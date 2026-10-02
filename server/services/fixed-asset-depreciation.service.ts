// Posting depreciation: every unposted month from the asset's first depreciation month up to the month asked for,
// oldest first, one journal per month dated the month end, on the caller's connection and transaction.
//
// "Run depreciation" for month M therefore catches an asset up (a van bought months ago is not stuck at 0 until each
// month is run by hand), the disposal path reuses it for the months before disposal, and a month's straight-line charge
// no longer depends on the order months are run in (fixed-asset-depreciation-math.ts).
// A month that is period-locked is refused for the target month; earlier locked months are either refused or skipped
// and reported, by `lockedPolicy`.

import { AppError } from "../errors";
import { lockAndCheckMonthPg } from "./posting-lock";
import { assertPeriodNotLocked } from "./period-lock.service";
import { calculateDepreciation, isNonDepreciableCategory } from "./fixed-asset-depreciation-math";

// Same advisory-lock hash function used by storage.generateEntryNumber so
// concurrent batch runs serialise on the same key. Keeps tx-scoped JE
// numbering collision-free without piggy-backing on the storage layer.
export function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// Allocate the next entry number from a per-(company, date) counter held
// in-memory for the duration of a transaction. Caller must hold an advisory
// xact lock for the same (company, date) so a parallel transaction can't
// recompute the same MAX. Returns a closure that produces JE-YYYYMMDD-NNN.
export async function makeEntryNumberAllocator(
  client: any,
  companyId: string,
  date: Date
): Promise<() => string> {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `JE-${dateStr}`;
  const counterStart = prefix.length + 2; // 1-based SUBSTRING start position
  const likePattern = prefix + "-%";

  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM $1::int) AS INTEGER)), 0) AS max_seq
       FROM journal_entries
      WHERE company_id = $2 AND entry_number LIKE $3`,
    [counterStart, companyId, likePattern]
  );
  let nextSeq = Number(result.rows[0]?.max_seq ?? 0) + 1;
  return () => {
    const num = `${prefix}-${String(nextSeq).padStart(3, "0")}`;
    nextSeq++;
    return num;
  };
}

// Inline JE insert that participates in the caller's transaction. Mirrors
// storage.createJournalEntry's contract (balanced lines required) but keeps
// every write on the same connection so the outer BEGIN/COMMIT actually
// covers it.
export async function insertJournalEntryTx(
  client: any,
  entry: {
    companyId: string;
    entryNumber: string;
    date: Date;
    memo: string;
    status: string;
    source: string;
    sourceId: string | null;
    createdBy: string;
    postedBy: string | null;
    postedAt: Date | null;
  },
  lines: Array<{ accountId: string; debit: number; credit: number; description: string }>
): Promise<{ id: string }> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("Journal entry must have at least one line");
  }
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal entry is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }

  // Posted entries take the shared month lock and re-check the period lock on
  // this connection, so a filing / close cannot interleave (posting-lock.ts).
  if (entry.status === "posted") {
    await lockAndCheckMonthPg(client, entry.companyId, entry.date);
  }
  const inserted = await client.query(
    `INSERT INTO journal_entries
       (company_id, entry_number, date, memo, status, source, source_id, created_by, posted_by, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      entry.companyId,
      entry.entryNumber,
      entry.date,
      entry.memo,
      entry.status,
      entry.source,
      entry.sourceId,
      entry.createdBy,
      entry.postedBy,
      entry.postedAt,
    ]
  );
  const entryId = inserted.rows[0].id;
  for (const line of lines) {
    await client.query(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [entryId, line.accountId, line.debit, line.credit, line.description]
    );
  }
  return { id: entryId };
}


const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The asset with its purchase date as UTC midnight of the calendar day the database holds (`purchase_day`, selected with
 * to_char). node-pg parses a timestamp without a zone in the server's own time zone, which moves the day on a server that
 * is not on UTC; the month an asset starts depreciating in must not depend on that.
 */
export function withPurchaseDay<T extends { purchase_day?: string | null; purchase_date: any }>(row: T): T {
  if (!row.purchase_day) return row;
  return { ...row, purchase_date: new Date(`${row.purchase_day}T00:00:00Z`) };
}

/** Last calendar day of a month (month is 1-12) as UTC midnight. */
export const monthEnd = (year: number, month: number): Date => new Date(Date.UTC(year, month, 0));

export interface PostedMonth {
  year: number;
  month: number;
  amount: number;
  prorationFactor: number;
  journalEntryId: string;
  scheduleId: string;
}

export interface DepreciateThroughResult {
  posted: PostedMonth[];
  skippedLocked: Array<{ year: number; month: number }>;
  accumulated: number;
  netBookValue: number;
  /** The month asked for, when it was posted by this call. */
  target: PostedMonth | null;
  /** The month asked for charged nothing (fully depreciated, or not depreciable). */
  targetNothingToCharge: boolean;
}

export async function depreciateThrough(
  client: any,
  a: {
    asset: any;
    toYear: number;
    toMonth: number;
    userId: string;
    depExpenseAccountId: string;
    accDepAccountId: string;
    /** "throw": a locked month stops everything (403). "skip": earlier locked months are left out and reported. */
    lockedPolicy: "throw" | "skip";
    memoSuffix?: string;
  }
): Promise<DepreciateThroughResult> {
  const asset = withPurchaseDay(a.asset);
  const result: DepreciateThroughResult = { posted: [], skippedLocked: [], accumulated: 0, netBookValue: 0, target: null, targetNothingToCharge: false };
  const cost = parseFloat(asset.purchase_cost);

  const sums = await client.query(`SELECT COALESCE(SUM(amount), 0) AS acc FROM depreciation_schedules WHERE asset_id = $1`, [asset.id]);
  result.accumulated = round2(Number(sums.rows[0].acc));
  result.netBookValue = round2(cost - result.accumulated);

  if (isNonDepreciableCategory(asset.category) || asset.useful_life_years === null || asset.useful_life_years === undefined) {
    result.targetNothingToCharge = true;
    return result;
  }

  const purchase = asset.purchase_date instanceof Date ? asset.purchase_date : new Date(asset.purchase_date);
  const periods: Array<{ year: number; month: number }> = [];
  for (let y = purchase.getUTCFullYear(), m = purchase.getUTCMonth() + 1; y < a.toYear || (y === a.toYear && m <= a.toMonth); ) {
    periods.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  const existingRows = await client.query(`SELECT period_year, period_month FROM depreciation_schedules WHERE asset_id = $1`, [asset.id]);
  const existing = new Set<string>(existingRows.rows.map((r: any) => `${r.period_year}-${r.period_month}`));
  const todo = periods.filter((p) => !existing.has(`${p.year}-${p.month}`));

  // A declining balance charge comes from the book value, so it must be posted in order.
  if ((asset.depreciation_method || "straight_line") === "declining_balance" && todo.length > 0) {
    const first = todo[0];
    const later = await client.query(
      `SELECT 1 FROM depreciation_schedules WHERE asset_id = $1 AND (period_year > $2 OR (period_year = $2 AND period_month > $3)) LIMIT 1`,
      [asset.id, first.year, first.month]
    );
    if (later.rows.length > 0) {
      throw new AppError({
        message: `Declining-balance depreciation must be posted in order: ${first.month}/${first.year} is still open but a later month is posted.`,
        statusCode: 409,
        code: "DEPRECIATION_OUT_OF_ORDER",
      });
    }
  }

  const lockKey1 = hashStringToInt(asset.company_id);
  const lockedDates = new Set<string>();

  for (const period of todo) {
    const isTarget = period.year === a.toYear && period.month === a.toMonth;
    const entryDate = monthEnd(period.year, period.month);
    try {
      await assertPeriodNotLocked(asset.company_id, entryDate);
    } catch (err) {
      if (a.lockedPolicy === "skip" && !isTarget && err instanceof AppError && err.statusCode === 403) {
        result.skippedLocked.push(period);
        continue;
      }
      throw err;
    }

    const acc = await client.query(`SELECT COALESCE(SUM(amount), 0) AS acc, COUNT(*)::int AS n FROM depreciation_schedules WHERE asset_id = $1`, [asset.id]);
    const calc = calculateDepreciation({ ...asset, accumulated_depreciation: Number(acc.rows[0].acc) }, period.year, period.month, Number(acc.rows[0].n));
    if (calc.skipped || calc.monthlyDepreciation <= 0) {
      if (isTarget) result.targetNothingToCharge = true;
      continue;
    }

    const claim = await client.query(
      `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_id, period_year, period_month) DO NOTHING
       RETURNING id`,
      [asset.company_id, asset.id, period.year, period.month, calc.monthlyDepreciation, a.userId]
    );
    if (claim.rowCount === 0) {
      throw new AppError({
        message: `Depreciation for ${period.month}/${period.year} was posted by another request. Try again.`,
        statusCode: 409,
        code: "DEPRECIATION_CONFLICT",
      });
    }
    const scheduleId = claim.rows[0].id;

    const dateKey = entryDate.toISOString().slice(0, 10);
    if (!lockedDates.has(dateKey)) {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [lockKey1, hashStringToInt(`JE-${dateKey.replace(/-/g, "")}`)]);
      lockedDates.add(dateKey);
    }
    const allocate = await makeEntryNumberAllocator(client, asset.company_id, entryDate);
    const memoSuffix =
      (calc.prorationFactor < 1 ? ` (${period.month}/${period.year}, prorated ${(calc.prorationFactor * 100).toFixed(1)}%` : ` (${period.month}/${period.year}`) +
      (a.memoSuffix ? `, ${a.memoSuffix}` : "") +
      ")";
    const je = await insertJournalEntryTx(
      client,
      {
        companyId: asset.company_id,
        entryNumber: allocate(),
        date: entryDate,
        memo: `Depreciation: ${asset.asset_name}${memoSuffix}`,
        status: "posted",
        source: "system",
        sourceId: asset.id,
        createdBy: a.userId,
        postedBy: a.userId,
        postedAt: new Date(),
      },
      [
        { accountId: a.depExpenseAccountId, debit: calc.monthlyDepreciation, credit: 0, description: `Depreciation - ${asset.asset_name}` },
        { accountId: a.accDepAccountId, debit: 0, credit: calc.monthlyDepreciation, description: `Accumulated depreciation - ${asset.asset_name}` },
      ]
    );
    await client.query(`UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`, [je.id, scheduleId]);

    result.accumulated = calc.newAccumulatedDepreciation;
    result.netBookValue = calc.newNetBookValue;
    await client.query(`UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`, [result.accumulated, result.netBookValue, asset.id]);

    const row: PostedMonth = { year: period.year, month: period.month, amount: calc.monthlyDepreciation, prorationFactor: calc.prorationFactor, journalEntryId: je.id, scheduleId };
    result.posted.push(row);
    if (isTarget) result.target = row;
  }
  return result;
}
