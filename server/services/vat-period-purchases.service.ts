// The purchase documents a VAT period's return is built from (Phase 8 D4). The loaders were lifted out of
// computeVatReturnForPeriod (vat-return-compute.service.ts), which now calls them, so the VAT 201 (box 9 and 10) and the
// VAT Audit: Purchases Detail report read the same rows with the same conditions and cannot disagree.
//
// Read-only; runs on whatever executor the caller has (the pool, a filing transaction, or a report snapshot).
// Every amount is AED (document amount x the rate booked on the document), as a decimal string; a vendor credit
// note reduces the period, so its rows are negative.

import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { blockedInputSql } from "./blocked-input-vat";
import { dubaiDaySql, dubaiDayTextSql } from "./vat-dubai-day";
import { loadVatJournalAdjustments } from "./vat-adjustments.service";
import type { VatJournalPurchaseLine } from "./vat-adjustments";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export type PurchaseDocKind = "receipt" | "bill" | "vendor_credit" | "expense_claim" | "journal";

export interface PurchaseDocRow {
  kind: PurchaseDocKind;
  id: string;
  /** The document the row belongs to when the row is a line of it (an expense claim item: the claim). */
  documentId?: string;
  /** Calendar day of the document (YYYY-MM-DD). */
  date: string;
  number: string | null;
  vendor: string | null;
  vendorTrn: string | null;
  /** Net amount in AED, decimal string (negative for a vendor credit). */
  net: string;
  /** Input VAT in AED that counts toward recovery, decimal string (negative for a vendor credit). */
  vat: string;
  reverseCharge: boolean;
  /**
   * Blocked input VAT (Art. 53, e.g. entertainment): the row is listed but is not a box 9 expense. `net` and `vat` are the
   * document's real amounts, so the audit shows them; totalPurchases leaves the row out.
   */
  blocked?: boolean;
}

export interface PurchaseTotals {
  /** Ordinary purchases (box 9 base). */
  totalExpenses: number;
  /** Ordinary input VAT before partial-exemption apportionment. */
  inputTaxGross: number;
  /** Reverse-charge purchases (boxes 3 and 10 base). */
  reverseChargeAmount: number;
  reverseChargeVatGross: number;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Posted receipts dated (UAE day) in [startDate, endDate]; the Dates only carry the calendar days of the period. */
export async function loadPeriodReceipts(ex: Executor, companyId: string, startDate: Date, endDate: Date): Promise<PurchaseDocRow[]> {
  const fromDay = dayOf(startDate);
  const toDay = dayOf(endDate);
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT r.id, r.merchant, ${sql.raw(dubaiDayTextSql("COALESCE(r.date, r.created_at)"))} AS d,
             (COALESCE(r.amount, 0) * COALESCE(NULLIF(r.exchange_rate, 0), 1))::text AS net,
             (COALESCE(r.vat_amount, 0) * COALESCE(NULLIF(r.exchange_rate, 0), 1))::text AS vat,
             COALESCE(r.reverse_charge, false) AS reverse_charge,
             ${sql.raw(blockedInputSql("r.category"))} AS blocked
        FROM receipts r
       WHERE r.company_id = ${companyId} AND r.posted = true
         AND ${sql.raw(dubaiDaySql("COALESCE(r.date, r.created_at)"))} >= ${fromDay}::date
         AND ${sql.raw(dubaiDaySql("COALESCE(r.date, r.created_at)"))} <= ${toDay}::date
       ORDER BY COALESCE(r.date, r.created_at), r.id`)
  );
  return rows.map((r) => ({
    kind: "receipt" as const,
    id: String(r.id),
    date: String(r.d),
    number: null,
    vendor: r.merchant ?? null,
    vendorTrn: null,
    net: String(r.net),
    vat: String(r.vat),
    reverseCharge: r.reverse_charge === true,
    blocked: r.blocked === true && r.reverse_charge !== true,
  }));
}

/** Approved / partial / paid / overdue vendor bills dated in the period (pending and draft bills do not recover VAT). */
export async function loadPeriodBills(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT id, bill_number, vendor_name, vendor_trn, ${sql.raw(dubaiDayTextSql("bill_date"))} AS d,
             (subtotal * COALESCE(exchange_rate, 1))::text AS net, (vat_amount * COALESCE(exchange_rate, 1))::text AS vat,
             COALESCE(reverse_charge, false) AS reverse_charge,
             ${sql.raw(blockedInputSql("category"))} AS blocked
        FROM vendor_bills
       WHERE company_id = ${companyId}
         AND ${sql.raw(dubaiDaySql("bill_date"))} >= ${fromDay}::date
         AND ${sql.raw(dubaiDaySql("bill_date"))} <= ${toDay}::date
         AND status NOT IN ('void','cancelled','draft','pending','pending_approval')
         AND COALESCE(is_opening_balance, false) = false
       ORDER BY bill_date, id`)
  );
  return rows.map((r) => ({
    kind: "bill" as const,
    id: String(r.id),
    date: String(r.d),
    number: r.bill_number ?? null,
    vendor: r.vendor_name ?? null,
    vendorTrn: r.vendor_trn ?? null,
    net: String(r.net),
    vat: String(r.vat),
    reverseCharge: r.reverse_charge === true,
    blocked: r.blocked === true && r.reverse_charge !== true,
  }));
}

/** Approved vendor credit notes dated in the period: they reduce the purchases (negative rows). */
export async function loadPeriodVendorCredits(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT id, number, vendor_name, vendor_trn, to_char("date", 'YYYY-MM-DD') AS d,
             (-subtotal * COALESCE(exchange_rate, 1))::text AS net, (-vat_amount * COALESCE(exchange_rate, 1))::text AS vat,
             COALESCE(reverse_charge, false) AS reverse_charge
        FROM vendor_credit_notes
       WHERE company_id = ${companyId}
         AND "date" >= ${fromDay}::date
         AND "date" <= ${toDay}::date
         AND status = 'approved'
       ORDER BY "date", id`)
  );
  return rows.map((r) => ({
    kind: "vendor_credit" as const,
    id: String(r.id),
    date: String(r.d),
    number: r.number ?? null,
    vendor: r.vendor_name ?? null,
    vendorTrn: r.vendor_trn ?? null,
    net: String(r.net),
    vat: String(r.vat),
    reverseCharge: r.reverse_charge === true,
  }));
}

/**
 * Approved / paid expense-claim items dated (UAE day) in the period. An entertainment item carries blocked input VAT
 * (Art. 53): it is listed (blocked) but is not a box 9 expense, exactly as the posting leaves its VAT out of 1050.
 */
export async function loadPeriodExpenseClaimItems(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT i.id, c.id AS claim_id, c.claim_number, COALESCE(NULLIF(i.merchant_name, ''), i.description) AS vendor,
             ${sql.raw(dubaiDayTextSql("i.expense_date"))} AS d,
             COALESCE(i.amount, 0)::text AS net, COALESCE(i.vat_amount, 0)::text AS vat,
             ${sql.raw(blockedInputSql("i.category"))} AS blocked
        FROM expense_claim_items i
        JOIN expense_claims c ON c.id = i.claim_id
       WHERE c.company_id = ${companyId}
         AND c.status IN ('approved','paid')
         AND ${sql.raw(dubaiDaySql("i.expense_date"))} >= ${fromDay}::date
         AND ${sql.raw(dubaiDaySql("i.expense_date"))} <= ${toDay}::date
       ORDER BY i.expense_date, i.id`)
  );
  return rows.map((r) => ({
    kind: "expense_claim" as const,
    id: String(r.id),
    documentId: String(r.claim_id),
    date: String(r.d),
    number: r.claim_number ?? null,
    vendor: r.vendor ?? null,
    vendorTrn: null,
    net: String(r.net),
    vat: String(r.vat),
    reverseCharge: false,
    blocked: r.blocked === true,
  }));
}

/** Add rows up exactly (decimal), split into ordinary and reverse-charge purchases. */
/**
 * Purchases recorded by manual journal (Dr expense or fixed asset + Dr 1050, no document) as purchase rows: their net amount
 * and VAT count in box 9 like a bill's, a blocked-category one is listed and counts nowhere (vat-adjustments.ts).
 */
export function journalPurchaseRows(purchases: readonly VatJournalPurchaseLine[]): PurchaseDocRow[] {
  return purchases.map((p) => ({
    kind: "journal" as const,
    id: p.entryId,
    date: p.date,
    number: p.entryNumber,
    vendor: p.description || null,
    vendorTrn: null,
    net: String(p.amount),
    vat: String(p.vat),
    reverseCharge: false,
    blocked: p.blocked,
  }));
}

export async function loadPeriodJournalPurchases(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  return journalPurchaseRows((await loadVatJournalAdjustments(ex, companyId, fromDay, toDay, null)).purchases);
}

export function totalPurchases(rows: PurchaseDocRow[]): PurchaseTotals {
  let totalExpenses = new Decimal(0);
  let inputTaxGross = new Decimal(0);
  let reverseChargeAmount = new Decimal(0);
  let reverseChargeVatGross = new Decimal(0);
  for (const r of rows) {
    if (r.blocked) continue; // blocked input VAT: the whole document is outside box 9 (see blocked-input-vat.ts)
    if (r.reverseCharge) {
      reverseChargeAmount = reverseChargeAmount.plus(r.net);
      reverseChargeVatGross = reverseChargeVatGross.plus(r.vat);
    } else {
      totalExpenses = totalExpenses.plus(r.net);
      inputTaxGross = inputTaxGross.plus(r.vat);
    }
  }
  return {
    totalExpenses: totalExpenses.toNumber(),
    inputTaxGross: inputTaxGross.toNumber(),
    reverseChargeAmount: reverseChargeAmount.toNumber(),
    reverseChargeVatGross: reverseChargeVatGross.toNumber(),
  };
}

/** Every purchase document of the period, bills first, in the order the return reads them. */
export async function loadPeriodPurchases(
  ex: Executor,
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<PurchaseDocRow[]> {
  const fromDay = dayOf(periodStart);
  const toDay = dayOf(periodEnd);
  const receipts = await loadPeriodReceipts(ex, companyId, periodStart, periodEnd);
  const bills = await loadPeriodBills(ex, companyId, fromDay, toDay);
  const credits = await loadPeriodVendorCredits(ex, companyId, fromDay, toDay);
  const claims = await loadPeriodExpenseClaimItems(ex, companyId, fromDay, toDay);
  const journals = await loadPeriodJournalPurchases(ex, companyId, fromDay, toDay);
  return [...receipts, ...bills, ...credits, ...claims, ...journals];
}
