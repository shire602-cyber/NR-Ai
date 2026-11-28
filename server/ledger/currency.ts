/**
 * Functional (base) currency helpers (W5-C, R14-19).
 *
 * A company's `base_currency` is its functional currency: journal debits and
 * credits are always in it, a document whose currency equals it needs no
 * conversion, and every rate is "base units per 1 foreign unit" (see
 * server/services/fx/README.md). Nothing in the posting services, invoice
 * routes, FX services or reporting compares against a literal currency code;
 * they ask these helpers instead.
 *
 * DEFAULT_BASE_CURRENCY is only the fallback for a missing/blank column (the
 * column is NOT NULL DEFAULT 'AED'); it is never a business rule.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { companies } from "../../shared/schema";
import { DomainError } from "../errors";
import type { LedgerTx } from "./types";

/** Fallback for a company row with no base currency (schema default). */
export const DEFAULT_BASE_CURRENCY = "AED";

/** VAT returns are always filed in AED with the FTA, whatever the functional currency. */
export const VAT_FILING_CURRENCY = "AED";

/** The company's functional currency, upper-cased. */
export function baseCurrencyOf(
  company: { baseCurrency?: string | null } | null | undefined
): string {
  const raw = company?.baseCurrency;
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return s || DEFAULT_BASE_CURRENCY;
}

/** Document currency (blank = the company's base currency), upper-cased. */
export function documentCurrency(currency: string | null | undefined, base: string): string {
  const s = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  return s || base;
}

/** True when a document in `currency` must be converted into `base`. */
export function isForeignCurrency(currency: string | null | undefined, base: string): boolean {
  return documentCurrency(currency, base) !== base;
}

/** Load a company's base currency (optionally inside a transaction). 404 when missing. */
export async function loadBaseCurrency(companyId: string, q: LedgerTx = db): Promise<string> {
  const rows = await q
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!rows[0]) throw new DomainError("COMPANY_NOT_FOUND", 404, { companyId });
  return baseCurrencyOf(rows[0]);
}
