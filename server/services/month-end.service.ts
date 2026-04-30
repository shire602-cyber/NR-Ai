import { pool } from '../db';
import { storage } from '../storage';
import { detectAnomalies } from './anomaly-detection.service';

// ===========================
// Month-End Close Automation
// Checklist, closing entries, period locking, AI validation.
// ===========================

export interface ChecklistItem {
  id: number;
  title: string;
  description: string;
  status: 'complete' | 'incomplete';
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
 * Ensure the month_end_close table exists.
 */
async function ensureMonthEndTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS month_end_close (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      period_end DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      closed_by UUID,
      closed_at TIMESTAMPTZ,
      closing_entry_id UUID,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(company_id, period_end)
    )
  `);
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
  const bankTotal = parseInt(bankResult.rows[0]?.total || '0');
  const bankReconciled = parseInt(bankResult.rows[0]?.reconciled || '0');
  const bankUnreconciled = bankTotal - bankReconciled;
  checklist.push({
    id: 1,
    title: 'Bank Reconciliation Complete',
    description: 'All bank transactions for the period are reconciled',
    status: bankTotal === 0 || bankUnreconciled === 0 ? 'complete' : 'incomplete',
    details: bankTotal === 0
      ? 'No bank transactions in this period'
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
  const invTotal = parseInt(invoiceResult.rows[0]?.total || '0');
  const invPosted = parseInt(invoiceResult.rows[0]?.posted || '0');
  const invDrafts = invTotal - invPosted;
  checklist.push({
    id: 2,
    title: 'All Invoices Posted',
    description: 'No draft invoices remain for the period',
    status: invTotal === 0 || invDrafts === 0 ? 'complete' : 'incomplete',
    details: invTotal === 0
      ? 'No invoices in this period'
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
  const recTotal = parseInt(receiptResult.rows[0]?.total || '0');
  const recCategorized = parseInt(receiptResult.rows[0]?.categorized || '0');
  const recUncategorized = recTotal - recCategorized;
  checklist.push({
    id: 3,
    title: 'All Receipts Categorized',
    description: 'Every receipt has an assigned expense account',
    status: recTotal === 0 || recUncategorized === 0 ? 'complete' : 'incomplete',
    details: recTotal === 0
      ? 'No receipts in this period'
      : `${recCategorized}/${recTotal} categorized (${recUncategorized} remaining)`,
  });

  // 4. Anomaly scan clean
  try {
    const anomalyResult = await detectAnomalies(companyId);
    const criticalCount = anomalyResult.summary.critical;
    checklist.push({
      id: 4,
      title: 'Anomaly Scan Clean',
      description: 'No critical anomalies detected in transactions',
      status: criticalCount === 0 ? 'complete' : 'incomplete',
      details: criticalCount === 0
        ? `Scan clean (${anomalyResult.summary.total} non-critical items)`
        : `${criticalCount} critical anomalies require attention`,
    });
  } catch {
    checklist.push({
      id: 4,
      title: 'Anomaly Scan Clean',
      description: 'No critical anomalies detected in transactions',
      status: 'incomplete',
      details: 'Unable to run anomaly scan',
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
    const pendingCount = parseInt(queueResult.rows[0]?.pending || '0');
    checklist.push({
      id: 5,
      title: 'AI Inbox Clear',
      description: 'All AI-suggested entries reviewed and processed',
      status: pendingCount === 0 ? 'complete' : 'incomplete',
      details: pendingCount === 0
        ? 'All AI suggestions processed'
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
    const pendingCount = parseInt(classResult.rows[0]?.pending || '0');
    checklist.push({
      id: 5,
      title: 'AI Inbox Clear',
      description: 'All AI-suggested classifications reviewed',
      status: pendingCount === 0 ? 'complete' : 'incomplete',
      details: pendingCount === 0
        ? 'All AI suggestions processed'
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
    const depResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE depreciation_posted = true OR status = 'fully_depreciated') AS posted
       FROM fixed_assets
       WHERE company_id = $1
         AND purchase_date <= $2::date
         AND (disposal_date IS NULL OR disposal_date > $3::date)`,
      [companyId, periodEnd, periodStart]
    );
    const depTotal = parseInt(depResult.rows[0]?.total || '0');
    const depPosted = parseInt(depResult.rows[0]?.posted || '0');
    checklist.push({
      id: 6,
      title: 'Depreciation Entries Posted',
      description: 'Monthly depreciation has been recorded for all active fixed assets',
      status: depTotal === 0 || depPosted >= depTotal ? 'complete' : 'incomplete',
      details: depTotal === 0
        ? 'No active fixed assets'
        : `${depPosted}/${depTotal} assets depreciated for this period`,
    });
  } else {
    checklist.push({
      id: 6,
      title: 'Depreciation Entries Posted',
      description: 'Monthly depreciation has been recorded for all active fixed assets',
      status: 'complete',
      details: 'Fixed assets module not configured',
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
  const vatCount = parseInt(vatResult.rows[0]?.total || '0');
  checklist.push({
    id: 7,
    title: 'VAT Return Prepared',
    description: 'VAT 201 return has been prepared or filed for the period',
    status: vatCount > 0 ? 'complete' : 'incomplete',
    details: vatCount > 0
      ? `${vatCount} VAT return(s) prepared`
      : 'No VAT return prepared for this period',
  });

  return checklist;
}

/**
 * Generate closing journal entries for a period.
 * Debits all revenue accounts, credits all expense accounts,
 * and posts the net difference to retained earnings.
 */
export async function generateClosingEntries(
  companyId: string,
  periodStart: string,
  periodEnd: string,
  userId: string
): Promise<ClosingJournalEntry> {
  // Idempotency check #1: refuse to generate closing entries if the period is
  // already formally locked in month_end_close.
  await ensureMonthEndTable();
  const existingClose = await pool.query(
    `SELECT id, status, closing_entry_id
     FROM month_end_close
     WHERE company_id = $1 AND period_end = $2::date`,
    [companyId, periodEnd]
  );
  const closeRow = existingClose.rows[0];
  if (closeRow && closeRow.status === 'locked') {
    throw new Error(
      `Period ending ${periodEnd} is already closed (closing entry ${closeRow.closing_entry_id || 'unknown'}). ` +
      `Unlock the period before generating new closing entries.`
    );
  }

  // Idempotency check #2: refuse to generate closing entries twice for the
  // same period. Without this, calling twice double-closes revenue/expense
  // and corrupts equity even when month_end_close has not been locked yet.
  const existingClosingResult = await pool.query(
    `SELECT id, entry_number, date, memo, status
     FROM journal_entries
     WHERE company_id = $1
       AND source = 'system'
       AND date = $2::date
       AND memo LIKE 'Closing entries for %'
       AND status != 'void'
     LIMIT 1`,
    [companyId, periodEnd]
  );
  if (existingClosingResult.rows.length > 0) {
    throw new Error(
      `Closing entries already exist for period ending ${periodEnd} (entry ${existingClosingResult.rows[0].entry_number}). ` +
      `Reverse the existing closing entry before re-running.`
    );
  }

  // Get all income accounts with their balances for the period
  const incomeResult = await pool.query(
    `SELECT
       a.id, a.code, a.name_en,
       COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) AS balance
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     LEFT JOIN journal_entries je ON je.id = jl.entry_id
       AND je.company_id = $1
       AND je.status = 'posted'
       AND je.date >= $2::date
       AND je.date <= $3::date
     WHERE a.company_id = $1
       AND a.type = 'income'
       AND a.is_active = true
     GROUP BY a.id, a.code, a.name_en
     HAVING COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) != 0
     ORDER BY a.code`,
    [companyId, periodStart, periodEnd]
  );

  // Get all expense accounts with their balances for the period
  const expenseResult = await pool.query(
    `SELECT
       a.id, a.code, a.name_en,
       COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS balance
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     LEFT JOIN journal_entries je ON je.id = jl.entry_id
       AND je.company_id = $1
       AND je.status = 'posted'
       AND je.date >= $2::date
       AND je.date <= $3::date
     WHERE a.company_id = $1
       AND a.type = 'expense'
       AND a.is_active = true
     GROUP BY a.id, a.code, a.name_en
     HAVING COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) != 0
     ORDER BY a.code`,
    [companyId, periodStart, periodEnd]
  );

  // Find or use retained earnings account
  const retainedResult = await pool.query(
    `SELECT id, code, name_en FROM accounts
     WHERE company_id = $1
       AND type = 'equity'
       AND (LOWER(name_en) LIKE '%retained%' OR code LIKE '3%')
       AND is_active = true
     ORDER BY
       CASE WHEN LOWER(name_en) LIKE '%retained%' THEN 0 ELSE 1 END,
       code
     LIMIT 1`,
    [companyId]
  );

  if (retainedResult.rows.length === 0) {
    throw new Error('No retained earnings equity account found. Please create one before closing the period.');
  }

  const retainedAccount = retainedResult.rows[0];

  // Build the closing entry lines
  const lines: ClosingJournalEntry['lines'] = [];
  let totalDebits = 0;
  let totalCredits = 0;

  // Debit revenue accounts to close them (revenue normally has credit balance)
  for (const row of incomeResult.rows) {
    const balance = parseFloat(row.balance);
    if (balance > 0) {
      lines.push({
        accountId: row.id,
        accountCode: row.code,
        accountName: row.name_en,
        debit: Math.round(balance * 100) / 100,
        credit: 0,
      });
      totalDebits += balance;
    } else if (balance < 0) {
      // Contra-revenue (negative balance)
      lines.push({
        accountId: row.id,
        accountCode: row.code,
        accountName: row.name_en,
        debit: 0,
        credit: Math.round(Math.abs(balance) * 100) / 100,
      });
      totalCredits += Math.abs(balance);
    }
  }

  // Credit expense accounts to close them (expenses normally have debit balance)
  for (const row of expenseResult.rows) {
    const balance = parseFloat(row.balance);
    if (balance > 0) {
      lines.push({
        accountId: row.id,
        accountCode: row.code,
        accountName: row.name_en,
        debit: 0,
        credit: Math.round(balance * 100) / 100,
      });
      totalCredits += balance;
    } else if (balance < 0) {
      // Contra-expense (negative balance)
      lines.push({
        accountId: row.id,
        accountCode: row.code,
        accountName: row.name_en,
        debit: Math.round(Math.abs(balance) * 100) / 100,
        credit: 0,
      });
      totalDebits += Math.abs(balance);
    }
  }

  // Net difference goes to retained earnings
  const netIncome = totalDebits - totalCredits;
  if (Math.abs(netIncome) > 0.005) {
    if (netIncome > 0) {
      // Net income: credit retained earnings
      lines.push({
        accountId: retainedAccount.id,
        accountCode: retainedAccount.code,
        accountName: retainedAccount.name_en,
        debit: 0,
        credit: Math.round(netIncome * 100) / 100,
      });
      totalCredits += netIncome;
    } else {
      // Net loss: debit retained earnings
      lines.push({
        accountId: retainedAccount.id,
        accountCode: retainedAccount.code,
        accountName: retainedAccount.name_en,
        debit: Math.round(Math.abs(netIncome) * 100) / 100,
        credit: 0,
      });
      totalDebits += Math.abs(netIncome);
    }
  }

  if (lines.length === 0) {
    throw new Error('No revenue or expense balances found for this period. Nothing to close.');
  }

  // Format period for memo
  const periodLabel = `${periodStart} to ${periodEnd}`;
  const memo = `Closing entries for ${periodLabel}`;
  const periodEndDate = new Date(periodEnd);
  const entryNumber = await storage.generateEntryNumber(companyId, periodEndDate);

  // Create entry + lines atomically via storage (validates balance & wraps in transaction)
  const journalLines = lines.map((line) => ({
    accountId: line.accountId,
    debit: Math.round(line.debit * 100) / 100,
    credit: Math.round(line.credit * 100) / 100,
    description: `Closing entry - ${line.accountName}`,
  }));

  const entry = await storage.createJournalEntry(
    {
      companyId,
      entryNumber,
      date: periodEndDate,
      memo,
      status: 'posted',
      source: 'system',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    } as any,
    journalLines
  );

  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date instanceof Date ? entry.date.toISOString() : String(entry.date),
    memo: entry.memo ?? memo,
    lines,
    totalDebits: Math.round(totalDebits * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
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

  const result = await pool.query(
    `INSERT INTO month_end_close (company_id, period_end, status, closed_by, closed_at, closing_entry_id)
     VALUES ($1, $2::date, 'locked', $3, now(), $4)
     ON CONFLICT (company_id, period_end)
     DO UPDATE SET
       status = 'locked',
       closed_by = EXCLUDED.closed_by,
       closed_at = now(),
       closing_entry_id = COALESCE(EXCLUDED.closing_entry_id, month_end_close.closing_entry_id),
       updated_at = now()
     RETURNING *`,
    [companyId, periodEnd, userId, closingEntryId || null]
  );

  return formatCloseRecord(result.rows[0]);
}

/**
 * Check if a given date falls within a locked period.
 *
 * A month_end_close row locks ONLY the month it represents (the calendar month
 * ending at period_end). Locking February must not retroactively close January.
 */
export async function isPeriodLocked(
  companyId: string,
  date: string
): Promise<boolean> {
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
export async function listLockedPeriods(
  companyId: string
): Promise<MonthEndCloseRecord[]> {
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
export async function getCloseHistory(
  companyId: string
): Promise<MonthEndCloseRecord[]> {
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

  const incompleteItems = checklist.filter((item) => item.status === 'incomplete');
  const completeCount = checklist.filter((item) => item.status === 'complete').length;
  const totalCount = checklist.length;

  let summary: string;
  let ready: boolean;

  if (incompleteItems.length === 0) {
    ready = true;
    summary = `Ready to close. All ${totalCount} checks passed. You can proceed with generating closing entries and locking the period.`;
  } else {
    ready = false;
    const issues = incompleteItems.map((item) => {
      const detail = item.details ? ` (${item.details})` : '';
      return `${item.title}${detail}`;
    });
    summary = `Not ready to close: ${completeCount}/${totalCount} checks passed. Outstanding issues:\n` +
      issues.map((issue) => `- ${issue}`).join('\n');
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
