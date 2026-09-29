// Pure rules for exchange rates (no DB, no Express) so they are unit-testable.
//
// CONVENTION, everywhere: a stored row means
//   "1 unit of baseCurrency = `rate` units of targetCurrency"
// (1 CHF = 4.1 AED -> base CHF, target AED, rate 4.1), and a lookup
// resolveRate(from, to) returns how many `to` per 1 `from`.
// Invoices use the same reading: `exchangeRate` = AED per 1 foreign unit, which is
// exactly a lookup from the foreign currency to AED.
//
// Scope: companyId null on a row = SYSTEM rate (automated feed only); otherwise
// the rate belongs to that company and is never visible to another one.

export const BASE_CURRENCY = "AED";

// Reject rates that value one foreign unit outside this AED range: clearly a typo.
export const MIN_PLAUSIBLE_AED_PER_UNIT = 0.0001;
export const MAX_PLAUSIBLE_AED_PER_UNIT = 100_000;

export type RateScope = "company" | "system";

export interface RateRow {
  companyId: string | null;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  date: Date;
  source: string;
  isTrusted: boolean;
}

export interface ResolvedRate {
  rate: number; // units of `to` per 1 `from`
  scope: RateScope;
  inverted: boolean; // true when derived as 1 / (a stored to->from rate)
  date: Date;
  source: string;
}

interface ResolveOptions {
  from: string;
  to: string;
  asOf?: Date;
  /** The company asking; null = no company (system rates only). */
  companyId: string | null;
}

function newestUsable(
  rows: RateRow[],
  base: string,
  target: string,
  scope: RateScope,
  opts: ResolveOptions
): RateRow | null {
  let best: RateRow | null = null;
  for (const row of rows) {
    if (!row.isTrusted) continue;
    if (row.baseCurrency !== base || row.targetCurrency !== target) continue;
    if (!Number.isFinite(row.rate) || row.rate <= 0) continue;
    if (opts.asOf && row.date.getTime() > opts.asOf.getTime()) continue;
    const isSystem = row.companyId === null;
    if (scope === "system" ? !isSystem : isSystem || row.companyId !== opts.companyId) continue;
    if (!best || row.date.getTime() > best.date.getTime()) best = row;
  }
  return best;
}

/**
 * Lookup order for a company:
 *   1. its own newest rate for from->to on or before asOf
 *   2. the newest SYSTEM rate for from->to
 *   3. the inverse pair (to->from), own first, then system, returned as 1/rate
 * Untrusted rows and other companies' rows are never used.
 */
export function resolveRate(rows: RateRow[], opts: ResolveOptions): ResolvedRate | null {
  const { from, to } = opts;
  if (from === to) {
    return { rate: 1, scope: "system", inverted: false, date: opts.asOf ?? new Date(), source: "manual" };
  }
  const steps: Array<[string, string, RateScope, boolean]> = [
    [from, to, "company", false],
    [from, to, "system", false],
    [to, from, "company", true],
    [to, from, "system", true],
  ];
  for (const [base, target, scope, inverted] of steps) {
    if (scope === "company" && opts.companyId === null) continue;
    const hit = newestUsable(rows, base, target, scope, opts);
    if (hit) {
      return {
        rate: inverted ? 1 / hit.rate : hit.rate,
        scope,
        inverted,
        date: hit.date,
        source: hit.source,
      };
    }
  }
  return null;
}

// ISO 4217 validation via the runtime's own currency list (Node >= 18).
let knownCurrencies: Set<string> | null = null;
export function isIsoCurrencyCode(code: unknown): code is string {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  if (!knownCurrencies) {
    knownCurrencies = new Set(
      (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("currency")
    );
  }
  return knownCurrencies.has(code);
}

export interface RateInput {
  fromCurrency?: unknown;
  toCurrency?: unknown;
  rate?: unknown;
}

export type RateValidation =
  | { ok: true; value: { baseCurrency: string; targetCurrency: string; rate: number } }
  | { ok: false; message: string };

/**
 * Validate a "1 <from> = <rate> <to>" entry. The result is already in storage
 * form: baseCurrency = from, targetCurrency = to.
 */
export function validateRateInput(input: RateInput): RateValidation {
  const from = typeof input.fromCurrency === "string" ? input.fromCurrency.trim().toUpperCase() : "";
  const to = typeof input.toCurrency === "string" ? input.toCurrency.trim().toUpperCase() : "";
  const rate = input.rate;

  if (!isIsoCurrencyCode(from) || !isIsoCurrencyCode(to)) {
    return { ok: false, message: "fromCurrency and toCurrency must be valid ISO 4217 currency codes" };
  }
  if (from === to) {
    return { ok: false, message: "Currencies must be different" };
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return { ok: false, message: "rate must be a finite number greater than 0" };
  }
  if (from !== BASE_CURRENCY && to !== BASE_CURRENCY) {
    return { ok: false, message: `One side of the pair must be ${BASE_CURRENCY}` };
  }
  // AED value of one unit of the foreign currency, whichever way it was entered.
  const aedPerUnit = from === BASE_CURRENCY ? 1 / rate : rate;
  if (aedPerUnit < MIN_PLAUSIBLE_AED_PER_UNIT || aedPerUnit > MAX_PLAUSIBLE_AED_PER_UNIT) {
    const foreign = from === BASE_CURRENCY ? to : from;
    return {
      ok: false,
      message: `This rate values 1 ${foreign} at ${aedPerUnit} AED, which is outside the plausible range (${MIN_PLAUSIBLE_AED_PER_UNIT} to ${MAX_PLAUSIBLE_AED_PER_UNIT}). Check the direction: enter "1 ${from} = ? ${to}".`,
    };
  }
  return { ok: true, value: { baseCurrency: from, targetCurrency: to, rate } };
}

/** A rate's calendar day, at 00:00 UTC. Rates are effective per day. */
export function normalizeEffectiveDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
