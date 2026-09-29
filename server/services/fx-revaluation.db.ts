// Loads the OPEN foreign-currency receivables and payables of a company for a
// given date, with the rate they were booked at and the rate at that date.

import { pool } from "../db";
import { getLatestRate } from "./exchange-rate.service";
import { loadInvoiceBalances } from "./invoice-outstanding.db";
import { balanceAsOf } from "./invoice-outstanding";
import type { RevaluationItem } from "./fx-revaluation.service";

// "Open" is decided by the balance AS OF the chosen date, not by the document's
// status today: an invoice that was paid after that date was still receivable
// then. So the candidates are every document issued on or before the date that
// was not a draft / void / cancelled one (isRevaluationScopeStatus and
// isBillRevaluationScopeStatus in fx-revaluation.service.ts state the rule).
const INVOICE_SCOPE_SQL = "('draft', 'void', 'cancelled')";
const BILL_SCOPE_SQL = "('approved', 'partial', 'paid', 'overdue')";

/** UTC end of the as-of day as a timezone-free timestamp literal. */
const endOfDay = (asOf: Date) => `${asOf.toISOString().slice(0, 10)}T23:59:59.999`;

export async function loadRevaluationItems(companyId: string, asOf: Date): Promise<RevaluationItem[]> {
  const cutoff = endOfDay(asOf);
  const rateCache = new Map<string, number | null>();
  const rateFor = async (currency: string) => {
    if (!rateCache.has(currency)) {
      rateCache.set(currency, (await getLatestRate(currency, "AED", asOf, companyId)) ?? null);
    }
    return rateCache.get(currency) ?? null;
  };

  const items: RevaluationItem[] = [];

  // Receivables: issued foreign invoices dated on/before the as-of date (any
  // status but draft/void/cancelled), with payments and credit notes counted
  // only up to that date; open = still outstanding on that date.
  const invoiceRows = (
    await pool.query(
      `SELECT id, number, customer_name, currency, exchange_rate::float8 AS exchange_rate
         FROM invoices
        WHERE company_id = $1 AND currency <> 'AED' AND invoice_type <> 'credit_note'
          AND status NOT IN ${INVOICE_SCOPE_SQL} AND date <= $2::timestamp`,
      [companyId, cutoff]
    )
  ).rows;
  const balances = await loadInvoiceBalances(companyId, { asOf });
  for (const row of invoiceRows) {
    const balance = balances.get(row.id);
    if (!balance || balance.outstanding <= 0.005) continue;
    items.push({
      id: row.id,
      kind: "receivable",
      currency: row.currency,
      outstandingForeign: balance.outstanding,
      bookRate: Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : 1,
      currentRate: await rateFor(row.currency),
      number: row.number,
      counterparty: row.customer_name,
    });
  }

  // Payables: approved foreign vendor bills dated on/before the as-of date, with
  // payments counted only up to that date. A reverse-charge bill owes the
  // vendor its subtotal only (the VAT leg is self-assessed), which is what its
  // A/P credit carried.
  const billRows = (
    await pool.query(
      `SELECT b.id, b.bill_number, b.vendor_name, b.currency, b.exchange_rate::float8 AS exchange_rate,
              (CASE WHEN b.reverse_charge THEN b.subtotal ELSE b.total_amount END)::float8 AS basis,
              COALESCE((SELECT json_agg(json_build_object('amount', bp.amount::float8, 'date', bp.payment_date))
                          FROM bill_payments bp WHERE bp.bill_id = b.id), '[]'::json) AS payments
         FROM vendor_bills b
        WHERE b.company_id = $1 AND b.currency <> 'AED'
          AND b.status IN ${BILL_SCOPE_SQL} AND b.bill_date <= $2::timestamp`,
      [companyId, cutoff]
    )
  ).rows;
  for (const row of billRows) {
    const { outstanding } = balanceAsOf({ total: row.basis, payments: row.payments, creditNotes: [] }, asOf);
    if (outstanding <= 0.005) continue;
    items.push({
      id: row.id,
      kind: "payable",
      currency: row.currency,
      outstandingForeign: outstanding,
      bookRate: Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : 1,
      currentRate: await rateFor(row.currency),
      number: row.bill_number ?? `BILL-${String(row.id).slice(0, 8)}`,
      counterparty: row.vendor_name,
    });
  }
  return items;
}
