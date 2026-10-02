import { normaliseVatFrequency, vatChecklistVerdict } from "./month-end-checklist-rules";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { acquirePeriodLockExclusive } from "./posting-lock";
import { storage } from "../storage";
import { detectAnomalies } from "./anomaly-detection.service";
import { bankRevaluationChecklist } from "./bank-revaluation.service";

// ===========================
// Month-End Close Automation
// Checklist, closing entries, period locking, AI validation.
// ===========================

export interface ChecklistItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
}

interface ClosingJournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  memo: string;
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  totalDebits: number;
  totalCredits: number;
}

interface MonthEndCloseRecord {
  id: string;
  companyId: string;
  periodEnd: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
  closingEntryId: string | null;
  createdAt: string;
}

/**
 * Previously created month_end_close at query time, which (a) ran DDL on the
 * request path and (b) silently diverged from the migration-defined table,
 * causing "column closing_entry_id does not exist" and a 500 on lock-period.
 *
 * The table and its columns/constraint are now owned solely by migrations
 * (0014/0073 create it; 0087 reconciles column names + unique constraint).
 * This is retained as a no-op so the six call sites need not change, and so
 * that DDL never runs on a user request again.
 */
async function ensureMonthEndTable(): Promise<void> {
  // Intentionally empty — schema is owned by migrations. See 0087.
}

/**
 * Get the month-end close checklist for a given period.
 * Returns 7 items with status indicating whether each requirement is met.
 */
export async function getCloseChecklist(
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<ChecklistItem[]> {
  const checklist: ChecklistItem[] = [];

  // 1. Bank reconciliation complete: every bank account with activity in the period needs a COMPLETED reconciliation
  // session as at the period end or later (the transaction flags alone do not prove the statement was agreed to the ledger).
  // Lines with no managed bank account cannot have a session: they must all be reconciled.
  const bankResult = await pool.query(
    `SELECT t.bank_statement_account_id AS bank_account_id,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.is_reconciled = true) AS reconciled
     FROM bank_transactions t
     WHERE t.company_id = $1
       AND t.transaction_date >= $2::date
       AND t.transaction_date < ($3::date + 1)
     GROUP BY t.bank_statement_account_id`,
    [companyId, periodStart, periodEnd]
  );
  const sessionResult = await pool.query(
    `SELECT DISTINCT bank_account_id
     FROM bank_reconciliations
     WHERE company_id = $1 AND status = 'completed' AND statement_date >= $2::date`,
    [companyId, periodEnd]
  );
  const sessionAccounts = new Set<string>(sessionResult.rows.map((r: any) => String(r.bank_account_id)));
  let bankTotal = 0;
  let bankReconciled = 0;
  let accountsNeedingSession = 0;
  let accountsWithSession = 0;
  let looseUnreconciled = 0;
  for (const row of bankResult.rows) {
    const total = parseInt(row.total || "0");
    const reconciled = parseInt(row.reconciled || "0");
    bankTotal += total;
    bankReconciled += reconciled;
    if (row.bank_account_id) {
      accountsNeedingSession++;
      if (sessionAccounts.has(String(row.bank_account_id))) accountsWithSession++;
    } else {
      looseUnreconciled += total - reconciled;
    }
  }
  const bankUnreconciled = bankTotal - bankReconciled;
  const bankSessionsMissing = accountsNeedingSession - accountsWithSession;
  checklist.push({
    id: 1,
    title: "Bank Reconciliation Complete",
    description: "Every bank account with activity has a completed reconciliation as at the period end",
    status: bankTotal === 0 || (bankSessionsMissing === 0 && looseUnreconciled === 0) ? "complete" : "incomplete",
    details:
      bankTotal === 0
        ? "No bank transactions in this period"
        : bankSessionsMissing > 0
          ? `${accountsWithSession}/${accountsNeedingSession} bank accounts have a completed reconciliation as at ${periodEnd} (${bankUnreconciled} lines unreconciled)`
          : looseUnreconciled > 0
            ? `${looseUnreconciled} lines without a bank account are unreconciled`
            : `${accountsWithSession}/${accountsNeedingSession} bank accounts reconciled as at ${periodEnd}`,
  });

  // 2. All invoices posted (non-draft)
  const invoiceResult = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status != 'draft') AS posted
     FROM invoices
     WHERE company_id = $1
       AND date >= $2::date
       AND date <= $3::date`,
    [companyId, periodStart, periodEnd]
  );
  const invTotal = parseInt(invoiceResult.rows[0]?.total || "0");
  const invPosted = parseInt(invoiceResult.rows[0]?.posted || "0");
  const invDrafts = invTotal - invPosted;
  checklist.push({
    id: 2,
    title: "All Invoices Posted",
    description: "No draft invoices remain for the period",
    status: invTotal === 0 || invDrafts === 0 ? "complete" : "incomplete",
    details:
      invTotal === 0
        ? "No invoices in this period"
        : `${invPosted}/${invTotal} posted (${invDrafts} drafts remaining)`,
  });

  // 3. All receipts categorized
  const receiptResult = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE account_id IS NOT NULL) AS categorized
     FROM receipts
     WHERE company_id = $1
       AND date >= $2
       AND date <= $3`,
    [companyId, periodStart, periodEnd]
  );
  const recTotal = parseInt(receiptResult.rows[0]?.total || "0");
  const recCategorized = parseInt(receiptResult.rows[0]?.categorized || "0");
  const recUncategorized = recTotal - recCategorized;
  checklist.push({
    id: 3,
    title: "All Receipts Categorized",
    description: "Every receipt has an assigned expense account",
    status: recTotal === 0 || recUncategorized === 0 ? "complete" : "incomplete",
    details:
      recTotal === 0
        ? "No receipts in this period"
        : `${recCategorized}/${recTotal} categorized (${recUncategorized} remaining)`,
  });

  // 4. Anomaly scan clean
  try {
    const anomalyResult = await detectAnomalies(companyId);
    const criticalCount = anomalyResult.summary.critical;
    checklist.push({
      id: 4,
      title: "Anomaly Scan Clean",
      description: "No critical anomalies detected in transactions",
      status: criticalCount === 0 ? "complete" : "incomplete",
      details:
        criticalCount === 0
          ? `Scan clean (${anomalyResult.summary.total} non-critical items)`
          : `${criticalCount} critical anomalies require attention`,
    });
  } catch {
    checklist.push({
      id: 4,
      title: "Anomaly Scan Clean",
      description: "No critical anomalies detected in transactions",
      status: "incomplete",
      details: "Unable to run anomaly scan",
    });
  }

  // 5. AI inbox clear (check transaction_classifications pending review)
  // Since ai_gl_queue may not exist, check transaction_classifications with no feedback
  const tableCheck = await pool.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'ai_gl_queue'
     ) AS exists`
  );

  if (tableCheck.rows[0].exists) {
    const queueResult = await pool.query(
      `SELECT COUNT(*) AS pending
       FROM ai_gl_queue
       WHERE company_id = $1
         AND status = 'pending_review'
         AND created_at >= $2::date
         AND created_at <= $3::date`,
      [companyId, periodStart, periodEnd]
    );
    const pendingCount = parseInt(queueResult.rows[0]?.pending || "0");
    checklist.push({
      id: 5,
      title: "AI Inbox Clear",
      description: "All AI-suggested entries reviewed and processed",
      status: pendingCount === 0 ? "complete" : "incomplete",
      details:
        pendingCount === 0
          ? "All AI suggestions processed"
          : `${pendingCount} items pending review`,
    });
  } else {
    // Fallback: check unreviewed classifications
    const classResult = await pool.query(
      `SELECT COUNT(*) AS pending
       FROM transaction_classifications
       WHERE company_id = $1
         AND was_accepted IS NULL
         AND created_at >= $2::date
         AND created_at <= $3::date`,
      [companyId, periodStart, periodEnd]
    );
    const pendingCount = parseInt(classResult.rows[0]?.pending || "0");
    checklist.push({
      id: 5,
      title: "AI Inbox Clear",
      description: "All AI-suggested classifications reviewed",
      status: pendingCount === 0 ? "complete" : "incomplete",
      details:
        pendingCount === 0
          ? "All AI suggestions processed"
          : `${pendingCount} classifications pending review`,
    });
  }

  // 6. Depreciation entries posted: every depreciable asset in use has its schedule row (a posted month) for this
  // period's month. Land and assets with no life are not depreciated; one fully depreciated earlier needs no row.
  const periodYear = parseInt(periodEnd.slice(0, 4));
  const periodMonth = parseInt(periodEnd.slice(5, 7));
  const depResult = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE posted) AS posted
     FROM (
       SELECT fa.id,
              (fa.status = 'fully_depreciated'
               OR EXISTS (SELECT 1 FROM depreciation_schedules ds
                           WHERE ds.asset_id = fa.id AND ds.period_year = $4 AND ds.period_month = $5)) AS posted
       FROM fixed_assets fa
       WHERE fa.company_id = $1
         AND fa.purchase_date <= $2::date
         AND (fa.disposal_date IS NULL OR fa.disposal_date > $3::date)
         AND lower(trim(coalesce(fa.category, ''))) <> 'land'
         AND fa.useful_life_years IS NOT NULL
     ) x`,
    [companyId, periodEnd, periodStart, periodYear, periodMonth]
  );
  const depTotal = parseInt(depResult.rows[0]?.total || "0");
  const depPosted = parseInt(depResult.rows[0]?.posted || "0");
  checklist.push({
    id: 6,
    title: "Depreciation Entries Posted",
    description: "Depreciation has been posted for this month for every depreciable fixed asset",
    status: depTotal === 0 || depPosted >= depTotal ? "complete" : "incomplete",
    details:
      depTotal === 0
        ? "No depreciable fixed assets"
        : `${depPosted}/${depTotal} assets depreciated through ${periodEnd.slice(0, 7)}`,
  });

  // 7. VAT return prepared: a submitted or filed return (a draft does not satisfy it) that COVERS the month (a monthly return inside it, or the
  // quarterly / annual return it belongs to). A quarterly filer is not held up mid-quarter: the return exists once the quarter ends.
  // A company that is not VAT-registered, or has no VAT in the month, has nothing to prepare.
  const vat = await vatItemStatus(companyId, periodStart, periodEnd);
  checklist.push({
    id: 7,
    title: "VAT Return Prepared",
    description: "VAT 201 return has been prepared or filed for the period",
    status: vat.open ? "incomplete" : "complete",
    details:
      vat.reason === "covered"
        ? `${vat.coveringReturns} VAT return(s) cover this period`
        : vat.reason === "period_not_ended"
          ? "This month falls inside a VAT period that has not ended: its return is prepared after the period closes"
          : vat.reason === "not_applicable"
            ? "No VAT to report for this month (not VAT-registered, or no VAT postings)"
            : "No VAT return prepared for this period",
  });

  // 8. Foreign-currency bank balances revalued at the period end (Teardown 7 F2): an unrealised gain or loss is booked and
  // reversed the next day (bank-revaluation.service.ts). Shown on the checklist; it does not hold up the lock.
  const fxBank = await bankRevaluationChecklist(companyId, periodEnd);
  checklist.push({
    id: 8,
    title: "Foreign-Currency Bank Balances Revalued",
    description: "Every foreign-currency bank account is revalued at the closing rate on the last day of the month",
    status: fxBank.complete ? "complete" : "incomplete",
    details: fxBank.details,
  });

  return checklist;
}

export interface VatItemStatus {
  open: boolean;
  reason: "covered" | "period_not_ended" | "not_applicable" | "missing";
  coveringReturns: number;
}

/**
 * Is the month's VAT item open? Open only when the company reports VAT for the month, the month ends a VAT period and no return
 * (submitted or filed; a draft does not count, nor a voided one) covers it. The month-end checklist shows it and the lock refuses while it is open.
 */
export async function vatItemStatus(companyId: string, periodStart: string, periodEnd: string): Promise<VatItemStatus> {
  const vatResult = await pool.query(
    `SELECT COUNT(*) AS total FROM vat_returns
      WHERE company_id = $1 AND period_start <= $3::date AND period_end >= $2::date AND status NOT IN ('draft', 'void', 'cancelled')`,
    [companyId, periodStart, periodEnd]
  );
  const coveringReturns = parseInt(vatResult.rows[0]?.total || "0");
  if (coveringReturns > 0) return { open: false, reason: "covered", coveringReturns };
  const company = await pool.query(`SELECT vat_filing_frequency, vat_period_start_month, trn_vat_number FROM companies WHERE id = $1`, [companyId]);
  const verdict = vatChecklistVerdict({
    coveringReturns,
    frequency: normaliseVatFrequency(company.rows[0]?.vat_filing_frequency),
    periodStartMonth: Number(company.rows[0]?.vat_period_start_month ?? 1),
    month: parseInt(periodEnd.slice(5, 7)),
  });
  if (verdict.complete) return { open: false, reason: "period_not_ended", coveringReturns };
  const activity = await pool.query(
    `SELECT 1 FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.source NOT IN ('vat_filing', 'vat_payment')
        AND ((je.date + INTERVAL '4 hours')::date) BETWEEN $2::date AND $3::date
        AND a.company_id = $1 AND a.code IN ('1050', '2020') LIMIT 1`,
    [companyId, periodStart, periodEnd]
  );
  if (!company.rows[0]?.trn_vat_number || activity.rows.length === 0) return { open: false, reason: "not_applicable", coveringReturns };
  return { open: true, reason: "missing", coveringReturns };
}

export interface MonthEndClosingResult {
  /** Always false: a month-end close posts no closing entries (see below). */
  posted: false;
  code: "MONTH_END_POSTS_NO_CLOSING_ENTRIES";
  message: string;
  messageAr: string;
  periodStart: string;
  periodEnd: string;
  /** What the period earned (income - expenses over the period only): informational, nothing was moved. */
  netProfit: number;
  lines: [];
  entryNumber: null;
}

/**
 * "Generate closing entries" for a MONTH. A month-end close locks the period; it never closes revenue and expense to
 * equity. That is the year-end's job (year-end.service.ts): one entry dated the year's last day, only for the year being
 * closed. A month close that did it zeroed the Q3 P&L and the corporate-tax base (teardown 6, t1/F3): the old query also
 * summed every posting of every date. So this posts NOTHING, whatever the dates asked for, and reports the period's
 * profit read from the ledger layer (posted entries within the period only) so the screen can still show it.
 */
export async function generateClosingEntries(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  _userId: string
): Promise<MonthEndClosingResult> {
  const { periodProfit } = await import("../reports/ledger");
  const profit = await periodProfit(pool as any, companyId, periodStart, periodEnd);
  return {
    posted: false,
    code: "MONTH_END_POSTS_NO_CLOSING_ENTRIES",
    message:
      "A month-end close does not post closing entries: revenue and expenses stay in the P&L. Lock the period to close the month; the financial-year close moves the year's profit to retained earnings.",
    messageAr:
      "إقفال نهاية الشهر لا ينشئ قيود إقفال: تبقى الإيرادات والمصروفات في قائمة الدخل. اقفل الفترة لإغلاق الشهر، أما إقفال السنة المالية فينقل ربح السنة إلى الأرباح المحتجزة.",
    periodStart,
    periodEnd,
    netProfit: profit.net,
    lines: [],
    entryNumber: null,
  };
}

/**
 * Lock a period to prevent further modifications.
 */
export async function lockPeriod(
  companyId: string,
  periodEnd: string,
  userId: string,
  closingEntryId?: string
): Promise<MonthEndCloseRecord> {
  await ensureMonthEndTable();

  // Exclusive month lock first, in the same transaction as the upsert: postings in
  // flight finish before the month is locked, later ones see it locked (posting-lock.ts).
  const result: any = await db.transaction(async (tx: any) => {
    await acquirePeriodLockExclusive(tx, companyId, [periodEnd]);
    return await tx.execute(sql`
      INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at, closing_entry_id)
      VALUES (${companyId}, ${periodEnd}::date, 'locked', ${userId}, now(), ${closingEntryId || null})
      ON CONFLICT (company_id, period_end)
      DO UPDATE SET
        status = 'locked',
        closed_by = EXCLUDED.closed_by,
        closed_at = now(),
        closing_entry_id = COALESCE(EXCLUDED.closing_entry_id, month_end_close.closing_entry_id),
        updated_at = now()
      RETURNING *`);
  });
  result.rows = result.rows ?? result;

  return formatCloseRecord(result.rows[0]);
}

/**
 * Same upsert as lockPeriod, run on a caller-owned drizzle transaction so a
 * VAT filing and the locking of its months commit (or roll back) together.
 */
export async function lockPeriodInTx(
  tx: { execute: (query: any) => Promise<unknown> },
  companyId: string,
  periodEnd: string,
  userId: string
): Promise<void> {
  // Callers take the exclusive month locks FIRST (before any other work); repeating it
  // here is free (the same session already holds it) and covers a caller that forgot.
  await acquirePeriodLockExclusive(tx, companyId, [periodEnd]);
  await tx.execute(sql`
    INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at)
    VALUES (${companyId}, ${periodEnd}::date, 'locked', ${userId}, now())
    ON CONFLICT (company_id, period_end)
    DO UPDATE SET status = 'locked', closed_by = EXCLUDED.closed_by, closed_at = now(), updated_at = now()
  `);
}

/**
 * Check if a given date falls within a locked period.
 *
 * A month_end_close row locks ONLY the month it represents (the calendar month
 * ending at period_end). Locking February must not retroactively close January.
 */
export async function isPeriodLocked(companyId: string, date: string): Promise<boolean> {
  await ensureMonthEndTable();

  const result = await pool.query(
    `SELECT 1
     FROM month_end_close
     WHERE company_id = $1
       AND status = 'locked'
       AND $2::date >= date_trunc('month', period_end)::date
       AND $2::date <= period_end
     LIMIT 1`,
    [companyId, date]
  );

  return result.rowCount! > 0;
}

/**
 * Unlock a previously-locked period. Reverses lockPeriod by flipping status
 * back to 'open'. The month_end_close row itself is preserved so that audit
 * trail (closed_by / closed_at) survives the unlock.
 */
export async function unlockPeriod(
  companyId: string,
  periodEnd: string
): Promise<MonthEndCloseRecord | null> {
  await ensureMonthEndTable();

  const result = await pool.query(
    `UPDATE month_end_close
     SET status = 'open', updated_at = now()
     WHERE company_id = $1 AND period_end = $2::date
     RETURNING *`,
    [companyId, periodEnd]
  );

  if (result.rowCount === 0) return null;
  return formatCloseRecord(result.rows[0]);
}

/**
 * List all locked periods for a company.
 */
export async function listLockedPeriods(companyId: string): Promise<MonthEndCloseRecord[]> {
  await ensureMonthEndTable();

  const result = await pool.query(
    `SELECT * FROM month_end_close
     WHERE company_id = $1 AND status = 'locked'
     ORDER BY period_end DESC`,
    [companyId]
  );

  return result.rows.map(formatCloseRecord);
}

/**
 * Get the history of month-end close records for a company.
 */
export async function getCloseHistory(companyId: string): Promise<MonthEndCloseRecord[]> {
  await ensureMonthEndTable();

  const result = await pool.query(
    `SELECT mc.*, u.email AS closed_by_email
     FROM month_end_close mc
     LEFT JOIN users u ON u.id = mc.closed_by
     WHERE mc.company_id = $1
     ORDER BY mc.period_end DESC`,
    [companyId]
  );

  return result.rows.map((row: any) => ({
    ...formatCloseRecord(row),
    closedByEmail: row.closed_by_email || null,
  }));
}

/**
 * AI-powered validation of month-end readiness.
 * Runs all checks and generates a human-readable summary.
 */
export async function aiValidation(
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ ready: boolean; summary: string; checklist: ChecklistItem[] }> {
  const checklist = await getCloseChecklist(companyId, periodStart, periodEnd);

  const incompleteItems = checklist.filter((item) => item.status === "incomplete");
  const completeCount = checklist.filter((item) => item.status === "complete").length;
  const totalCount = checklist.length;

  let summary: string;
  let ready: boolean;

  if (incompleteItems.length === 0) {
    ready = true;
    summary = `Ready to close. All ${totalCount} checks passed. You can proceed with generating closing entries and locking the period.`;
  } else {
    ready = false;
    const issues = incompleteItems.map((item) => {
      const detail = item.details ? ` (${item.details})` : "";
      return `${item.title}${detail}`;
    });
    summary =
      `Not ready to close: ${completeCount}/${totalCount} checks passed. Outstanding issues:\n` +
      issues.map((issue) => `- ${issue}`).join("\n");
  }

  return { ready, summary, checklist };
}

function formatCloseRecord(row: any): MonthEndCloseRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    periodEnd: row.period_end,
    status: row.status,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closingEntryId: row.closing_entry_id,
    createdAt: row.created_at,
  };
}
