/**
 * The 20 customer launch routes crawled by tests/e2e/a11y-crawl.mjs and
 * tests/e2e/arabic-runtime-crawl.mjs.
 */
export const LAUNCH_ROUTES = [
  "/dashboard",
  "/invoices",
  "/receipts",
  "/bank-reconciliation",
  "/vat-filing",
  "/corporate-tax",
  "/reports",
  "/analytics",
  "/payment-chasing",
  "/contacts",
  "/integrations-hub",
  "/document-vault",
  "/subscription",
  "/chart-of-accounts",
  "/journal",
  "/ai",
  "/quotes",
  "/payroll",
  "/inventory",
  "/company-profile",
];

/**
 * The 14 public (signed-out) routes: marketing, pricing, auth, legal and help.
 * Crawled in Arabic by `npm run e2e:arabic-public` (arabic-runtime-crawl.mjs
 * with ARABIC_PUBLIC=true) and screenshotted by the design passes.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/services",
  "/demo",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password?token=synthetic-preview-token",
  "/privacy",
  "/terms",
  "/cookies",
  "/help",
  "/trust",
  "/migration-guides",
];

/**
 * Every authenticated route in client/src/App.tsx that a customer account can open without
 * route params (settings, books, banking, tax, payroll, AI, reports, onboarding). Used by
 * `arabic-runtime-crawl.mjs --all`. tests/unit/launch-routes-all.test.ts keeps these lists in
 * step with App.tsx so a new route cannot ship unvisited.
 */
export const ALL_AUTH_ROUTES = [
  "/dashboard",
  "/onboarding",
  "/company-profile",
  "/firm-relationship",
  "/settings/company",
  "/settings/security",
  "/settings/einvoicing",
  "/settings/zatca",
  "/chart-of-accounts",
  "/invoices",
  "/invoices/new",
  "/recurring-invoices",
  "/payment-chasing",
  "/journal",
  "/reports",
  "/reports/statements-of-account",
  "/receipts",
  "/receipt-autopilot",
  "/contacts",
  "/inventory",
  "/quotes",
  "/credit-notes",
  "/purchase-orders",
  "/cost-centers",
  "/financial-statements",
  "/reconciliation-rules",
  "/invoice-templates",
  "/document-versions",
  "/developer-settings",
  "/notification-preferences",
  "/subscription",
  "/exchange-rates",
  "/company-groups",
  "/consolidation",
  "/payroll",
  "/bill-pay",
  "/vendors",
  "/fixed-assets",
  "/budgets",
  "/expense-claims",
  "/cashflow-forecast",
  "/anomaly-detection",
  "/auto-reconcile",
  "/ai",
  "/ai-inbox",
  "/month-end",
  "/ai-cfo",
  "/ai-features",
  "/smart-assistant",
  "/ai-chat",
  "/advanced-analytics",
  "/integrations",
  "/integrations-hub",
  "/notifications",
  "/reminders",
  "/referrals",
  "/feedback",
  "/analytics",
  "/bank-reconciliation",
  "/bank-accounts",
  "/bank-feeds",
  "/bank-feeds/callback",
  "/evidence-center",
  "/vat-filing",
  "/vat-autopilot",
  "/corporate-tax",
  "/team",
  "/history",
  "/backup-restore",
  "/import",
  "/advanced-reports",
  "/document-vault",
  "/tax-return-archive",
  "/compliance-calendar",
  "/task-center",
  "/news-feed",
];

/** Admin-only routes (need `users.is_admin`); `--all` promotes its synthetic user when it can. */
export const ADMIN_ROUTES = [
  "/admin/dashboard",
  "/admin/clients",
  "/admin/documents",
  "/admin/invitations",
  "/admin/import",
  "/admin/activity-logs",
  "/admin/users",
  "/admin",
];

/** Firm-staff routes (need `users.firm_role`); `--all` promotes its synthetic user when it can. */
export const FIRM_ROUTES = [
  "/firm/command-center",
  "/firm/value-ops",
  "/firm/health",
  "/firm/clients",
  "/firm/practice",
  "/firm/staff",
  "/firm/bulk",
  "/firm/comms",
  "/firm/document-chasing",
  "/firm/email-intake",
  "/firm/analytics",
  "/firm/pipeline",
];

/**
 * Routes with params, resolved against one seeded record by `arabic-runtime-crawl.mjs --all`.
 * Keys are the App.tsx patterns, values the kind of seeded record that fills the param.
 */
export const PARAM_ROUTES = {
  "/accounts/:id/ledger": "account",
  "/journal/:id": "journal",
  // WP-C full-page invoice editor; resolved only when the crawl seeds an invoice id.
  "/invoices/:id/edit": "invoice",
  "/admin/clients/:id": "company",
  "/admin/clients/:id/documents": "company",
  "/admin/clients/:id/tasks": "company",
  "/firm/clients/:companyId": "company",
};

/**
 * App.tsx routes deliberately not visited by --all: public pages (covered by the public
 * crawl), portal-user routes (a different account type) and OAuth/e-mail callbacks.
 */
export const ALL_CRAWL_SKIPPED = [
  "/client-portal/dashboard",
  "/client-portal/invoices",
  "/client-portal/documents",
  "/client-portal/statements",
  "/client-portal/messages",
  "/auth/callback",
  "/verify-email",
  "/view/invoice/:token",
  "/portal/:token",
  "/accounts",
];
