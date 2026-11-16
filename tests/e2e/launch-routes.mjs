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
