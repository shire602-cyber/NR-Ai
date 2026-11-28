/**
 * The write gates a company's plan applies, as plain data both sides read: the server's central
 * feature policy (server/middleware/featureGate.ts) builds its bookkeeping rules from these lists,
 * and the client's read-only form lock (client/src/lib/plan-routes.ts) derives which pages it
 * locks from the same lists, so the screen never disables a form the server would accept.
 */

/**
 * Core bookkeeping modules every paid plan includes. Listed so that a company whose trial ended
 * without a plan cannot add or change records in them (reads, exports and PDFs stay open).
 * Billing, team, onboarding, automations switches, notification settings, backups and data
 * export are deliberately absent: a planless company can still choose a plan and take its data.
 */
export const CORE_COMPANY_MODULES = [
  "invoices",
  "bills",
  "receipts",
  "journal",
  "journal-templates",
  "accounts",
  "seed-accounts",
  "customer-contacts",
  "vendors",
  "products",
  "quotes",
  "credit-notes",
  "debit-notes",
  "customer-deposits",
  "customer-credits",
  "vendor-prepayments",
  "receivables",
  "reminders",
  "reminder-settings",
  "customer-statements",
  "invoice-templates",
  "recurring-bills",
  "bank-accounts",
  "bank-statements",
  "bank-transactions",
  "bank-connections",
  "bank-reconciliations",
  "auto-reconcile",
  "reconciliation-rules",
  "vat-returns",
  "vat-workpapers",
  "tax-returns-archive",
  "period-lock",
  "inventory",
  "warehouses",
  "stocktakes",
  "fx-revaluations",
  "imports",
  "documents",
  "document-versions",
  "einvoicing",
  "ai-gl",
] as const;

export const CORE_ROW_MODULES = [
  "invoices",
  "bills",
  "receipts",
  "journal",
  "journal-templates",
  "accounts",
  "products",
  "quotes",
  "credit-notes",
  "vat-returns",
  "bank-connections",
  "reconciliation-rules",
  "exchange-rates",
  "documents",
  "tax-returns-archive",
  "reminder-settings",
] as const;

export type CoreGatedModule =
  | (typeof CORE_COMPANY_MODULES)[number]
  | (typeof CORE_ROW_MODULES)[number];

/**
 * App pages that write through a core bookkeeping module, by route prefix. A page that is not
 * listed here (and not a plan-feature page) writes through endpoints the server does not gate
 * (feedback, team, admin and firm consoles, integrations, notification settings ...), so the
 * client leaves its forms alone. tests/unit/step4-plan-states.test.ts pins each module against
 * the server's rule table.
 */
export const CORE_ROUTE_MODULES: ReadonlyArray<readonly [prefix: string, module: CoreGatedModule]> =
  [
    ["/invoices", "invoices"],
    ["/sales", "invoices"],
    ["/bill-pay", "bills"],
    ["/receipts", "receipts"],
    ["/receipt-autopilot", "receipts"],
    ["/journal", "journal"],
    ["/journal-entries", "journal"],
    ["/accounts", "accounts"],
    ["/chart-of-accounts", "accounts"],
    ["/contacts", "customer-contacts"],
    ["/vendors", "vendors"],
    ["/inventory", "inventory"],
    ["/quotes", "quotes"],
    ["/credit-notes", "credit-notes"],
    ["/debit-notes", "debit-notes"],
    ["/invoice-templates", "invoice-templates"],
    ["/document-versions", "document-versions"],
    ["/document-vault", "documents"],
    ["/reconciliation-rules", "reconciliation-rules"],
    ["/exchange-rates", "exchange-rates"],
    ["/banking", "bank-reconciliations"],
    ["/bank-accounts", "bank-accounts"],
    ["/bank-reconciliation", "bank-reconciliations"],
    ["/bank-feeds", "bank-reconciliations"],
    ["/auto-reconcile", "auto-reconcile"],
    ["/vat-filing", "vat-returns"],
    ["/vat-autopilot", "vat-returns"],
    ["/vat-bad-debt-relief", "vat-returns"],
    ["/tax-return-archive", "tax-returns-archive"],
    ["/import", "imports"],
    ["/reminders", "reminders"],
    ["/payment-chasing", "reminders"],
  ];

/** The core bookkeeping module a page writes through, or null. */
export function coreModuleForRoute(path: string): CoreGatedModule | null {
  const p = path.split("?")[0];
  for (const [prefix, module] of CORE_ROUTE_MODULES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return module;
  }
  return null;
}
