// DB access for exchange rates. The rules (convention, lookup order, validation)
// live in exchange-rate-rules.ts. Convention: a row means
// "1 unit of baseCurrency = rate units of targetCurrency".
//
// Company-facing writes always carry the caller's companyId and never touch a
// row whose company_id is NULL (system) or another company's. System rows are
// written only by importSystemRates (the automated feed).

import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { exchangeRates } from "../../shared/schema";
import type { ExchangeRate } from "../../shared/schema";
import {
  resolveRate,
  type RateRow,
  type ResolvedRate,
} from "./exchange-rate-rules";

export interface RateLookupResult extends ResolvedRate {}

function toRateRow(row: ExchangeRate): RateRow {
  return {
    companyId: row.companyId ?? null,
    baseCurrency: row.baseCurrency,
    targetCurrency: row.targetCurrency,
    rate: Number(row.rate),
    date: row.date,
    source: row.source,
    isTrusted: row.isTrusted,
  };
}

/**
 * How many `to` per 1 `from` on or before `asOf`, for `companyId` (null = system
 * rates only). Own rate, then system rate, then the inverse pair.
 */
export async function getLatestRateDetailed(
  from: string,
  to: string,
  asOf: Date | undefined,
  companyId: string | null
): Promise<RateLookupResult | null> {
  if (from === to) return resolveRate([], { from, to, asOf, companyId });

  const scopeFilter =
    companyId === null
      ? isNull(exchangeRates.companyId)
      : or(isNull(exchangeRates.companyId), eq(exchangeRates.companyId, companyId));
  const conditions = [
    eq(exchangeRates.isTrusted, true),
    scopeFilter,
    or(
      and(eq(exchangeRates.baseCurrency, from), eq(exchangeRates.targetCurrency, to)),
      and(eq(exchangeRates.baseCurrency, to), eq(exchangeRates.targetCurrency, from))
    ),
  ];
  if (asOf) conditions.push(lte(exchangeRates.date, asOf));

  const isSystem = sql`(${exchangeRates.companyId} IS NULL)`;
  // Newest row per (scope, direction): at most four rows come back.
  const rows: ExchangeRate[] = await db
    .selectDistinctOn([isSystem, exchangeRates.baseCurrency, exchangeRates.targetCurrency])
    .from(exchangeRates)
    .where(and(...conditions))
    .orderBy(
      isSystem,
      exchangeRates.baseCurrency,
      exchangeRates.targetCurrency,
      desc(exchangeRates.date),
      desc(exchangeRates.createdAt)
    );

  return resolveRate(rows.map(toRateRow), { from, to, asOf, companyId });
}

export async function getLatestRate(
  from: string,
  to: string,
  asOf: Date | undefined,
  companyId: string | null
): Promise<number | null> {
  const result = await getLatestRateDetailed(from, to, asOf, companyId);
  return result === null ? null : result.rate;
}

/** The company's own rows plus trusted system rows, newest first. */
export async function listRatesForCompany(companyId: string): Promise<ExchangeRate[]> {
  return db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.isTrusted, true),
        or(isNull(exchangeRates.companyId), eq(exchangeRates.companyId, companyId))
      )
    )
    .orderBy(desc(exchangeRates.date), desc(exchangeRates.createdAt));
}

/** A row that belongs to this company (never a system row or another company's). */
export async function getCompanyRate(companyId: string, id: string): Promise<ExchangeRate | null> {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(and(eq(exchangeRates.id, id), eq(exchangeRates.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

interface RateValues {
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  date: Date;
}

export async function createCompanyRate(companyId: string, values: RateValues): Promise<ExchangeRate> {
  const [created] = await db
    .insert(exchangeRates)
    .values({ ...values, companyId, source: "manual", isTrusted: true })
    .returning();
  return created;
}

export async function updateCompanyRate(
  companyId: string,
  id: string,
  values: RateValues
): Promise<ExchangeRate | null> {
  const [updated] = await db
    .update(exchangeRates)
    .set(values)
    .where(and(eq(exchangeRates.id, id), eq(exchangeRates.companyId, companyId)))
    .returning();
  return updated ?? null;
}

export async function deleteCompanyRate(companyId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(exchangeRates)
    .where(and(eq(exchangeRates.id, id), eq(exchangeRates.companyId, companyId)))
    .returning({ id: exchangeRates.id });
  return deleted.length > 0;
}

export interface FeedRate {
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  date: Date;
}

/**
 * The automated feed (FTA / central bank): the ONLY writer of system rows
 * (company_id NULL, source 'fta'). Re-imports of the same pair and day are
 * skipped by the unique index.
 */
export async function importSystemRates(
  rates: FeedRate[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const r of rates) {
    const result = await db
      .insert(exchangeRates)
      .values({ ...r, companyId: null, source: "fta", isTrusted: true })
      .onConflictDoNothing()
      .returning({ id: exchangeRates.id });
    if (result.length > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

/** True when this company already holds a rate for the pair on that calendar day. */
export async function companyRateExists(
  companyId: string,
  baseCurrency: string,
  targetCurrency: string,
  date: Date,
  exceptId?: string
): Promise<boolean> {
  const rows = await db
    .select({ id: exchangeRates.id })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.companyId, companyId),
        eq(exchangeRates.baseCurrency, baseCurrency),
        eq(exchangeRates.targetCurrency, targetCurrency),
        eq(exchangeRates.source, "manual"),
        sql`${exchangeRates.date}::date = ${date.toISOString()}::timestamp::date`
      )
    );
  return rows.some((r: { id: string }) => r.id !== exceptId);
}
