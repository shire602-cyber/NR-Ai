import type { QueryResultRow } from "pg";
import { sql } from "drizzle-orm";
import { journalLine, journalMemo } from "@shared/journal-memo";
import { pool } from "../db";
import { DomainError } from "../errors";
import { postJournal, type LedgerTx } from "../ledger";
import { ledgerQueryable, rowsOf, withLedgerTx } from "../ledger/tx";
import { describeMonthEndText, type CopyDescriptor } from "@shared/server-copy";
import { detectAnomalies } from "./anomaly-detection.service";
import { AI_QUEUE_STILL_OPEN_SQL } from "./ai-gl-queue-sql";
import {
  assertNotInHardClosedYear,
  getEffectiveLock,
  lockPeriodPolicy,
  type LockScope,
  type LockType,
} from "./period-lock.service";
import { controlAccountTies, type ControlTie } from "./control-account-ties.service";
import { computeFxExposure } from "./fx/exposure";
import { pendingOpeningDocuments } from "./migration-import";
import { frequencyOf, periodContaining } from "../tax/vat-periods";
import { isVatRegistered } from "@shared/vat-registration";
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
  runReportReads,
  type Queryable,
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
  /**
   * Stable keys + params for the English `title` / `description` / `details` above
   * (`shared/server-copy.ts`), so the client renders them from its catalogs.
   */
  copy?: {
    title: CopyDescriptor | null;
    description: CopyDescriptor | null;
    details: CopyDescriptor | null;
  };
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
  /** Control-account ties (step 11, A4 M12). */
  ties?: ControlTie[];
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
  /** Keys + params for `memo` and `message` (see `shared/server-copy.ts`). */
  copy?: { memo: CopyDescriptor | null; message: CopyDescriptor | null };
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
  periodEnd: string,
  tx?: LedgerTx
): Promise<ChecklistItem[]> {
  const q = tx ? ledgerQueryable(tx) : pool;
  const checklist: ChecklistItem[] = [];

  // 1. Bank reconciliation complete
  const bankResult = await q.query(
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
    title: "Bank reconciliation complete",
    description: "All bank transactions for the period are reconciled",
    status: bankTotal === 0 || bankUnreconciled === 0 ? "complete" : "incomplete",
    details:
      bankTotal === 0
        ? "No bank transactions in this period"
        : `${bankReconciled}/${bankTotal} reconciled (${bankUnreconciled} remaining)`,
  });

  // 2. All invoices posted (non-draft)
  const invoiceResult = await q.query(
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
    title: "All invoices posted",
    description: "No draft invoices remain for the period",
    status: invTotal === 0 || invDrafts === 0 ? "complete" : "incomplete",
    details:
      invTotal === 0
        ? "No invoices in this period"
        : `${invPosted}/${invTotal} posted (${invDrafts} drafts remaining)`,
  });

  // 3. All receipts categorized
  const receiptResult = await q.query(
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
    title: "All receipts categorized",
    description: "Every receipt has an assigned expense account",
    status: recTotal === 0 || recUncategorized === 0 ? "complete" : "incomplete",
    details:
      recTotal === 0
        ? "No receipts in this period"
        : `${recCategorized}/${recTotal} categorized (${recUncategorized} remaining)`,
  });

  // 4. Anomaly scan clean
  try {
    const anomalyResult = tx
      ? await tx.transaction((savepoint) => detectAnomalies(companyId, ledgerQueryable(savepoint)))
      : await detectAnomalies(companyId);
    const criticalCount = anomalyResult.summary.critical;
    checklist.push({
      id: 4,
      title: "Anomaly scan clean",
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
      title: "Anomaly scan clean",
      description: "No critical anomalies detected in transactions",
      status: "incomplete",
      details: "Unable to run anomaly scan",
    });
  }

  // 5. AI inbox clear (check transaction_classifications pending review)
  // Since ai_gl_queue may not exist, check transaction_classifications with no feedback
  const tableCheck = await q.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'ai_gl_queue'
     ) AS exists`
  );

  if (tableCheck.rows[0].exists) {
    const queueResult = await q.query(
      // X5 (J1 D6): only suggestions still open (bank line not reconciled / excluded) for
      // transactions dated in the period count as pending.
      `SELECT COUNT(*) AS pending
       FROM ai_gl_queue q
       WHERE q.company_id = $1
         AND q.status = 'pending_review'
         AND ${AI_QUEUE_STILL_OPEN_SQL}
         AND COALESCE(q.transaction_date, q.created_at) >= $2::date
         AND COALESCE(q.transaction_date, q.created_at) < ($3::date + 1)`,
      [companyId, periodStart, periodEnd]
    );
    const pendingCount = parseInt(queueResult.rows[0]?.pending || "0");
    checklist.push({
      id: 5,
      title: "Assistant review clear",
      description: "All AI-suggested entries reviewed and processed",
      status: pendingCount === 0 ? "complete" : "incomplete",
      details:
        pendingCount === 0
          ? "All AI suggestions processed"
          : `${pendingCount} items pending review`,
    });
  } else {
    // Fallback: check unreviewed classifications
    const classResult = await q.query(
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
      title: "Assistant review clear",
      description: "All AI-suggested classifications reviewed",
      status: pendingCount === 0 ? "complete" : "incomplete",
      details:
        pendingCount === 0
          ? "All AI suggestions processed"
          : `${pendingCount} classifications pending review`,
    });
  }

  // 6. Depreciation entries posted (if fixed_assets table exists)
  const fixedAssetsCheck = await q.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'fixed_assets'
     ) AS exists`
  );

  if (fixedAssetsCheck.rows[0].exists) {
    // X4 (J3): derived from the depreciation actually posted for the period (one
    // depreciation_schedules row per asset and month, written with its journal entry), not a
    // status flag. An active depreciable asset is done when every month of the period it owned
    // the asset has a schedule row, or when it is fully depreciated.
    const depResult = await q.query(
      `WITH a AS (
         SELECT fa.id, fa.status, fa.net_book_value, fa.salvage_value,
                date_trunc('month', GREATEST(fa.purchase_date::date, $2::date))::date AS from_month,
                date_trunc('month', $3::date)::date AS to_month
           FROM fixed_assets fa
          WHERE fa.company_id = $1
            AND fa.is_depreciable IS DISTINCT FROM false
            AND fa.status IN ('active', 'fully_depreciated')
            AND fa.purchase_date::date <= $3::date
            AND (fa.disposal_date IS NULL OR fa.disposal_date::date > $2::date)
       )
       SELECT COUNT(*) AS total,
              COUNT(*) FILTER (
                WHERE a.status = 'fully_depreciated'
                   OR COALESCE(a.net_book_value, 0) <= COALESCE(a.salvage_value, 0)
                   OR (SELECT COUNT(DISTINCT (ds.period_year, ds.period_month))
                         FROM depreciation_schedules ds
                        WHERE ds.asset_id = a.id
                          AND make_date(ds.period_year, ds.period_month, 1) BETWEEN a.from_month AND a.to_month)
                      >= (EXTRACT(YEAR FROM age(a.to_month, a.from_month)) * 12
                          + EXTRACT(MONTH FROM age(a.to_month, a.from_month)) + 1)
              ) AS posted
         FROM a`,
      [companyId, periodStart, periodEnd]
    );
    const depTotal = parseInt(depResult.rows[0]?.total || "0");
    const depPosted = parseInt(depResult.rows[0]?.posted || "0");
    checklist.push({
      id: 6,
      title: "Depreciation entries posted",
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
      title: "Depreciation entries posted",
      description: "Monthly depreciation has been recorded for all active fixed assets",
      status: "complete",
      details: "Fixed assets module not configured",
    });
  }

  // 7. VAT return prepared. E3 (J3-r3): only a month in which one of the company's VAT periods
  //    ends needs a return (a month inside an open quarter has none to prepare yet), and a
  //    company that is not VAT registered files none. The return counted is the one whose period
  //    ENDS in this month (period_end is stored as the last instant of the day, so compare dates).
  const vatStep = await vatReturnStepScope(companyId, periodEnd, q);
  let vatCount = 0;
  if (vatStep.kind === "due") {
    const vatResult = await q.query(
      `SELECT COUNT(*) AS total
       FROM vat_returns
       WHERE company_id = $1
         AND (period_end::date) BETWEEN $2::date AND $3::date
         AND status != 'draft'`,
      [companyId, periodStart, periodEnd]
    );
    vatCount = parseInt(vatResult.rows[0]?.total || "0");
  }
  checklist.push({
    id: 7,
    title: "VAT return prepared",
    description: "VAT 201 return has been prepared or filed for the period",
    status: vatStep.kind !== "due" || vatCount > 0 ? "complete" : "incomplete",
    details:
      vatStep.kind === "not_registered"
        ? "Not VAT registered: no VAT return to prepare"
        : vatStep.kind === "not_return_month"
          ? `No VAT return due this month: the VAT period ends ${vatStep.periodEnd}`
          : vatCount > 0
            ? `${vatCount} VAT return(s) prepared`
            : "No VAT return prepared for this period",
  });

  // ── W4-A (R08-23): accruals, prepayments, FX revaluation ────────────────
  // 8. Accruals recorded: expense activity in the period should be matched by
  //    accrual entries (auto-reversing journals or Accrued Expenses 2040)
  //    unless the preparer signs the step off as not required.
  const accrualResult = await q.query(
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
    title: "Accruals recorded",
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
  const prepaid = await q.query(
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
    title: "Prepayments amortised",
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

  // 10. FX revaluation: OPEN foreign-currency balances need a revaluation at period end. E1 (J1-r2):
  //     counted from the exposure engine (the FX page's own figure), so settled foreign documents
  //     no longer keep the step open just because their accounts once carried a foreign tag.
  const fx = await q.query(
    `SELECT
       (SELECT COUNT(*) FROM journal_entries je
         WHERE je.company_id = $1 AND je.status = 'posted'
           AND (je.entry_kind = 'revaluation' OR je.source IN ('fx_revaluation', 'revaluation'))
           AND ((je.date + interval '4 hours')::date) BETWEEN $2::date AND $3::date) AS revaluations`,
    [companyId, periodStart, periodEnd]
  );
  const exposure = await computeFxExposure(companyId, periodEnd, {}, tx);
  const fxAccounts = exposure.items.length + exposure.missingRates.length;
  const revaluations = parseInt(fx.rows[0]?.revaluations || "0");
  checklist.push({
    id: 10,
    key: "fx_revaluation",
    title: "FX revaluation run",
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

  // 11. A4 (M12): control accounts tie to their sub-ledgers at period end (AR 1040, AP 2010,
  //     inventory 1070 (B1: NM5), VAT, pension 2032, gratuity 2036, salaries 2030). A difference
  //     keeps the step open.
  const ties = await controlAccountTies(companyId, periodStart, periodEnd, tx);
  const applicable = ties.filter((t) => t.applicable);
  const broken = applicable.filter((t) => !t.reconciled);
  const list = broken
    .map((t) => `${t.accountCode ?? t.key.toUpperCase()} (${t.difference.toFixed(2)})`)
    .join(", ");
  checklist.push({
    id: 11,
    key: "control_accounts",
    title: "Control accounts reconciled",
    description:
      "Receivables, payables, inventory, VAT and payroll control accounts equal their sub-ledgers",
    status: broken.length === 0 ? "complete" : "incomplete",
    details:
      applicable.length === 0
        ? "No control-account activity in this period"
        : broken.length === 0
          ? `${applicable.length} control account(s) tie to their sub-ledgers`
          : `${broken.length} control account(s) differ from their sub-ledger: ${list}`,
    actionHref: "/reports",
    ties,
  });

  // 12. D1 (N14): a documents-mode opening trial balance moved A/R and A/P to Opening Balance
  //     Equity 3040 for the open invoices and bills; until they are imported the receivable /
  //     payable is missing from the balance sheet (and its 3040 offset sits in equity).
  const pending = await pendingOpeningDocuments(companyId, q);
  if (pending && pending.cutOver <= periodEnd) {
    const open = pending.receivablesFils !== 0 || pending.payablesFils !== 0;
    checklist.push({
      id: 12,
      key: "opening_balances",
      title: "Opening balances complete",
      description: "The open invoices and bills behind the opening trial balance are imported",
      status: open ? "incomplete" : "complete",
      details: open
        ? `Opening balances at ${pending.cutOver} still await their documents: receivables ${(pending.receivablesFils / 100).toFixed(2)}, payables ${(pending.payablesFils / 100).toFixed(2)}; until they are imported the difference sits in Opening Balance Equity (3040)`
        : `Open invoices and bills match the opening trial balance at ${pending.cutOver}`,
      actionHref: "/import",
    });
  }

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
  for (const item of checklist) {
    item.copy = {
      title: describeMonthEndText(item.title),
      description: describeMonthEndText(item.description),
      details: describeMonthEndText(item.details),
    };
  }

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

/**
 * R08-01: compute closing lines from posted lines of entries dated INSIDE the
 * period only (the kernel filters date/status in WHERE, never on an outer-join
 * ON clause), excluding earlier closing entries.
 */
export async function computeCloseSummary(
  companyId: string,
  periodStartRaw: unknown,
  periodEndRaw: unknown,
  q: Queryable = pool
): Promise<CloseSummary> {
  const { periodStart, periodEnd } = assertPeriodRange(periodStartRaw, periodEndRaw);
  const [accounts, totals] = await runReportReads(
    q,
    () => loadAccounts(companyId, q),
    () => accountTotals(companyId, { from: periodStart, to: periodEnd }, q)
  );
  const re =
    accounts.find((a) => a.isActive && a.code === "3020") ??
    accounts.find((a) => a.isActive && isRetainedEarningsAccount(a)) ??
    null;
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
    ...journalMemo("computedClose", { from: periodStart, to: periodEnd }),
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
    copy: {
      memo: { key: "monthEnd.closeMemo", params: { start: periodStart, end: periodEnd } },
      message: { key: "monthEnd.closeMessage", params: {} },
    },
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

export async function getCloseSettings(
  companyId: string,
  q: Queryable = pool
): Promise<CloseSettings> {
  const r = await q.query(
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
  opts: LockOptions = {},
  outer?: LedgerTx
): Promise<MonthEndCloseRecord> {
  const end = parseReportDate(periodEnd, "periodEnd");
  if (!end) {
    throw new DomainError("PERIOD_REQUIRED", 400, undefined, "periodEnd is required (YYYY-MM-DD)");
  }
  return withLedgerTx(async (tx) => {
    await lockPeriodPolicy(tx, companyId, "exclusive");
    await assertNotInHardClosedYear(companyId, end, tx, { exactYearEnd: true });
    return writePeriodLock(tx, companyId, end, userId, opts);
  }, outer);
}

/** Used by the fiscal close after it acquires the exclusive lock and writes its fiscal record. */
async function writePeriodLock(
  tx: LedgerTx,
  companyId: string,
  end: string,
  userId: string,
  opts: LockOptions
): Promise<MonthEndCloseRecord> {
  const result = await tx.execute(sql`
     INSERT INTO month_end_close
       (company_id, period_start, period_end, status, closed_by, closed_at, closing_entry_id,
        lock_type, lock_scope, lock_reason, checklist_override, checklist_snapshot)
     VALUES (${companyId}, date_trunc('month', ${end}::date), ${end}::date, 'locked', ${userId},
             now(), ${opts.closingEntryId || null}, ${opts.lockType ?? "hard"},
             ${opts.lockScope ?? "through"}, ${opts.reason ?? null},
             ${opts.checklistOverride === true}, ${JSON.stringify(opts.checklistSnapshot) ?? null}::jsonb)
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
     RETURNING *`);
  return formatCloseRecord(rowsOf<QueryResultRow>(result)[0]);
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
  opts: { userId?: string | null; reason?: string | null } = {},
  outer?: LedgerTx
): Promise<MonthEndCloseRecord | null> {
  const end = parseReportDate(periodEnd, "periodEnd");
  if (!end) throw new DomainError("PERIOD_REQUIRED", 400);
  return withLedgerTx(async (tx) => {
    await lockPeriodPolicy(tx, companyId, "exclusive");
    await assertNotInHardClosedYear(companyId, end, tx, { exactYearEnd: true });
    const result = await tx.execute(sql`
      UPDATE month_end_close
         SET status = 'open', updated_at = now(), unlocked_by = ${opts.userId ?? null},
             unlocked_at = now(), unlock_reason = ${opts.reason ?? null}
       WHERE company_id = ${companyId} AND period_end::date = ${end}::date AND status = 'locked'
       RETURNING *`);
    const [row] = rowsOf<QueryResultRow>(result);
    return row ? formatCloseRecord(row) : null;
  }, outer);
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
  post(
    input: {
      companyId: string;
      date: string;
      memo: string;
      memoKey?: string | null;
      memoParams?: Record<string, string> | null;
      source: string;
      userId: string;
      /** The entry this one undoes (reopen), recorded as source_id. */
      sourceId?: string | null;
      idempotencyKey?: string | null;
      lines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        description: string;
        lineKey?: string | null;
        lineParams?: Record<string, string> | null;
      }>;
    },
    tx: LedgerTx
  ): Promise<{ id: string; entryNumber: string }>;
}

export const ledgerClosePostingPort: ClosePostingPort = {
  async post(input, tx) {
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        memo: input.memo,
        memoKey: input.memoKey ?? null,
        memoParams: input.memoParams ?? null,
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
            ...(l.lineKey ? { lineKey: l.lineKey, lineParams: l.lineParams ?? null } : {}),
          })),
      },
      { actorId: input.userId, audit: true, tx }
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
 * 400 NOT_FISCAL_YEAR_END (with the expected date) unless `fye` is the last day of the
 * company's fiscal year. The route calls it before the checklist (X4/J3), so a wrong date is
 * reported as a wrong date, not as an incomplete checklist for an unrelated month.
 */
export async function assertFiscalYearEnd(companyId: string, fye: string, q: Queryable = pool) {
  const company = await loadCompany(companyId, q);
  const expectedEnd = fiscalYearEndOf(fye, company.fiscalYearStartMonth);
  if (expectedEnd !== fye) {
    throw new DomainError(
      "NOT_FISCAL_YEAR_END",
      400,
      { expectedFiscalYearEnd: expectedEnd },
      "fiscalYearEnd must be the last day of the company's fiscal year"
    );
  }
  return company;
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
  } = {},
  outer?: LedgerTx
): Promise<YearEndCloseResult> {
  const fye = parseReportDate(fiscalYearEndRaw, "fiscalYearEnd");
  if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
  return withLedgerTx(async (tx) => {
    // Existing ledger transactions finish before this read. New postings wait until
    // the fiscal close and the period lock are both visible.
    await lockPeriodPolicy(tx, companyId, "exclusive");
    const q = ledgerQueryable(tx);
    const company = await assertFiscalYearEnd(companyId, fye, q);
    const fys = fiscalYearStartOf(fye, company.fiscalYearStartMonth);
    const existing = await q.query(
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

    const summary = await computeCloseSummary(companyId, fys, fye, q);
    const settings = await getCloseSettings(companyId, q);
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
      const posted = await closePostingPort.post(
        {
          companyId,
          date: fye,
          ...journalMemo("yearEndCloseRange", { from: fys, to: fye }),
          source: YEAR_END_CLOSE_SOURCE,
          userId,
          lines: summary.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            ...journalLine("yearEndCloseLine", { account: l.accountName }),
          })),
        },
        tx
      );
      closingEntryId = posted.id;
      entryNumber = posted.entryNumber;
    }

    const r = await q.query(
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
    const lock = await writePeriodLock(tx, companyId, fye, userId, {
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
  }, outer);
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
  reason: string,
  options: { canReopenHardClose?: boolean } = {}
): Promise<FiscalYearCloseRecord> {
  const fye = parseReportDate(fiscalYearEndRaw, "fiscalYearEnd");
  if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
  return withLedgerTx(async (tx) => {
    await lockPeriodPolicy(tx, companyId, "exclusive");
    const q = ledgerQueryable(tx);
    const existing = await q.query(
      `SELECT ${YEAR_CLOSE_COLUMNS} FROM fiscal_year_closes
      WHERE company_id = $1 AND fiscal_year_end = $2::date`,
      [companyId, fye]
    );
    const row = existing.rows[0];
    if (!row || row.status !== "closed") throw new DomainError("FISCAL_YEAR_NOT_CLOSED", 404);
    if (row.hard_closed === true && !options.canReopenHardClose) {
      await assertNotInHardClosedYear(companyId, fye, tx, { exactYearEnd: true });
    }
    // Mark both records reopened inside the exclusive transaction before the ledger reversal.
    // If the reversal fails, both records are restored by rollback.
    const r = await q.query(
      `UPDATE fiscal_year_closes
        SET status = 'reopened', reopened_by = $3, reopened_at = now(), reopen_reason = $4,
            closing_entry_id = NULL
      WHERE company_id = $1 AND fiscal_year_end = $2::date
      RETURNING ${YEAR_CLOSE_COLUMNS}`,
      [companyId, fye, userId, reason]
    );
    await unlockPeriod(companyId, fye, { userId, reason }, tx);
    if (row.closing_entry_id) {
      const lines = await q.query(
        `SELECT jl.account_id, ROUND(jl.debit * 100)::bigint AS d, ROUND(jl.credit * 100)::bigint AS c,
                jl.description, jl.line_key, jl.line_params
           FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
          WHERE jl.entry_id = $1 AND je.company_id = $2`,
        [row.closing_entry_id, companyId]
      );
      if (lines.rows.length) {
        // Tagged year_end_close (not a kernel "reversal") so statements keep
        // excluding both sides of the close.
        await closePostingPort.post(
          {
            companyId,
            date: fye,
            ...journalMemo("yearEndCloseReversalRange", { from: row.fys, to: fye }),
            source: YEAR_END_CLOSE_SOURCE,
            sourceId: row.closing_entry_id,
            idempotencyKey: `year_end_close:${row.closing_entry_id}:reopen`,
            userId,
            lines: lines.rows.map((l) => ({
              accountId: l.account_id,
              debit: aed(Number(l.c)),
              credit: aed(Number(l.d)),
              ...(l.line_key === "yearEndCloseLine"
                ? journalLine("yearEndCloseReversalLine", l.line_params ?? {})
                : { description: `Reversal - ${l.description ?? ""}`.trim() }),
            })),
          },
          tx
        );
      }
    }
    return formatYearClose(r.rows[0]);
  });
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
  // E3 (J3-r3): the checklist offers Sign off on every step it lists; this one answered 404.
  "control_accounts",
  // INTEGRATE-H: D1's go-live step (id 12, shown while a documents-mode opening TB exists). D1's
  // grni / fixed_assets checks are ties inside control_accounts, not steps of their own.
  "opening_balances",
] as const;
export type CloseStepKey = (typeof CLOSE_STEP_KEYS)[number];

/**
 * E3 (J3-r3): whether the month ending `periodEnd` (YYYY-MM-DD) needs a VAT return: only when the
 * company is VAT registered and one of its VAT periods (frequency + stagger) ends in this month.
 */
export async function vatReturnStepScope(
  companyId: string,
  periodEnd: string,
  q: Queryable = pool
): Promise<
  { kind: "due" } | { kind: "not_registered" } | { kind: "not_return_month"; periodEnd: string }
> {
  const r = await q.query(
    `SELECT tax_registration_type, trn_vat_number, vat_filing_frequency, vat_period_start_month
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (
    row &&
    !isVatRegistered({
      taxRegistrationType: (row.tax_registration_type as string | null) ?? null,
      trnVatNumber: (row.trn_vat_number as string | null) ?? null,
    })
  ) {
    return { kind: "not_registered" };
  }
  const vatPeriod = periodContaining(
    periodEnd,
    frequencyOf((row?.vat_filing_frequency as string | null) ?? null),
    Number(row?.vat_period_start_month) || 1
  );
  return vatPeriod.to === periodEnd
    ? { kind: "due" }
    : { kind: "not_return_month", periodEnd: vatPeriod.to };
}

export interface StepSignOff {
  stepKey: string;
  signedOffBy: string;
  signedOffByEmail: string | null;
  signedOffAt: string;
  note: string | null;
}

export async function listStepSignOffs(
  companyId: string,
  periodEnd: string,
  q: Queryable = pool
): Promise<StepSignOff[]> {
  const r = await q.query(
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
  periodEnd: string,
  tx?: LedgerTx
): Promise<ChecklistItem[]> {
  const readChecklist = () => getCloseChecklist(companyId, periodStart, periodEnd, tx);
  const readSignOffs = () => listStepSignOffs(companyId, periodEnd, tx && ledgerQueryable(tx));
  const [checklist, signoffs] = tx
    ? [await readChecklist(), await readSignOffs()]
    : await Promise.all([readChecklist(), readSignOffs()]);
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
  note: string | null,
  q: Queryable = pool
): Promise<ReopenRequest> {
  const r = await q.query(
    `UPDATE month_end_reopen_requests
        SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5
      WHERE company_id = $1 AND id = $2 AND status = 'pending'
      RETURNING *`,
    [companyId, id, decision, userId, note]
  );
  if (!r.rows[0]) {
    throw new DomainError("REOPEN_REQUEST_NOT_PENDING", 409, undefined, "Request is not pending");
  }
  return formatReopen(r.rows[0]);
}
