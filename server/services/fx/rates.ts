/**
 * FX rates — the single rate convention and tenant-scoped lookup (W2-E).
 *
 * Convention (R14-02): an exchange_rates row (base_currency = X, target_currency = Y, rate = r)
 * means "1 X = r Y". A company rate is stored canonically as (foreign, company base), so
 * AED per USD is (USD, AED, 3.6725). Inverse pairs are derived here; nothing else should
 * divide or invert a stored rate.
 *
 * Tenancy (R14-01): a lookup for a company reads that company's rows first, then system rows
 * (company_id IS NULL). Rows flagged legacy_unscoped by migration 0094 are never read.
 */
import Decimal from "decimal.js";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { companies, exchangeRates } from "../../../shared/schema";
import type { ExchangeRate, ExchangeRateType } from "../../../shared/schema";
import { EXCHANGE_RATE_TYPES } from "../../../shared/schema";
import { ISO_4217_CODES, parseIsoDate } from "../../../shared/validators/primitives";
import { mulRate, RATE_DECIMALS } from "../../../shared/money";
import { DomainError } from "../../errors";
import type { LedgerTx } from "../../ledger/types";
import { VAT_FILING_CURRENCY, baseCurrencyOf } from "../../ledger/currency";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const ISO = new Set<string>(ISO_4217_CODES);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default proximity: a rate older than this many days is returned with stale=true. */
export const DEFAULT_MAX_RATE_AGE_DAYS = 7;
/** Sanity band: a new rate moving more than this vs the previous one needs confirmation. */
export const RATE_SANITY_BAND = 0.2;
/** numeric(15,6) upper bound. */
const MAX_RATE = new D("999999999.999999");

export type RateScope = "company" | "system" | "identity";

export interface RateResult {
  /** Units of `to` per 1 unit of `from`, rounded half-up to 6 dp. */
  rate: number;
  /** Same value as an exact 6 dp string. */
  rateText: string;
  source: string;
  /** Effective date of the stored row (YYYY-MM-DD). */
  date: string;
  stale: boolean;
  ageDays: number;
  warning?: string;
  scope: RateScope;
  /** True when the stored row was (to, from) and the rate was derived as 1 / stored. */
  inverse: boolean;
  rateType: ExchangeRateType;
  rateId: string | null;
  /** The stored row's rate (before any inversion). */
  storedRate: string;
}

export interface GetRateOptions {
  rateType?: ExchangeRateType;
  /** Proximity window in days (default 7). */
  maxAgeDays?: number;
  /** Use the AED/USD peg when no row exists for that pair (default true; the sanity band opts out). */
  pegDefault?: boolean;
  /** When a closing/average rate is missing, fall back to spot (default true). */
  fallbackToSpot?: boolean;
}

// ─── Validation helpers (R14-12) ──────────────────────────────────────────

export function normalizeCurrency(code: unknown, field = "currency"): string {
  const s = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!ISO.has(s)) {
    throw new DomainError(
      "INVALID_CURRENCY",
      400,
      { field, value: typeof code === "string" ? code : null },
      `${field} must be an ISO 4217 currency code`
    );
  }
  return s;
}

export function isRateType(v: unknown): v is ExchangeRateType {
  return typeof v === "string" && (EXCHANGE_RATE_TYPES as readonly string[]).includes(v);
}

/** Parse a rate to an exact 6 dp decimal; rejects <= 0, non-finite and out-of-range values. */
export function parseRate(input: unknown, field = "rate"): Decimal {
  let d: Decimal;
  try {
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("not finite");
      d = new D(input.toString());
    } else if (typeof input === "string" && /^\s*\d+(\.\d+)?\s*$/.test(input)) {
      d = new D(input.trim());
    } else {
      throw new Error("not a number");
    }
  } catch {
    throw new DomainError("INVALID_RATE", 400, { field }, `${field} must be a positive number`);
  }
  d = d.toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP);
  if (d.lte(0)) {
    throw new DomainError("INVALID_RATE", 400, { field }, `${field} must be greater than zero`);
  }
  if (d.gt(MAX_RATE)) {
    throw new DomainError("INVALID_RATE", 400, { field }, `${field} is too large`);
  }
  return d;
}

/** Canonical "YYYY-MM-DD" from a Date or date string; throws INVALID_DATE. */
export function toIsoDate(value: Date | string | undefined | null, field = "date"): string {
  if (value === undefined || value === null || value === "") {
    return new Date().toISOString().slice(0, 10);
  }
  const iso = parseIsoDate(value);
  if (!iso) {
    throw new DomainError("INVALID_DATE", 400, { field }, `${field} must be a valid date`);
  }
  return iso;
}

export const isoToDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const addDaysIso = (iso: string, days: number): string =>
  new Date(isoToDate(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);

export function invertRate(rate: Decimal.Value): Decimal {
  return new D(1).dividedBy(new D(rate)).toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP);
}

// ─── Lookup ───────────────────────────────────────────────────────────────

export async function getCompanyBaseCurrency(
  companyId: string,
  tx: LedgerTx = db
): Promise<string> {
  const [row] = await tx
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!row) throw new DomainError("COMPANY_NOT_FOUND", 404);
  return baseCurrencyOf(row);
}

const rowIso = (row: ExchangeRate): string =>
  (row.date instanceof Date ? row.date : new Date(row.date)).toISOString().slice(0, 10);

/**
 * Pick the best row for a pair (either orientation) as of `asOfIso`.
 * companyId null = system rows only.
 */
async function findRow(
  companyId: string | null,
  from: string,
  to: string,
  asOfIso: string,
  rateType: ExchangeRateType,
  tx: LedgerTx
): Promise<ExchangeRate | null> {
  const end = isoToDate(addDaysIso(asOfIso, 1));
  const scope = companyId
    ? or(eq(exchangeRates.companyId, companyId), isNull(exchangeRates.companyId))
    : isNull(exchangeRates.companyId);
  const rows = await tx
    .select()
    .from(exchangeRates)
    .where(
      and(
        scope,
        eq(exchangeRates.legacyUnscoped, false),
        eq(exchangeRates.rateType, rateType),
        lt(exchangeRates.date, end),
        or(
          and(eq(exchangeRates.baseCurrency, from), eq(exchangeRates.targetCurrency, to)),
          and(eq(exchangeRates.baseCurrency, to), eq(exchangeRates.targetCurrency, from))
        )
      )
    )
    // Company rows before system rows; then newest; FTA wins a same-day tie;
    // then the direct orientation; then the most recently entered.
    .orderBy(
      sql`(${exchangeRates.companyId} IS NULL) ASC`,
      desc(exchangeRates.date),
      sql`(${exchangeRates.source} = 'fta') DESC`,
      sql`(${exchangeRates.baseCurrency} = ${from}) DESC`,
      desc(exchangeRates.createdAt)
    )
    .limit(1);
  return rows[0] ?? null;
}

function buildResult(
  row: ExchangeRate,
  from: string,
  asOfIso: string,
  maxAgeDays: number,
  extraWarning?: string
): RateResult {
  const stored = new D(String(row.rate)).toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP);
  const inverse = row.baseCurrency !== from;
  const value = inverse ? invertRate(stored) : stored;
  const date = rowIso(row);
  const ageDays = Math.max(
    0,
    Math.floor((isoToDate(asOfIso).getTime() - isoToDate(date).getTime()) / DAY_MS)
  );
  const stale = ageDays > maxAgeDays;
  const warnings: string[] = [];
  if (extraWarning) warnings.push(extraWarning);
  if (stale) {
    warnings.push(
      `Rate ${row.baseCurrency}/${row.targetCurrency} is ${ageDays} days old (dated ${date}); ` +
        `the proximity limit is ${maxAgeDays} days.`
    );
  }
  return {
    rate: value.toNumber(),
    rateText: value.toFixed(RATE_DECIMALS),
    source: row.source,
    date,
    stale,
    ageDays,
    warning: warnings.length ? warnings.join(" ") : undefined,
    scope: row.companyId ? "company" : "system",
    inverse,
    rateType: (isRateType(row.rateType) ? row.rateType : "spot") as ExchangeRateType,
    rateId: row.id,
    storedRate: stored.toFixed(RATE_DECIMALS),
  };
}

/** The UAE dirham is pegged to the US dollar: 1 USD = 3.6725 AED (Central Bank of the UAE). */
export const AED_USD_PEG = "3.6725";
export const PEG_SOURCE = "peg";

export function isPeggedPair(from: string, to: string): boolean {
  return (from === "USD" && to === "AED") || (from === "AED" && to === "USD");
}

/** The fixed AED/USD peg as a RateResult (stored orientation (USD, AED, 3.6725)). */
function pegResult(from: string, asOfIso: string, rateType: ExchangeRateType): RateResult {
  const stored = new D(AED_USD_PEG).toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP);
  const inverse = from !== "USD";
  const value = inverse ? invertRate(stored) : stored;
  return {
    rate: value.toNumber(),
    rateText: value.toFixed(RATE_DECIMALS),
    source: PEG_SOURCE,
    date: asOfIso,
    stale: false,
    ageDays: 0,
    scope: "system",
    inverse,
    rateType,
    rateId: null,
    storedRate: stored.toFixed(RATE_DECIMALS),
  };
}

async function lookup(
  companyId: string | null,
  fromRaw: string,
  toRaw: string,
  dateInput: Date | string | undefined,
  opts: GetRateOptions,
  tx: LedgerTx = db
): Promise<RateResult> {
  const from = normalizeCurrency(fromRaw, "from");
  const to = normalizeCurrency(toRaw, "to");
  const asOfIso = toIsoDate(dateInput ?? undefined, "date");
  const rateType = opts.rateType ?? "spot";
  if (!isRateType(rateType)) {
    throw new DomainError("INVALID_RATE_TYPE", 400, { rateType });
  }
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_RATE_AGE_DAYS;

  if (from === to) {
    return {
      rate: 1,
      rateText: (1).toFixed(RATE_DECIMALS),
      source: "identity",
      date: asOfIso,
      stale: false,
      ageDays: 0,
      scope: "identity",
      inverse: false,
      rateType,
      rateId: null,
      storedRate: (1).toFixed(RATE_DECIMALS),
    };
  }

  const row = await findRow(companyId, from, to, asOfIso, rateType, tx);
  if (row) return buildResult(row, from, asOfIso, maxAgeDays);

  if (rateType !== "spot" && opts.fallbackToSpot !== false) {
    const spot = await findRow(companyId, from, to, asOfIso, "spot", tx);
    if (spot) {
      return buildResult(
        spot,
        from,
        asOfIso,
        maxAgeDays,
        `No ${rateType} rate for ${from}/${to}; the spot rate was used.`
      );
    }
  }

  // E1: the dirham is pegged to the US dollar (CBUAE, 3.6725). When no row exists for that pair
  // the peg itself is the rate, so a new tenant can book a USD bill without first typing the
  // number the platform already knows. Any company or system row above still wins.
  if (opts.pegDefault !== false && isPeggedPair(from, to))
    return pegResult(from, asOfIso, rateType);

  throw new DomainError(
    "NO_EXCHANGE_RATE",
    422,
    { from, to, date: asOfIso, rateType },
    `No ${from}→${to} exchange rate on or before ${asOfIso}`
  );
}

/**
 * Tenant-scoped rate lookup: company rows first, then system rows.
 * Same currency → 1. Inverse pairs derived. Older than maxAgeDays → stale=true + warning.
 * No rate → DomainError 422 NO_EXCHANGE_RATE.
 */
export function getRate(
  companyId: string,
  from: string,
  to: string,
  date?: Date | string,
  opts: GetRateOptions = {},
  tx?: LedgerTx
): Promise<RateResult> {
  if (!companyId) throw new DomainError("COMPANY_REQUIRED", 400);
  return lookup(companyId, from, to, date, opts, tx);
}

/** System rows only (company_id IS NULL). For callers that have no company context. */
export function getSystemRate(
  from: string,
  to: string,
  date?: Date | string,
  opts: GetRateOptions = {}
): Promise<RateResult> {
  // System rows only means exactly that: the peg default is a company-scoped convenience.
  return lookup(null, from, to, date, { pegDefault: false, ...opts });
}

export interface ConvertResult extends RateResult {
  amountFils: number;
  convertedFils: number;
}

/** Convert integer fils of `from` into integer fils of `to` (half-up). */
export async function convert(
  companyId: string,
  amountFils: number,
  from: string,
  to: string,
  date?: Date | string,
  opts: GetRateOptions = {},
  tx?: LedgerTx
): Promise<ConvertResult> {
  if (!Number.isSafeInteger(amountFils)) {
    throw new DomainError("INVALID_AMOUNT", 400, { amountFils });
  }
  const r = await getRate(companyId, from, to, date, opts, tx);
  // Divide by the stored rate for inverse pairs instead of multiplying by a
  // rounded reciprocal, so AED→USD with (USD, AED, 3.6725) stays exact.
  const convertedFils = r.inverse
    ? new D(amountFils).dividedBy(new D(r.storedRate)).toDecimalPlaces(0).toNumber()
    : mulRate(amountFils, r.rateText);
  return { ...r, amountFils, convertedFils: Object.is(convertedFils, -0) ? 0 : convertedFils };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface RateWriteInput {
  fromCurrency: string;
  toCurrency: string;
  rate: number | string;
  effectiveDate?: string;
  rateType?: ExchangeRateType;
  /** cbuae / ecb: written only by the rate feed (W5-C, R14-14). */
  source?: RateSource;
  /** Confirm a move larger than the sanity band versus the previous rate. */
  confirmLargeMove?: boolean;
}

interface CanonicalRow {
  baseCurrency: string;
  targetCurrency: string;
  rate: Decimal;
}

/**
 * Canonical storage for a company rate: (foreign, company base) with "base per 1 foreign".
 * A rate entered as base→foreign is inverted once here. Cross rates are stored as entered.
 */
export function canonicalizeCompanyRate(
  from: string,
  to: string,
  rate: Decimal,
  companyBase: string
): CanonicalRow {
  if (to === companyBase) return { baseCurrency: from, targetCurrency: to, rate };
  if (from === companyBase) {
    return { baseCurrency: to, targetCurrency: from, rate: invertRate(rate) };
  }
  return { baseCurrency: from, targetCurrency: to, rate };
}

export const RATE_SOURCES = ["manual", "api", "fta", "cbuae", "ecb"] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

export interface ValidatedRate {
  row: CanonicalRow;
  date: string;
  rateType: ExchangeRateType;
  source: RateSource;
}

/** Shared write validation: ISO codes, base != target, rate > 0, date valid and not future. */
export function validateRateInput(
  input: RateWriteInput,
  companyBase: string | null
): ValidatedRate {
  const from = normalizeCurrency(input.fromCurrency, "fromCurrency");
  const to = normalizeCurrency(input.toCurrency, "toCurrency");
  if (from === to) {
    throw new DomainError(
      "SAME_CURRENCY",
      400,
      { fromCurrency: from, toCurrency: to },
      "Base and target currencies must differ"
    );
  }
  const rate = parseRate(input.rate);
  const date = toIsoDate(input.effectiveDate, "effectiveDate");
  if (date > new Date().toISOString().slice(0, 10)) {
    throw new DomainError(
      "FUTURE_RATE_DATE",
      400,
      { effectiveDate: date },
      "A rate cannot be dated in the future"
    );
  }
  if (date < "1990-01-01") {
    throw new DomainError("INVALID_DATE", 400, { effectiveDate: date });
  }
  const rateType = input.rateType ?? "spot";
  if (!isRateType(rateType)) throw new DomainError("INVALID_RATE_TYPE", 400, { rateType });
  const source = input.source ?? "manual";
  if (!(RATE_SOURCES as readonly string[]).includes(source)) {
    throw new DomainError("INVALID_RATE_SOURCE", 400, { source });
  }
  const row = companyBase
    ? canonicalizeCompanyRate(from, to, rate, companyBase)
    : { baseCurrency: from, targetCurrency: to, rate };
  return { row, date, rateType, source };
}

/**
 * Previous rate for the same stored pair (company scope, then system) on or before `date`.
 * D2 (N9): with no row of that type, the spot rate is the reference, and for USD / AED the
 * CBUAE peg (3.6725), so the first rate a user types is checked too (36.725 is refused).
 */
async function previousRate(
  companyId: string | null,
  v: ValidatedRate
): Promise<{ rate: Decimal; date: string } | null> {
  const opts = { rateType: v.rateType, fallbackToSpot: true, pegDefault: true };
  try {
    const r = companyId
      ? await getRate(companyId, v.row.baseCurrency, v.row.targetCurrency, v.date, opts)
      : await getSystemRate(v.row.baseCurrency, v.row.targetCurrency, v.date, opts);
    return { rate: new D(r.rateText), date: r.date };
  } catch (err) {
    if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") return null;
    throw err;
  }
}

/**
 * D2 (N9): the reference a rate in use is checked against: the CBUAE peg for USD / AED, else the
 * platform (system) rate on or before the date, when one exists. Null when there is none.
 */
export async function referenceRate(
  from: string,
  to: string,
  date: string
): Promise<{ rate: Decimal; date: string; source: string } | null> {
  const f = normalizeCurrency(from, "from");
  const t = normalizeCurrency(to, "to");
  if (f === t) return null;
  if (isPeggedPair(f, t)) {
    const p = pegResult(f, date, "spot");
    return { rate: new D(p.rateText), date, source: PEG_SOURCE };
  }
  try {
    const r = await getSystemRate(f, t, date, { rateType: "spot" });
    return { rate: new D(r.rateText), date: r.date, source: r.source };
  } catch (err) {
    if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") return null;
    throw err;
  }
}

/** Sanity band: > 20% move vs the previous rate needs confirmLargeMove. */
export function sanityCheck(
  newRate: Decimal,
  previous: { rate: Decimal; date: string } | null,
  confirmed: boolean
): { changePct: number } | null {
  if (!previous || previous.rate.lte(0)) return null;
  const change = newRate.minus(previous.rate).dividedBy(previous.rate).abs();
  if (change.gt(RATE_SANITY_BAND) && !confirmed) {
    throw new DomainError(
      "RATE_CHANGE_UNCONFIRMED",
      409,
      {
        previousRate: previous.rate.toFixed(RATE_DECIMALS),
        previousDate: previous.date,
        newRate: newRate.toFixed(RATE_DECIMALS),
        changePct: change.times(100).toDecimalPlaces(2).toNumber(),
        bandPct: RATE_SANITY_BAND * 100,
      },
      `The rate moves ${change.times(100).toDecimalPlaces(2).toString()}% from the previous rate ` +
        `(${previous.rate.toFixed(RATE_DECIMALS)} on ${previous.date}); resend with confirmLargeMove=true to save it.`
    );
  }
  return { changePct: change.times(100).toDecimalPlaces(2).toNumber() };
}

/**
 * Insert (or replace the same-day, same-source, same-type row of) a rate in one scope.
 * companyId null = system row (callers must have checked platform-admin rights).
 */
export async function saveRate(
  companyId: string | null,
  userId: string | null,
  input: RateWriteInput
): Promise<{ row: ExchangeRate; replaced: boolean; changePct: number | null }> {
  const base = companyId ? await getCompanyBaseCurrency(companyId) : null;
  const v = validateRateInput(input, base);
  const prev = await previousRate(companyId, v);
  const sanity = sanityCheck(v.row.rate, prev, input.confirmLargeMove === true);

  const day = isoToDate(v.date);
  const next = isoToDate(addDaysIso(v.date, 1));
  const scope = companyId
    ? eq(exchangeRates.companyId, companyId)
    : isNull(exchangeRates.companyId);
  const sameDay = and(
    scope,
    eq(exchangeRates.legacyUnscoped, false),
    eq(exchangeRates.baseCurrency, v.row.baseCurrency),
    eq(exchangeRates.targetCurrency, v.row.targetCurrency),
    eq(exchangeRates.source, v.source),
    eq(exchangeRates.rateType, v.rateType),
    gte(exchangeRates.date, day),
    lt(exchangeRates.date, next)
  );
  const rateNumber = v.row.rate.toNumber();
  const [existing] = await db.select().from(exchangeRates).where(sameDay).limit(1);
  if (existing) {
    const [row] = await db
      .update(exchangeRates)
      .set({ rate: rateNumber, createdBy: userId })
      .where(eq(exchangeRates.id, existing.id))
      .returning();
    return { row, replaced: true, changePct: sanity?.changePct ?? null };
  }
  const [row] = await db
    .insert(exchangeRates)
    .values({
      companyId,
      baseCurrency: v.row.baseCurrency,
      targetCurrency: v.row.targetCurrency,
      rate: rateNumber,
      rateType: v.rateType,
      date: day,
      source: v.source,
      createdBy: userId,
    })
    .returning();
  return { row, replaced: false, changePct: sanity?.changePct ?? null };
}

/** Company rows plus the system rows visible to that company, newest first. */
export async function listRatesForCompany(companyId: string): Promise<ExchangeRate[]> {
  return db
    .select()
    .from(exchangeRates)
    .where(
      and(
        or(eq(exchangeRates.companyId, companyId), isNull(exchangeRates.companyId)),
        eq(exchangeRates.legacyUnscoped, false)
      )
    )
    .orderBy(desc(exchangeRates.date), desc(exchangeRates.createdAt))
    .limit(1000);
}

/** Delete one company-owned rate. System rows are never deletable from a company route. */
export async function deleteCompanyRate(companyId: string, rateId: string): Promise<boolean> {
  const rows = await db
    .delete(exchangeRates)
    .where(and(eq(exchangeRates.id, rateId), eq(exchangeRates.companyId, companyId)))
    .returning({ id: exchangeRates.id });
  return rows.length > 0;
}

/**
 * W5-C (R14-19): VAT returns are filed in AED whatever the functional currency. Converts a
 * base-currency amount into AED at the document date (identity for an AED company). Exposed as
 * the `fx.toVatFilingCurrency` service for the VAT engine (FOLLOW-UP: server/tax/vat-engine).
 */
export async function toVatFilingCurrency(
  companyId: string,
  baseFils: number,
  documentDate: Date | string,
  tx?: LedgerTx
): Promise<{ filingCurrency: string; fils: number; rate: string; baseCurrency: string }> {
  const baseCurrency = await getCompanyBaseCurrency(companyId, tx);
  if (baseCurrency === VAT_FILING_CURRENCY) {
    return { filingCurrency: VAT_FILING_CURRENCY, fils: baseFils, rate: "1.000000", baseCurrency };
  }
  const c = await convert(
    companyId,
    baseFils,
    baseCurrency,
    VAT_FILING_CURRENCY,
    documentDate,
    {},
    tx
  );
  return {
    filingCurrency: VAT_FILING_CURRENCY,
    fils: c.convertedFils,
    rate: c.rateText,
    baseCurrency,
  };
}
