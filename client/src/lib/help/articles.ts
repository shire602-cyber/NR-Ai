/**
 * The bundled help articles: client/src/help/<locale>/<slug>.md, loaded as raw
 * text at build time. This module is heavy (all article text), so only the
 * help pages import it. Page headers use ./route-map, which is tiny.
 */
import type { Locale } from "../i18n";
import { parseFrontMatter, type ParsedArticle } from "./markdown-lite";

export interface HelpArticleData extends ParsedArticle {
  slug: string;
  locale: Locale;
}

export const HELP_CATEGORIES = ["getting-started", "sales", "purchases", "banking", "accounting", "compliance", "payroll", "reports", "settings", "security", "firm"] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

const modules = import.meta.glob("../../help/*/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const byLocale: Record<Locale, Map<string, HelpArticleData>> = { en: new Map(), ar: new Map() };

for (const [path, source] of Object.entries(modules)) {
  const match = /\/help\/(en|ar)\/([^/]+)\.md$/.exec(path);
  if (!match) continue;
  const locale = match[1] as Locale;
  const slug = match[2];
  byLocale[locale].set(slug, { ...parseFrontMatter(source), slug, locale });
}

/** Reading order inside a category: the order a new customer meets the product. Unknown slugs go last, alphabetically. */
const SLUG_ORDER = [
  "getting-started", "chart-of-accounts", "opening-balances", "import-data",
  "invoices", "recurring-invoices", "quotes", "sales-orders", "customer-advances", "credit-notes", "contacts", "payment-chasing", "invoice-templates", "sales-settings", "projects",
  "bill-pay", "vendor-credits", "purchase-orders", "expense-claims", "receipts",
  "bank-reconciliation", "cashflow-forecast",
  "journal-entries", "approvals", "fixed-assets", "inventory", "cost-centers-budgets", "exchange-rates", "month-end-close",
  "vat-filing", "corporate-tax", "documents-evidence", "compliance-calendar",
  "payroll", "reports", "ai-assistant",
  "company-settings", "team-roles", "subscription", "integrations", "notifications", "backup-history", "data-export-deletion", "mobile-camera",
  "security", "developers-api", "firm-workspace", "admin-panel",
];

const rank = (slug: string) => {
  const i = SLUG_ORDER.indexOf(slug);
  return i === -1 ? SLUG_ORDER.length : i;
};

export function listArticles(locale: Locale): HelpArticleData[] {
  return Array.from(byLocale[locale].values()).sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
}

export function listSlugs(): string[] {
  return Array.from(byLocale.en.keys()).sort();
}

/** The article in the language asked for, falling back to English when the translation is missing. */
export function getArticle(locale: Locale, slug: string): HelpArticleData | undefined {
  return byLocale[locale].get(slug) ?? byLocale.en.get(slug);
}
