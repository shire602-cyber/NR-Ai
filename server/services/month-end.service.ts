import type { QueryResultRow } from "pg";
import { pool } from "../db";
import { DomainError } from "../errors";
import { postJournal } from "../ledger";
import { detectAnomalies } from "./anomaly-detection.service";
import { getEffectiveLock, type LockScope, type LockType } from "./period-lock.service";
import {
  YEAR_END_CLOSE_SOURCE,
  accountTotals,
  aed,
  fiscalYearEnd as fiscalYearEndOf,
  fiscalYearStart as fiscalYearStartOf,
  isRetainedEarningsAccount,
  loadAccounts,
  loadCompany,
  parseReportDate,
} from "../reporting";

// ===========================
// Month-End Close Automation
// Checklist, computed close, period locking, year-end close, AI validation.
//
// Policy (W2-B): statements are correct by computation, not by closing
// entries. Monthly close posts nothing. A year-end closing entry is optional
// (company opt-in), tagged `year_end_close`, and excluded from every P&L,
// corporate-tax and comparison query.
// ===========================

export interface ChecklistItem {
  id: number;
  /** Stable step key used for sign-offs (W4-A). */
  key?: string;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
  /** Judgment steps a preparer may sign off when the system check cannot prove them. */
  requiresSignOff?: boolean;
  /** Where the user fixes the step (client route) and, for FX, the API to run. */
  actionHref?: string;
  actionEndpoint?: string;
  /** Filled by getChecklistWithSignOffs. */
  signOff?: {
    stepKey: string;
    signedOffBy: string;
    signedOffByEmail: string | null;
    signedOffAt: string;
    note: string | null;
  } | null;
  effectiveStatus?: "complete" | "incomplete";
}

export interface ClosingLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

/**
 * The computed close for a period: what a closing entry WOULD contain, built
 * only from posted, non-closing lines dated inside the period (R08-01).
 */
export interface CloseSummary {
  id: string | null;
  entryNumber: string | null;
  posted: boolean;
  mode: "computed" | "posted";
  periodStart: string;
  periodEnd: string;
  date: string;
  memo: string;
  lines: ClosingLine[];
  totalDebits: number;
  totalCredits: number;
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  retainedEarningsAccount: { id: string; code: string; name: string } | null;
  message: string;
}

export interface MonthEndCloseRecord {
  id: string;
  companyId: string;
  periodEnd: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
  closingEntryId: string | null;
  createdAt: string;
  lockType: LockType;
  lockScope: LockScope;
  lockReason: string | null;
  checklistOverride: boolean;
  unlockedBy: string | null;
  unlockedAt: string | null;
  unlockReason: string | null;
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

  // 1. Bank reconciliation complete
  const bankResult = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_reconciled = true) AS reconciled
     FROM bank_transactions
     WHERE company_id = $1
       AND transaction_date >= $2::date
       AND transaction_date <= $3::date`,
    [companyId, periodStart, periodEnd]
  );
  const bankTotal = parseInt(bankResult.rows[0]?.total || "0");
  const bankReconciled = parseInt(bankResult.rows[0]?.reconciled || "0");
  const bankUnreconciled = bankTotal - bankReconciled;
  checklist.push({
    id: 1,
    title: "Bank Reconciliation Complete",
    description: "All bank transactions for the period are reconciled",
    status: bankTotal === 0 || bankUnreconciled === 0 ? "complete" : "incomplete",
    details:
      bankTotal === 0
        ? "No bank transactions in this period"
        : `${bankReconciled}/${bankTotal} reconciled (${bankUnreconciled} remaining)`,
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

  // 6. Depreciation entries posted (if fixed_assets table exists)
  const fixedAssetsCheck = await pool.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'fixed_assets'
     ) AS exists`
  );

  if (fixedAssetsCheck.rows[0].exists) {
    // Legacy databases may predate the depreciation_posted column; fall back
    // to status-only detection rather than failing the whole checklist.
    const depColCheck = await pool.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.columns
         WHERE table_name = 'fixed_assets' AND column_name = 'depreciation_posted'
       ) AS exists`
    );
    const postedFilter = depColCheck.rows[0].exists
      ? `(depreciation_posted = true OR status = 'fully_depreciated')`
      : `status = 'fully_depreciated'`;
    const depResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE ${postedFilter}) AS posted
       FROM fixed_assets
       WHERE company_id = $1
         AND purchase_date <= $2::date
         AND (disposal_date IS NULL OR disposal_date > $3::date)`,
      [companyId, periodEnd, periodStart]
    );
    const depTotal = parseInt(depResult.rows[0]?.total || "0");
    const depPosted = parseInt(depResult.rows[0]?.posted || "0");
    checklist.push({
      id: 6,
      title: "Depreciation Entries Posted",
      description: "Monthly depreciation has been recorded for all active fixed assets",
      status: depTotal === 0 || depPosted >= depTotal ? "complete" : "incomplete",
      details:
        depTotal === 0
          ? "No active fixed assets"
          : `${depPosted}/${depTotal} assets depreciated for this period`,
    });
  } else {
    checklist.push({
      id: 6,
      title: "Depreciation Entries Posted",
      description: "Monthly depreciation has been recorded for all active fixed assets",
      status: "complete",
      details: "Fixed assets module not configured",
    });
  }

  // 7. VAT return prepared
  const vatResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM vat_returns
     WHERE company_id = $1
       AND period_start >= $2::date
       AND period_end <= $3::date
       AND status != 'draft'`,
    [companyId, periodStart, periodEnd]
  );
  const vatCount = parseInt(vatResult.rows[0]?.total || "0");
  checklist.push({
    id: 7,
    title: "VAT Return Prepared",
    description: "VAT 201 return has been prepared or filed for the period",
    status: vatCount > 0 ? "complete" : "incomplete",
    details:
      vatCount > 0
        ? `${vatCount} VAT return(s) prepared`
        : "No VAT return prepared for this period",
  });

  // ── W4-A (R08-23): accruals, prepayments, FX revaluation ────────────────
  // 8. Accruals recorded: expense activity in the period should be matched by
  //    accrual entries (auto-reversing journals or Accrued Expenses 2040)
  //    unless the preparer signs the step off as not required.
  const accrualResult = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM journal_entries je
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND ((je.date + interval '4 hours')::date) BETWEEN $2::date AND $3::date
           AND (je.auto_reverse_on IS NOT NULL OR COALESCE(je.memo, '') ILIKE '%accru%'
                OR EXISTS (SELECT 1 FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
                            WHERE jl.entry_id = je.id AND a.code = '2040'))) AS accruals,
       (SELECT COUNT(*) FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN accounts a ON a.id = jl.account_id
         WHERE je.company_id = $1 AND je.status = 'posted' AND a.type = 'expense'
           AND ((je.date + interval '4 hours')::date) BETWEEN $2::date AND $3::date) AS expense_lines`,
    [companyId, periodStart, periodEnd]
  );
  const accrualCount = parseInt(accrualResult.rows[0]?.accruals || "0");
  const expenseLines = parseInt(accrualResult.rows[0]?.expense_lines || "0");
  checklist.push({
    id: 8,
    key: "accruals",
    title: "Accruals Recorded",
    description: "Expenses incurred but not yet billed are accrued (auto-reversing journals)",
    status: expenseLines === 0 || accrualCount > 0 ? "complete" : "incomplete",
    details:
      expenseLines === 0
        ? "No expense activity in this period"
        : accrualCount > 0
          ? `${accrualCount} accrual entr${accrualCount === 1 ? "y" : "ies"} posted`
          : "No accrual entries found. Post accruals or sign this step off as not required.",
    requiresSignOff: true,
    actionHref: "/journal",
  });

  // 9. Prepayments amortised: a prepaid balance (1060) needs release activity.
  const prepaid = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ((je.date + interval '4 hours')::date) <= $3::date
                         THEN ROUND(jl.debit * 100) - ROUND(jl.credit * 100) END), 0)::bigint AS balance,
       COALESCE(SUM(CASE WHEN ((je.date + interval '4 hours')::date) BETWEEN $2::date AND $3::date
                         THEN ROUND(jl.credit * 100) END), 0)::bigint AS released
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '1060'`,
    [companyId, periodStart, periodEnd]
  );
  const prepaidBalance = Number(prepaid.rows[0]?.balance || 0) / 100;
  const prepaidReleased = Number(prepaid.rows[0]?.released || 0) / 100;
  checklist.push({
    id: 9,
    key: "prepayments",
    title: "Prepayments Amortised",
    description: "The period's share of prepaid expenses has been released to the P&L",
    status: prepaidBalance <= 0 || prepaidReleased > 0 ? "complete" : "incomplete",
    details:
      prepaidBalance <= 0
        ? "No prepaid balance"
        : prepaidReleased > 0
          ? `AED ${prepaidReleased.toFixed(2)} released; AED ${prepaidBalance.toFixed(2)} remaining`
          : `AED ${prepaidBalance.toFixed(2)} prepaid with no release this period`,
    requiresSignOff: true,
    actionHref: "/journal",
  });

  // 10. FX revaluation: open foreign-currency balances need a revaluation at period end.
  const fx = await pool.query(
    `SELECT
       (SELECT COUNT(DISTINCT jl.account_id) FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN accounts a ON a.id = jl.account_id
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND a.type IN ('asset', 'liability')
           AND COALESCE(jl.foreign_currency, '') NOT IN ('', 'AED')
           AND ((je.date + interval '4 hours')::date) <= $3::date) AS fx_accounts,
       (SELECT COUNT(*) FROM journal_entries je
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND (je.entry_kind = 'revaluation' OR je.source IN ('fx_revaluation', 'revaluation'))
           AND ((je.date + interval '4 hours')::date) BETWEEN $2::date AND $3::date) AS revaluations`,
    [companyId, periodStart, periodEnd]
  );
  const fxAccounts = parseInt(fx.rows[0]?.fx_accounts || "0");
  const revaluations = parseInt(fx.rows[0]?.revaluations || "0");
  checklist.push({
    id: 10,
    key: "fx_revaluation",
    title: "FX Revaluation Run",
    description: "Foreign-currency balances revalued at the period-end rate",
    status: fxAccounts === 0 || revaluations > 0 ? "complete" : "incomplete",
    details:
      fxAccounts === 0
        ? "No foreign-currency balances"
        : revaluations > 0
          ? `${revaluations} revaluation entr${revaluations === 1 ? "y" : "ies"} posted`
          : `${fxAccounts} account(s) hold foreign-currency balances; run the revaluation`,
    requiresSignOff: true,
    actionHref: "/exchange-rates",
    actionEndpoint: "POST /api/companies/:companyId/exchange-rates/revalue",
  });

  const keys: Record<number, string> = {
    1: "bank_reconciliation",
    2: "invoices_posted",
    3: "receipts_categorized",
    4: "anomaly_scan",
    5: "ai_inbox",
    6: "depreciation",
    7: "vat_return",
  };
  for (const item of checklist) item.key = item.key ?? keys[item.id];
  const bank = checklist.find((c) => c.id === 1);
  if (bank) bank.actionHref = "/bank-reconciliation";
  const dep = checklist.find((c) => c.id === 6);
  if (dep) dep.actionHref = "/fixed-assets";

  return checklist;
}

/** Validate a YYYY-MM-DD period pair; 400 on garbage (R08-11). */
export function assertPeriodRange(
  periodStart: unknown,
  periodEnd: unknown
): { periodStart: string; periodEnd: string } {
  const start = parseReportDate(periodStart, "periodStart");
  const end = parseReportDate(periodEnd, "periodEnd");
  if (!start || !end) {
    throw new DomainError(
      "PERIOD_REQUIRED",
      400,
      undefined,
      "periodStart and periodEnd are required (YYYY-MM-DD)"
    );
  }
  if (start > end) {
    throw new DomainError(
      "INVALID_PERIOD",
      400,
      { periodStart: start, periodEnd: end },
      "periodStart must be on or before periodEnd"
    );
  }
  return { periodStart: start, periodEnd: end };
}

async function findRetainedEarningsAccount(companyId: string) {
  const accounts = (await loadAccounts(companyId)).filter((a) => a.isActive);
  return (
    accounts.find((a) => a.code === "3020") ??
    accounts.find((a) => isRetainedEarningsAccount(a)) ??
    null
  );
}

/**
 * R08-01: compute closing lines from posted lines of entries dated INSIDE the
 * period only (the kernel filters date/status in WHERE, never on an outer-join
 * ON clause), excluding earlier closing entries.
 */
export async function computeCloseSummary(
  companyId: string,
  periodStartRaw: unknown,
  periodEndRaw: unknown
): Promise<CloseSummary> {
  const { periodStart, periodEnd } = assertPeriodRange(periodStartRaw, periodEndRaw);
  const [accounts, totals, re] = await Promise.all([
    loadAccounts(companyId),
    accountTotals(companyId, { from: periodStart, to: periodEnd }),
    findRetainedEarningsAccount(companyId),
  ]);
  const lines: ClosingLine[] = [];
  let dr = 0;
  let cr = 0;
  let revenue = 0;
  let expenses = 0;
  for (const a of accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    const t = totals.get(a.id);
    if (!t) continue;
    const net = t.debit - t.credit; // fils, debit positive
    if (net === 0) continue;
    if (a.type === "income") revenue += -net;
    else expenses += net;
    // A closing line reverses the balance.
    const debit = net < 0 ? -net : 0;
    const credit = net > 0 ? net : 0;
    dr += debit;
    cr += credit;
    lines.push({
      accountId: a.id,
      accountCode: a.code,
      accountName: a.nameEn,
      debit: aed(debit),
      credit: aed(credit),
    });
  }
  const netIncome = revenue - expenses;
  if (netIncome !== 0 && re) {
    const debit = netIncome < 0 ? -netIncome : 0;
    const credit = netIncome > 0 ? netIncome : 0;
    dr += debit;
    cr += credit;
    lines.push({
      accountId: re.id,
      accountCode: re.code,
      accountName: re.nameEn,
      debit: aed(debit),
      credit: aed(credit),
    });
  }
  return {
    id: null,
    entryNumber: null,
    posted: false,
    mode: "computed",
    periodStart,
    periodEnd,
    date: periodEnd,
    memo: `Computed close for ${periodStart} to ${periodEnd}`,
    lines,
    totalDebits: aed(dr),
    totalCredits: aed(cr),
    totalRevenue: aed(revenue),
    totalExpenses: aed(expenses),
    netIncome: aed(netIncome),
    retainedEarningsAccount: re ? { id: re.id, code: re.code, name: re.nameEn } : null,
    message:
      "Monthly close posts no journal entry: statements roll earnings into retained earnings by " +
      "computation. Use the year-end close to record (and, if enabled, post) the fiscal-year close.",
  };
}

/**
 * Month-end "generate closing entries" (R08-01, R08-02). The endpoint now
 * returns the computed close summary and posts nothing. A closing entry can
 * only be posted through the year-end close, and only when the company opts in.
 */
export async function generateClosingEntries(
  companyId: string,
  periodStart: unknown,
  periodEnd: unknown
): Promise<CloseSummary> {
  return computeCloseSummary(companyId, periodStart, periodEnd);
}

// ─── Close settings ─────────────────────────────────────────────────────────

export interface CloseSettings {
  postYearEndClosingEntry: boolean;
  requireChecklistToLock: boolean;
}

export async function getCloseSettings(companyId: string): Promise<CloseSettings> {
  const r = await pool.query(
    `SELECT post_year_end_closing_entry, require_checklist_to_lock
       FROM company_close_settings WHERE company_id = $1`,
    [companyId]
  );
  return {
    postYearEndClosingEntry: r.rows[0]?.post_year_end_closing_entry === true,
    requireChecklistToLock: r.rows[0] ? r.rows[0].require_checklist_to_lock !== false : true,
  };
}

export async function updateCloseSettings(
  companyId: string,
  patch: Partial<CloseSettings>,
  userId: string
): Promise<CloseSettings> {
  const next = { ...(await getCloseSettings(companyId)), ...patch };
  await pool.query(
    `INSERT INTO company_close_settings
       (company_id, post_year_end_closing_entry, require_checklist_to_lock, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id) DO UPDATE SET
       post_year_end_closing_entry = EXCLUDED.post_year_end_closing_entry,
       require_checklist_to_lock = EXCLUDED.require_checklist_to_lock,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [companyId, next.postYearEndClosingEntry, next.requireChecklistToLock, userId]
  );
  return next;
}

// ─── Locking ────────────────────────────────────────────────────────────────

export interface LockOptions {
  lockType?: LockType;
  lockScope?: LockScope;
  reason?: string | null;
  checklistOverride?: boolean;
  checklistSnapshot?: unknown;
  closingEntryId?: string | null;
}

/**
 * Lock a period. New locks are lock-through (everything on or before
 * periodEnd) and hard unless told otherwise. Routes enforce the checklist and
 * role policy before calling this.
 */
export async function lockPeriod(
  companyId: string,
  periodEnd: string,
  userId: string,
  opts: LockOptions = {}
): Promise<MonthEndCloseRecord> {
  const end = parseReportDate(periodEnd, "periodEnd");
  if (!end) {
    throw new DomainError("PERIOD_REQUIRED", 400, undefined, "periodEnd is required (YYYY-MM-DD)");
  }
  const result = await pool.query(
    `INSERT INTO month_end_close
       (company_id, period_start, period_end, status, closed_by, closed_at, closing_entry_id,
        lock_type, lock_scope, lock_reason, checklist_override, checklist_snapshot)
     VALUES ($1, date_trunc('month', $2::date), $2::date, 'locked', $3, now(), $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (company_id, period_end)
     DO UPDATE SET
       status = 'locked',
       closed_by = EXCLUDED.closed_by,
       closed_at = now(),
       closing_entry_id = COALESCE(EXCLUDED.closing_entry_id, month_end_close.closing_entry_id),
       lock_type = EXCLUDED.lock_type,
       lock_scope = EXCLUDED.lock_scope,
       lock_reason = EXCLUDED.lock_reason,
       checklist_override = EXCLUDED.checklist_override,
       checklist_snapshot = EXCLUDED.checklist_snapshot,
       updated_at = now()
     RETURNING *`,
    [
      companyId,
      end,
      userId,
      opts.closingEntryId || null,
      opts.lockType ?? "hard",
      opts.lockScope ?? "through",
      opts.reason ?? null,
      opts.checklistOverride === true,
      opts.checklistSnapshot === undefined ? null : JSON.stringify(opts.checklistSnapshot),
    ]
  );
  return formatCloseRecord(result.rows[0]);
}

/**
 * Is `date` inside a locked period? A lock-through row covers every date on or
 * before its period_end; a legacy month row covers only its calendar month.
 */
export async function isPeriodLocked(companyId: string, date: string): Promise<boolean> {
  return (await getEffectiveLock(companyId, date)) !== null;
}

/**
 * Unlock a locked period. The row survives so the audit trail (closed_by /
 * closed_at, unlocked_by / unlock_reason) is preserved. Role policy lives in
 * the route.
 */
export async function unlockPeriod(
  companyId: string,
  periodEnd: string,
  opts: { userId?: string | null; reason?: string | null } = {}
): Promise<MonthEndCloseRecord | null> {
  const end = parseReportDate(periodEnd, "periodEnd");
  if (!end) throw new DomainError("PERIOD_REQUIRED", 400);
  const result = await pool.query(
    `UPDATE month_end_close
        SET status = 'open', updated_at = now(), unlocked_by = $3, unlocked_at = now(),
            unlock_reason = $4
      WHERE company_id = $1 AND period_end::date = $2::date AND status = 'locked'
      RETURNING *`,
    [companyId, end, opts.userId ?? null, opts.reason ?? null]
  );
  if (result.rowCount === 0) return null;
  return formatCloseRecord(result.rows[0]);
}

/** List all locked periods for a company. */
export async function listLockedPeriods(companyId: string): Promise<MonthEndCloseRecord[]> {
  const result = await pool.query(
    `SELECT * FROM month_end_close
     WHERE company_id = $1 AND status = 'locked'
     ORDER BY period_end DESC`,
    [companyId]
  );
  return result.rows.map(formatCloseRecord);
}

/** History of month-end close records for a company. */
export async function getCloseHistory(companyId: string): Promise<MonthEndCloseRecord[]> {
  const result = await pool.query(
    `SELECT mc.*, u.email AS closed_by_email
     FROM month_end_close mc
     LEFT JOIN users u ON u.id = mc.closed_by
     WHERE mc.company_id = $1
     ORDER BY mc.period_end DESC`,
    [companyId]
  );
  return result.rows.map((row) => ({
    ...formatCloseRecord(row),
    closedByEmail: row.closed_by_email || null,
  }));
}

// ─── Year-end close (R11-14) ────────────────────────────────────────────────

export interface FiscalYearCloseRecord {
  id: string;
  companyId: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  status: "closed" | "reopened";
  hardClosed: boolean;
  closingEntryId: string | null;
  netIncome: number;
  reason: string | null;
  closedBy: string | null;
  closedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

function formatYearClose(row: QueryResultRow): FiscalYearCloseRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    fiscalYearStart: row.fys,
    fiscalYearEnd: row.fye,
    status: row.status,
    hardClosed: row.hard_closed === true,
    closingEntryId: row.closing_entry_id ?? null,
    netIncome: Number(row.net_income) || 0,
    reason: row.reason ?? null,
    closedBy: row.closed_by ?? null,
    closedAt: row.closed_at ?? null,
    reopenedBy: row.reopened_by ?? null,
    reopenedAt: row.reopened_at ?? null,
    reopenReason: row.reopen_reason ?? null,
  };
}

const YEAR_CLOSE_COLUMNS = `*, fiscal_year_start::text AS fys, fiscal_year_end::text AS fye`;

export async function listFiscalYearCloses(companyId: string): Promise<FiscalYearCloseRecord[]> {
  const r = await pool.query(
    `SELECT ${YEAR_CLOSE_COLUMNS} FROM fiscal_year_closes
      WHERE company_id = $1 ORDER BY fiscal_year_end DESC`,
    [companyId]
  );
  return r.rows.map(formatYearClose);
}

/**
 * The seam the close posts through. Default: the server/ledger posting kernel
 * (postJournal) with entry kind `year_end_close`; tests may swap it with
 * setClosePostingPort().
 */
export interface ClosePostingPort {
  post(input: {
    companyId: string;
    date: string;
    memo: string;
    source: string;
    userId: string;
    /** The entry this one undoes (reopen), recorded as source_id. */
    sourceId?: string | null;
    idempotencyKey?: string | null;
    lines: Array<{ accountId: string; debit: number; credit: number; description: string }>;
  }): Promise<{ id: string; entryNumber: string }>;
}

export const ledgerClosePostingPort: ClosePostingPort = {
  async post(input) {
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        memo: input.memo,
        source: input.source,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: "posted",
        kind: "year_end_close",
        allowFutureDate: true,
        lines: input.lines
          .filter((l) => l.debit !== 0 || l.credit !== 0)
          .map((l) => ({
            accountId: l.accountId,
            debitFils: Math.round(l.debit * 100),
            creditFils: Math.round(l.credit * 100),
            description: l.description,
          })),
      },
      { actorId: input.userId, audit: true }
    );
    return { id: entry.id, entryNumber: entry.entryNumber };
  },
};

let closePostingPort: ClosePostingPort = ledgerClosePostingPort;

export function setClosePostingPort(port: ClosePostingPort): void {
  closePostingPort = port;
}

export interface YearEndCloseResult {
  record: FiscalYearCloseRecord;
  summary: CloseSummary;
  posted: boolean;
  closingEntryId: string | null;
  entryNumber: string | null;
  lock: MonthEndCloseRecord;
}

/**
 * Close a fiscal year: records the close and locks through the year end
 * (soft, or hard with hardClose). Posts ONE closing entry tagged
 * `year_end_close` to retained earnings only when the company opted in; that
 * entry is excluded from every statement and corporate-tax query so the
 * roll-forward never double counts it. Closing twice -> 409.
 */
export async function closeFiscalYear(
  companyId: string,
  fiscalYearEndRaw: unknown,
  userId: string,
  opts: {
    hardClose?: boolean;
    reason?: string | null;
    checklistOverride?: boolean;
    checklistSnapshot?: unknown;
  } = {}
): Promise<YearEndCloseResult> {
  const fye = parseReportDate(fiscalYearEndRaw, "fiscalYearEnd");
  if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
  const company = await loadCompany(companyId);
  const expectedEnd = fiscalYearEndOf(fye, company.fiscalYearStartMonth);
  if (expectedEnd !== fye) {
    throw new DomainError(
      "NOT_FISCAL_YEAR_END",
      400,
      { expectedFiscalYearEnd: expectedEnd },
      "fiscalYearEnd must be the last day of the company's fiscal year"
    );
  }
  const fys = fiscalYearStartOf(fye, company.fiscalYearStartMonth);
  const existing = await pool.query(
    `SELECT status FROM fiscal_year_closes WHERE company_id = $1 AND fiscal_year_end = $2::date`,
    [companyId, fye]
  );
  if (existing.rows[0]?.status === "closed") {
    throw new DomainError(
      "FISCAL_YEAR_ALREADY_CLOSED",
      409,
      { fiscalYearEnd: fye },
      "This fiscal year is already closed"
    );
  }

  const summary = await computeCloseSummary(companyId, fys, fye);
  const settings = await getCloseSettings(companyId);
  let closingEntryId: string | null = null;
  let entryNumber: string | null = null;
  if (settings.postYearEndClosingEntry && summary.lines.length > 0) {
    if (!summary.retainedEarningsAccount) {
      throw new DomainError(
        "RETAINED_EARNINGS_ACCOUNT_MISSING",
        422,
        undefined,
        "Create a retained earnings equity account (3020) before posting a year-end close"
      );
    }
    const posted = await closePostingPort.post({
      companyId,
      date: fye,
      memo: `Year-end close FY ${fys} to ${fye}`,
      source: YEAR_END_CLOSE_SOURCE,
      userId,
      lines: summary.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: `Year-end close - ${l.accountName}`,
      })),
    });
    closingEntryId = posted.id;
    entryNumber = posted.entryNumber;
  }

  const r = await pool.query(
    `INSERT INTO fiscal_year_closes
       (company_id, fiscal_year_start, fiscal_year_end, status, hard_closed, closing_entry_id,
        net_income, reason, closed_by, closed_at)
     VALUES ($1, $2::date, $3::date, 'closed', $4, $5, $6, $7, $8, now())
     ON CONFLICT (company_id, fiscal_year_end) DO UPDATE SET
       status = 'closed', hard_closed = EXCLUDED.hard_closed,
       closing_entry_id = EXCLUDED.closing_entry_id, net_income = EXCLUDED.net_income,
       reason = EXCLUDED.reason, closed_by = EXCLUDED.closed_by, closed_at = now()
     WHERE fiscal_year_closes.status <> 'closed'
     RETURNING ${YEAR_CLOSE_COLUMNS}`,
    [
      companyId,
      fys,
      fye,
      opts.hardClose === true,
      closingEntryId,
      summary.netIncome,
      opts.reason ?? null,
      userId,
    ]
  );
  if (!r.rows[0]) {
    throw new DomainError("FISCAL_YEAR_ALREADY_CLOSED", 409, { fiscalYearEnd: fye });
  }
  const lock = await lockPeriod(companyId, fye, userId, {
    lockType: opts.hardClose ? "hard" : "soft",
    lockScope: "through",
    reason: opts.reason ?? `Year-end close ${fye}`,
    checklistOverride: opts.checklistOverride,
    checklistSnapshot: opts.checklistSnapshot,
    closingEntryId,
  });
  return {
    record: formatYearClose(r.rows[0]),
    summary: {
      ...summary,
      id: closingEntryId,
      entryNumber,
      posted: closingEntryId !== null,
      mode: closingEntryId ? "posted" : "computed",
    },
    posted: closingEntryId !== null,
    closingEntryId,
    entryNumber,
    lock,
  };
}

/**
 * Reopen a closed fiscal year: reverses a posted closing entry (the reversal
 * is tagged year_end_close too, so it is also excluded from statements) and
 * unlocks the year end. The route enforces who may reopen a hard close.
 */
export async function reopenFiscalYear(
  companyId: string,
  fiscalYearEndRaw: unknown,
  userId: string,
  reason: string
): Promise<FiscalYearCloseRecord> {
  const fye = parseReportDate(fiscalYearEndRaw, "fiscalYearEnd");
  if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
  const existing = await pool.query(
    `SELECT ${YEAR_CLOSE_COLUMNS} FROM fiscal_year_closes
      WHERE company_id = $1 AND fiscal_year_end = $2::date`,
    [companyId, fye]
  );
  const row = existing.rows[0];
  if (!row || row.status !== "closed") throw new DomainError("FISCAL_YEAR_NOT_CLOSED", 404);
  // Unlock first: the reversal is dated on the (locked) fiscal year end and the
  // posting kernel enforces period locks. Restore the lock if posting fails.
  const unlocked = await unlockPeriod(companyId, fye, { userId, reason });
  try {
    if (row.closing_entry_id) {
      const lines = await pool.query(
        `SELECT account_id, ROUND(debit * 100)::bigint AS d, ROUND(credit * 100)::bigint AS c, description
           FROM journal_lines WHERE entry_id = $1`,
        [row.closing_entry_id]
      );
      if (lines.rows.length) {
        // Tagged year_end_close (not a kernel "reversal") so statements keep
        // excluding both sides of the close.
        await closePostingPort.post({
          companyId,
          date: fye,
          memo: `Reversal of year-end close FY ${row.fys} to ${fye}`,
          source: YEAR_END_CLOSE_SOURCE,
          sourceId: row.closing_entry_id,
          idempotencyKey: `year_end_close:${row.closing_entry_id}:reopen`,
          userId,
          lines: lines.rows.map((l) => ({
            accountId: l.account_id,
            debit: aed(Number(l.c)),
            credit: aed(Number(l.d)),
            description: `Reversal - ${l.description ?? ""}`.trim(),
          })),
        });
      }
    }
  } catch (err) {
    if (unlocked) {
      await pool.query(
        `UPDATE month_end_close SET status = 'locked', updated_at = now(),
                unlocked_by = NULL, unlocked_at = NULL, unlock_reason = NULL
          WHERE company_id = $1 AND period_end::date = $2::date AND status = 'open'`,
        [companyId, fye]
      );
    }
    throw err;
  }
  const r = await pool.query(
    `UPDATE fiscal_year_closes
        SET status = 'reopened', reopened_by = $3, reopened_at = now(), reopen_reason = $4,
            closing_entry_id = NULL
      WHERE company_id = $1 AND fiscal_year_end = $2::date
      RETURNING ${YEAR_CLOSE_COLUMNS}`,
    [companyId, fye, userId, reason]
  );
  return formatYearClose(r.rows[0]);
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

function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

function formatCloseRecord(row: QueryResultRow): MonthEndCloseRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    periodEnd: isoOf(row.period_end),
    status: row.status,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closingEntryId: row.closing_entry_id,
    createdAt: row.created_at,
    lockType: row.lock_type === "soft" ? "soft" : "hard",
    lockScope: row.lock_scope === "through" ? "through" : "month",
    lockReason: row.lock_reason ?? null,
    checklistOverride: row.checklist_override === true,
    unlockedBy: row.unlocked_by ?? null,
    unlockedAt: row.unlocked_at ?? null,
    unlockReason: row.unlock_reason ?? null,
  };
}

// ─── Step sign-off and reopen workflow (W4-A, R08-23) ───────────────────────

export const CLOSE_STEP_KEYS = [
  "bank_reconciliation",
  "invoices_posted",
  "receipts_categorized",
  "anomaly_scan",
  "ai_inbox",
  "depreciation",
  "vat_return",
  "accruals",
  "prepayments",
  "fx_revaluation",
] as const;
export type CloseStepKey = (typeof CLOSE_STEP_KEYS)[number];

export interface StepSignOff {
  stepKey: string;
  signedOffBy: string;
  signedOffByEmail: string | null;
  signedOffAt: string;
  note: string | null;
}

export async function listStepSignOffs(
  companyId: string,
  periodEnd: string
): Promise<StepSignOff[]> {
  const r = await pool.query(
    `SELECT s.step_key, s.signed_off_by, u.email, s.signed_off_at, s.note
       FROM month_end_step_signoffs s
       LEFT JOIN users u ON u.id = s.signed_off_by
      WHERE s.company_id = $1 AND s.period_end = $2::date
      ORDER BY s.signed_off_at`,
    [companyId, periodEnd]
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    stepKey: String(row.step_key),
    signedOffBy: String(row.signed_off_by),
    signedOffByEmail: (row.email as string) ?? null,
    signedOffAt: new Date(row.signed_off_at as string).toISOString(),
    note: (row.note as string) ?? null,
  }));
}

/** Checklist with each step's sign-off (user and time) merged in. */
export async function getChecklistWithSignOffs(
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<ChecklistItem[]> {
  const [checklist, signoffs] = await Promise.all([
    getCloseChecklist(companyId, periodStart, periodEnd),
    listStepSignOffs(companyId, periodEnd),
  ]);
  const byKey = new Map(signoffs.map((s) => [s.stepKey, s]));
  return checklist.map((item) => {
    const signOff = item.key ? (byKey.get(item.key) ?? null) : null;
    return {
      ...item,
      signOff,
      effectiveStatus: item.status === "complete" || signOff ? "complete" : "incomplete",
    };
  });
}

export async function signOffStep(
  companyId: string,
  periodEnd: string,
  stepKey: CloseStepKey,
  userId: string,
  note: string | null
): Promise<StepSignOff> {
  const locked = await pool.query(
    `SELECT 1 FROM month_end_close
      WHERE company_id = $1 AND period_end::date = $2::date AND status = 'locked'`,
    [companyId, periodEnd]
  );
  if ((locked.rowCount ?? 0) > 0) {
    throw new DomainError(
      "PERIOD_LOCKED",
      409,
      { periodEnd },
      "The period is locked; reopen it before changing sign-offs"
    );
  }
  await pool.query(
    `INSERT INTO month_end_step_signoffs (company_id, period_end, step_key, signed_off_by, note)
     VALUES ($1, $2::date, $3, $4, $5)
     ON CONFLICT (company_id, period_end, step_key)
     DO UPDATE SET signed_off_by = EXCLUDED.signed_off_by, signed_off_at = now(),
                   note = EXCLUDED.note`,
    [companyId, periodEnd, stepKey, userId, note]
  );
  const all = await listStepSignOffs(companyId, periodEnd);
  return all.find((s) => s.stepKey === stepKey)!;
}

export async function withdrawStepSignOff(
  companyId: string,
  periodEnd: string,
  stepKey: CloseStepKey
): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM month_end_step_signoffs
      WHERE company_id = $1 AND period_end = $2::date AND step_key = $3`,
    [companyId, periodEnd, stepKey]
  );
  return (r.rowCount ?? 0) > 0;
}

export interface ReopenRequest {
  id: string;
  companyId: string;
  periodEnd: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

function formatReopen(row: Record<string, unknown>): ReopenRequest {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    periodEnd: isoOf(row.period_end),
    reason: String(row.reason),
    status: row.status as ReopenRequest["status"],
    requestedBy: String(row.requested_by),
    requestedAt: new Date(row.requested_at as string).toISOString(),
    decidedBy: (row.decided_by as string) ?? null,
    decidedAt: row.decided_at ? new Date(row.decided_at as string).toISOString() : null,
    decisionNote: (row.decision_note as string) ?? null,
  };
}

export async function listReopenRequests(companyId: string): Promise<ReopenRequest[]> {
  const r = await pool.query(
    `SELECT * FROM month_end_reopen_requests WHERE company_id = $1
      ORDER BY requested_at DESC LIMIT 100`,
    [companyId]
  );
  return r.rows.map(formatReopen);
}

export async function getReopenRequest(
  companyId: string,
  id: string
): Promise<ReopenRequest | null> {
  const r = await pool.query(
    `SELECT * FROM month_end_reopen_requests WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  return r.rows[0] ? formatReopen(r.rows[0]) : null;
}

export async function createReopenRequest(
  companyId: string,
  periodEnd: string,
  reason: string,
  userId: string
): Promise<ReopenRequest> {
  const locked = await pool.query(
    `SELECT 1 FROM month_end_close
      WHERE company_id = $1 AND period_end::date = $2::date AND status = 'locked'`,
    [companyId, periodEnd]
  );
  if ((locked.rowCount ?? 0) === 0) {
    throw new DomainError(
      "PERIOD_NOT_LOCKED",
      404,
      undefined,
      "No locked period found for that date"
    );
  }
  try {
    const r = await pool.query(
      `INSERT INTO month_end_reopen_requests (company_id, period_end, reason, requested_by)
       VALUES ($1, $2::date, $3, $4) RETURNING *`,
      [companyId, periodEnd, reason, userId]
    );
    return formatReopen(r.rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new DomainError(
        "REOPEN_REQUEST_PENDING",
        409,
        undefined,
        "A reopen request for this period is already pending"
      );
    }
    throw err;
  }
}

/** Conditional decision: only a pending request can be approved or rejected. */
export async function decideReopenRequest(
  companyId: string,
  id: string,
  decision: "approved" | "rejected",
  userId: string,
  note: string | null
): Promise<ReopenRequest> {
  const r = await pool.query(
    `UPDATE month_end_reopen_requests
        SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5
      WHERE company_id = $1 AND id = $2 AND status = 'pending'
      RETURNING *`,
    [companyId, id, decision, userId, note]
  );
  if (r.rowCount === 0) {
    throw new DomainError("REOPEN_REQUEST_NOT_PENDING", 409, undefined, "Request is not pending");
  }
  return formatReopen(r.rows[0]);
}
