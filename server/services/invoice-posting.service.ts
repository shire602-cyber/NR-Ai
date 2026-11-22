// Sales ledger: revenue recognition, void, credit notes and debit notes (W3-A).
//
// Every journal goes through the ledger kernel (server/ledger). Policy:
//
//   * Issue (draft -> sent/posted) posts ONE entry, atomically with the status
//     change, inside the invoice's document lock:
//       Dr  Accounts Receivable                       total
//       Cr  revenue account per supply-type role       net (after discounts)
//             standard 4010 · zero-rated 4060 · exempt 4070 · out of scope 4030
//       Cr  VAT Payable (Output VAT)                  VAT
//     Foreign-currency documents post every line at the invoice's rate with
//     the original amounts on the line (foreignCurrency / foreign*).
//   * Void reverses the ORIGINAL entry through reverseBySource (exact mirror:
//     same accounts, base amounts, foreign amounts, rate, cost centre). Never
//     recomputed from document totals (R03-01, R03-04).
//   * A credit note reverses the original revenue / VAT legs proportionally per
//     original account, in base currency at the original rate; the part of the
//     credit that exceeds the invoice's open balance becomes a customer credit
//     (liability) instead of a negative receivable (R03-08, R03-21, R03-22).
//
// Status is server-owned and moves only through `invoiceMachine`
// (invoice-state-machine.ts) with conditional transitionRow updates.

import { type JournalLineKey, journalLine, journalMemo } from "@shared/journal-memo";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  companies,
  customerContacts,
  customerCredits,
  invoiceLines,
  invoices,
  journalLines,
  products as products_,
  type CustomerCredit,
  type Invoice,
  type InvoiceLine,
} from "../../shared/schema";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { lockDocumentInTx, withDocumentLock, LOCK_NS } from "./document-lock";
import {
  DEFAULT_BASE_CURRENCY,
  documentCurrency,
  isForeignCurrency,
  loadBaseCurrency,
  postJournal,
  reverseBySource,
  transitionRow,
  type LedgerTx,
  type PostJournalLineInput,
} from "../ledger";
import { allocate, fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import {
  REVENUE_ACCOUNT_CODES,
  type RevenueAccountRole,
  type SupplyType,
} from "../../shared/vat-classification";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { allocateInvoiceNumber, type InvoiceDocType } from "./invoice-numbering.service";
import {
  computeSalesDocument,
  storedLineToTotalsInput,
  type SalesDocumentTotals,
} from "./document-totals.service";
import { invoiceMachine, settlementStatus } from "./invoice-state-machine";
import { has, resolve } from "../platform/service-registry";
import { receivableSettlementPartsSql } from "../reporting/settlement";

// W4-B inventory / COGS hooks (provided by server/services/inventory), and C2 the fixed-asset
// disposal hooks (server/services/fixed-assets/disposal-credit.ts). Called on the document's
// transaction so stock, cost of sales and the disposal result commit atomically with the entry.
type InventoryHook = (tx: LedgerTx, args: Record<string, unknown>) => Promise<unknown>;
async function inventoryHook(name: string, tx: LedgerTx, args: Record<string, unknown>) {
  if (has(name)) await resolve<InventoryHook>(name)(tx, args);
}

const log = createLogger("invoice-posting");

/**
 * @deprecated W5-C (R14-19): the base currency is per company — use
 * `loadBaseCurrency(companyId, tx)` / `baseCurrencyOf(company)` from server/ledger.
 * Kept only as the default for modules that have not moved yet.
 */
export const BASE_CURRENCY = DEFAULT_BASE_CURRENCY;

/** Ledger codes used by the sales cycle. */
export const SALES_CODES = {
  AR: "1040",
  VAT_OUTPUT: "2020",
  REVENUE_ALT: "4020",
  CUSTOMER_CREDITS: "2055",
  CUSTOMER_ADVANCES: "2050",
  FX_GAIN: "4090",
  FX_LOSS: "5140",
} as const;

const ISSUED_STATUSES = ["sent", "posted", "partial", "paid"] as const;
export function isIssuedStatus(status: string | null | undefined): boolean {
  return (ISSUED_STATUSES as readonly string[]).includes(String(status));
}

type AccountRow = typeof accounts.$inferSelect;

const EXTRA_ACCOUNT_SPECS: Record<
  string,
  Pick<AccountRow, "nameEn" | "nameAr" | "type" | "subType" | "description">
> = {
  [SALES_CODES.CUSTOMER_CREDITS]: {
    nameEn: "Customer Credit Balances",
    nameAr: "أرصدة دائنة للعملاء",
    type: "liability",
    subType: "current_liability",
    description: "Credit notes and refunds owed to customers (W3-A)",
  },
};

/** Find an account by code, creating it from the default chart when missing. */
async function getOrCreateAccount(tx: LedgerTx, companyId: string, code: string): Promise<string> {
  const [found] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  if (found) return found.id;
  const tpl = defaultChartOfAccounts.find((a) => a.code === code);
  const spec = tpl
    ? {
        nameEn: tpl.nameEn,
        nameAr: tpl.nameAr,
        type: tpl.type,
        subType: tpl.subType,
        description: tpl.description,
        isVatAccount: tpl.isVatAccount,
        vatType: tpl.vatType,
      }
    : { ...EXTRA_ACCOUNT_SPECS[code], isVatAccount: false, vatType: null };
  if (!spec?.nameEn) throw new DomainError("CHART_OF_ACCOUNTS_MISSING", 422, { code });
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code,
      nameEn: spec.nameEn,
      nameAr: spec.nameAr ?? null,
      description: spec.description ?? null,
      type: spec.type,
      subType: spec.subType ?? null,
      isVatAccount: spec.isVatAccount ?? false,
      vatType: spec.vatType ?? null,
      isSystemAccount: true,
    })
    .onConflictDoNothing()
    .returning({ id: accounts.id });
  if (created) {
    log.info({ companyId, code }, "Created missing sales-cycle account");
    return created.id;
  }
  const [again] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return again.id;
}

export interface SalesAccounts {
  ar: string;
  vatOutput: string | null;
  revenue: Record<RevenueAccountRole, string>;
}

/**
 * Resolve the accounts a sales document posts to. A chart without A/R or a
 * standard revenue account is "not seeded" (422); the supply-type accounts
 * (4060 / 4070 / 4030) are created on demand so the split is never folded
 * back into 4010.
 */
export async function resolveSalesAccounts(
  tx: LedgerTx,
  companyId: string,
  needed: { roles: Set<RevenueAccountRole>; vat: boolean }
): Promise<SalesAccounts> {
  const rows: AccountRow[] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const ar = rows.find((a) => a.code === SALES_CODES.AR && a.isSystemAccount);
  const standard =
    rows.find(
      (a) =>
        a.isSystemAccount && a.type === "income" && a.code === REVENUE_ACCOUNT_CODES.standard_sales
    ) ??
    rows.find(
      (a) => a.isSystemAccount && a.type === "income" && a.code === SALES_CODES.REVENUE_ALT
    );
  if (!ar || !standard) {
    throw new DomainError(
      "CHART_OF_ACCOUNTS_MISSING",
      422,
      { missing: !ar ? SALES_CODES.AR : REVENUE_ACCOUNT_CODES.standard_sales },
      "Revenue accounts are missing from the chart of accounts. Seed the default chart first (POST /api/companies/:id/seed-accounts)."
    );
  }
  const vat = rows.find(
    (a) => a.isVatAccount && a.vatType === "output" && a.code === SALES_CODES.VAT_OUTPUT
  );
  if (needed.vat && !vat) {
    throw new DomainError(
      "VAT_ACCOUNT_MISSING",
      422,
      { code: SALES_CODES.VAT_OUTPUT },
      "Output VAT was charged but the VAT Payable account (2020) is missing from the chart of accounts."
    );
  }
  const revenue: Record<RevenueAccountRole, string> = {
    standard_sales: standard.id,
    zero_rated_sales: "",
    exempt_sales: "",
    out_of_scope_revenue: "",
  };
  for (const role of needed.roles) {
    if (role === "standard_sales") continue;
    revenue[role] = await getOrCreateAccount(tx, companyId, REVENUE_ACCOUNT_CODES[role]);
  }
  return { ar: ar.id, vatOutput: vat?.id ?? null, revenue };
}

export async function getCustomerCreditAccount(tx: LedgerTx, companyId: string): Promise<string> {
  return getOrCreateAccount(tx, companyId, SALES_CODES.CUSTOMER_CREDITS);
}

export async function getFxAccounts(
  tx: LedgerTx,
  companyId: string
): Promise<{ gain: string; loss: string }> {
  return {
    gain: await getOrCreateAccount(tx, companyId, SALES_CODES.FX_GAIN),
    loss: await getOrCreateAccount(tx, companyId, SALES_CODES.FX_LOSS),
  };
}

export async function getArAccount(tx: LedgerTx, companyId: string): Promise<string> {
  const [ar] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.code, SALES_CODES.AR),
        eq(accounts.isSystemAccount, true)
      )
    );
  if (!ar) throw new DomainError("CHART_OF_ACCOUNTS_MISSING", 422, { missing: SALES_CODES.AR });
  return ar.id;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Rate (company base per 1 document unit) of a stored document; "1" when it is in the base. */
export function invoiceRate(
  invoice: { currency?: string | null; exchangeRate?: unknown },
  baseCurrency: string
): string {
  const currency = documentCurrency(invoice.currency, baseCurrency);
  if (currency === baseCurrency) return "1";
  const r = Number(invoice.exchangeRate);
  if (!Number.isFinite(r) || r <= 0) {
    throw new DomainError(
      "NO_EXCHANGE_RATE",
      422,
      { currency },
      `No exchange rate on the ${currency} invoice`
    );
  }
  return String(invoice.exchangeRate);
}

function isForeign(invoice: { currency?: string | null }, baseCurrency: string): boolean {
  return isForeignCurrency(invoice.currency, baseCurrency);
}

export function toBase(docFils: number, rate: string): number {
  if (docFils === 0) return 0;
  if (rate === "1") return docFils;
  return mulRate(docFils, rate);
}

const dateOnly = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

/** Compute a stored document's totals from its stored lines. */
export function totalsForStoredDocument(
  invoice: Pick<Invoice, "discountType" | "discountValue" | "reverseCharge">,
  lines: InvoiceLine[]
): SalesDocumentTotals {
  return computeSalesDocument(
    lines.map((l) =>
      storedLineToTotalsInput({
        ...l,
        quantity: Math.abs(Number(l.quantity)),
        unitPrice: Math.abs(Number(l.unitPrice)),
      })
    ),
    {
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
      reverseCharge: invoice.reverseCharge,
    }
  );
}

/** Lock the invoice row (FOR UPDATE) inside `tx` and return it. */
export async function lockInvoice(tx: LedgerTx, invoiceId: string, companyId: string) {
  const res = await tx.execute(
    sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId} FOR UPDATE`
  );
  const rows = ((res as { rows?: unknown[] }).rows ?? res) as unknown[];
  if (!rows.length) throw new DomainError("INVOICE_NOT_FOUND", 404);
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  return row as Invoice;
}

/**
 * Settlement figures for an invoice in its own currency (fils) — the one settlement rule in
 * server/reporting/settlement.ts (D5c), shared with aging, the dashboard and the invoice list.
 */
export async function invoiceSettlement(
  tx: LedgerTx,
  invoiceId: string
): Promise<{ paidFils: number; creditedFils: number; appliedFils: number }> {
  const parts = receivableSettlementPartsSql("si");
  const res = await tx.execute(sql`
    SELECT ${sql.raw(parts.paid)}::text AS paid,
           ${sql.raw(parts.credited)}::text AS credited,
           ${sql.raw(parts.applied)}::text AS applied
      FROM invoices si WHERE si.id = ${invoiceId}
  `);
  const row = (((res as { rows?: unknown[] }).rows ?? res) as Array<Record<string, string>>)[0];
  return {
    paidFils: toFils(row?.paid ?? "0", { rounding: "halfUp" }),
    creditedFils: toFils(row?.credited ?? "0", { rounding: "halfUp" }),
    appliedFils: toFils(row?.applied ?? "0", { rounding: "halfUp" }),
  };
}

/** Open (unsettled) balance of an invoice, in its currency (fils, never negative). */
export async function invoiceOpenFils(tx: LedgerTx, invoice: Invoice): Promise<number> {
  const s = await invoiceSettlement(tx, invoice.id);
  const totalFils = toFils(invoice.total, { rounding: "halfUp" });
  return Math.max(0, totalFils - s.paidFils - s.creditedFils - s.appliedFils);
}

/**
 * Move an issued invoice to the status its settlement implies (sent/posted →
 * partial → paid, and back when a credit note is voided). Conditional update
 * through the invoice state machine.
 */
export async function refreshSettlementStatus(tx: LedgerTx, invoiceId: string): Promise<Invoice> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv || !isIssuedStatus(inv.status)) return inv;
  const s = await invoiceSettlement(tx, invoiceId);
  const totalFils = toFils(inv.total, { rounding: "halfUp" });
  const target = settlementStatus(
    inv.status,
    totalFils,
    s.paidFils + s.creditedFils + s.appliedFils
  );
  if (target === inv.status) return inv;
  const row = await transitionRow<Invoice>(
    tx,
    invoices,
    invoiceId,
    inv.status,
    target,
    {},
    {
      machine: invoiceMachine,
    }
  );
  return row ?? inv;
}

// ─── Revenue recognition ────────────────────────────────────────────────────

interface RevenueBucket {
  role: RevenueAccountRole;
  costCenterId: string | null;
  /** X5 (J1 L1): an explicit income account for the bucket (service revenue); else by role. */
  accountId: string | null;
  netFils: number;
}

/** A sales line's posting hints: cost centre and, for a standard-rated service, its account. */
export interface RevenueLineHint {
  costCenterId?: string | null;
  revenueAccountId?: string | null;
}

function revenueBuckets(totals: SalesDocumentTotals, lines: RevenueLineHint[]) {
  const map = new Map<string, RevenueBucket>();
  totals.lines.forEach((l, i) => {
    const role = l.classification.revenueAccountRole;
    const cc = lines[i]?.costCenterId ?? null;
    // Only standard-rated lines move to the service revenue account: the zero-rated / exempt /
    // out-of-scope accounts carry the VAT treatment the VAT-to-GL reconciliation relies on.
    const accountId = role === "standard_sales" ? (lines[i]?.revenueAccountId ?? null) : null;
    const key = `${role}|${cc ?? ""}|${accountId ?? ""}`;
    const b = map.get(key) ?? { role, costCenterId: cc, accountId, netFils: 0 };
    b.netFils += l.netFils;
    map.set(key, b);
  });
  return [...map.values()].filter((b) => b.netFils > 0);
}

/**
 * X5 (J1 L1): income account per line by item type. A line linked to a service product posts
 * to the chart's service revenue account (4020 "Service Revenue", when the chart has it as an
 * active income account); goods and free-text lines post to sales revenue (4010) as before.
 */
export async function revenueLineHints(
  tx: LedgerTx,
  companyId: string,
  lines: Array<{
    costCenterId?: string | null;
    productId?: string | null;
    revenueAccountId?: string | null;
  }>
): Promise<RevenueLineHint[]> {
  // E3 (J1-r3): a line that names its income account posts there, when that is still one of the
  // company's active income accounts; otherwise the item-type rule below applies.
  const chosenIds = [...new Set(lines.map((l) => l.revenueAccountId).filter(Boolean) as string[])];
  const chosen = new Set<string>();
  if (chosenIds.length > 0) {
    const rows: Array<{ id: string }> = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          inArray(accounts.id, chosenIds),
          eq(accounts.type, "income"),
          eq(accounts.isActive, true),
          eq(accounts.isArchived, false)
        )
      );
    for (const r of rows) chosen.add(r.id);
  }
  const explicit = (l: { revenueAccountId?: string | null }) =>
    l.revenueAccountId && chosen.has(l.revenueAccountId) ? l.revenueAccountId : null;
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean) as string[])];
  if (productIds.length === 0) {
    return lines.map((l) => ({
      costCenterId: l.costCenterId ?? null,
      revenueAccountId: explicit(l),
    }));
  }
  const products: Array<{ id: string; productType: string | null }> = await tx
    .select({ id: products_.id, productType: products_.productType })
    .from(products_)
    .where(and(eq(products_.companyId, companyId), inArray(products_.id, productIds)));
  const services = new Set(products.filter((p) => p.productType === "service").map((p) => p.id));
  let serviceAccount: string | null = null;
  if (services.size > 0) {
    const [row]: Array<{ id: string }> = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.companyId, companyId),
          eq(accounts.code, SALES_CODES.REVENUE_ALT),
          eq(accounts.type, "income"),
          eq(accounts.isActive, true),
          eq(accounts.isArchived, false)
        )
      );
    serviceAccount = row?.id ?? null;
  }
  return lines.map((l) => ({
    costCenterId: l.costCenterId ?? null,
    revenueAccountId:
      explicit(l) ?? (l.productId && services.has(l.productId) ? serviceAccount : null),
  }));
}

/** Build the issue entry lines for an invoice or debit note (pure given accounts). */
export function buildRevenueLines(args: {
  invoice: Pick<Invoice, "number" | "customerName" | "currency">;
  rate: string;
  totals: SalesDocumentTotals;
  lines: RevenueLineHint[];
  accounts: SalesAccounts;
  /** The company's functional currency (W5-C). */
  baseCurrency: string;
}): PostJournalLineInput[] {
  const { invoice, rate, totals, accounts: acc, baseCurrency } = args;
  const foreign = isForeign(invoice, baseCurrency);
  const cur = documentCurrency(invoice.currency, baseCurrency);
  const fx = (docFils: number, side: "debit" | "credit") =>
    foreign
      ? {
          foreignCurrency: cur,
          exchangeRate: rate,
          ...(side === "debit"
            ? { foreignDebit: fromFils(docFils) }
            : { foreignCredit: fromFils(docFils) }),
        }
      : {};

  const out: PostJournalLineInput[] = [];
  let creditBase = 0;
  for (const b of revenueBuckets(totals, args.lines)) {
    const base = toBase(b.netFils, rate);
    if (base <= 0) continue;
    creditBase += base;
    out.push({
      accountId: b.accountId ?? acc.revenue[b.role],
      creditFils: base,
      costCenterId: b.costCenterId,
      ...journalLine(roleLineKey(b.role), { ref: invoice.number }),
      ...fx(b.netFils, "credit"),
    });
  }
  if (totals.vatFils > 0) {
    if (!acc.vatOutput) throw new DomainError("VAT_ACCOUNT_MISSING", 422);
    const base = toBase(totals.vatFils, rate);
    creditBase += base;
    out.push({
      accountId: acc.vatOutput,
      creditFils: base,
      systemVat: true,
      ...journalLine("vatOutput", { ref: invoice.number }),
      ...fx(totals.vatFils, "credit"),
    });
  }
  out.unshift({
    accountId: acc.ar,
    debitFils: creditBase,
    controlLeg: "receivables",
    ...(foreign
      ? journalLine("invoiceReceivableFx", {
          ref: invoice.number,
          party: invoice.customerName,
          currency: cur,
          amount: fromFils(totals.totalFils),
          rate,
        })
      : journalLine("invoiceReceivable", { ref: invoice.number, party: invoice.customerName })),
    ...fx(totals.totalFils, "debit"),
  });
  return out;
}

function roleLineKey(role: RevenueAccountRole): JournalLineKey {
  switch (role) {
    case "zero_rated_sales":
      return "zeroRatedSales";
    case "exempt_sales":
      return "exemptSales";
    case "out_of_scope_revenue":
      return "outOfScopeRevenue";
    default:
      return "salesRevenue";
  }
}

/** Post the revenue entry for an invoice (or debit note) inside `tx`. Idempotent. */
async function postRevenueInTx(tx: LedgerTx, invoice: Invoice, userId: string): Promise<boolean> {
  const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));
  const totals = totalsForStoredDocument(invoice, lines);
  if (totals.totalFils <= 0) {
    throw new DomainError(
      "INVOICE_HAS_NO_VALUE",
      422,
      undefined,
      "Invoice has no value to recognise"
    );
  }
  const roles = new Set(totals.lines.map((l) => l.classification.revenueAccountRole));
  const acc = await resolveSalesAccounts(tx, invoice.companyId, {
    roles,
    vat: totals.vatFils > 0,
  });
  const baseCurrency = await loadBaseCurrency(invoice.companyId, tx);
  const rate = invoiceRate(invoice, baseCurrency);
  const journalLinesIn = buildRevenueLines({
    invoice,
    rate,
    totals,
    lines: await revenueLineHints(tx, invoice.companyId, lines),
    accounts: acc,
    baseCurrency,
  });
  const docMemoKey = invoice.invoiceType === "debit_note" ? "debitNote" : "salesInvoice";
  const { replayed, entry } = await postJournal(
    {
      companyId: invoice.companyId,
      date: dateOnly(invoice.date),
      ...journalMemo(docMemoKey, { ref: invoice.number, party: invoice.customerName }),
      status: "posted",
      source: "invoice",
      sourceId: invoice.id,
      idempotencyKey: `invoice:${invoice.id}:revenue`,
      allowFutureDate: true,
      lines: journalLinesIn,
    },
    { actorId: userId, tx }
  );
  if (!replayed && invoice.invoiceType === "debit_note" && invoice.originalInvoiceId) {
    // D2 (N5): a debit note on a disposal invoice adjusts the disposal result, not revenue.
    await inventoryHook("fixedAssets.onDisposalInvoiceDebited", tx, {
      companyId: invoice.companyId,
      originalInvoiceId: invoice.originalInvoiceId,
      debitNoteId: invoice.id,
      debitNoteNumber: invoice.number,
      entryId: entry.id,
      date: dateOnly(invoice.date),
      userId,
    });
  }
  if (!replayed) await inventoryHook("inventory.onInvoiceIssued", tx, { invoice, lines, userId });
  return !replayed;
}

async function hasPostedRevenue(tx: LedgerTx, companyId: string, invoiceId: string) {
  const res = await tx.execute(sql`
    SELECT 1 FROM journal_entries
     WHERE company_id = ${companyId} AND source = 'invoice' AND source_id = ${invoiceId}
       AND status = 'posted' AND entry_kind <> 'reversal' LIMIT 1`);
  return (((res as { rows?: unknown[] }).rows ?? res) as unknown[]).length > 0;
}

/**
 * Issue a draft invoice or debit note: draft -> sent|posted and the revenue
 * entry, in ONE transaction under the invoice's document lock. Parallel calls
 * post exactly once; the losers see the issued state (no-op).
 */
/**
 * FTA rule (X6a): only a VAT-registered supplier may charge VAT, and its tax invoice must show
 * its own TRN. A company without a TRN is treated as not VAT registered whatever its filing
 * frequency setting: issuing any document that charges VAT above zero is refused, with a
 * pointer to the company settings. Zero-rated / out-of-scope documents ("Invoice") are fine.
 * Only the issue path checks this; invoices already issued keep their data.
 */
export async function assertSupplierTrnForTaxInvoice(
  tx: LedgerTx,
  inv: Pick<Invoice, "companyId" | "vatAmount">
): Promise<void> {
  if (!(Number(inv.vatAmount) > 0)) return;
  const [co] = await tx
    .select({ trn: companies.trnVatNumber })
    .from(companies)
    .where(eq(companies.id, inv.companyId));
  if (!co) return;
  if (!(co.trn ?? "").trim()) {
    throw new DomainError(
      "SUPPLIER_TRN_REQUIRED",
      422,
      { settingsPath: "/company-profile", fields: { trnVatNumber: ["Company TRN is required"] } },
      "Your company has no Tax Registration Number (TRN), so it cannot charge VAT. Set the VAT on each line to 0% (out of scope), or add your 15-digit TRN in Company settings before issuing a tax invoice with VAT."
    );
  }
}

export async function issueInvoice(
  invoiceId: string,
  companyId: string,
  userId: string,
  target: "sent" | "posted" = "sent"
): Promise<{ invoice: Invoice; posted: boolean; alreadyIssued: boolean }> {
  return withDocumentLock(invoiceId, LOCK_NS.INVOICE_POSTING, (tx) =>
    issueLocked(tx, invoiceId, companyId, userId, target)
  );
}

/**
 * WQ1 (cash sale): issue a draft inside the caller's ledger transaction, under the same document
 * lock, so the invoice, its revenue entry and its payment commit together or not at all.
 */
export async function issueInvoiceInTx(
  tx: LedgerTx,
  invoiceId: string,
  companyId: string,
  userId: string,
  target: "sent" | "posted" = "sent"
): Promise<{ invoice: Invoice; posted: boolean; alreadyIssued: boolean }> {
  await lockDocumentInTx(tx, invoiceId, LOCK_NS.INVOICE_POSTING);
  return issueLocked(tx, invoiceId, companyId, userId, target);
}

async function issueLocked(
  tx: LedgerTx,
  invoiceId: string,
  companyId: string,
  userId: string,
  target: "sent" | "posted"
): Promise<{ invoice: Invoice; posted: boolean; alreadyIssued: boolean }> {
  {
    const inv = await lockInvoice(tx, invoiceId, companyId);
    if (inv.status !== "draft") {
      if (isIssuedStatus(inv.status)) return { invoice: inv, posted: false, alreadyIssued: true };
      throw new DomainError("INVALID_TRANSITION", 422, { from: inv.status, to: target });
    }
    if (inv.invoiceType === "credit_note") {
      throw new DomainError(
        "USE_CREDIT_NOTE_ISSUE",
        422,
        undefined,
        "Issue credit notes through /api/credit-notes/:id/issue"
      );
    }
    await assertSupplierTrnForTaxInvoice(tx, inv);
    const row = await transitionRow<Invoice>(
      tx,
      invoices,
      invoiceId,
      "draft",
      target,
      { issuedAt: new Date() },
      { machine: invoiceMachine }
    );
    if (!row) return { invoice: inv, posted: false, alreadyIssued: true };
    const posted = (await hasPostedRevenue(tx, companyId, invoiceId))
      ? false
      : await postRevenueInTx(tx, row, userId);
    return { invoice: row, posted, alreadyIssued: false };
  }
}

/**
 * REPAIR path: an issued invoice with no revenue entry (legacy data, chart
 * seeded after issue) gets one now. Returns true when an entry was created.
 */
export async function postInvoiceRevenueJournal(
  invoice: Pick<Invoice, "id" | "companyId">,
  userId: string
): Promise<boolean> {
  return withDocumentLock(invoice.id, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const inv = await lockInvoice(tx, invoice.id, invoice.companyId);
    if (await hasPostedRevenue(tx, inv.companyId, inv.id)) return false;
    return postRevenueInTx(tx, inv, userId);
  });
}

// ─── Void ───────────────────────────────────────────────────────────────────

/**
 * Void (or cancel) an invoice: mirror-reverse every posted revenue entry via
 * the kernel (dated on the original date when its period is open), then move
 * the status. Refused when payments, credit notes or applied credits exist.
 */
export async function voidInvoice(
  invoiceId: string,
  companyId: string,
  userId: string,
  target: "void" | "cancelled",
  reason?: string
): Promise<{ invoice: Invoice; reversedEntryIds: string[] }> {
  return withDocumentLock(invoiceId, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const inv = await lockInvoice(tx, invoiceId, companyId);
    if (inv.status === target) return { invoice: inv, reversedEntryIds: [] };
    // B1 (NH3): the invoice that billed an asset disposal carries the disposal's receivable and
    // VAT; voiding it alone would leave the disposal moving proceeds that were never invoiced.
    const disposal = await tx.execute(sql`
      SELECT id FROM fixed_assets
       WHERE company_id = ${companyId} AND disposal_invoice_id = ${invoiceId}
         AND status = 'disposed' LIMIT 1`);
    if ((((disposal as { rows?: unknown[] }).rows ?? disposal) as unknown[]).length > 0) {
      throw new DomainError(
        "INVOICE_BILLS_ASSET_DISPOSAL",
        409,
        { invoiceId },
        "This invoice bills a fixed-asset disposal. Issue a credit note for a price change; the disposal itself stays in the fixed-asset register."
      );
    }
    if (!invoiceMachine.can(inv.status, target)) {
      throw new DomainError(
        "INVALID_TRANSITION",
        422,
        { from: inv.status, to: target },
        `Invalid invoice status transition: ${inv.status} → ${target}`
      );
    }
    const s = await invoiceSettlement(tx, invoiceId);
    if (s.paidFils > 0) {
      throw new DomainError(
        "PAID_INVOICE_CANNOT_VOID",
        409,
        undefined,
        "This invoice has recorded payments and cannot be voided directly. Issue a credit note (and a refund if cash was received) so the cash already collected is properly accounted for."
      );
    }
    if (s.creditedFils > 0 || s.appliedFils > 0) {
      throw new DomainError(
        "INVOICE_HAS_CREDITS",
        409,
        undefined,
        "This invoice has credit notes or applied customer credits. Void those first, or credit the remaining balance instead of voiding."
      );
    }
    const reversals = await reverseBySource(
      companyId,
      "invoice",
      invoiceId,
      { void: true, reason: reason ?? `Invoice ${target}` },
      { actorId: userId, tx }
    );
    if (inv.invoiceType === "debit_note") {
      // D2 (N5): voiding a debit note on a disposal invoice restores the disposal result.
      await inventoryHook("fixedAssets.onDisposalCreditVoided", tx, {
        companyId,
        originalInvoiceId: inv.originalInvoiceId ?? null,
        creditNoteId: invoiceId,
        userId,
      });
    }
    await inventoryHook("inventory.onInvoiceVoided", tx, {
      companyId,
      invoiceId,
      number: inv.number,
      userId,
      reason,
    });
    const row = await transitionRow<Invoice>(
      tx,
      invoices,
      invoiceId,
      inv.status,
      target,
      {},
      {
        machine: invoiceMachine,
      }
    );
    if (!row) throw new DomainError("INVOICE_STATE_CHANGED", 409);
    log.info({ invoiceId, reversals: reversals.length }, "Invoice voided via kernel mirror");
    return { invoice: row, reversedEntryIds: reversals.map((r) => r.reversal.id) };
  });
}

// ─── Credit notes ───────────────────────────────────────────────────────────

interface OriginalLeg {
  accountId: string;
  costCenterId: string | null;
  kind: "ar" | "vat" | "revenue";
  role: RevenueAccountRole | null;
  /** Remaining creditable base fils on this leg (original minus prior credits). */
  remainingBase: number;
  remainingForeign: number;
}

async function originalLegs(
  tx: LedgerTx,
  original: Invoice,
  acc: { ar: string; vat: string | null }
): Promise<OriginalLeg[]> {
  // Original revenue entry(ies) of the invoice (non-reversal, still posted).
  const res = await tx.execute(sql`
    SELECT jl.account_id, jl.cost_center_id, a.code,
           SUM(jl.debit)::text AS debit, SUM(jl.credit)::text AS credit,
           SUM(COALESCE(jl.foreign_debit, 0))::text AS fdebit,
           SUM(COALESCE(jl.foreign_credit, 0))::text AS fcredit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = ${original.companyId} AND je.source = 'invoice'
       AND je.source_id = ${original.id} AND je.status = 'posted'
       AND je.entry_kind <> 'reversal' AND je.reversed_by_entry_id IS NULL
     GROUP BY jl.account_id, jl.cost_center_id, a.code`);
  const rows = ((res as { rows?: unknown[] }).rows ?? res) as Array<Record<string, string | null>>;
  if (!rows.length) {
    throw new DomainError(
      "INVOICE_NOT_POSTED",
      409,
      undefined,
      "The invoice has no posted revenue entry to credit. Issue it first."
    );
  }
  // Prior credit notes on this invoice: their debits per (account, cost centre).
  const prior = await tx.execute(sql`
    SELECT jl.account_id, jl.cost_center_id,
           SUM(jl.debit)::text AS debit, SUM(jl.credit)::text AS credit,
           SUM(COALESCE(jl.foreign_debit, 0))::text AS fdebit,
           SUM(COALESCE(jl.foreign_credit, 0))::text AS fcredit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN invoices cn ON cn.id = je.source_id
     WHERE je.company_id = ${original.companyId} AND je.source = 'invoice'
       AND cn.original_invoice_id = ${original.id} AND cn.invoice_type = 'credit_note'
       AND je.status = 'posted' AND je.entry_kind <> 'reversal' AND je.reversed_by_entry_id IS NULL
     GROUP BY jl.account_id, jl.cost_center_id`);
  const priorRows = ((prior as { rows?: unknown[] }).rows ?? prior) as Array<
    Record<string, string | null>
  >;
  const key = (a: string | null, c: string | null) => `${a}|${c ?? ""}`;
  const priorMap = new Map(priorRows.map((r) => [key(r.account_id, r.cost_center_id), r]));
  const f = (v: string | null | undefined) => toFils(v ?? "0", { rounding: "halfUp" });
  const codeRole: Record<string, RevenueAccountRole> = {
    [REVENUE_ACCOUNT_CODES.zero_rated_sales]: "zero_rated_sales",
    [REVENUE_ACCOUNT_CODES.exempt_sales]: "exempt_sales",
    [REVENUE_ACCOUNT_CODES.out_of_scope_revenue]: "out_of_scope_revenue",
  };
  return rows.map((r) => {
    const p = priorMap.get(key(r.account_id, r.cost_center_id));
    const isAr = r.account_id === acc.ar;
    const isVat = !isAr && r.account_id === acc.vat;
    // Original revenue/VAT legs are credits; prior credit notes debit them.
    const remainingBase = isAr
      ? f(r.debit) - f(r.credit) - (f(p?.credit) - f(p?.debit))
      : f(r.credit) - f(r.debit) - (f(p?.debit) - f(p?.credit));
    const remainingForeign = isAr
      ? f(r.fdebit) - f(r.fcredit) - (f(p?.fcredit) - f(p?.fdebit))
      : f(r.fcredit) - f(r.fdebit) - (f(p?.fdebit) - f(p?.fcredit));
    return {
      accountId: String(r.account_id),
      costCenterId: r.cost_center_id ?? null,
      kind: isAr ? "ar" : isVat ? "vat" : "revenue",
      role: isAr || isVat ? null : (codeRole[String(r.code)] ?? "standard_sales"),
      remainingBase,
      remainingForeign,
    };
  });
}

export interface CreditNoteResult {
  creditNote: Invoice;
  journalEntryId: string;
  customerCreditId: string | null;
  customerCreditFils: number;
  capped: boolean;
}

/**
 * Post an issued credit note's entry, mirroring the original invoice legs.
 * `mode: "remaining"` credits exactly what is left on every original leg.
 */
async function postCreditNoteInTx(args: {
  tx: LedgerTx;
  original: Invoice;
  creditNote: Invoice;
  totals: SalesDocumentTotals;
  lines: Array<{ costCenterId?: string | null }>;
  mode: "lines" | "remaining";
  creditDocFils: number;
  userId: string;
}): Promise<{ entryId: string; customerCreditId: string | null; customerCreditFils: number }> {
  const { tx, original, creditNote, totals, mode, userId, creditDocFils } = args;
  const companyId = original.companyId;
  const baseCurrency = await loadBaseCurrency(companyId, tx);
  const rate = invoiceRate(original, baseCurrency);
  const foreign = isForeign(original, baseCurrency);
  const cur = documentCurrency(original.currency, baseCurrency);
  const arId = await getArAccount(tx, companyId);
  const [vatRow] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.code, SALES_CODES.VAT_OUTPUT),
        eq(accounts.isVatAccount, true)
      )
    );
  const legs = await originalLegs(tx, original, { ar: arId, vat: vatRow?.id ?? null });
  const revenueLegs = legs.filter((l) => l.kind === "revenue");
  const vatLeg = legs.find((l) => l.kind === "vat");

  type Debit = { leg: OriginalLeg; base: number; foreign: number };
  const debits: Debit[] = [];
  if (mode === "remaining") {
    for (const leg of [...revenueLegs, ...(vatLeg ? [vatLeg] : [])]) {
      if (leg.remainingBase > 0)
        debits.push({ leg, base: leg.remainingBase, foreign: leg.remainingForeign });
    }
  } else {
    // Net per revenue role (document currency) → split over that role's legs
    // (e.g. two cost centres) by their remaining amounts, at the original rate.
    const perRole = new Map<RevenueAccountRole, number>();
    for (const l of totals.lines) {
      const role = l.classification.revenueAccountRole;
      perRole.set(role, (perRole.get(role) ?? 0) + l.netFils);
    }
    for (const [role, docFils] of perRole) {
      if (docFils <= 0) continue;
      const roleLegs = revenueLegs.filter((l) => l.role === role && l.remainingBase > 0);
      if (!roleLegs.length) {
        throw new DomainError(
          "CREDIT_LINE_NOT_ON_INVOICE",
          422,
          { role },
          `The invoice has no ${role.replace(/_/g, " ")} revenue left to credit.`
        );
      }
      const base = toBase(docFils, rate);
      const remaining = sumFils(roleLegs.map((l) => l.remainingBase));
      if (base > remaining) {
        throw new DomainError(
          "CREDIT_EXCEEDS_REMAINING",
          409,
          { role, requested: fromFils(base), remaining: fromFils(remaining) },
          "Credit amount exceeds the remaining creditable revenue on the invoice."
        );
      }
      const baseParts = allocate(
        base,
        roleLegs.map((l) => l.remainingBase)
      );
      const docParts = allocate(
        docFils,
        roleLegs.map((l) => l.remainingBase)
      );
      roleLegs.forEach((leg, i) => {
        if (baseParts[i] > 0) debits.push({ leg, base: baseParts[i], foreign: docParts[i] });
      });
    }
    if (totals.vatFils > 0) {
      if (!vatLeg || vatLeg.remainingBase <= 0) {
        throw new DomainError("CREDIT_EXCEEDS_REMAINING", 409, { leg: "vat" });
      }
      const base = Math.min(toBase(totals.vatFils, rate), vatLeg.remainingBase);
      debits.push({ leg: vatLeg, base, foreign: totals.vatFils });
    }
  }
  if (!debits.length) throw new DomainError("FULLY_CREDITED", 409);

  const debitBase = sumFils(debits.map((d) => d.base));

  // Split the receivable side: what the invoice still owes is reduced; any
  // excess (invoice already paid) becomes a customer credit liability.
  // invoiceSettlement already counts this credit note (issued in this tx).
  const s = await invoiceSettlement(tx, original.id);
  const totalFils = toFils(original.total, { rounding: "halfUp" });
  const openBeforeFils = Math.max(
    0,
    totalFils - s.paidFils - s.appliedFils - (s.creditedFils - creditDocFils)
  );
  const arDocFils = Math.min(openBeforeFils, creditDocFils);
  const excessDocFils = creditDocFils - arDocFils;
  const arBase = excessDocFils === 0 ? debitBase : Math.min(debitBase, toBase(arDocFils, rate));
  const excessBase = debitBase - arBase;

  const fx = (docFils: number, side: "debit" | "credit") =>
    foreign
      ? {
          foreignCurrency: cur,
          exchangeRate: rate,
          ...(side === "debit"
            ? { foreignDebit: fromFils(docFils) }
            : { foreignCredit: fromFils(docFils) }),
        }
      : {};
  const jl: PostJournalLineInput[] = debits.map((d) => ({
    accountId: d.leg.accountId,
    debitFils: d.base,
    costCenterId: d.leg.costCenterId,
    ...(d.leg.kind === "vat" ? { systemVat: true } : {}),
    ...journalLine(d.leg.kind === "vat" ? "reverseVat" : "reverseRevenue", {
      ref: creditNote.number,
    }),
    ...(foreign && d.foreign > 0 ? fx(d.foreign, "debit") : {}),
  }));
  if (arBase > 0) {
    jl.push({
      accountId: arId,
      creditFils: arBase,
      controlLeg: "receivables",
      ...journalLine("reduceReceivable", { ref: creditNote.number }),
      ...(foreign && arDocFils > 0 ? fx(arDocFils, "credit") : {}),
    });
  }
  let customerCreditId: string | null = null;
  let liabilityId: string | null = null;
  if (excessBase > 0) {
    liabilityId = await getCustomerCreditAccount(tx, companyId);
    jl.push({
      accountId: liabilityId,
      creditFils: excessBase,
      ...journalLine("customerCreditLine", { ref: creditNote.number }),
      ...(foreign && excessDocFils > 0 ? fx(excessDocFils, "credit") : {}),
    });
  }

  const { entry } = await postJournal(
    {
      companyId,
      date: dateOnly(creditNote.date),
      ...journalMemo(mode === "remaining" ? "creditNoteReversal" : "creditNotePartial", {
        ref: creditNote.number,
        invoice: original.number,
      }),
      status: "posted",
      source: "invoice",
      sourceId: creditNote.id,
      idempotencyKey: `credit_note:${creditNote.id}:post`,
      allowFutureDate: true,
      lines: jl,
    },
    { actorId: userId, tx }
  );

  if (excessDocFils > 0 && liabilityId) {
    const [credit] = await tx
      .insert(customerCredits)
      .values({
        companyId,
        contactId: original.contactId ?? null,
        customerName: original.customerName,
        sourceType: "credit_note",
        sourceId: creditNote.id,
        invoiceId: original.id,
        currency: cur,
        exchangeRate: Number(rate),
        liabilityAccountId: liabilityId,
        amount: Number(fromFils(excessDocFils)),
        remaining: Number(fromFils(excessDocFils)),
        status: "open",
        createdBy: userId,
      })
      .returning({ id: customerCredits.id });
    customerCreditId = credit.id;
  }
  return { entryId: entry.id, customerCreditId, customerCreditFils: excessDocFils };
}

export interface CreditNoteLineInput {
  description: string;
  quantity: number;
  unitPriceFils: number;
  vatRate: number;
  vatSupplyType: SupplyType;
  discountType?: string | null;
  discountValue?: number | null;
  productId?: string | null;
  costCenterId?: string | null;
  marginScheme?: boolean | null;
  /** Margin-scheme purchase cost (major units, document currency). */
  marginPurchaseCost?: number | null;
}

/**
 * Create AND issue a credit note against an invoice in one transaction under
 * the invoice's lock. Omitted lines = credit the remaining balance exactly.
 */
export async function createAndIssueCreditNote(args: {
  invoiceId: string;
  companyId: string;
  userId: string;
  lines?: CreditNoteLineInput[];
  /** S1: product lines return to stock (default) or are written off (false). */
  restock?: boolean;
  date?: string;
  reason?: string;
}): Promise<CreditNoteResult> {
  return withDocumentLock(args.invoiceId, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const original = await lockInvoice(tx, args.invoiceId, args.companyId);
    assertCreditable(original);
    const draft = await insertCreditNoteDocument(tx, original, args);
    return issueCreditNoteLocked(tx, original, draft.creditNote, draft.mode, args.userId);
  });
}

function assertCreditable(original: Invoice) {
  if (original.invoiceType === "credit_note") {
    throw new DomainError(
      "CN_OF_CN",
      400,
      undefined,
      "Cannot create a credit note of a credit note."
    );
  }
  if (!isIssuedStatus(original.status)) {
    throw new DomainError(
      "INVOICE_NOT_ISSUED",
      409,
      { status: original.status },
      "Only an issued invoice can be credited."
    );
  }
}

/** Insert a credit-note document (status draft) with its lines. */
export async function insertCreditNoteDocument(
  tx: LedgerTx,
  original: Invoice,
  args: {
    companyId: string;
    lines?: CreditNoteLineInput[];
    date?: string;
    reason?: string;
    restock?: boolean;
  }
): Promise<{ creditNote: Invoice; mode: "lines" | "remaining" }> {
  const originalLines: InvoiceLine[] = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, original.id));
  let mode: "lines" | "remaining" = "lines";
  let docLines: Array<Omit<CreditNoteLineInput, "unitPriceFils"> & { unitPrice: number }>;
  let header: Partial<Invoice> = {};
  let totals: SalesDocumentTotals;
  if (args.lines && args.lines.length) {
    totals = computeSalesDocument(
      args.lines.map((l) => ({
        ...l,
        marginCostFils: l.marginScheme
          ? toFils(Math.abs(Number(l.marginPurchaseCost ?? 0)), { rounding: "halfUp" })
          : null,
      })),
      { resolve: false }
    );
    docLines = args.lines.map((l) => ({ ...l, unitPrice: Number(fromFils(l.unitPriceFils)) }));
  } else {
    mode = "remaining";
    const s = await invoiceSettlement(tx, original.id);
    const totalFils = toFils(original.total, { rounding: "halfUp" });
    if (s.creditedFils >= totalFils) {
      throw new DomainError(
        "FULLY_CREDITED",
        409,
        undefined,
        "This invoice has already been fully credited."
      );
    }
    if (s.creditedFils === 0) {
      // Mirror the invoice exactly (same lines, same document discount).
      docLines = originalLines.map((l) => ({
        description: l.description,
        quantity: Math.abs(Number(l.quantity)),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        vatSupplyType: (l.vatSupplyType ?? "standard_rated") as SupplyType,
        discountType: l.discountType,
        discountValue: l.discountValue,
        productId: l.productId,
        costCenterId: l.costCenterId,
        marginScheme: l.marginScheme,
        marginPurchaseCost: l.marginPurchaseCost,
      }));
      header = { discountType: original.discountType, discountValue: original.discountValue };
      totals = totalsForStoredDocument(original, originalLines);
    } else {
      // Remaining balance after earlier partial credits: one line per role.
      const orig = totalsForStoredDocument(original, originalLines);
      const remainingSub =
        toFils(original.subtotal, { rounding: "halfUp" }) -
        (await loadPriorCreditedSubtotal(tx, original));
      const remainingTotal = totalFils - s.creditedFils;
      const remainingVat = remainingTotal - remainingSub;
      docLines = [
        {
          description: `Remaining balance of ${original.number}`,
          quantity: 1,
          unitPrice: Number(fromFils(Math.max(0, remainingSub))),
          vatRate: remainingVat > 0 ? 0.05 : 0,
          vatSupplyType: remainingVat > 0 ? "standard_rated" : "zero_rated",
        },
      ];
      totals = {
        ...orig,
        lines: [],
        subtotalFils: Math.max(0, remainingSub),
        vatFils: Math.max(0, remainingVat),
        totalFils: remainingTotal,
        discountFils: 0,
      };
    }
  }
  const date = args.date ? new Date(`${args.date}T00:00:00.000Z`) : new Date();
  const number = await allocateInvoiceNumber(args.companyId, "credit_note", date, tx);
  const rate = invoiceRate(original, await loadBaseCurrency(args.companyId, tx));
  const [creditNote] = await tx
    .insert(invoices)
    .values({
      companyId: args.companyId,
      number,
      customerName: original.customerName,
      customerTrn: original.customerTrn,
      customerAddress: original.customerAddress,
      contactId: original.contactId,
      date,
      currency: original.currency,
      exchangeRate: Number(rate),
      baseCurrencyAmount: -Number(fromFils(toBase(totals.totalFils, rate))),
      subtotal: -Number(fromFils(totals.subtotalFils)),
      vatAmount: -Number(fromFils(totals.vatFils)),
      total: -Number(fromFils(totals.totalFils)),
      discountAmount: Number(fromFils(totals.discountFils)),
      discountType: header.discountType ?? null,
      discountValue: header.discountValue ?? null,
      status: "draft",
      invoiceType: "credit_note",
      originalInvoiceId: original.id,
      reverseCharge: original.reverseCharge,
      placeOfSupplyEmirate: original.placeOfSupplyEmirate,
      notes: args.reason ?? null,
      restock: args.restock ?? null,
    })
    .returning();
  for (let i = 0; i < docLines.length; i++) {
    const l = docLines[i];
    await tx.insert(invoiceLines).values({
      invoiceId: creditNote.id,
      description: `[Credit] ${l.description}`,
      quantity: -Math.abs(Number(l.quantity)),
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      vatSupplyType: l.vatSupplyType,
      discountType: l.discountType ?? null,
      discountValue: l.discountValue ?? null,
      discountAmount: totals.lines[i] ? Number(fromFils(totals.lines[i].lineDiscountFils)) : 0,
      netAmount: totals.lines[i] ? -Number(fromFils(totals.lines[i].netFils)) : null,
      productId: l.productId ?? null,
      costCenterId: l.costCenterId ?? null,
      marginScheme: l.marginScheme ?? false,
      marginPurchaseCost: l.marginScheme ? (l.marginPurchaseCost ?? null) : null,
    });
  }
  return { creditNote, mode };
}

async function loadPriorCreditedSubtotal(
  tx: LedgerTx,
  invoice: Pick<Invoice, "id" | "companyId">
): Promise<number> {
  const res = await tx.execute(sql`
    SELECT COALESCE(SUM(-subtotal), 0)::text AS sub FROM invoices
     WHERE original_invoice_id = ${invoice.id} AND company_id = ${invoice.companyId}
       AND invoice_type = 'credit_note'
       AND status NOT IN ('void', 'cancelled', 'draft')`);
  const row = (((res as { rows?: unknown[] }).rows ?? res) as Array<Record<string, string>>)[0];
  return toFils(row?.sub ?? "0", { rounding: "halfUp" });
}

/** Issue a draft credit note: post its mirrored entry and move it to sent. */
async function issueCreditNoteLocked(
  tx: LedgerTx,
  original: Invoice,
  creditNote: Invoice,
  mode: "lines" | "remaining",
  userId: string
): Promise<CreditNoteResult> {
  const cnLines: InvoiceLine[] = await tx
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, creditNote.id));
  const totals =
    mode === "remaining"
      ? ({
          lines: [],
          subtotalFils: toFils(-creditNote.subtotal, { rounding: "halfUp" }),
          vatFils: toFils(-creditNote.vatAmount, { rounding: "halfUp" }),
          totalFils: toFils(-creditNote.total, { rounding: "halfUp" }),
        } as unknown as SalesDocumentTotals)
      : totalsForStoredDocument(creditNote, cnLines);
  const cnTotalFils = toFils(-creditNote.total, { rounding: "halfUp" });

  // Cap: never credit more than the invoice total in aggregate.
  const s = await invoiceSettlement(tx, original.id);
  const origTotal = toFils(original.total, { rounding: "halfUp" });
  const remaining = origTotal - s.creditedFils;
  if (remaining <= 0)
    throw new DomainError(
      "FULLY_CREDITED",
      409,
      undefined,
      "This invoice has already been fully credited."
    );
  if (cnTotalFils > remaining) {
    throw new DomainError(
      "CREDIT_EXCEEDS_REMAINING",
      409,
      { requested: fromFils(cnTotalFils), remaining: fromFils(remaining) },
      `Credit amount ${fromFils(cnTotalFils)} exceeds the remaining creditable balance ${fromFils(remaining)}.`
    );
  }
  const effectiveMode = cnTotalFils === remaining ? "remaining" : mode;

  const issued = await transitionRow<Invoice>(
    tx,
    invoices,
    creditNote.id,
    "draft",
    "sent",
    { issuedAt: new Date() },
    { machine: invoiceMachine }
  );
  if (!issued) throw new DomainError("CREDIT_NOTE_NOT_DRAFT", 409);

  const posted = await postCreditNoteInTx({
    tx,
    original,
    creditNote: issued,
    totals,
    lines: cnLines,
    mode: effectiveMode,
    creditDocFils: cnTotalFils,
    userId,
  });
  // C2 (RM3): a credit note on a disposal invoice adjusts the disposal result, not revenue.
  await inventoryHook("fixedAssets.onDisposalInvoiceCredited", tx, {
    companyId: original.companyId,
    originalInvoiceId: original.id,
    creditNoteId: issued.id,
    creditNoteNumber: issued.number,
    entryId: posted.entryId,
    date: dateOnly(issued.date),
    userId,
  });
  await inventoryHook("inventory.onCreditNoteIssued", tx, {
    original,
    creditNote: issued,
    lines: cnLines,
    userId,
    // S1: "return to stock?" — false writes the goods off (no stock in, COGS stays).
    restock: issued.restock !== false,
  });
  await refreshSettlementStatus(tx, original.id);
  return {
    creditNote: issued,
    journalEntryId: posted.entryId,
    customerCreditId: posted.customerCreditId,
    customerCreditFils: posted.customerCreditFils,
    capped: mode === "remaining" && s.creditedFils > 0,
  };
}

/** Issue a standalone draft credit note (POST /api/credit-notes/:id/issue). */
export async function issueDraftCreditNote(
  creditNoteId: string,
  companyId: string,
  userId: string
): Promise<CreditNoteResult> {
  const [cn] = await db.select().from(invoices).where(eq(invoices.id, creditNoteId));
  if (!cn || cn.companyId !== companyId || cn.invoiceType !== "credit_note") {
    throw new DomainError("CREDIT_NOTE_NOT_FOUND", 404);
  }
  if (!cn.originalInvoiceId) throw new DomainError("CREDIT_NOTE_HAS_NO_INVOICE", 422);
  return withDocumentLock(cn.originalInvoiceId, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const original = await lockInvoice(tx, cn.originalInvoiceId!, companyId);
    assertCreditable(original);
    const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, creditNoteId));
    if (fresh.status !== "draft") throw new DomainError("CREDIT_NOTE_NOT_DRAFT", 409);
    return issueCreditNoteLocked(tx, original, fresh, "lines", userId);
  });
}

/** Create a standalone DRAFT credit note (no journal until issued). */
export async function createDraftCreditNote(args: {
  invoiceId: string;
  companyId: string;
  lines?: CreditNoteLineInput[];
  date?: string;
  reason?: string;
  restock?: boolean;
}): Promise<Invoice> {
  return withDocumentLock(args.invoiceId, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const original = await lockInvoice(tx, args.invoiceId, args.companyId);
    assertCreditable(original);
    if (!args.lines?.length) {
      const s = await invoiceSettlement(tx, original.id);
      if (s.creditedFils > 0) {
        throw new DomainError(
          "CREDIT_LINES_REQUIRED",
          422,
          undefined,
          "This invoice is already partly credited: list the lines to credit."
        );
      }
    }
    const { creditNote } = await insertCreditNoteDocument(tx, original, args);
    return creditNote;
  });
}

/**
 * Void an issued credit note: mirror-reverse its entry, close its unused
 * customer credit and restore the invoice's settlement status. Refused when
 * the credit it created has already been applied or refunded.
 */
export async function voidCreditNote(
  creditNoteId: string,
  companyId: string,
  userId: string,
  reason?: string
): Promise<Invoice> {
  const [cn] = await db.select().from(invoices).where(eq(invoices.id, creditNoteId));
  if (!cn || cn.companyId !== companyId || cn.invoiceType !== "credit_note") {
    throw new DomainError("CREDIT_NOTE_NOT_FOUND", 404);
  }
  const lockId = cn.originalInvoiceId ?? cn.id;
  return withDocumentLock(lockId, LOCK_NS.INVOICE_POSTING, async (tx) => {
    const fresh = await lockInvoice(tx, creditNoteId, companyId);
    if (fresh.status === "void") return fresh;
    if (fresh.status === "draft") {
      const row = await transitionRow<Invoice>(
        tx,
        invoices,
        creditNoteId,
        "draft",
        "void",
        {},
        {
          machine: invoiceMachine,
        }
      );
      return row ?? fresh;
    }
    const credits = await tx
      .select()
      .from(customerCredits)
      .where(
        and(
          eq(customerCredits.companyId, companyId),
          eq(customerCredits.sourceType, "credit_note"),
          eq(customerCredits.sourceId, creditNoteId)
        )
      );
    for (const c of credits as CustomerCredit[]) {
      if (Number(c.remaining) !== Number(c.amount) && c.status !== "void") {
        throw new DomainError(
          "CUSTOMER_CREDIT_USED",
          409,
          { creditId: c.id },
          "The customer credit from this credit note has been applied or refunded. Reverse that first."
        );
      }
    }
    await reverseBySource(
      companyId,
      "invoice",
      creditNoteId,
      { void: true, reason: reason ?? "Credit note voided" },
      { actorId: userId, tx }
    );
    await inventoryHook("fixedAssets.onDisposalCreditVoided", tx, {
      companyId,
      originalInvoiceId: fresh.originalInvoiceId ?? null,
      creditNoteId,
      userId,
    });
    await inventoryHook("inventory.onCreditNoteVoided", tx, {
      companyId,
      creditNoteId,
      number: fresh.number,
      userId,
    });
    if (credits.length) {
      await tx
        .update(customerCredits)
        .set({ status: "void", remaining: 0, updatedAt: new Date() })
        .where(
          inArray(
            customerCredits.id,
            credits.map((c: CustomerCredit) => c.id)
          )
        );
    }
    const row = await transitionRow<Invoice>(
      tx,
      invoices,
      creditNoteId,
      fresh.status,
      "void",
      {},
      {
        machine: invoiceMachine,
      }
    );
    if (!row) throw new DomainError("CREDIT_NOTE_STATE_CHANGED", 409);
    if (cn.originalInvoiceId) await refreshSettlementStatus(tx, cn.originalInvoiceId);
    return row;
  });
}

// ─── Debit notes ────────────────────────────────────────────────────────────

/** Allocate a document number for a sales document type inside `tx`. */
export function allocateSalesNumber(
  tx: LedgerTx,
  companyId: string,
  docType: InvoiceDocType,
  date: Date
): Promise<string> {
  return allocateInvoiceNumber(companyId, docType, date, tx);
}

/** Used by tests/diagnostics: the journal lines of an entry. */
export async function entryLines(entryId: string) {
  return db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
}

// ─── Customer defaults (R03-10, R03-25) ─────────────────────────────────────

export interface CustomerHeaderInput {
  contactId?: string | null;
  customerName?: string | null;
  customerTrn?: string | null;
  customerAddress?: string | null;
  paymentTerms?: string | null;
  placeOfSupplyEmirate?: string | null;
  dueDate?: string | null;
  date: string;
}

export interface CustomerHeader {
  contactId: string | null;
  customerName: string;
  customerTrn: string | null;
  customerAddress: string | null;
  paymentTerms: string | null;
  placeOfSupplyEmirate: string | null;
  dueDate: string | null;
}

/**
 * Fill the customer header from the linked contact (TRN, address, payment
 * terms, emirate) and the company (place-of-supply fallback); compute the due
 * date from the payment terms when none is given. Explicit values win.
 */
export async function resolveCustomerHeader(
  companyId: string,
  input: CustomerHeaderInput,
  helpers: {
    dueDateFromTerms: (d: string, t: string | null | undefined) => string | null;
    termsFromDays: (n: number | null | undefined) => string | null;
  },
  tx: LedgerTx = db
): Promise<CustomerHeader> {
  let contact: typeof customerContacts.$inferSelect | undefined;
  if (input.contactId) {
    [contact] = await tx
      .select()
      .from(customerContacts)
      .where(
        and(eq(customerContacts.id, input.contactId), eq(customerContacts.companyId, companyId))
      );
    if (!contact) throw new DomainError("CONTACT_NOT_FOUND", 404, { contactId: input.contactId });
  }
  const customerName = (input.customerName || contact?.name || "").trim();
  if (!customerName) {
    throw new DomainError(
      "CUSTOMER_REQUIRED",
      400,
      { fields: { customerName: ["Customer name or contactId is required"] } },
      "Customer name or contactId is required"
    );
  }
  const address =
    input.customerAddress ??
    (contact
      ? [contact.address, contact.city, contact.country]
          .filter((x) => x && String(x).trim())
          .join(", ") || null
      : null);
  const paymentTerms =
    input.paymentTerms ?? (contact ? helpers.termsFromDays(contact.paymentTerms) : null) ?? "net30";
  let emirate = input.placeOfSupplyEmirate ?? contact?.emirate ?? null;
  if (!emirate) {
    const [co] = await tx
      .select({ emirate: companies.emirate })
      .from(companies)
      .where(eq(companies.id, companyId));
    emirate = co?.emirate ?? null;
  }
  return {
    contactId: contact?.id ?? input.contactId ?? null,
    customerName,
    customerTrn: input.customerTrn ?? contact?.trnNumber ?? null,
    customerAddress: address,
    paymentTerms,
    placeOfSupplyEmirate: emirate,
    dueDate: input.dueDate ?? helpers.dueDateFromTerms(input.date, paymentTerms),
  };
}

/** Standard-rated supplies of a VAT-registered company need a place of supply (VAT 201 Box 1). */
export async function assertPlaceOfSupply(
  companyId: string,
  emirate: string | null,
  supplyTypes: string[],
  tx: LedgerTx = db
): Promise<void> {
  if (emirate || !supplyTypes.includes("standard_rated")) return;
  const [co] = await tx
    .select({ trn: companies.trnVatNumber })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (co?.trn) {
    throw new DomainError(
      "PLACE_OF_SUPPLY_REQUIRED",
      422,
      { fields: { placeOfSupplyEmirate: ["Choose the emirate of supply"] } },
      "Standard-rated supplies need a place of supply (emirate). Set it on the invoice, the contact or the company."
    );
  }
}
