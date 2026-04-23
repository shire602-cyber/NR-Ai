import { storage } from '../storage';
import type { Account } from '../../shared/schema';

type AnomalySeverity = 'critical' | 'warning' | 'info';

interface Anomaly {
  id: string;
  type: string;
  severity: AnomalySeverity;
  description: string;
  amount: number;
  date: string;
  relatedId: string;
  relatedType: 'journal_entry' | 'receipt' | 'invoice';
}

interface AnomalySummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  summary: AnomalySummary;
  scannedAt: string;
}

/**
 * Detects anomalies in a company's recent financial transactions.
 * Checks for: duplicate amounts, unusually large transactions, weekend activity,
 * round number patterns, duplicate vendor billing, and expense spikes.
 */
export async function detectAnomalies(companyId: string): Promise<AnomalyDetectionResult> {
  // Fetch all transaction data in parallel
  const [journalEntries, receipts, invoices, accounts] = await Promise.all([
    storage.getJournalEntriesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
    storage.getInvoicesByCompanyId(companyId),
    storage.getAccountsByCompanyId(companyId),
  ]);

  const accountMap = new Map<string, Account>();
  for (const account of accounts) {
    accountMap.set(account.id, account);
  }

  const anomalies: Anomaly[] = [];
  let anomalyCounter = 0;

  const generateId = () => {
    anomalyCounter++;
    return `anomaly-${Date.now()}-${anomalyCounter}`;
  };

  // ===========================
  // 1. Duplicate amount detection (same amount, same day)
  // ===========================
  const receiptsByDateAmount = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    if (!receipt.amount || !receipt.date) continue;
    const key = `${receipt.date}-${receipt.amount.toFixed(2)}`;
    if (!receiptsByDateAmount.has(key)) {
      receiptsByDateAmount.set(key, []);
    }
    receiptsByDateAmount.get(key)!.push(receipt);
  }

  for (const [key, group] of receiptsByDateAmount) {
    if (group.length > 1) {
      const [dateStr, amountStr] = key.split('-');
      anomalies.push({
        id: generateId(),
        type: 'duplicate_amount',
        severity: 'warning',
        description: `${group.length} receipts with the same amount (AED ${parseFloat(amountStr).toLocaleString()}) on ${dateStr}. Possible duplicate entries from ${group.map(r => r.merchant || 'Unknown').join(', ')}.`,
        amount: parseFloat(amountStr),
        date: dateStr,
        relatedId: group[0].id,
        relatedType: 'receipt',
      });
    }
  }

  // Also check invoices for duplicates
  const invoicesByDateAmount = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    if (!inv.total || !inv.date) continue;
    const dateStr = new Date(inv.date).toISOString().split('T')[0];
    const key = `${dateStr}-${inv.total.toFixed(2)}`;
    if (!invoicesByDateAmount.has(key)) {
      invoicesByDateAmount.set(key, []);
    }
    invoicesByDateAmount.get(key)!.push(inv);
  }

  for (const [key, group] of invoicesByDateAmount) {
    if (group.length > 1) {
      const parts = key.split('-');
      const amountStr = parts[parts.length - 1];
      const dateStr = parts.slice(0, -1).join('-');
      anomalies.push({
        id: generateId(),
        type: 'duplicate_amount',
        severity: 'warning',
        description: `${group.length} invoices with the same total (AED ${parseFloat(amountStr).toLocaleString()}) on ${dateStr}. Customers: ${group.map(i => i.customerName).join(', ')}.`,
        amount: parseFloat(amountStr),
        date: dateStr,
        relatedId: group[0].id,
        relatedType: 'invoice',
      });
    }
  }

  // ===========================
  // 2. Unusually large transactions (>3x average)
  // ===========================
  const receiptAmounts = receipts
    .filter((r) => r.amount && r.amount > 0)
    .map((r) => r.amount!);

  if (receiptAmounts.length >= 3) {
    const avgReceiptAmount = receiptAmounts.reduce((a, b) => a + b, 0) / receiptAmounts.length;
    const threshold = avgReceiptAmount * 3;

    for (const receipt of receipts) {
      if (receipt.amount && receipt.amount > threshold) {
        anomalies.push({
          id: generateId(),
          type: 'unusual_amount',
          severity: 'critical',
          description: `Receipt from ${receipt.merchant || 'Unknown'} for AED ${receipt.amount.toLocaleString()} is ${(receipt.amount / avgReceiptAmount).toFixed(1)}x the average receipt amount (AED ${avgReceiptAmount.toLocaleString()}).`,
          amount: receipt.amount,
          date: receipt.date ? (receipt.date instanceof Date ? receipt.date.toISOString().split('T')[0] : String(receipt.date)) : new Date().toISOString().split('T')[0],
          relatedId: receipt.id,
          relatedType: 'receipt',
        });
      }
    }
  }

  const invoiceAmounts = invoices
    .filter((i) => i.total && i.total > 0)
    .map((i) => i.total);

  if (invoiceAmounts.length >= 3) {
    const avgInvoiceAmount = invoiceAmounts.reduce((a, b) => a + b, 0) / invoiceAmounts.length;
    const threshold = avgInvoiceAmount * 3;

    for (const inv of invoices) {
      if (inv.total > threshold) {
        anomalies.push({
          id: generateId(),
          type: 'unusual_amount',
          severity: 'warning',
          description: `Invoice #${inv.number} for ${inv.customerName} (AED ${inv.total.toLocaleString()}) is ${(inv.total / avgInvoiceAmount).toFixed(1)}x the average invoice amount.`,
          amount: inv.total,
          date: new Date(inv.date).toISOString().split('T')[0],
          relatedId: inv.id,
          relatedType: 'invoice',
        });
      }
    }
  }

  // ===========================
  // 3. Weekend transactions
  // ===========================
  for (const entry of journalEntries) {
    if (entry.status !== 'posted') continue;
    const entryDate = new Date(entry.date);
    const dayOfWeek = entryDate.getDay();

    // Friday and Saturday are typical UAE weekends
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      const dayName = dayOfWeek === 5 ? 'Friday' : 'Saturday';
      // Get total amount from lines
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);

      if (totalDebit > 0) {
        anomalies.push({
          id: generateId(),
          type: 'weekend_transaction',
          severity: 'info',
          description: `Journal entry ${entry.entryNumber} posted on ${dayName} (${entryDate.toISOString().split('T')[0]}) for AED ${totalDebit.toLocaleString()}. UAE businesses typically don't transact on weekends.`,
          amount: totalDebit,
          date: entryDate.toISOString().split('T')[0],
          relatedId: entry.id,
          relatedType: 'journal_entry',
        });
      }
    }
  }

  // ===========================
  // 4. Round number patterns (exact multiples of 1000)
  // ===========================
  for (const receipt of receipts) {
    if (
      receipt.amount &&
      receipt.amount >= 1000 &&
      receipt.amount % 1000 === 0
    ) {
      anomalies.push({
        id: generateId(),
        type: 'round_number',
        severity: 'info',
        description: `Receipt from ${receipt.merchant || 'Unknown'} has a perfectly round amount of AED ${receipt.amount.toLocaleString()}. Round amounts may indicate estimates rather than actual transactions.`,
        amount: receipt.amount,
        date: receipt.date ? (receipt.date instanceof Date ? receipt.date.toISOString().split('T')[0] : String(receipt.date)) : new Date().toISOString().split('T')[0],
        relatedId: receipt.id,
        relatedType: 'receipt',
      });
    }
  }

  // ===========================
  // 5. Same vendor billed twice in a short period
  // ===========================
  const receiptsByVendor = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    if (!receipt.merchant) continue;
    const vendorKey = receipt.merchant.toLowerCase().trim();
    if (!receiptsByVendor.has(vendorKey)) {
      receiptsByVendor.set(vendorKey, []);
    }
    receiptsByVendor.get(vendorKey)!.push(receipt);
  }

  for (const [vendor, vendorReceipts] of receiptsByVendor) {
    if (vendorReceipts.length < 2) continue;

    // Sort by date
    const sorted = vendorReceipts
      .filter((r) => r.date)
      .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!prev.date || !curr.date) continue;

      const daysDiff = Math.abs(
        (new Date(curr.date).getTime() - new Date(prev.date).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      // Same vendor, same amount, within 7 days
      if (
        daysDiff <= 7 &&
        prev.amount &&
        curr.amount &&
        Math.abs(prev.amount - curr.amount) < 0.01
      ) {
        anomalies.push({
          id: generateId(),
          type: 'duplicate_vendor',
          severity: 'warning',
          description: `${curr.merchant} billed AED ${curr.amount!.toLocaleString()} twice within ${Math.ceil(daysDiff)} day(s). This may be a duplicate charge.`,
          amount: curr.amount!,
          date: curr.date ? (curr.date instanceof Date ? curr.date.toISOString().split('T')[0] : String(curr.date)) : new Date().toISOString().split('T')[0],
          relatedId: curr.id,
          relatedType: 'receipt',
        });
      }
    }
  }

  // ===========================
  // 6. Expenses exceeding monthly average by >50%
  // ===========================
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Group receipts by month
  const receiptsByMonth = new Map<string, number>();
  for (const receipt of receipts) {
    if (!receipt.amount || !receipt.date) continue;
    const d = new Date(receipt.date);
    if (d < threeMonthsAgo) continue;
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    receiptsByMonth.set(monthKey, (receiptsByMonth.get(monthKey) || 0) + receipt.amount);
  }

  if (receiptsByMonth.size >= 2) {
    const monthlyTotals = Array.from(receiptsByMonth.values());
    const avgMonthly = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length;
    const spikeThreshold = avgMonthly * 1.5;

    // Check the most recent month
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthTotal = receiptsByMonth.get(currentMonthKey) || 0;

    if (currentMonthTotal > spikeThreshold && avgMonthly > 0) {
      anomalies.push({
        id: generateId(),
        type: 'expense_spike',
        severity: 'warning',
        description: `This month's expenses (AED ${currentMonthTotal.toLocaleString()}) exceed the monthly average (AED ${avgMonthly.toLocaleString()}) by ${(((currentMonthTotal - avgMonthly) / avgMonthly) * 100).toFixed(0)}%. Review recent spending.`,
        amount: currentMonthTotal,
        date: now.toISOString().split('T')[0],
        relatedId: '',
        relatedType: 'receipt',
      });
    }
  }

  // Build summary
  const summary: AnomalySummary = {
    total: anomalies.length,
    critical: anomalies.filter((a) => a.severity === 'critical').length,
    warning: anomalies.filter((a) => a.severity === 'warning').length,
    info: anomalies.filter((a) => a.severity === 'info').length,
  };

  // Sort: critical first, then warning, then info
  const severityOrder: Record<AnomalySeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    anomalies,
    summary,
    scannedAt: new Date().toISOString(),
  };
}
