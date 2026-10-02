// The purchase documents a VAT period's return is built from (Phase 8 D4). The loaders were lifted out of
// computeVatReturnForPeriod (vat-return-compute.service.ts), which now calls them, so the VAT 201 (box 9 and 10) and the
// VAT Audit: Purchases Detail report read the same rows with the same conditions and cannot disagree.
//
// Read-only; runs on whatever executor the caller has (the pool, a filing transaction, or a report snapshot).
// Every amount is AED (document amount x the rate booked on the document), as a decimal string; a vendor credit
// note reduces the period, so its rows are negative.

import Decimal from "decimal.js";
import { sql } from "drizzle-orm";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export type PurchaseDocKind = "receipt" | "bill" | "vendor_credit" | "expense_claim";

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
const tsOf = (d: Date) => d.toISOString().slice(0, 23);

/** Posted receipts dated in [startDate, endDate] (UTC instants, as the return reads them). */
export async function loadPeriodReceipts(ex: Executor, companyId: string, startDate: Date, endDate: Date): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT r.id, r.merchant, to_char(COALESCE(r.date, r.created_at), 'YYYY-MM-DD') AS d,
             (COALESCE(r.amount, 0) * COALESCE(NULLIF(r.exchange_rate, 0), 1))::text AS net,
             (COALESCE(r.vat_amount, 0) * COALESCE(NULLIF(r.exchange_rate, 0), 1))::text AS vat,
             COALESCE(r.reverse_charge, false) AS reverse_charge
        FROM receipts r
       WHERE r.company_id = ${companyId} AND r.posted = true
         AND COALESCE(r.date, r.created_at) >= ${tsOf(startDate)}::timestamp
         AND COALESCE(r.date, r.created_at) <= ${tsOf(endDate)}::timestamp
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
  }));
}

/** Approved / partial / paid / overdue vendor bills dated in the period (pending and draft bills do not recover VAT). */
export async function loadPeriodBills(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT id, bill_number, vendor_name, vendor_trn, to_char(bill_date, 'YYYY-MM-DD') AS d,
             (subtotal * COALESCE(exchange_rate, 1))::text AS net, (vat_amount * COALESCE(exchange_rate, 1))::text AS vat,
             COALESCE(reverse_charge, false) AS reverse_charge
        FROM vendor_bills
       WHERE company_id = ${companyId}
         AND bill_date >= ${fromDay}::date
         AND bill_date <= ${toDay}::date
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
 * Approved / paid expense-claim items dated in the period. Entertainment items are excluded from VAT recovery
 * (Art. 53 blocked input tax), mirroring the posting service: their VAT counts as 0 here, their net still counts.
 */
export async function loadPeriodExpenseClaimItems(ex: Executor, companyId: string, fromDay: string, toDay: string): Promise<PurchaseDocRow[]> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT i.id, c.id AS claim_id, c.claim_number, COALESCE(NULLIF(i.merchant_name, ''), i.description) AS vendor, to_char(i.expense_date, 'YYYY-MM-DD') AS d,
             COALESCE(i.amount, 0)::text AS net,
             (CASE WHEN LOWER(COALESCE(i.category,'')) NOT LIKE '%entertain%' THEN COALESCE(i.vat_amount, 0) ELSE 0 END)::text AS vat
        FROM expense_claim_items i
        JOIN expense_claims c ON c.id = i.claim_id
       WHERE c.company_id = ${companyId}
         AND c.status IN ('approved','paid')
         AND i.expense_date >= ${fromDay}::date
         AND i.expense_date <= ${toDay}::date
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
  }));
}

/** Add rows up exactly (decimal), split into ordinary and reverse-charge purchases. */
export function totalPurchases(rows: PurchaseDocRow[]): PurchaseTotals {
  let totalExpenses = new Decimal(0);
  let inputTaxGross = new Decimal(0);
  let reverseChargeAmount = new Decimal(0);
  let reverseChargeVatGross = new Decimal(0);
  for (const r of rows) {
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
  return [...receipts, ...bills, ...credits, ...claims];
}
