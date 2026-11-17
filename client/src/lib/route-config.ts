// Routes that ONLY SaaS customers (and admins) can access
export const customerOnlyRoutes = [
  "/chart-of-accounts",
  "/accounts",
  "/invoices",
  "/recurring-invoices",
  "/bill-pay",
  "/journal",
  "/receipts",
  "/expense-claims",
  "/contacts",
  "/inventory",
  "/fixed-assets",
  "/bank-reconciliation",
  "/bank-accounts",
  "/bank-feeds",
  "/payroll",
  "/budgets",
  "/ai",
  "/ai-cfo",
  "/ai-features",
  "/smart-assistant",
  "/ai-chat",
  "/cashflow-forecast",
  "/anomaly-detection",
  "/auto-reconcile",
  "/ai-inbox",
  "/month-end",
  "/integrations",
  "/integrations-hub",
  "/team",
];

// Routes accessible by ALL authenticated users (customer, client, admin)
export const commonRoutes = [
  "/dashboard",
  "/company-profile",
  "/reports",
  "/vat-filing",
  "/corporate-tax",
  "/document-vault",
  "/tax-return-archive",
  "/compliance-calendar",
  "/task-center",
  "/news-feed",
  "/notifications",
  "/reminders",
  "/feedback",
  "/analytics",
  "/history",
  "/backup-restore",
  "/advanced-reports",
  "/advanced-analytics",
  "/pricing",
];

// Routes ONLY for admin users
export const adminOnlyRoutes = [
  "/admin",
  "/admin/dashboard",
  "/admin/clients",
  "/admin/documents",
  "/admin/invitations",
  "/admin/import",
  "/admin/users",
  "/admin/activity-logs",
];

// Every /firm/* page is NR-internal. The prefix match in isFirmOnlyRoute covers
// current and future firm routes, so this list cannot drift from App.tsx.
export const firmOnlyRoutes = ["/firm"];

// Helper to check if a path requires customer type
export function isCustomerOnlyRoute(path: string): boolean {
  return customerOnlyRoutes.some((r) => path === r || path.startsWith(r + "/"));
}

export function isAdminOnlyRoute(path: string): boolean {
  return adminOnlyRoutes.some((r) => path === r || path.startsWith(r + "/"));
}

export function isFirmOnlyRoute(path: string): boolean {
  return firmOnlyRoutes.some((r) => path === r || path.startsWith(r + "/"));
}

/**
 * Destination for a consolidated/legacy route redirect. The legacy URL's query
 * string is carried over so deep links (`/advanced-reports?tab=comparison`)
 * keep their state; destination parameters take precedence over stale ones.
 */
export function mergeLegacySearch(to: string, legacySearch: string): string {
  const [path, destQuery = ""] = to.split("?");
  const params = new URLSearchParams(legacySearch);
  new URLSearchParams(destQuery).forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
