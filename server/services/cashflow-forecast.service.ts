import { storage } from '../storage';
import type { JournalEntry, JournalLine, Account, Invoice, Receipt } from '../../shared/schema';

interface WeeklyProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

interface CashFlowForecastResult {
  currentBalance: number;
  projections: WeeklyProjection[];
  insights: string[];
}

interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

/**
 * Generates a cash flow forecast for a company over a given number of days.
 * Analyzes historical journal entries, outstanding invoices (receivables),
 * and outstanding bills/expenses (payables) to project future cash flows.
 */
export async function generateCashFlowForecast(
  companyId: string,
  days: number = 90
): Promise<CashFlowForecastResult> {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Fetch all necessary data in parallel
  const [accounts, journalEntries, invoices, receipts, bankTransactions] = await Promise.all([
    storage.getAccountsByCompanyId(companyId),
    storage.getJournalEntriesByCompanyId(companyId),
    storage.getInvoicesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
    storage.getBankTransactionsByCompanyId(companyId),
  ]);

  // Build account lookup maps
  const accountMap = new Map<string, Account>();
  const incomeAccountIds = new Set<string>();
  const expenseAccountIds = new Set<string>();
  const assetAccountIds = new Set<string>();

  for (const account of accounts) {
    accountMap.set(account.id, account);
    if (account.type === 'income') incomeAccountIds.add(account.id);
    if (account.type === 'expense') expenseAccountIds.add(account.id);
    if (account.type === 'asset') assetAccountIds.add(account.id);
  }

  // Filter posted journal entries from last 6 months
  const recentEntries = journalEntries.filter(
    (e) => e.status === 'posted' && new Date(e.date) >= sixMonthsAgo
  );

  // Get all journal lines for recent entries
  const allLines: (JournalLine & { entryDate: Date })[] = [];
  for (const entry of recentEntries) {
    const lines = await storage.getJournalLinesByEntryId(entry.id);
    for (const line of lines) {
      allLines.push({ ...line, entryDate: new Date(entry.date) });
    }
  }

  // Calculate historical weekly averages for income and expense.
  // Dividing by a fixed 26 weeks (the lookback window) understates a young
  // company's averages — a one-month-old business with AED 100k of activity
  // would have its weekly average diluted to ~3.8k instead of 25k. Use the
  // span between the earliest in-window transaction and now so the divisor
  // tracks the data we actually have.
  let totalHistoricalInflows = 0;
  let totalHistoricalOutflows = 0;
  let earliestActivity: Date | null = null;

  for (const line of allLines) {
    const account = accountMap.get(line.accountId);
    if (!account) continue;

    if (account.type === 'income') {
      totalHistoricalInflows += (line.credit || 0);
    } else if (account.type === 'expense') {
      totalHistoricalOutflows += (line.debit || 0);
    }

    if (account.type === 'income' || account.type === 'expense') {
      if (!earliestActivity || line.entryDate < earliestActivity) {
        earliestActivity = line.entryDate;
      }
    }
  }

  // Span from first observed inflow/outflow to now, in weeks. Floor at 1
  // week to avoid division by zero / wild extrapolation in the first days
  // of activity. Capped at the lookback window so a long-running but
  // recently-quiet company isn't penalised.
  const spanStart = earliestActivity && earliestActivity > sixMonthsAgo ? earliestActivity : sixMonthsAgo;
  const weeksInHistory = Math.max(1, Math.ceil(
    (now.getTime() - spanStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
  ));

  const avgWeeklyInflow = totalHistoricalInflows / weeksInHistory;
  const avgWeeklyOutflow = totalHistoricalOutflows / weeksInHistory;

  // Calculate current balance from bank transactions and asset accounts
  // Use the net of all bank transactions as a proxy for current cash
  let currentBalance = 0;
  for (const txn of bankTransactions) {
    currentBalance += txn.amount || 0;
  }

  // If no bank transactions, estimate from journal entries on asset (cash/bank) accounts
  if (bankTransactions.length === 0) {
    for (const line of allLines) {
      const account = accountMap.get(line.accountId);
      if (account && account.type === 'asset' && (
        account.code.startsWith('10') || // Cash accounts typically 1000-series
        account.nameEn.toLowerCase().includes('cash') ||
        account.nameEn.toLowerCase().includes('bank')
      )) {
        currentBalance += (line.debit || 0) - (line.credit || 0);
      }
    }
  }

  // Outstanding invoices (receivables) - unpaid invoices
  const outstandingInvoices = invoices.filter(
    (inv) => inv.status === 'sent' || inv.status === 'draft'
  );

  // Outstanding receipts (payables) - unposted receipts
  const outstandingReceipts = receipts.filter(
    (r) => !r.posted && r.amount && r.amount > 0
  );

  // Calculate total receivables and payables
  const totalReceivables = outstandingInvoices.reduce(
    (sum, inv) => sum + (inv.total || 0), 0
  );
  // receipts.amount is the net subtotal (excludes VAT); cash outflow when
  // the receipt is paid is amount + vatAmount.
  const totalPayables = outstandingReceipts.reduce(
    (sum, r) => sum + (r.amount || 0) + (r.vatAmount || 0), 0
  );
  const overdueInvoices = outstandingInvoices.filter(
    (inv) => new Date(inv.date) < now
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + (inv.total || 0), 0
  );

  // Generate weekly projections
  const totalWeeks = Math.ceil(days / 7);
  const projections: WeeklyProjection[] = [];
  let runningBalance = currentBalance;

  // ── Forecast guardrails ──────────────────────────────────────
  // A single anomalous transaction in the lookback window can blow up
  // the weekly average and produce absurd extrapolations. We cap the
  // projected balance so it cannot exceed 3× the larger of currentBalance
  // and total expected inflows over the horizon (i.e. >200% growth gets
  // clamped). The floor is symmetric on the downside so a runaway
  // outflow average can't project a fictitious bottomless drain. When
  // a clamp fires we surface it as an insight so the user knows the
  // raw model output was tempered.
  const horizonInflowBudget = Math.abs(avgWeeklyInflow) * totalWeeks + totalReceivables;
  const horizonOutflowBudget = Math.abs(avgWeeklyOutflow) * totalWeeks + totalPayables;
  const upperBalanceCap = Math.max(
    Math.abs(currentBalance) * 3,
    Math.abs(currentBalance) + horizonInflowBudget,
    10000,
  );
  const lowerBalanceFloor = -Math.max(
    Math.abs(currentBalance) * 3,
    Math.abs(currentBalance) + horizonOutflowBudget,
    10000,
  );
  let clampedAny = false;

  for (let w = 1; w <= totalWeeks; w++) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + (w - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Base inflow from historical average
    let weekInflow = avgWeeklyInflow;
    let weekOutflow = avgWeeklyOutflow;

    // Add expected receivable collections (spread over first few weeks)
    if (w <= 4 && totalReceivables > 0) {
      // Assume receivables collected gradually over first 4 weeks
      weekInflow += totalReceivables / 4;
    }

    // Add expected payable payments (spread over first few weeks)
    if (w <= 3 && totalPayables > 0) {
      // Assume payables paid over first 3 weeks
      weekOutflow += totalPayables / 3;
    }

    runningBalance = runningBalance + weekInflow - weekOutflow;

    if (runningBalance > upperBalanceCap) {
      runningBalance = upperBalanceCap;
      clampedAny = true;
    } else if (runningBalance < lowerBalanceFloor) {
      runningBalance = lowerBalanceFloor;
      clampedAny = true;
    }

    projections.push({
      week: w,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      expectedInflows: Math.round(weekInflow * 100) / 100,
      expectedOutflows: Math.round(weekOutflow * 100) / 100,
      projectedBalance: Math.round(runningBalance * 100) / 100,
    });
  }

  // Generate insights
  const insights: string[] = [];

  // Low balance warning
  const lowBalanceWeek = projections.find((p) => p.projectedBalance < 10000);
  if (lowBalanceWeek) {
    insights.push(
      `Cash may drop below AED 10,000 in week ${lowBalanceWeek.week} (${lowBalanceWeek.weekStart}). Consider collecting receivables sooner.`
    );
  }

  // Negative balance warning
  const negativeWeek = projections.find((p) => p.projectedBalance < 0);
  if (negativeWeek) {
    insights.push(
      `Warning: Projected negative balance of AED ${Math.abs(negativeWeek.projectedBalance).toLocaleString()} in week ${negativeWeek.week}. Immediate action needed.`
    );
  }

  // Overdue receivables insight
  if (overdueAmount > 0) {
    insights.push(
      `You have AED ${overdueAmount.toLocaleString()} in overdue invoices from ${overdueInvoices.length} customer(s). Collecting these would improve cash position.`
    );
  }

  // Outstanding receivables
  if (totalReceivables > 0) {
    insights.push(
      `Expect up to AED ${totalReceivables.toLocaleString()} from ${outstandingInvoices.length} outstanding invoice(s) in the coming weeks.`
    );
  }

  // Outstanding payables
  if (totalPayables > 0) {
    insights.push(
      `AED ${totalPayables.toLocaleString()} in pending expenses (${outstandingReceipts.length} receipt(s)) may need to be settled soon.`
    );
  }

  // Positive trend
  if (projections.length > 0 && projections[projections.length - 1].projectedBalance > currentBalance) {
    insights.push(
      `Positive outlook: Cash position is projected to improve by AED ${(projections[projections.length - 1].projectedBalance - currentBalance).toLocaleString()} over the forecast period.`
    );
  }

  // Low activity warning
  if (avgWeeklyInflow === 0 && avgWeeklyOutflow === 0) {
    insights.push(
      'No recent transaction activity found. Forecast is based on outstanding invoices and receipts only.'
    );
  }

  if (clampedAny) {
    insights.push(
      'Forecast extrapolated beyond a sanity bound and was clamped — recent activity may include an outlier transaction skewing the weekly average.'
    );
  }

  return {
    currentBalance: Math.round(currentBalance * 100) / 100,
    projections,
    insights,
  };
}

/**
 * Get actual monthly cash flow history for the last N months.
 */
export async function getCashFlowHistory(
  companyId: string,
  months: number = 6
): Promise<MonthlyCashHistory[]> {
  const now = new Date();
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);

  const accountMap = new Map<string, Account>();
  for (const account of accounts) {
    accountMap.set(account.id, account);
  }

  // Filter posted entries only
  const postedEntries = journalEntries.filter((e) => e.status === 'posted');

  // Build month buckets
  const history: MonthlyCashHistory[] = [];
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  for (let i = months - 1; i >= 0; i--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59);

    const monthEntries = postedEntries.filter((e) => {
      const d = new Date(e.date);
      return d >= monthStart && d <= monthEnd;
    });

    let totalInflows = 0;
    let totalOutflows = 0;

    for (const entry of monthEntries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accountMap.get(line.accountId);
        if (!account) continue;

        if (account.type === 'income') {
          totalInflows += (line.credit || 0);
        } else if (account.type === 'expense') {
          totalOutflows += (line.debit || 0);
        }
      }
    }

    history.push({
      month: monthNames[targetDate.getMonth()],
      year: targetDate.getFullYear(),
      monthNum: targetDate.getMonth() + 1,
      totalInflows: Math.round(totalInflows * 100) / 100,
      totalOutflows: Math.round(totalOutflows * 100) / 100,
      netCashFlow: Math.round((totalInflows - totalOutflows) * 100) / 100,
    });
  }

  return history;
}
