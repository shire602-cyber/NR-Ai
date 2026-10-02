// Disposing of a fixed asset (Teardown 7 F4 + F5).
//
//   depreciation   runs to the disposal date: whole months before the disposal month in full, the disposal month pro rata by
//                  days; depreciation already posted beyond that (the whole disposal month, later months) is reversed
//                  (fixed-asset-disposal-math.ts). Gain or loss is measured against the book value at the disposal date.
//   price + VAT    `proceeds` is the price WITHOUT VAT. Standard-rated adds 5%. A sale that is a supply (standard, zero-rated
//                  or exempt) is invoiced to the buyer: an ordinary sales invoice whose revenue line credits 4080 (not sales
//                  revenue), so output VAT reaches 2020 and the VAT return by the invoice's emirate, and the sale is not
//                  counted as revenue. The disposal journal then releases the asset against 4080.
//                  Not a supply ("none"): the price goes straight to the bank or cash account, as before.
//   paid at once   with an invoice and a proceeds account, the invoice is paid into that account; without one it stays open
//                  (Sent) and the bank line is matched to it.

import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { invoices } from "../../shared/schema";
import { AppError } from "../errors";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { dubaiDayTextSql } from "./vat-dubai-day";
import { assertPeriodNotLocked } from "./period-lock.service";
import { isBankOrCashAccount } from "./bank-posting-common";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { replaceInvoiceLines } from "./sales-lines.service";
import { issueInvoice } from "./invoice-issue.service";
import { voidOrCancelInvoice } from "./invoice-void.service";
import { normalizeVatEmirate } from "./vat-emirate";
import { depreciateThrough, hashStringToInt, insertJournalEntryTx, makeEntryNumberAllocator, withPurchaseDay } from "./fixed-asset-depreciation.service";
import { disposalVat, invoicedDisposalLines, planDisposalDepreciation, type DisposalVatTreatment } from "./fixed-asset-disposal-math";

const log = createLogger("fixed-asset-disposal");
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const err = (status: number, code: string, message: string, details?: unknown) => new AppError({ message, statusCode: status, code, details });

export const DISPOSAL_VAT_TREATMENTS: readonly DisposalVatTreatment[] = ["none", "standard", "zero_rated", "exempt"];

/** "out_of_scope" is another name for "none". Undefined stays undefined (the caller did not say). */
export function normalizeTreatment(v: unknown): DisposalVatTreatment | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "out_of_scope") return "none";
  if ((DISPOSAL_VAT_TREATMENTS as readonly string[]).includes(s)) return s as DisposalVatTreatment;
  throw err(422, "VAT_TREATMENT_INVALID", "vatTreatment must be none, standard, zero_rated or exempt.");
}

function parseDay(value: unknown): { date: Date; year: number; month: number; day: number; ymd: string } {
  const text = String(value ?? "");
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
  if (!text || Number.isNaN(date.getTime())) throw err(400, "VALIDATION_ERROR", "disposalDate is not a valid date");
  return { date, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), ymd: date.toISOString().slice(0, 10) };
}

async function loadAsset(companyId: string, assetId: string) {
  const res = await pool.query(`SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1 AND company_id = $2`, [assetId, companyId]);
  if (res.rows.length === 0) throw err(404, "ASSET_NOT_FOUND", "Fixed asset not found");
  return withPurchaseDay(res.rows[0]);
}

const scheduleRows = async (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> }, assetId: string) =>
  (await client.query(`SELECT period_year AS year, period_month AS month, amount::float8 AS amount FROM depreciation_schedules WHERE asset_id = $1`, [assetId])).rows.map((r: any) => ({ year: Number(r.year), month: Number(r.month), amount: Number(r.amount) }));

export interface DisposalPreview {
  depreciationToDate: number;
  accumulatedAfter: number;
  nbv: number;
  proceeds: number;
  vatAmount: number;
  total: number;
  gainLoss: number;
  gainLossType: "gain" | "loss" | "breakeven";
  /** Depreciation posted after the disposal date that the disposal reverses. */
  depreciationReversed: number;
  /** The disposal-month share charged (days up to the disposal date over the days of the month). */
  disposalMonthFraction: number;
}

export async function previewDisposal(companyId: string, assetId: string, args: { date: string; amount: number; vatTreatment?: unknown }): Promise<DisposalPreview> {
  const asset = await loadAsset(companyId, assetId);
  const disp = parseDay(args.date);
  const proceeds = round2(Number.isFinite(args.amount) && args.amount > 0 ? args.amount : 0);
  const treatment = normalizeTreatment(args.vatTreatment) ?? "none";
  const plan = planDisposalDepreciation(asset, await scheduleRows(pool, assetId), disp);
  const cost = Number(asset.purchase_cost);
  const nbv = round2(cost - plan.accumulatedAtDisposal);
  const gainLoss = round2(proceeds - nbv);
  const vat = disposalVat(proceeds, treatment);
  return {
    depreciationToDate: round2(plan.accumulatedAtDisposal - plan.accumulatedPosted),
    accumulatedAfter: plan.accumulatedAtDisposal,
    nbv,
    proceeds,
    vatAmount: vat.vatAmount,
    total: vat.total,
    gainLoss,
    gainLossType: gainLoss > 0 ? "gain" : gainLoss < 0 ? "loss" : "breakeven",
    depreciationReversed: plan.excess,
    disposalMonthFraction: plan.disposalMonth.fraction,
  };
}

export interface DisposeInput {
  companyId: string;
  assetId: string;
  userId: string;
  disposalDate: unknown;
  disposalAmount?: unknown;
  notes?: string | null;
  proceedsAccountId?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
  vatTreatment?: unknown;
  emirate?: string | null;
}

async function createDisposalInvoice(args: {
  companyId: string;
  userId: string;
  asset: any;
  date: Date;
  proceeds: number;
  treatment: Exclude<DisposalVatTreatment, "none">;
  contact: { id: string; name: string; trn_number: string | null; address: string | null; emirate: string | null } | null;
  buyerName: string;
  emirate: string | null;
  gainAccountId: string;
}) {
  const { asset } = args;
  const created = await db.transaction(async (tx: typeof db) => {
    const number = await allocateInvoiceNumber(args.companyId, "invoice", args.date, tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        companyId: args.companyId,
        number,
        customerName: args.buyerName,
        customerTrn: args.contact?.trn_number ?? null,
        customerAddress: args.contact?.address ?? null,
        contactId: args.contact?.id ?? null,
        date: args.date,
        dueDate: args.date,
        currency: "AED",
        exchangeRate: 1,
        status: "draft",
        invoiceType: "invoice",
        emirate: args.emirate,
      } as any)
      .returning();
    await replaceInvoiceLines(tx, {
      companyId: args.companyId,
      invoiceId: invoice.id,
      lines: [
        {
          kind: "item" as const,
          description: `Sale of fixed asset: ${asset.asset_name}${asset.asset_number ? ` (${asset.asset_number})` : ""}`,
          quantity: 1,
          unitPrice: args.proceeds,
          vatRate: args.treatment === "standard" ? 0.05 : 0,
          vatSupplyType: args.treatment === "standard" ? "standard_rated" : args.treatment === "zero_rated" ? "zero_rated" : "exempt",
          revenueAccountId: args.gainAccountId,
        },
      ],
      exchangeRate: 1,
    });
    const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    return row;
  });
  const issued = await issueInvoice(created as any, args.userId, "sent");
  if (!issued.ok) throw err(issued.status, issued.body.code ?? "INVOICE_NOT_ISSUED", issued.body.message);
  return created;
}

export async function disposeAsset(input: DisposeInput) {
  const { companyId, assetId, userId } = input;
  const asset0 = await loadAsset(companyId, assetId);
  if (asset0.status === "disposed") throw err(400, "ASSET_ALREADY_DISPOSED", "Asset is already disposed");
  const disp = parseDay(input.disposalDate);
  const dispDate = disp.date;
  const purchaseDate = asset0.purchase_date instanceof Date ? asset0.purchase_date : new Date(asset0.purchase_date);
  if (dispDate.getTime() < purchaseDate.getTime()) throw err(400, "VALIDATION_ERROR", "disposalDate cannot precede purchaseDate");
  // Disposal posts on the disposal date: a locked period refuses it.
  await assertPeriodNotLocked(companyId, input.disposalDate as any);

  const proceeds = round2(parseFloat(String(input.disposalAmount ?? 0)) || 0);
  if (proceeds < 0) throw err(400, "VALIDATION_ERROR", "disposalAmount cannot be negative");
  const given = normalizeTreatment(input.vatTreatment);
  const warnings: Array<{ code: string; message: string }> = [];
  const companyRow = (await pool.query(`SELECT trn_vat_number FROM companies WHERE id = $1`, [companyId])).rows[0];
  const vatRegistered = !!String(companyRow?.trn_vat_number ?? "").trim();
  let treatment: DisposalVatTreatment = given ?? "none";
  if (treatment !== "none" && !vatRegistered) {
    throw err(422, "VAT_NOT_REGISTERED", "This company has no VAT registration number (TRN): a sale cannot be standard-rated, zero-rated or exempt. Choose \"none\" or add the TRN first.");
  }
  if (given === undefined && vatRegistered && proceeds > 0) {
    warnings.push({ code: "VAT_TREATMENT_NOT_SET", message: "No VAT treatment was given: the sale was recorded without VAT. Say whether it is standard-rated (5%), zero-rated or exempt." });
  }
  if (proceeds <= 0 && treatment !== "none") {
    treatment = "none";
    warnings.push({ code: "NO_PROCEEDS_NO_INVOICE", message: "There is no price, so no invoice or VAT was raised." });
  }
  const invoiced = treatment !== "none";

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const accDepAccount = accounts.find((a) => a.code === "1240" && a.isSystemAccount);
  const costAccount = accounts.find((a) => a.code === "1290" && a.isSystemAccount);
  const cashAccount = accounts.find((a) => a.code === "1010" && a.isSystemAccount);
  const gainAccount = accounts.find((a) => a.code === "4080" && a.isSystemAccount);
  const lossAccount = accounts.find((a) => a.code === "5130" && a.isSystemAccount);
  const depExpenseAccount = accounts.find((a) => a.code === "5100" && a.isSystemAccount);
  const ar = accounts.find((a) => a.code === "1040" && a.isSystemAccount);

  let proceedsAccount = cashAccount;
  if (input.proceedsAccountId) {
    const managed = new Set((await storage.getBankAccountsByCompanyId(companyId)).map((b) => b.glAccountId).filter((v): v is string => !!v));
    const chosen = accounts.find((a) => a.id === input.proceedsAccountId);
    if (!chosen || chosen.isActive === false || chosen.isArchived === true || !isBankOrCashAccount(chosen, managed, chosen.id)) {
      throw err(422, "PROCEEDS_ACCOUNT_INVALID", "The proceeds account must be an active bank or cash account of this company.");
    }
    proceedsAccount = chosen;
  }
  const missing: string[] = [];
  if (!accDepAccount) missing.push("1240");
  if (!costAccount) missing.push("1290");
  if (!depExpenseAccount) missing.push("5100");
  if (invoiced && !gainAccount) missing.push("4080");
  if (invoiced && !ar) missing.push("1040");
  if (!invoiced && proceeds > 0 && !proceedsAccount) missing.push("1010");
  if (missing.length > 0) throw err(500, "CHART_OF_ACCOUNTS_MISSING", `Disposal cannot post - missing system accounts: ${missing.join(", ")}. Run migrations to create them.`);

  // the buyer and place of supply of a sale that is a supply
  let contact: { id: string; name: string; trn_number: string | null; address: string | null; emirate: string | null } | null = null;
  let buyerName = String(input.buyerName ?? "").trim();
  let emirate: string | null = null;
  if (invoiced) {
    if (input.buyerId) {
      const c = (await pool.query(`SELECT id, name, trn_number, address, emirate FROM customer_contacts WHERE id = $1 AND company_id = $2`, [input.buyerId, companyId])).rows[0];
      if (!c) throw err(422, "BUYER_NOT_FOUND", "The buyer is not one of this company's customers.");
      contact = c;
      buyerName = buyerName || c.name;
    }
    if (!buyerName) throw err(422, "BUYER_REQUIRED", "A sale that carries VAT (or is zero-rated or exempt) needs a tax invoice: name the buyer.");
    if (input.emirate) {
      emirate = normalizeVatEmirate(input.emirate);
      if (!emirate) throw err(422, "EMIRATE_INVALID", "The emirate must be one of abu_dhabi, dubai, sharjah, ajman, umm_al_quwain, ras_al_khaimah, fujairah.");
    } else {
      emirate = normalizeVatEmirate(contact?.emirate) ?? null;
    }
  }

  // the invoice first (it has its own transactions); it is voided again if the disposal itself fails
  let invoice: { id: string; number: string } | null = null;
  const vat = disposalVat(proceeds, treatment);
  if (invoiced) {
    const row = await createDisposalInvoice({ companyId, userId, asset: asset0, date: dispDate, proceeds, treatment: treatment as Exclude<DisposalVatTreatment, "none">, contact, buyerName, emirate, gainAccountId: gainAccount!.id });
    invoice = { id: row.id, number: row.number };
  }

  const client = await pool.connect();
  let result: any;
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT *, ${dubaiDayTextSql("purchase_date")} AS purchase_day FROM fixed_assets WHERE id = $1 FOR UPDATE`, [assetId]);
    let working = withPurchaseDay(locked.rows[0]);
    if (working.status === "disposed") throw err(400, "ASSET_ALREADY_DISPOSED", "Asset is already disposed");

    const lockKey1 = hashStringToInt(companyId);
    const lockedDates = new Set<string>();
    const lockDate = async (d: Date) => {
      const key = d.toISOString().slice(0, 10);
      if (lockedDates.has(key)) return;
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [lockKey1, hashStringToInt(`JE-${key.replace(/-/g, "")}`)]);
      lockedDates.add(key);
    };

    // 1. whole months before the disposal month, in one catch-up journal dated the disposal date
    const endYear = disp.month === 1 ? disp.year - 1 : disp.year;
    const endMonth = disp.month === 1 ? 12 : disp.month - 1;
    const caught = await depreciateThrough(client, {
      asset: working,
      toYear: endYear,
      toMonth: endMonth,
      userId,
      depExpenseAccountId: depExpenseAccount!.id,
      accDepAccountId: accDepAccount!.id,
      mode: "disposal",
      disposalDate: dispDate,
    });
    const catchUpEntries = (caught.catchUp?.months ?? []).map((m) => ({ year: m.year, month: m.month, amount: m.amount, journalEntryId: caught.catchUp!.journalEntryId }));

    // 2. the disposal month: pro rata up to the disposal date; anything posted beyond it is reversed
    const rowsNow = await scheduleRows(client, assetId);
    const plan = planDisposalDepreciation(working, rowsNow, disp);
    await lockDate(dispDate);
    const allocate = await makeEntryNumberAllocator(client, companyId, dispDate);
    const jeBase = { companyId, date: dispDate, status: "posted", source: "system", sourceId: assetId, createdBy: userId, postedBy: userId, postedAt: new Date() };
    let depreciationReversed = 0;
    if (plan.excess > 0.005) {
      const dm = plan.disposalMonth;
      if (dm.posted !== null) {
        if (dm.target > 0.005) await client.query(`UPDATE depreciation_schedules SET amount = $1 WHERE asset_id = $2 AND period_year = $3 AND period_month = $4`, [dm.target, assetId, dm.year, dm.month]);
        else await client.query(`DELETE FROM depreciation_schedules WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`, [assetId, dm.year, dm.month]);
      }
      for (const later of plan.laterMonths) {
        await client.query(`DELETE FROM depreciation_schedules WHERE asset_id = $1 AND period_year = $2 AND period_month = $3`, [assetId, later.year, later.month]);
      }
      await insertJournalEntryTx(client, { ...jeBase, entryNumber: allocate(), memo: `Depreciation reversed after the disposal date: ${working.asset_name} (${disp.ymd})` }, [
        { accountId: accDepAccount!.id, debit: plan.excess, credit: 0, description: `Reverse depreciation after disposal - ${working.asset_name}` },
        { accountId: depExpenseAccount!.id, debit: 0, credit: plan.excess, description: `Reverse depreciation after disposal - ${working.asset_name}` },
      ]);
      depreciationReversed = plan.excess;
    } else if (plan.disposalMonth.posted === null && plan.disposalMonth.target > 0.005) {
      const dm = plan.disposalMonth;
      const row = await client.query(
        `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by, catch_up) VALUES ($1, $2, $3, $4, $5, $6, false) ON CONFLICT (asset_id, period_year, period_month) DO NOTHING RETURNING id`,
        [companyId, assetId, dm.year, dm.month, dm.target, userId]
      );
      if (row.rowCount === 0) throw err(409, "DEPRECIATION_CONFLICT", `Depreciation for ${dm.month}/${dm.year} was posted by another request. Try again.`);
      const je = await insertJournalEntryTx(client, { ...jeBase, entryNumber: allocate(), memo: `Depreciation to the disposal date: ${working.asset_name} (${disp.day} days of ${dm.month}/${dm.year}, ${(dm.fraction * 100).toFixed(1)}%)` }, [
        { accountId: depExpenseAccount!.id, debit: dm.target, credit: 0, description: `Depreciation to disposal - ${working.asset_name}` },
        { accountId: accDepAccount!.id, debit: 0, credit: dm.target, description: `Accumulated depreciation - ${working.asset_name}` },
      ]);
      await client.query(`UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`, [je.id, row.rows[0].id]);
    }
    const accRow = await client.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS acc FROM depreciation_schedules WHERE asset_id = $1`, [assetId]);
    const accDep = round2(Number(accRow.rows[0].acc));
    const cost = parseFloat(working.purchase_cost);

    // 3. the disposal journal, against the book value at the disposal date
    const nbv = round2(cost - accDep);
    const gainLoss = round2(proceeds - nbv);
    const gainLossType: "gain" | "loss" | "breakeven" = gainLoss > 0 ? "gain" : gainLoss < 0 ? "loss" : "breakeven";
    if (!invoiced && gainLoss > 0 && !gainAccount) throw err(500, "CHART_OF_ACCOUNTS_MISSING", "Disposal cannot post - missing system account 4080. Run migrations to create it.");
    if (gainLoss < 0 && !lossAccount) throw err(500, "CHART_OF_ACCOUNTS_MISSING", "Disposal cannot post - missing system account 5130. Run migrations to create it.");

    type Line = { accountId: string; debit: number; credit: number; description: string };
    const lines: Line[] = [];
    const name = working.asset_name;
    if (invoiced) {
      const split = invoicedDisposalLines(cost, accDep, proceeds);
      if (accDep > 0) lines.push({ accountId: accDepAccount!.id, debit: accDep, credit: 0, description: `Reverse accumulated depreciation on ${name}` });
      if (split.against4080 > 0) lines.push({ accountId: gainAccount!.id, debit: split.against4080, credit: 0, description: `Book value of ${name} against the sale price` });
      if (split.loss > 0) lines.push({ accountId: lossAccount!.id, debit: split.loss, credit: 0, description: `Loss on disposal of ${name}` });
      lines.push({ accountId: costAccount!.id, debit: 0, credit: round2(cost), description: `Remove cost of ${name}` });
    } else {
      if (proceeds > 0) lines.push({ accountId: proceedsAccount!.id, debit: proceeds, credit: 0, description: `Proceeds from disposal of ${name}` });
      if (accDep > 0) lines.push({ accountId: accDepAccount!.id, debit: accDep, credit: 0, description: `Reverse accumulated depreciation on ${name}` });
      if (gainLoss < 0) lines.push({ accountId: lossAccount!.id, debit: round2(-gainLoss), credit: 0, description: `Loss on disposal of ${name}` });
      lines.push({ accountId: costAccount!.id, debit: 0, credit: round2(cost), description: `Remove cost of ${name}` });
      if (gainLoss > 0) lines.push({ accountId: gainAccount!.id, debit: 0, credit: gainLoss, description: `Gain on disposal of ${name}` });
    }
    const disposalJe = await insertJournalEntryTx(client, { ...jeBase, entryNumber: allocate(), memo: `Disposal: ${name}` }, lines);

    await client.query(
      `UPDATE fixed_assets SET status = 'disposed', disposal_date = $1, disposal_amount = $2, net_book_value = 0, accumulated_depreciation = $3,
              notes = COALESCE($4, notes), disposal_journal_id = $5, disposal_account_id = $6,
              disposal_buyer_id = $7, disposal_buyer_name = $8, disposal_vat_treatment = $9, disposal_vat_amount = $10, disposal_invoice_id = $11,
              disposal_depreciation_reversed = $12
        WHERE id = $13`,
      [dispDate, proceeds, accDep, input.notes || null, disposalJe.id, !invoiced && proceeds > 0 ? proceedsAccount!.id : null, contact?.id ?? null, buyerName || null, treatment, vat.vatAmount, invoice?.id ?? null, depreciationReversed, assetId]
    );
    const finalRow = await client.query(`SELECT * FROM fixed_assets WHERE id = $1`, [assetId]);
    await client.query("COMMIT");
    result = { asset: finalRow.rows[0], nbv, gainLoss, gainLossType, journalEntryId: disposalJe.id, catchUpEntries, depreciationReversed, accDep };
  } catch (e) {
    await client.query("ROLLBACK").catch((rb: unknown) => log.error({ rb }, "ROLLBACK failed during disposal"));
    if (invoice) {
      const voided = await voidOrCancelInvoice({ invoiceId: invoice.id, companyId, targetStatus: "void", userId }).catch((ve) => ({ ok: false, message: String(ve) }));
      if (!(voided as any).ok) log.error({ invoiceId: invoice.id, voided }, "The disposal failed and its invoice could not be voided: void it by hand");
    }
    throw e;
  } finally {
    client.release();
  }

  // paid at once: the invoice is settled into the chosen bank or cash account
  let paid = false;
  if (invoice && input.proceedsAccountId && proceedsAccount) {
    try {
      await storage.recordInvoicePayment({
        invoiceId: invoice.id,
        companyId,
        amount: vat.total,
        date: dispDate,
        method: "bank_transfer",
        reference: null,
        notes: `Sale of fixed asset: ${asset0.asset_name}`,
        paymentAccountId: proceedsAccount.id,
        paymentAccountCurrency: "AED",
        receivableAccountId: ar!.id,
        createdBy: userId,
      });
      paid = true;
    } catch (e: any) {
      log.error({ invoiceId: invoice.id, err: e?.message }, "The payment of a disposal invoice could not be recorded");
      warnings.push({ code: "PAYMENT_NOT_RECORDED", message: `The asset is disposed and invoice ${invoice.number} issued, but the payment could not be recorded (${e?.message}). Record it on the invoice.` });
    }
  }
  log.info({ assetId, proceeds, gainLoss: result.gainLoss, invoiceId: invoice?.id ?? null, depreciationReversed: result.depreciationReversed }, "Asset disposed");
  return {
    asset: result.asset,
    disposalAmount: proceeds,
    netBookValueAtDisposal: result.nbv,
    gainLoss: result.gainLoss,
    gainLossType: result.gainLossType,
    journalEntryId: result.journalEntryId,
    catchUpDepreciation: result.catchUpEntries,
    depreciationReversed: result.depreciationReversed,
    accumulatedAtDisposal: result.accDep,
    vatTreatment: treatment,
    vatAmount: vat.vatAmount,
    total: vat.total,
    disposalInvoiceId: invoice?.id ?? null,
    disposalInvoiceNumber: invoice?.number ?? null,
    invoicePaid: paid,
    warnings,
  };
}
