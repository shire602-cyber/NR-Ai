/**
 * Which help article explains which screen. Kept apart from the article text
 * so the page header's help link costs nothing in the main bundle. A unit test
 * checks that every menu destination resolves to a real article in both
 * languages.
 */

const EXACT: Record<string, string> = {
  "/dashboard": "getting-started",
  "/company-profile": "company-settings",
  "/settings/company": "company-settings",
  "/settings/security": "security",
  "/settings/data": "data-export-deletion",
  "/import": "import-data",
  "/accounts": "chart-of-accounts",
  "/chart-of-accounts": "chart-of-accounts",
  "/opening-balances": "opening-balances",
  "/invoices": "invoices",
  "/recurring-invoices": "recurring-invoices",
  "/quotes": "quotes",
  "/sales-orders": "sales-orders",
  "/customer-advances": "customer-advances",
  "/settings/sales": "sales-settings",
  "/credit-notes": "credit-notes",
  "/contacts": "contacts",
  "/payment-chasing": "payment-chasing",
  "/invoice-templates": "invoice-templates",
  "/projects": "projects",
  "/bill-pay": "bill-pay",
  "/vendor-credits": "vendor-credits",
  "/purchase-orders": "purchase-orders",
  "/expense-claims": "expense-claims",
  "/receipts": "receipts",
  "/receipt-autopilot": "receipts",
  "/bank-reconciliation": "bank-reconciliation",
  "/auto-reconcile": "bank-reconciliation",
  "/reconciliation-rules": "bank-reconciliation",
  "/cashflow-forecast": "cashflow-forecast",
  "/journal": "journal-entries",
  "/approvals": "approvals",
  "/fixed-assets": "fixed-assets",
  "/inventory": "inventory",
  "/cost-centers": "cost-centers-budgets",
  "/budgets": "cost-centers-budgets",
  "/exchange-rates": "exchange-rates",
  "/month-end": "month-end-close",
  "/vat-filing": "vat-filing",
  "/vat-autopilot": "vat-filing",
  "/corporate-tax": "corporate-tax",
  "/tax-return-archive": "documents-evidence",
  "/document-vault": "documents-evidence",
  "/document-versions": "documents-evidence",
  "/evidence-center": "documents-evidence",
  "/compliance-calendar": "compliance-calendar",
  "/payroll": "payroll",
  "/reports": "reports",
  "/financial-statements": "reports",
  "/advanced-reports": "reports",
  "/team": "team-roles",
  "/subscription": "subscription",
  "/integrations": "integrations",
  "/integrations-hub": "integrations",
  "/developer-settings": "developers-api",
  "/notification-preferences": "notifications",
  "/notifications": "notifications",
  "/reminders": "notifications",
  "/ai-cfo": "ai-assistant",
  "/ai-features": "ai-assistant",
  "/ai-chat": "ai-assistant",
  "/ai-inbox": "ai-assistant",
  "/smart-assistant": "ai-assistant",
  "/anomaly-detection": "ai-assistant",
  "/backup-restore": "backup-history",
  "/history": "backup-history",
  "/admin": "admin-panel",
};

/** Section prefixes: the first match wins, so list the longer ones first. */
const PREFIXES: Array<[string, string]> = [
  ["/reports/", "reports"],
  ["/journal/", "journal-entries"],
  ["/accounts/", "chart-of-accounts"],
  ["/projects/", "projects"],
  ["/firm/", "firm-workspace"],
  ["/admin/", "admin-panel"],
];

/** The article slug for a pathname (query and hash ignored), or null when no article applies. */
export function helpSlugForPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (EXACT[path]) return EXACT[path];
  for (const [prefix, slug] of PREFIXES) if (path.startsWith(prefix)) return slug;
  return null;
}

/** Every slug the map can return, for tests. */
export function mappedSlugs(): string[] {
  return Array.from(new Set([...Object.values(EXACT), ...PREFIXES.map(([, slug]) => slug)])).sort();
}
