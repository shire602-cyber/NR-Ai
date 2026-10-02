// Payables owed to suppliers at the end of today (UAE day), tied to account 2010:
//   payables = posted bills - their payments - vendor credits applied to them - approved vendor credits not yet applied.
// ONE definition for the dashboard figure and the client portal (both read payableAgingAsOfSql, which is the same SQL the
// payables ageing report and the ledger tie-out use), so a supplier credit lowers what the company owes everywhere.

import { pool } from "../db";
import { dayEndTs, todayYmd } from "../reports/dates";
import { asOfParams, payableAgingAsOfSql, unappliedCreditAsOfSql } from "./aging-as-of.service";
import { round2 } from "./financial-statements";

export interface PayablesSummary {
  asOf: string;
  /** What the company owes: bills still open net of credits (equals the ledger balance of 2010). */
  outstandingTotal: number;
  /** Posted bills with an open balance, before unapplied credits. */
  billsOutstanding: number;
  /** Approved vendor credits not yet applied to a bill, as a positive amount that lowers the total. */
  unappliedCredits: number;
}

export async function loadPayablesSummary(companyId: string, now: Date = new Date()): Promise<PayablesSummary> {
  const asOf = todayYmd(now);
  const params = asOfParams(companyId, { ymd: asOf, dayEnd: dayEndTs(asOf) });
  const [aging, credits] = await Promise.all([
    pool.query(payableAgingAsOfSql(), params),
    pool.query(
      `SELECT COALESCE(SUM(${unappliedCreditAsOfSql("c")} * COALESCE(NULLIF(c.exchange_rate, 0), 1)), 0)::float AS credits
         FROM vendor_credit_notes c
        WHERE c.company_id = $1 AND c.status = 'approved' AND c.date::date <= $2::date`,
      [companyId, asOf]
    ),
  ]);
  const total = round2(aging.rows.reduce((sum: number, r: any) => sum + Number(r.total || 0), 0));
  const unapplied = round2(-Number(credits.rows[0]?.credits ?? 0));
  return { asOf, outstandingTotal: total, billsOutstanding: round2(total + unapplied), unappliedCredits: unapplied };
}
