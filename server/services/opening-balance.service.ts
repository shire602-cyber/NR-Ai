/**
 * Opening balances: bring a company's balances in when it starts using the
 * product. ONE journal entry (source "opening_balance") dated the opening date
 * posts the grid, with the difference going to "Opening Balance Equity".
 * Optional open customer invoices and vendor bills are created as posted
 * documents flagged `is_opening_balance`: they carry the receivable / payable
 * subledger but post NO revenue, expense or VAT (already in the opening
 * balances) and are left out of VAT returns. Their totals must equal the AR and
 * AP opening balances to the fils.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import {
  accounts,
  invoiceLines,
  invoices,
  openingBalances,
  type OpeningBalance,
} from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { assertPeriodNotLocked } from "./period-lock.service";
import { advanceSequencePast, previewSequenceJumps, type SequenceJump } from "./invoice-numbering.service";
import { recordAudit } from "./audit.service";
import { drizzleQueryable, resolveVendorWith } from "./vendor-contact.service";
import { applyMovementInTx, findAccount, isCostingEnabled } from "./inventory-costing.service";
import { uaeTodayYmd } from "./vat-period-status.service";
import { assertFilingPermission, postSettlementJournal, type FilingActor } from "./tax-filing.service";
import { fromFils, toFils } from "./tax-filing-core";
import {
  buildOpeningBalanceLines,
  parseOpeningCsv,
  reconcileSubledgers,
  validateOpeningDate,
  validateOpeningGrid,
  dayBefore,
  type OpeningIssue,
  type OpeningRowInput,
} from "./opening-balance";

type Tx = any;

export const OPENING_JOURNAL_SOURCE = "opening_balance";
export const OPENING_REVERSAL_SOURCE = "opening_balance_reversal";
export const OPENING_BALANCE_EQUITY = {
  code: "3040",
  nameEn: "Opening Balance Equity",
  nameAr: "رصيد افتتاحي - حقوق الملكية",
};

export interface OpeningDocInput {
  party?: unknown;
  number?: unknown;
  date?: unknown;
  dueDate?: unknown;
  amount?: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
}

export interface OpeningInput {
  asOfDate?: unknown;
  rows?: OpeningRowInput[];
  csv?: string | null;
  invoices?: OpeningDocInput[];
  bills?: OpeningDocInput[];
  /** Opening stock by item: it comes in on the opening date, inside the opening entry (Dr 1070) and as a stock movement. */
  openingStock?: Array<{ productId: string; quantity: number; unitCost: number }>;
}

export interface OpeningStockLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  value: number;
}

/** Validate the opening-stock rows against the company's tracked products. */
async function cleanOpeningStock(companyId: string, rows: OpeningInput["openingStock"]): Promise<{ lines: OpeningStockLine[]; errors: OpeningIssue[] }> {
  const lines: OpeningStockLine[] = [];
  const errors: OpeningIssue[] = [];
  const wanted = (rows ?? []).filter((r) => Number(r?.quantity) > 0);
  if (wanted.length === 0) return { lines, errors };
  const res: any = await db.execute(sql`SELECT id::text AS id, name, track_inventory FROM products WHERE company_id = ${companyId} AND id::text IN (${sql.join(wanted.map((r) => sql`${String(r.productId)}`), sql`, `)})`);
  const found = new Map<string, { name: string; track: boolean }>((res.rows ?? res).map((r: any) => [r.id, { name: r.name, track: !!r.track_inventory }]));
  for (const r of wanted) {
    const p = found.get(String(r.productId));
    const quantity = Math.trunc(Number(r.quantity));
    const unitCost = Number(r.unitCost);
    if (!p || !p.track) errors.push({ code: "OPENING_STOCK_INVALID", message: "An opening stock row names an item that is not a stock-tracked item of this company." });
    else if (!(quantity >= 1) || !Number.isFinite(unitCost) || unitCost < 0) errors.push({ code: "OPENING_STOCK_INVALID", message: `Opening stock of ${p.name}: a whole quantity and a cost of zero or more are needed.` });
    else lines.push({ productId: String(r.productId), name: p.name, quantity, unitCost, value: fromFils(toFils(quantity * unitCost)) });
  }
  return { lines, errors };
}

interface CleanDoc {
  party: string;
  number: string;
  date: string;
  dueDate: string | null;
  amount: number;
  currency: string;
  exchangeRate: number;
  base: number;
}

const isRealDate = (ymd: unknown): ymd is string => {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
};

function cleanDocs(kind: "invoice" | "bill", docs: OpeningDocInput[] | undefined, openingDate: string): { docs: CleanDoc[]; errors: OpeningIssue[] } {
  const errors: OpeningIssue[] = [];
  const out: CleanDoc[] = [];
  const seen = new Set<string>();
  const label = kind === "invoice" ? "Invoice" : "Bill";
  (docs ?? []).forEach((d, i) => {
    const row = i + 1;
    const party = typeof d.party === "string" ? d.party.trim() : "";
    const number = typeof d.number === "string" ? d.number.trim() : "";
    const amount = Number(d.amount);
    const currency = (typeof d.currency === "string" && d.currency.trim() ? d.currency.trim() : "AED").toUpperCase();
    const rate = currency === "AED" ? 1 : Number(d.exchangeRate);
    const problems: string[] = [];
    if (!party) problems.push(kind === "invoice" ? "customer name is required" : "vendor name is required");
    if (!number) problems.push("number is required");
    else if (seen.has(number)) problems.push(`number ${number} is used twice`);
    if (!isRealDate(d.date)) problems.push("date must be YYYY-MM-DD");
    else if (d.date > openingDate) problems.push(`date must be on or before the opening date (${openingDate})`);
    const due = d.dueDate === undefined || d.dueDate === null || d.dueDate === "" ? null : d.dueDate;
    if (due !== null && !isRealDate(due)) problems.push("due date must be YYYY-MM-DD");
    if (!Number.isFinite(amount) || toFils(amount) <= 0) problems.push("amount must be greater than zero");
    if (!/^[A-Z]{3}$/.test(currency)) problems.push("currency must be a 3-letter code");
    if (!Number.isFinite(rate) || rate <= 0) problems.push("exchange rate must be greater than zero");
    if (problems.length > 0) {
      errors.push({ code: `${kind.toUpperCase()}_INVALID`, row, message: `${label} row ${row}${number ? ` (${number})` : ""}: ${problems.join("; ")}.` });
      return;
    }
    seen.add(number);
    out.push({
      party,
      number,
      date: d.date as string,
      dueDate: due as string | null,
      amount: fromFils(toFils(amount)),
      currency,
      exchangeRate: rate,
      base: fromFils(toFils(amount * rate)),
    });
  });
  return { docs: out, errors };
}

/** Earliest transaction date of the company, ignoring opening balances themselves. */
export async function firstTransactionDate(companyId: string): Promise<string | null> {
  const res: any = await db.execute(sql`
    SELECT to_char(MIN(d), 'YYYY-MM-DD') AS first FROM (
      SELECT date AS d FROM journal_entries
        WHERE company_id = ${companyId} AND status = 'posted' AND source NOT IN ('opening_balance', 'opening_balance_reversal')
      UNION ALL SELECT date FROM invoices
        WHERE company_id = ${companyId} AND status NOT IN ('draft', 'void', 'cancelled') AND COALESCE(is_opening_balance, false) = false
      UNION ALL SELECT bill_date FROM vendor_bills
        WHERE company_id = ${companyId} AND status NOT IN ('draft', 'void', 'cancelled', 'pending', 'pending_approval') AND COALESCE(is_opening_balance, false) = false
      UNION ALL SELECT COALESCE(date, created_at) FROM receipts WHERE company_id = ${companyId}
    ) t`);
  return ((res.rows ?? res)[0]?.first as string | null) ?? null;
}

export async function getActiveOpeningBalance(companyId: string): Promise<OpeningBalance | null> {
  const rows = await db
    .select()
    .from(openingBalances)
    .where(and(eq(openingBalances.companyId, companyId), eq(openingBalances.status, "active")));
  return rows[0] ?? null;
}

export async function getOpeningBalanceOverview(companyId: string) {
  const [active, first, chart] = await Promise.all([
    getActiveOpeningBalance(companyId),
    firstTransactionDate(companyId),
    storage.getAccountsByCompanyId(companyId),
  ]);
  let documents = { invoices: 0, bills: 0 };
  if (active) {
    const inv: any = await db.execute(sql`SELECT count(*)::int AS n FROM invoices WHERE company_id = ${companyId} AND is_opening_balance = true AND status <> 'void'`);
    const bil: any = await db.execute(sql`SELECT count(*)::int AS n FROM vendor_bills WHERE company_id = ${companyId} AND is_opening_balance = true AND status <> 'void'`);
    documents = { invoices: (inv.rows ?? inv)[0]?.n ?? 0, bills: (bil.rows ?? bil)[0]?.n ?? 0 };
  }
  return {
    active: active
      ? { id: active.id, asOfDate: String(active.asOfDate).slice(0, 10), journalEntryId: active.journalEntryId, createdAt: active.createdAt, documents }
      : null,
    firstTransactionDate: first,
    suggestedDate: first ? dayBefore(first) : null,
    accounts: chart
      .filter((a) => ["asset", "liability", "equity"].includes(a.type) && a.isActive !== false && !a.isArchived)
      .map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, type: a.type }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export interface OpeningPreview {
  ok: boolean;
  errors: OpeningIssue[];
  parsedRows: OpeningRowInput[] | null;
  asOfDate: string | null;
  /** Things worth knowing that do not block posting (for example a jump in the invoice numbering). */
  warnings: Array<{ code: "INVOICE_NUMBER_GAP"; message: string; details: SequenceJump }>;
  totals: {
    debit: number;
    credit: number;
    balancingSide: "credit" | "debit" | "none";
    balancingAmount: number;
    ar: number;
    ap: number;
    openInvoicesTotal: number;
    openBillsTotal: number;
    /** Opening stock (quantity x cost) entered by item; part of the debit side when inventory is posted to the ledger. */
    stockValue: number;
  } | null;
}

/** Validate everything without writing. `parsedRows` is set when a CSV was supplied. */
export async function previewOpeningBalance(companyId: string, input: OpeningInput): Promise<OpeningPreview> {
  const errors: OpeningIssue[] = [];
  let rowsInput: OpeningRowInput[] = input.rows ?? [];
  let parsedRows: OpeningRowInput[] | null = null;

  if (typeof input.csv === "string" && input.csv.trim() !== "") {
    const parsed = parseOpeningCsv(input.csv);
    for (const e of parsed.errors) errors.push({ code: "CSV_INVALID", row: e.line, message: `CSV line ${e.line}: ${e.message}` });
    rowsInput = parsed.rows;
    parsedRows = parsed.rows;
  }

  const first = await firstTransactionDate(companyId);
  const dateCheck = validateOpeningDate(input.asOfDate, first, uaeTodayYmd());
  if (!dateCheck.ok) errors.push({ code: dateCheck.code, message: dateCheck.message });
  const openingDate = dateCheck.ok ? dateCheck.date : uaeTodayYmd();

  const chart = await storage.getAccountsByCompanyId(companyId);
  const grid = validateOpeningGrid(rowsInput, chart.map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, type: a.type })));
  if (!grid.ok) errors.push(...grid.errors);

  const inv = cleanDocs("invoice", input.invoices, openingDate);
  const bil = cleanDocs("bill", input.bills, openingDate);
  errors.push(...inv.errors, ...bil.errors);
  const stock = await cleanOpeningStock(companyId, input.openingStock);
  errors.push(...stock.errors);
  const stockValue = fromFils(stock.lines.reduce((sum, l) => sum + toFils(l.value), 0));
  const stockOnLedger = stockValue > 0 && (await isCostingEnabled(db, companyId));

  // Numbers already used by other documents of this company.
  if (inv.docs.length > 0) {
    const res: any = await db.execute(sql`SELECT number FROM invoices WHERE company_id = ${companyId} AND number IN (${sql.join(inv.docs.map((d) => sql`${d.number}`), sql`, `)})`);
    for (const r of res.rows ?? res) errors.push({ code: "INVOICE_NUMBER_EXISTS", message: `Invoice number ${r.number} already exists in this company.` });
  }

  let totals: OpeningPreview["totals"] = null;
  if (grid.ok) {
    const balance = (code: string) => grid.rows.find((r) => r.accountCode === code);
    const ar = balance(ACCOUNT_CODES.AR);
    const ap = balance(ACCOUNT_CODES.AP);
    const arBalance = ar ? fromFils(toFils(ar.debit) - toFils(ar.credit)) : 0;
    const apBalance = ap ? fromFils(toFils(ap.credit) - toFils(ap.debit)) : 0;
    const openInvoicesTotal = fromFils(inv.docs.reduce((s, d) => s + toFils(d.base), 0));
    const openBillsTotal = fromFils(bil.docs.reduce((s, d) => s + toFils(d.base), 0));
    // The stock goes into the same entry as a debit to Inventory, so it counts on the debit side: the balancing amount to
    // Opening Balance Equity is what is left after it.
    const diff = toFils(grid.totalDebit) + (stockOnLedger ? toFils(stockValue) : 0) - toFils(grid.totalCredit);
    totals = {
      debit: fromFils(toFils(grid.totalDebit) + (stockOnLedger ? toFils(stockValue) : 0)),
      credit: grid.totalCredit,
      balancingSide: diff === 0 ? "none" : diff > 0 ? "credit" : "debit",
      balancingAmount: fromFils(Math.abs(diff)),
      ar: arBalance,
      ap: apBalance,
      openInvoicesTotal,
      openBillsTotal,
      stockValue,
    };
    const tie = reconcileSubledgers({ arBalance, apBalance, openInvoicesTotal, openBillsTotal, documentsEntered: inv.docs.length + bil.docs.length > 0 });
    if (!tie.ok) errors.push(...tie.errors);
  }

  // A number in the sequence's own format moves the company's counter past it: say so, because UAE
  // tax invoices need sequential numbering. Numbering itself is unchanged.
  const jumps = await previewSequenceJumps(db, companyId, "invoice", inv.docs.map((d) => d.number));
  const warnings = jumps.map((j) => ({ code: "INVOICE_NUMBER_GAP" as const, message: j.message, details: j }));

  return { ok: errors.length === 0, errors, parsedRows, asOfDate: dateCheck.ok ? dateCheck.date : null, warnings, totals };
}

export async function ensureOpeningBalanceEquity(tx: Tx, companyId: string): Promise<{ id: string }> {
  const rows: Array<{ id: string; code: string; nameEn: string; type: string }> = await tx
    .select({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const found =
    rows.find((a) => a.type === "equity" && a.nameEn.trim().toLowerCase() === OPENING_BALANCE_EQUITY.nameEn.toLowerCase()) ??
    rows.find((a) => a.type === "equity" && a.code === OPENING_BALANCE_EQUITY.code);
  if (found) return { id: found.id };
  // Code 3040 may be taken by a custom account: fall back to the next free 30xx code.
  let code = OPENING_BALANCE_EQUITY.code;
  const used = new Set(rows.map((a) => a.code));
  for (let n = 3040; used.has(code) && n < 3100; n++) code = String(n + 1);
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code,
      nameEn: OPENING_BALANCE_EQUITY.nameEn,
      nameAr: OPENING_BALANCE_EQUITY.nameAr,
      description: "Balancing amount of the opening balances (auto-created)",
      type: "equity",
      subType: null,
      isVatAccount: false,
      vatType: null,
      isSystemAccount: false,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: accounts.id });
  return created;
}

export async function postOpeningBalance(args: { user: FilingActor; companyId: string; input: OpeningInput; req?: Request }) {
  const { user, companyId } = args;
  await assertFilingPermission(user, companyId, "write");

  if (await getActiveOpeningBalance(companyId)) {
    throw new AppError({
      message: "Opening balances were already entered for this company. Reverse them first to enter new ones.",
      statusCode: 409,
      code: "OPENING_BALANCE_EXISTS",
    });
  }
  const preview = await previewOpeningBalance(companyId, { ...args.input, csv: null });
  if (!preview.ok || !preview.asOfDate) {
    throw new AppError({
      message: preview.errors[0]?.message ?? "The opening balances are not valid.",
      statusCode: 422,
      code: "OPENING_BALANCE_INVALID",
      details: { errors: preview.errors },
    });
  }
  const openingDate = preview.asOfDate;
  await assertPeriodNotLocked(companyId, openingDate);

  const chart = await storage.getAccountsByCompanyId(companyId);
  const grid = validateOpeningGrid(args.input.rows ?? [], chart.map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, type: a.type })));
  if (!grid.ok) throw new AppError({ message: grid.errors[0].message, statusCode: 422, code: "OPENING_BALANCE_INVALID", details: { errors: grid.errors } });
  const invDocs = cleanDocs("invoice", args.input.invoices, openingDate).docs;
  const billDocs = cleanDocs("bill", args.input.bills, openingDate).docs;
  const stock = await cleanOpeningStock(companyId, args.input.openingStock);
  if (stock.errors.length > 0) throw new AppError({ message: stock.errors[0].message, statusCode: 422, code: "OPENING_BALANCE_INVALID", details: { errors: stock.errors } });

  // Gaps the imported invoice numbers open in the sequence, read inside the transaction BEFORE the
  // opening invoices are inserted (afterwards they would count as "existing"); recorded in the audit log below.
  let sequenceJumps: SequenceJump[] = [];
  const result = await db.transaction(async (tx: Tx) => {
    sequenceJumps = await previewSequenceJumps(tx, companyId, "invoice", invDocs.map((d) => d.number));
    const equity = await ensureOpeningBalanceEquity(tx, companyId);
    const [ob] = await tx
      .insert(openingBalances)
      .values({ companyId, asOfDate: openingDate, status: "active", createdBy: user.id })
      .returning();
    // Opening stock by item: the items' quantity and cost come in on the opening date. With inventory posted to the ledger
    // the value is a debit to Inventory (1070) in THIS entry (so the balancing amount to Opening Balance Equity already
    // counts it), and each item gets a stock movement dated the opening date.
    const stockValue = fromFils(stock.lines.reduce((sum, l) => sum + toFils(l.value), 0));
    const stockRows: typeof grid.rows = [];
    if (stock.lines.length > 0) {
      if (await isCostingEnabled(tx, companyId)) {
        const inv = await findAccount(tx, companyId, ACCOUNT_CODES.INVENTORY, "asset");
        if (inv && stockValue > 0) stockRows.push({ accountId: inv.id, accountCode: ACCOUNT_CODES.INVENTORY, accountName: "Opening stock", debit: stockValue, credit: 0 });
      }
      for (const l of stock.lines) {
        await applyMovementInTx(tx, {
          productId: l.productId,
          companyId,
          type: "adjustment",
          quantity: l.quantity,
          unitCost: l.unitCost,
          valueOverride: l.value,
          reference: "Opening stock",
          notes: `Opening balances as of ${openingDate}`,
          userId: user.id,
          date: new Date(`${openingDate}T00:00:00Z`),
          skipJournal: true,
        });
        await tx.execute(sql`UPDATE products SET cost_price = ${l.unitCost} WHERE id = ${l.productId} AND company_id = ${companyId} AND (cost_price IS NULL OR cost_price = 0)`);
      }
    }
    const entryId = await postSettlementJournal(tx, {
      companyId,
      ymd: openingDate,
      memo: `Opening balances as of ${openingDate}`,
      source: OPENING_JOURNAL_SOURCE,
      sourceId: ob.id,
      userId: user.id,
      lines: buildOpeningBalanceLines([...grid.rows, ...stockRows], equity.id),
    });
    await tx.update(openingBalances).set({ journalEntryId: entryId }).where(eq(openingBalances.id, ob.id));

    // Open customer invoices: posted documents that post NOTHING (no revenue, no VAT).
    for (const d of invDocs) {
      const [inv] = await tx
        .insert(invoices)
        .values({
          companyId,
          number: d.number,
          customerName: d.party,
          date: new Date(`${d.date}T00:00:00Z`),
          dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00Z`) : null,
          currency: d.currency,
          exchangeRate: d.exchangeRate,
          baseCurrencyAmount: d.base,
          subtotal: d.amount,
          vatAmount: 0,
          total: d.amount,
          status: "sent",
          isOpeningBalance: true,
        } as any)
        .returning({ id: invoices.id });
      await tx.insert(invoiceLines).values({
        invoiceId: inv.id,
        description: "Opening balance",
        quantity: 1,
        unitPrice: d.amount,
        vatRate: 0,
        vatSupplyType: "out_of_scope",
      } as any);
    }
    // The customer's own numbers may be in the sequence's format (INV-2026-00003): move the
    // company's counter past the highest one per year so normal numbering carries on after it
    // instead of running into the imported numbers one by one. (Bills have no sequence.)
    await advanceSequencePast(tx, companyId, "invoice", invDocs.map((d) => d.number));
    // Open vendor bills, likewise: approved, no journal, no VAT.
    for (const d of billDocs) {
      // One contacts table: the opening bill is linked to (or creates) the vendor contact.
      const vendor = await resolveVendorWith(drizzleQueryable(tx), companyId, { vendorName: d.party });
      const res: any = await tx.execute(sql`
        INSERT INTO vendor_bills (company_id, vendor_name, bill_number, bill_date, due_date, currency, subtotal, vat_amount,
                                  total_amount, amount_paid, status, exchange_rate, is_opening_balance, notes, vendor_id)
        VALUES (${companyId}, ${d.party}, ${d.number}, ${d.date}::date, ${d.dueDate}::date, ${d.currency}, ${d.amount}, 0,
                ${d.amount}, 0, 'approved', ${d.exchangeRate}, true, 'Opening balance', ${vendor.vendorId})
        RETURNING id`);
      const billId = (res.rows ?? res)[0].id;
      await tx.execute(sql`
        INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount)
        VALUES (${billId}, 'Opening balance', 1, ${d.amount}, 0, ${d.amount})`);
    }
    return { id: ob.id, journalEntryId: entryId };
  });

  await recordAudit({
    userId: user.id,
    companyId,
    action: "opening_balance.post",
    entityType: "opening_balance",
    entityId: result.id,
    after: {
      asOfDate: openingDate,
      journalEntryId: result.journalEntryId,
      accounts: grid.rows.length,
      invoices: invDocs.length,
      bills: billDocs.length,
      openingStockItems: stock.lines.length,
      ...(sequenceJumps.length > 0 ? { invoiceNumberJumps: sequenceJumps } : {}),
    },
    req: args.req,
  });
  // The jump in the invoice numbering is its own audit record: it has to be explainable later.
  for (const jump of sequenceJumps) {
    await recordAudit({
      userId: user.id,
      companyId,
      action: "invoice_sequence.jump",
      entityType: "invoice_number_sequence",
      entityId: result.id,
      after: jump,
      extra: { reason: "opening_balance", openingBalanceId: result.id },
      req: args.req,
    });
  }
  return { ...result, asOfDate: openingDate, totals: preview.totals, warnings: preview.warnings };
}

/**
 * Reverse the opening balances (a reversing entry + the open documents voided) so they can be
 * re-entered. Refused when the opening period is locked, a VAT return was filed for a period on or
 * after the opening date, or the opening documents already have payments against them.
 */
export async function reverseOpeningBalance(args: { user: FilingActor; companyId: string; reason: unknown; req?: Request }) {
  const { user, companyId } = args;
  await assertFilingPermission(user, companyId, "write");
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 5) {
    throw new AppError({ message: "A reason (at least 5 characters) is required to reverse the opening balances.", statusCode: 400, code: "REASON_REQUIRED" });
  }
  const active = await getActiveOpeningBalance(companyId);
  if (!active) throw new AppError({ message: "There are no opening balances to reverse.", statusCode: 404, code: "OPENING_BALANCE_NOT_FOUND" });
  const asOf = String(active.asOfDate).slice(0, 10);
  await assertPeriodNotLocked(companyId, asOf);

  const filed: any = await db.execute(sql`
    SELECT r.period_end FROM tax_filings f JOIN vat_returns r ON r.id = f.return_id
     WHERE f.company_id = ${companyId} AND f.kind = 'vat' AND r.period_end::date >= ${asOf}::date LIMIT 1`);
  if ((filed.rows ?? filed).length > 0) {
    throw new AppError({
      message: "A VAT return has been filed for a period on or after the opening date, so the opening balances can no longer be reversed.",
      statusCode: 409,
      code: "OPENING_BALANCE_VAT_FILED",
    });
  }
  const paid: any = await db.execute(sql`
    SELECT (SELECT count(*) FROM invoices WHERE company_id = ${companyId} AND is_opening_balance = true AND status NOT IN ('sent', 'void')) AS inv,
           (SELECT count(*) FROM vendor_bills WHERE company_id = ${companyId} AND is_opening_balance = true AND status NOT IN ('approved', 'void') ) AS bil,
           (SELECT count(*) FROM vendor_bills WHERE company_id = ${companyId} AND is_opening_balance = true AND COALESCE(amount_paid, 0) > 0) AS paid`);
  const p = (paid.rows ?? paid)[0];
  if (Number(p.inv) + Number(p.bil) + Number(p.paid) > 0) {
    throw new AppError({
      message: "Payments have already been recorded against the opening invoices or bills, so the opening balances cannot be reversed.",
      statusCode: 409,
      code: "OPENING_BALANCE_IN_USE",
    });
  }

  await db.transaction(async (tx: Tx) => {
    const locked: any = await tx.execute(sql`SELECT status FROM opening_balances WHERE id = ${active.id} FOR UPDATE`);
    if ((locked.rows ?? locked)[0]?.status !== "active") {
      throw new AppError({ message: "The opening balances were already reversed.", statusCode: 409, code: "OPENING_BALANCE_ALREADY_REVERSED" });
    }
    const original: any = await tx.execute(sql`SELECT a.id AS account_id, jl.debit, jl.credit, jl.description FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = ${active.journalEntryId}`);
    const lines = (original.rows ?? original).map((l: any) => ({
      accountId: l.account_id,
      debit: Number(l.credit),
      credit: Number(l.debit),
      description: `Reversal - ${l.description ?? "opening balance"}`,
    }));
    const reversalId = await postSettlementJournal(tx, {
      companyId,
      ymd: asOf,
      memo: `Reversal of opening balances as of ${asOf}: ${reason}`,
      source: OPENING_REVERSAL_SOURCE,
      sourceId: active.id,
      userId: user.id,
      lines,
    });
    if (reversalId && active.journalEntryId) {
      await tx.execute(sql`UPDATE journal_entries SET reversed_entry_id = ${active.journalEntryId}, reversal_reason = ${reason} WHERE id = ${reversalId}`);
    }
    await tx.execute(sql`UPDATE invoices SET status = 'void' WHERE company_id = ${companyId} AND is_opening_balance = true AND status <> 'void'`);
    await tx.execute(sql`UPDATE vendor_bills SET status = 'void' WHERE company_id = ${companyId} AND is_opening_balance = true AND status <> 'void'`);
    await tx
      .update(openingBalances)
      .set({ status: "reversed", reversedBy: user.id, reversedAt: new Date(), reversalReason: reason })
      .where(eq(openingBalances.id, active.id));
  });

  await recordAudit({
    userId: user.id,
    companyId,
    action: "opening_balance.reverse",
    entityType: "opening_balance",
    entityId: active.id,
    before: { asOfDate: asOf },
    extra: { reason },
    req: args.req,
  });
  return { reversed: true, asOfDate: asOf };
}
