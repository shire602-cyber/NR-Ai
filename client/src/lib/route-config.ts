// Routes that ONLY SaaS customers (and admins) can access
export const customerOnlyRoutes = [
  '/chart-of-accounts',
  '/accounts',
  '/invoices',
  '/recurring-invoices',
  '/bill-pay',
  '/journal',
  '/receipts',
  '/expense-claims',
  '/contacts',
  '/inventory',
  '/fixed-assets',
  '/bank-reconciliation',
  '/payroll',
  '/budgets',
  '/ai-cfo',
  '/ai-features',
  '/ai-chat',
  '/cashflow-forecast',
  '/anomaly-detection',
  '/auto-reconcile',
  '/ai-inbox',
  '/month-end',
  '/whatsapp',
  '/integrations',
  '/integrations-hub',
  '/team',
];

// Routes accessible by ALL authenticated users (customer, client, admin)
export const commonRoutes = [
  '/dashboard',
  '/company-profile',
  '/reports',
  '/vat-filing',
  '/corporate-tax',
  '/document-vault',
  '/tax-return-archive',
  '/compliance-calendar',
  '/task-center',
  '/news-feed',
  '/notifications',
  '/reminders',
  '/referrals',
  '/feedback',
  '/analytics',
  '/history',
  '/backup-restore',
  '/advanced-reports',
  '/pricing',
];

// Routes ONLY for admin users
export const adminOnlyRoutes = [
  '/admin',
  '/admin/dashboard',
  '/admin/clients',
  '/admin/documents',
  '/admin/invitations',
  '/admin/import',
  '/admin/users',
  '/admin/activity-logs',
  '/firm',
  '/firm/clients',
  '/firm/staff',
];

// Helper to check if a path requires customer type
export function isCustomerOnlyRoute(path: string): boolean {
  return customerOnlyRoutes.some(r => path === r || path.startsWith(r + '/'));
}

export function isAdminOnlyRoute(path: string): boolean {
  return adminOnlyRoutes.some(r => path === r || path.startsWith(r + '/'));
}
