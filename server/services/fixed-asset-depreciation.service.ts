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
import { isPeriodLocked } from "./month-end.service";
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

/** Months that fall in a closed or locked period, gathered into one journal dated an open day. */
export interface CatchUpJournal {
  journalEntryId: string;
  date: string;
  total: number;
  /** Debited to retained earnings (3020): months of a financial year that is already closed. */
  retainedEarningsTotal: number;
  months: Array<{ year: number; month: number; amount: number; closedYear: boolean }>;
}

export interface DepreciateThroughResult {
  posted: PostedMonth[];
  catchUp: CatchUpJournal | null;
  accumulated: number;
  netBookValue: number;
  /** The month asked for, when it was posted by this call. */
  target: PostedMonth | null;
  /** The month asked for charged nothing (fully depreciated, or not depreciable). */
  targetNothingToCharge: boolean;
}

const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Post depreciation for every unposted month up to (toYear, toMonth).
 *
 * mode "run" (Run depreciation): a month in an open period gets its own journal dated the month end; a month in a locked
 * or closed period is NEVER posted there: those months are gathered into ONE labelled catch-up journal dated the first
 * open day (months of an already closed financial year debit retained earnings 3020, the rest 5100), and the schedule
 * rows for them point at it. A month before the target year's January needs confirmBackdated (409 otherwise), like a
 * backdated manual journal. The target month itself must be open (403).
 * mode "disposal": nothing is backdated: every unposted month before disposal goes into one catch-up journal dated the
 * disposal date.
 */
export async function depreciateThrough(
  client: any,
  a: {
    asset: any;
    toYear: number;
    toMonth: number;
    userId: string;
    depExpenseAccountId: string;
    accDepAccountId: string;
    mode?: "run" | "disposal";
    disposalDate?: Date;
    confirmBackdated?: boolean;
  }
): Promise<DepreciateThroughResult> {
  const mode = a.mode ?? "run";
  const asset = withPurchaseDay(a.asset);
  const result: DepreciateThroughResult = { posted: [], catchUp: null, accumulated: 0, netBookValue: 0, target: null, targetNothingToCharge: false };
  const cost = parseFloat(asset.purchase_cost);

  const sums = await client.query(`SELECT COALESCE(SUM(amount), 0) AS acc, COUNT(*)::int AS n FROM depreciation_schedules WHERE asset_id = $1`, [asset.id]);
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
  if (todo.length === 0) return result;

  // which months are in a locked period, and which in a financial year that is already closed
  const closedRows = await client.query(
    `SELECT to_char(year_start, 'YYYY-MM-DD') AS s, to_char(year_end, 'YYYY-MM-DD') AS e FROM year_end_closes WHERE company_id = $1 AND status = 'closed'`,
    [asset.company_id]
  );
  const inClosedYear = (day: string) => closedRows.rows.some((c: any) => c.s <= day && day <= c.e);
  type Item = { year: number; month: number; isTarget: boolean; locked: boolean; closedYear: boolean; calc?: ReturnType<typeof calculateDepreciation> };
  const items: Item[] = [];
  for (const p of todo) {
    const day = ymdOf(monthEnd(p.year, p.month));
    const isTarget = mode === "run" && p.year === a.toYear && p.month === a.toMonth;
    const locked = await isPeriodLocked(asset.company_id, day);
    if (isTarget && locked) {
      throw new AppError({ message: `Cannot post to locked period (${String(p.month).padStart(2, "0")}/${p.year}). Unlock the period first.`, statusCode: 403, code: "PERIOD_LOCKED" });
    }
    items.push({ ...p, isTarget, locked, closedYear: inClosedYear(day) });
  }

  if (mode === "run" && !a.confirmBackdated) {
    const backdated = items.filter((i) => !i.locked && !i.closedYear && i.year < a.toYear);
    if (backdated.length > 0) {
      throw new AppError({
        message: `Running depreciation to ${a.toMonth}/${a.toYear} would post ${backdated.length} month(s) in earlier years (from ${backdated[0].month}/${backdated[0].year}). Confirm the backdating, or record the asset's opening accumulated depreciation instead.`,
        statusCode: 409,
        code: "BACKDATING_CONFIRMATION_REQUIRED",
        details: { months: backdated.map((i) => ({ year: i.year, month: i.month })) },
      });
    }
  }

  // the charge of every month, in order, from the schedule (and, for declining balance, the running book value)
  let runAcc = Number(sums.rows[0].acc);
  let runCount = Number(sums.rows[0].n);
  for (const it of items) {
    const calc = calculateDepreciation({ ...asset, accumulated_depreciation: runAcc }, it.year, it.month, runCount);
    if (calc.skipped || calc.monthlyDepreciation <= 0) {
      if (it.isTarget) result.targetNothingToCharge = true;
      continue;
    }
    it.calc = calc;
    runAcc = calc.newAccumulatedDepreciation;
    runCount++;
  }

  const lockKey1 = hashStringToInt(asset.company_id);
  const lockedDates = new Set<string>();
  const lockDay = async (day: string) => {
    if (lockedDates.has(day)) return;
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [lockKey1, hashStringToInt(`JE-${day.replace(/-/g, "")}`)]);
    lockedDates.add(day);
  };
  const claim = async (it: Item, amount: number, catchUp: boolean): Promise<string> => {
    const res = await client.query(
      `INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by, catch_up)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (asset_id, period_year, period_month) DO NOTHING
       RETURNING id`,
      [asset.company_id, asset.id, it.year, it.month, amount, a.userId, catchUp]
    );
    if (res.rowCount === 0) {
      throw new AppError({ message: `Depreciation for ${it.month}/${it.year} was posted by another request. Try again.`, statusCode: 409, code: "DEPRECIATION_CONFLICT" });
    }
    return res.rows[0].id;
  };

  const catchItems: Item[] = [];
  for (const it of items) {
    if (!it.calc) continue;
    if (mode === "disposal" || it.locked) {
      catchItems.push(it);
      continue;
    }
    const entryDate = monthEnd(it.year, it.month);
    const scheduleId = await claim(it, it.calc.monthlyDepreciation, false);
    const day = ymdOf(entryDate);
    await lockDay(day);
    const allocate = await makeEntryNumberAllocator(client, asset.company_id, entryDate);
    const memoSuffix = it.calc.prorationFactor < 1 ? ` (${it.month}/${it.year}, prorated ${(it.calc.prorationFactor * 100).toFixed(1)}%)` : ` (${it.month}/${it.year})`;
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
        { accountId: a.depExpenseAccountId, debit: it.calc.monthlyDepreciation, credit: 0, description: `Depreciation - ${asset.asset_name}` },
        { accountId: a.accDepAccountId, debit: 0, credit: it.calc.monthlyDepreciation, description: `Accumulated depreciation - ${asset.asset_name}` },
      ]
    );
    await client.query(`UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`, [je.id, scheduleId]);
    const row: PostedMonth = { year: it.year, month: it.month, amount: it.calc.monthlyDepreciation, prorationFactor: it.calc.prorationFactor, journalEntryId: je.id, scheduleId };
    result.posted.push(row);
    if (it.isTarget) result.target = row;
    result.accumulated = it.calc.newAccumulatedDepreciation;
    result.netBookValue = it.calc.newNetBookValue;
  }

  if (catchItems.length > 0) {
    // the one journal for months that cannot be posted where they belong
    let entryDate: Date;
    if (mode === "disposal") {
      entryDate = a.disposalDate as Date;
    } else {
      const first = catchItems[0];
      let y = first.year;
      let m = first.month;
      for (let guard = 0; guard < 600; guard++) {
        if (!(await isPeriodLocked(asset.company_id, ymdOf(monthEnd(y, m))))) break;
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
      entryDate = new Date(Date.UTC(y, m - 1, 1));
    }
    const closedTotal = round2(catchItems.filter((i) => i.closedYear).reduce((s, i) => s + (i.calc as any).monthlyDepreciation, 0));
    const total = round2(catchItems.reduce((s, i) => s + (i.calc as any).monthlyDepreciation, 0));
    let retainedId: string | null = null;
    if (closedTotal > 0) {
      const ret = await client.query(`SELECT id FROM accounts WHERE company_id = $1 AND code = '3020' AND type = 'equity' LIMIT 1`, [asset.company_id]);
      retainedId = ret.rows[0]?.id ?? null;
      if (!retainedId) {
        throw new AppError({ message: "Retained earnings (3020) is missing from the chart of accounts; it takes the depreciation of closed financial years.", statusCode: 422, code: "RETAINED_EARNINGS_MISSING" });
      }
    }
    const day = ymdOf(entryDate);
    await lockDay(day);
    const allocate = await makeEntryNumberAllocator(client, asset.company_id, entryDate);
    const first = catchItems[0];
    const last = catchItems[catchItems.length - 1];
    const covers = `${first.month}/${first.year}${catchItems.length > 1 ? `-${last.month}/${last.year}` : ""}`;
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    if (round2(total - closedTotal) > 0) {
      lines.push({ accountId: a.depExpenseAccountId, debit: round2(total - closedTotal), credit: 0, description: `Depreciation catch-up - ${asset.asset_name}` });
    }
    if (closedTotal > 0 && retainedId) {
      lines.push({ accountId: retainedId, debit: closedTotal, credit: 0, description: `Depreciation of closed financial years - ${asset.asset_name}` });
    }
    lines.push({ accountId: a.accDepAccountId, debit: 0, credit: total, description: `Accumulated depreciation - ${asset.asset_name}` });
    const je = await insertJournalEntryTx(
      client,
      {
        companyId: asset.company_id,
        entryNumber: allocate(),
        date: entryDate,
        memo: `Prior-period depreciation catch-up: ${asset.asset_name} (covers ${covers}, ${catchItems.length} month${catchItems.length === 1 ? "" : "s"})`,
        status: "posted",
        source: "system",
        sourceId: asset.id,
        createdBy: a.userId,
        postedBy: a.userId,
        postedAt: new Date(),
      },
      lines
    );
    for (const it of catchItems) {
      const scheduleId = await claim(it, (it.calc as any).monthlyDepreciation, true);
      await client.query(`UPDATE depreciation_schedules SET journal_entry_id = $1 WHERE id = $2`, [je.id, scheduleId]);
    }
    const lastCalc = (catchItems[catchItems.length - 1].calc as any);
    // the running accumulated after the last catch-up month is the right one only when no later month was posted after it
    const sumNow = await client.query(`SELECT COALESCE(SUM(amount), 0) AS acc FROM depreciation_schedules WHERE asset_id = $1`, [asset.id]);
    result.accumulated = round2(Number(sumNow.rows[0].acc));
    result.netBookValue = round2(cost - result.accumulated);
    void lastCalc;
    result.catchUp = {
      journalEntryId: je.id,
      date: day,
      total,
      retainedEarningsTotal: closedTotal,
      months: catchItems.map((i) => ({ year: i.year, month: i.month, amount: (i.calc as any).monthlyDepreciation, closedYear: i.closedYear })),
    };
  }
  await client.query(`UPDATE fixed_assets SET accumulated_depreciation = $1, net_book_value = $2 WHERE id = $3`, [result.accumulated, result.netBookValue, asset.id]);
  return result;
}
