import type { DashboardModel } from "./useCustomerDashboardModel";

/**
 * A company with nothing recorded yet: no posted figures, no invoices and no journal entries.
 * Decided only after the data has loaded, so a slow request never flashes the empty page.
 */
export function isEmptyCompany(m: DashboardModel): boolean {
  const { stats, statsLoading, recentInvoices, invoicesLoading, journalEntries } = m;
  if (statsLoading || invoicesLoading || !stats || !recentInvoices || !journalEntries) return false;
  return (
    recentInvoices.length === 0 &&
    journalEntries.length === 0 &&
    stats.revenue === 0 &&
    stats.expenses === 0 &&
    stats.cashPosition === 0 &&
    stats.outstanding === 0 &&
    stats.outstandingPayables === 0
  );
}
