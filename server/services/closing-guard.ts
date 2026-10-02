// Guards of the closing entries (teardown 6, t1/F3: a closing entry once swept every posting of every date, October
// included, into retained earnings dated 30 September). Only the financial-year close posts closing entries now.

import { sql } from "drizzle-orm";
import { AppError } from "../errors";
import { dubaiDaySql } from "./vat-dubai-day";

/**
 * The postings a closing entry sums must lie in [fromYmd, throughYmd] and throughYmd must not be after the date of the entry:
 * a closing entry can never include postings dated after itself.
 */
export function assertClosingWindow(w: { entryYmd: string; fromYmd: string; throughYmd: string }): void {
  if (w.throughYmd > w.entryYmd) {
    throw new AppError({
      message: `A closing entry dated ${w.entryYmd} cannot include postings dated up to ${w.throughYmd}.`,
      statusCode: 500,
      code: "CLOSING_WINDOW_AFTER_ENTRY",
    });
  }
  if (w.fromYmd > w.throughYmd) {
    throw new AppError({ message: "A closing entry's window starts after it ends.", statusCode: 500, code: "CLOSING_WINDOW_INVALID" });
  }
}

/** After the year's closing entry is posted, no income or expense account of the year may have a balance left (runs inside the closing transaction). */
export async function assertYearFullyClosed(tx: { execute: (q: any) => Promise<any> }, companyId: string, yearStart: string, yearEnd: string): Promise<void> {
  const res: any = await tx.execute(sql`
    SELECT count(*)::int AS open_accounts FROM (
      SELECT a.id
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        JOIN accounts a ON a.id = jl.account_id
       WHERE je.company_id = ${companyId} AND je.status = 'posted' AND a.type IN ('income', 'expense')
         AND ${sql.raw(dubaiDaySql("je.date"))} >= ${yearStart}::date AND ${sql.raw(dubaiDaySql("je.date"))} <= ${yearEnd}::date
       GROUP BY a.id HAVING SUM(jl.credit - jl.debit) <> 0) t`);
  const open = (res.rows ?? res)[0]?.open_accounts ?? 0;
  if (open > 0) {
    throw new AppError({
      message: `The year-end close left ${open} income or expense account(s) with a balance inside the year. Nothing was posted.`,
      statusCode: 500,
      code: "YEAR_END_CLOSE_INCOMPLETE",
    });
  }
}
