import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { adminMiddleware, authMiddleware, requireCompanyAccess } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { db } from "../db";
import { exchangeRates, EXCHANGE_RATE_TYPES } from "../../shared/schema";
import type { ExchangeRate, ExchangeRateType } from "../../shared/schema";
import { toFils, fromFils } from "../../shared/money";
import { storage } from "../storage";
import { DEFAULT_BASE_CURRENCY, loadBaseCurrency } from "../ledger";
import { parseReportDate, trialBalanceByCurrency, uaeToday } from "../reporting";
import {
  DEFAULT_MAX_RATE_AGE_DAYS,
  FEED_PROVIDERS,
  convert,
  feedStatus,
  importRateCsv,
  ingestFeedPayload,
  runFeedProvider,
  computeFxExposure,
  deleteCompanyRate,
  getRate,
  getSystemRate,
  isRateType,
  listRatesForCompany,
  listRevaluations,
  previewRevaluation,
  registerFxServices,
  runRevaluation,
  saveRate,
  toGainsLossesReport,
  toIsoDate,
  undoRevaluation,
} from "../services/fx";

export type ExchangeRateSource = "manual" | "api" | "fta";

export interface RateLookupResult {
  rate: number;
  source: ExchangeRateSource;
  date: Date;
}

/**
 * Legacy lookup kept for callers without a company context (invoices today).
 * R14-01: reads SYSTEM rows only (company_id IS NULL), so no tenant can poison
 * another tenant's documents. FTA rows win a same-day tie. Inverse pairs are
 * derived. Returns null when no rate exists.
 *
 * Document modules should move to the tenant-scoped `fx.getRate` service
 * (server/services/fx/README.md).
 */
export async function getLatestRateDetailed(
  baseCurrency: string,
  targetCurrency: string,
  asOf?: Date
): Promise<RateLookupResult | null> {
  if (baseCurrency === targetCurrency) {
    return { rate: 1, source: "manual", date: asOf ?? new Date() };
  }
  try {
    const r = await getSystemRate(baseCurrency, targetCurrency, asOf, {
      maxAgeDays: Number.MAX_SAFE_INTEGER,
    });
    return {
      rate: r.rate,
      source: (r.source as ExchangeRateSource) ?? "manual",
      date: new Date(`${r.date}T00:00:00.000Z`),
    };
  } catch (err) {
    if (err instanceof DomainError && ["NO_EXCHANGE_RATE", "INVALID_CURRENCY"].includes(err.code)) {
      return null;
    }
    throw err;
  }
}

export async function getLatestRate(
  baseCurrency: string,
  targetCurrency: string,
  asOf?: Date
): Promise<number | null> {
  const result = await getLatestRateDetailed(baseCurrency, targetCurrency, asOf);
  return result === null ? null : result.rate;
}

/**
 * Convert a foreign-currency amount to the base currency using the stored rate
 * (identity when the amount is already in `baseCurrency`, default the schema default).
 */
export function toBaseCurrency(
  foreignAmount: number,
  foreignCurrency: string,
  rateToBase: number,
  baseCurrency: string = DEFAULT_BASE_CURRENCY
): number {
  if (foreignCurrency.toUpperCase() === baseCurrency.toUpperCase()) return foreignAmount;
  return foreignAmount * rateToBase;
}

/**
 * UI shape: the stored row reads "1 fromCurrency = rate toCurrency".
 * R14-02: fromCurrency is the row's base_currency (no more swapping).
 */
function toCompanyRateResponse(row: ExchangeRate) {
  return {
    id: row.id,
    companyId: row.companyId,
    scope: row.companyId ? "company" : "system",
    fromCurrency: row.baseCurrency,
    toCurrency: row.targetCurrency,
    baseCurrency: row.baseCurrency,
    targetCurrency: row.targetCurrency,
    rate: row.rate,
    rateType: row.rateType,
    effectiveDate: row.date,
    date: row.date,
    source: row.source,
    legacyInverted: row.legacyInverted,
    createdAt: row.createdAt,
  };
}

const zIso = z.string().trim().toUpperCase().min(3).max(3);
const zRateValue = z.union([z.number(), z.string().trim().min(1).max(32)]);
const zRateType = z.enum(EXCHANGE_RATE_TYPES);
const zDay = z.string().trim().max(32);

const companyRateBody = z.object({
  fromCurrency: zIso,
  toCurrency: zIso.optional(),
  rate: zRateValue,
  effectiveDate: zDay.optional(),
  rateType: zRateType.optional(),
  confirmLargeMove: z.boolean().optional(),
});

const systemRateBody = z.object({
  baseCurrency: zIso.optional(),
  targetCurrency: zIso,
  rate: zRateValue,
  date: zDay.optional(),
  source: z.enum(["manual", "api", "fta"]).optional(),
  rateType: zRateType.optional(),
  confirmLargeMove: z.boolean().optional(),
});

const ftaBulkBody = z.object({
  baseCurrency: zIso.optional(),
  rates: z
    .array(
      z.object({
        targetCurrency: zIso,
        rate: zRateValue,
        date: zDay,
        rateType: zRateType.optional(),
      })
    )
    .min(1)
    .max(500),
  confirmLargeMove: z.boolean().optional(),
});

const feedRunBody = z.object({
  provider: z.enum(FEED_PROVIDERS),
  payload: z.string().min(1).max(2_000_000).optional(),
});

const csvImportBody = z.object({
  csv: z.string().min(1).max(2_000_000),
  source: z.enum(["manual", "fta"]).optional(),
});

const revalueBody = z.object({
  asOf: zDay.optional(),
  acknowledgeStale: z.boolean().optional(),
  /** D2 (N9): needed when a rate in use is outside the sanity band (owner/admin/accountant/CFO). */
  rateOverrideReason: z.string().trim().max(1000).optional().nullable(),
});

const userIdOf = (req: Request): string => {
  const id = req.user?.id;
  if (!id) throw new DomainError("UNAUTHENTICATED", 401);
  return id;
};

/** Viewers can read rates but not change them or post revaluations. */
async function assertCanWrite(req: Request, companyId: string): Promise<void> {
  if (req.user?.isAdmin) return;
  const membership = await storage.getUserRole(companyId, userIdOf(req));
  if (membership && membership.role === "viewer") {
    throw new DomainError("FORBIDDEN_ROLE", 403, { role: membership.role });
  }
}

const queryString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

function queryRateType(v: unknown): ExchangeRateType | undefined {
  const s = queryString(v);
  if (s === undefined) return undefined;
  if (!isRateType(s)) throw new DomainError("INVALID_RATE_TYPE", 400, { rateType: s });
  return s;
}

function queryMaxAge(v: unknown): number {
  const s = queryString(v);
  if (s === undefined) return DEFAULT_MAX_RATE_AGE_DAYS;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 3650) {
    throw new DomainError("INVALID_MAX_AGE", 400, { maxAgeDays: s });
  }
  return n;
}

export function registerExchangeRateRoutes(app: Express) {
  registerFxServices();
  const companyAccess = requireCompanyAccess("params");

  // ─── Company rates (tenant-scoped, R14-01) ──────────────────────────────

  app.get(
    "/api/companies/:companyId/exchange-rates",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await listRatesForCompany(req.params.companyId);
      res.json(rows.map(toCompanyRateResponse));
    })
  );

  app.post(
    "/api/companies/:companyId/exchange-rates",
    authMiddleware,
    companyAccess,
    strictBody(companyRateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCanWrite(req, companyId);
      const { fromCurrency, toCurrency, rate, effectiveDate, rateType, confirmLargeMove } =
        req.body as z.output<typeof companyRateBody>;
      const base = await loadBaseCurrency(companyId);
      const { row, replaced, changePct } = await saveRate(companyId, userIdOf(req), {
        fromCurrency,
        toCurrency: toCurrency ?? base,
        rate,
        effectiveDate,
        rateType,
        source: "manual",
        confirmLargeMove,
      });
      res.status(replaced ? 200 : 201).json({ ...toCompanyRateResponse(row), replaced, changePct });
    })
  );

  app.delete(
    "/api/companies/:companyId/exchange-rates/:rateId",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, rateId } = req.params;
      await assertCanWrite(req, companyId);
      if (!/^[0-9a-f-]{36}$/i.test(rateId)) throw new DomainError("RATE_NOT_FOUND", 404);
      const ok = await deleteCompanyRate(companyId, rateId);
      if (!ok) throw new DomainError("RATE_NOT_FOUND", 404);
      res.json({ deleted: true });
    })
  );

  app.get(
    "/api/companies/:companyId/exchange-rates/lookup",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const from = queryString(req.query.from ?? req.query.base);
      const to = queryString(req.query.to ?? req.query.target);
      if (!from || !to) throw new DomainError("CURRENCY_REQUIRED", 400);
      const r = await getRate(req.params.companyId, from, to, queryString(req.query.date), {
        rateType: queryRateType(req.query.rateType),
        maxAgeDays: queryMaxAge(req.query.maxAgeDays),
      });
      res.json({ from: from.toUpperCase(), to: to.toUpperCase(), ...r });
    })
  );

  app.get(
    "/api/companies/:companyId/exchange-rates/convert",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const from = queryString(req.query.from);
      const to = queryString(req.query.to);
      const amount = queryString(req.query.amount);
      if (!from || !to || !amount) {
        throw new DomainError(
          "CONVERT_PARAMS_REQUIRED",
          400,
          undefined,
          "from, to, and amount are required"
        );
      }
      const amountFils = toFils(amount, { rounding: "halfUp" });
      if (amountFils <= 0) throw new DomainError("INVALID_AMOUNT", 400, { amount });
      const r = await convert(
        req.params.companyId,
        amountFils,
        from,
        to,
        queryString(req.query.date),
        {
          rateType: queryRateType(req.query.rateType),
          maxAgeDays: queryMaxAge(req.query.maxAgeDays),
        }
      );
      res.json({
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        amount: Number(fromFils(r.amountFils)),
        convertedAmount: Number(fromFils(r.convertedFils)),
        convertedAmountText: fromFils(r.convertedFils),
        rate: r.rate,
        rateText: r.rateText,
        effectiveDate: r.date,
        source: r.source,
        scope: r.scope,
        stale: r.stale,
        warning: r.warning,
      });
    })
  );

  // ─── System rates (platform admins only, R14-01) ────────────────────────

  // GET /api/exchange-rates?base=USD&target=AED&asOf=2026-01-01 — system rows only.
  app.get(
    "/api/exchange-rates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const base = (queryString(req.query.base) ?? DEFAULT_BASE_CURRENCY).toUpperCase();
      const target = queryString(req.query.target);
      if (target) {
        const rate = await getLatestRate(
          base,
          target.toUpperCase(),
          queryString(req.query.asOf) ? new Date(String(req.query.asOf)) : undefined
        );
        if (rate === null) {
          return res.status(404).json({
            code: "NO_EXCHANGE_RATE",
            message: `No exchange rate found for ${base}/${target}`,
          });
        }
        return res.json({ baseCurrency: base, targetCurrency: target.toUpperCase(), rate });
      }
      const all = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            isNull(exchangeRates.companyId),
            eq(exchangeRates.legacyUnscoped, false),
            eq(exchangeRates.baseCurrency, base)
          )
        )
        .orderBy(desc(exchangeRates.date))
        .limit(1000);
      const seen = new Set<string>();
      res.json(
        all.filter((r: ExchangeRate) => {
          if (seen.has(r.targetCurrency)) return false;
          seen.add(r.targetCurrency);
          return true;
        })
      );
    })
  );

  // POST /api/exchange-rates — record a SYSTEM rate (admin only). "1 base = rate target".
  app.post(
    "/api/exchange-rates",
    authMiddleware,
    adminMiddleware,
    strictBody(systemRateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { baseCurrency, targetCurrency, rate, date, source, rateType, confirmLargeMove } =
        req.body as z.output<typeof systemRateBody>;
      const { row } = await saveRate(null, userIdOf(req), {
        fromCurrency: baseCurrency ?? DEFAULT_BASE_CURRENCY,
        toCurrency: targetCurrency,
        rate,
        effectiveDate: date,
        rateType,
        source: source ?? "manual",
        confirmLargeMove,
      });
      res.status(201).json(row);
    })
  );

  // POST /api/exchange-rates/fta/bulk — bulk-load FTA-published SYSTEM rates (admin only).
  app.post(
    "/api/exchange-rates/fta/bulk",
    authMiddleware,
    adminMiddleware,
    strictBody(ftaBulkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { baseCurrency, rates, confirmLargeMove } = req.body as z.output<typeof ftaBulkBody>;
      const userId = userIdOf(req);
      let inserted = 0;
      const skipped: Array<{ targetCurrency: string; date: string; reason: string }> = [];
      for (const r of rates) {
        try {
          await saveRate(null, userId, {
            fromCurrency: baseCurrency ?? DEFAULT_BASE_CURRENCY,
            toCurrency: r.targetCurrency,
            rate: r.rate,
            effectiveDate: r.date,
            rateType: r.rateType,
            source: "fta",
            confirmLargeMove,
          });
          inserted++;
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          skipped.push({ targetCurrency: r.targetCurrency, date: r.date, reason: err.code });
        }
      }
      res.status(201).json({ inserted, skipped: skipped.length, skippedDetails: skipped });
    })
  );

  // GET /api/exchange-rates/lookup?base=USD&target=AED&asOf=... — system rows only.
  app.get(
    "/api/exchange-rates/lookup",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const base = (queryString(req.query.base) ?? DEFAULT_BASE_CURRENCY).toUpperCase();
      const target = queryString(req.query.target);
      if (!target) throw new DomainError("TARGET_REQUIRED", 400, undefined, "target is required");
      const asOf = queryString(req.query.asOf);
      const result = await getLatestRateDetailed(
        base,
        target.toUpperCase(),
        asOf ? new Date(toIsoDate(asOf, "asOf")) : undefined
      );
      if (result === null) {
        return res.status(404).json({
          code: "NO_EXCHANGE_RATE",
          message: `No exchange rate found for ${base}/${target}`,
        });
      }
      res.json({
        baseCurrency: base,
        targetCurrency: target.toUpperCase(),
        rate: result.rate,
        source: result.source,
        date: result.date,
        scope: "system",
      });
    })
  );

  // ─── Trial balance by currency (W5-C, R14-16 / R11-18) ──────────────────

  app.get(
    "/api/companies/:companyId/reports/trial-balance-by-currency",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const to = parseReportDate(req.query.to ?? req.query.asOf, "to") ?? uaeToday();
      const from = parseReportDate(req.query.from, "from");
      if (from && from > to) throw new DomainError("INVALID_REPORT_RANGE", 400, { from, to });
      res.json(await trialBalanceByCurrency({ companyId: req.params.companyId, from, to }));
    })
  );

  // ─── Rate feed (W5-C, R14-14) ───────────────────────────────────────────

  // Staleness for the Exchange Rates banner: latest rate per pair visible to the company.
  app.get(
    "/api/companies/:companyId/exchange-rates/feed-status",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const maxAgeDays = queryMaxAge(req.query.maxAgeDays);
      const today = uaeToday();
      const rows = await listRatesForCompany(req.params.companyId);
      const latest = new Map<string, ExchangeRate>();
      for (const r of rows) {
        const k = `${r.baseCurrency}/${r.targetCurrency}/${r.rateType}`;
        if (!latest.has(k)) latest.set(k, r);
      }
      const pairs = [...latest.values()].map((r) => {
        const date = (r.date instanceof Date ? r.date : new Date(r.date))
          .toISOString()
          .slice(0, 10);
        const ageDays = Math.max(
          0,
          Math.floor(
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000
          )
        );
        return {
          pair: `${r.baseCurrency}/${r.targetCurrency}`,
          rateType: r.rateType,
          scope: r.companyId ? "company" : "system",
          source: r.source,
          date,
          ageDays,
          stale: ageDays > maxAgeDays,
        };
      });
      const status = await feedStatus();
      res.json({
        maxAgeDays,
        stale: pairs.filter((p) => p.stale),
        pairs,
        feed: { capability: status.capability, configured: status.configured },
      });
    })
  );

  app.get(
    "/api/exchange-rates/feed/status",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(await feedStatus());
    })
  );

  app.post(
    "/api/exchange-rates/feed/run",
    authMiddleware,
    adminMiddleware,
    strictBody(feedRunBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { provider, payload } = req.body as z.output<typeof feedRunBody>;
      const userId = userIdOf(req);
      // A payload is a provider file the admin downloaded (no network); otherwise fetch.
      const result = payload
        ? await ingestFeedPayload(provider, payload, userId)
        : await runFeedProvider(provider, { userId });
      res.status(result.status === "ok" ? 201 : 502).json(result);
    })
  );

  app.post(
    "/api/exchange-rates/import-csv",
    authMiddleware,
    adminMiddleware,
    strictBody(csvImportBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { csv, source } = req.body as z.output<typeof csvImportBody>;
      res.status(201).json(await importRateCsv(csv, userIdOf(req), source ?? "manual"));
    })
  );

  // ─── Unrealised FX (R14-03, R14-04, R14-17, R11-18) ─────────────────────

  // Same exposure function as the revaluation run: posted documents, outstanding balances.
  app.get(
    "/api/companies/:companyId/reports/fx-gains-losses",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const asOf = toIsoDate(queryString(req.query.asOf), "asOf");
      const exposure = await computeFxExposure(req.params.companyId, asOf, {
        rateType: queryRateType(req.query.rateType),
      });
      res.json(toGainsLossesReport(exposure));
    })
  );

  app.get(
    "/api/companies/:companyId/exchange-rates/revalue/preview",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await previewRevaluation(req.params.companyId, queryString(req.query.asOf)));
    })
  );

  app.post(
    "/api/companies/:companyId/exchange-rates/revalue",
    authMiddleware,
    companyAccess,
    strictBody(revalueBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCanWrite(req, companyId);
      const { asOf, acknowledgeStale, rateOverrideReason } = req.body as z.output<
        typeof revalueBody
      >;
      const userId = userIdOf(req);
      const membership = req.user?.isAdmin ? null : await storage.getUserRole(companyId, userId);
      const result = await runRevaluation(companyId, asOf, userId, {
        acknowledgeStale,
        rateOverrideReason,
        role: membership?.role ?? null,
      });
      if (result.posted) {
        const { recordAudit } = await import("../services/audit.service");
        await recordAudit({
          userId,
          companyId,
          action: "fx.revaluation",
          entityType: "fx_revaluation",
          entityId: result.revaluation.id,
          after: {
            asOf: result.revaluation.asOf,
            netGainLoss: result.netGainLoss,
            journalEntryId: result.journalEntryId,
            reversalEntryId: result.reversalEntryId,
            rateOverride: result.rateOverride ?? null,
          },
          req,
        });
      }
      res.status(result.posted ? 201 : 200).json(result);
    })
  );

  app.get(
    "/api/companies/:companyId/fx-revaluations",
    authMiddleware,
    companyAccess,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listRevaluations(req.params.companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/fx-revaluations/:revaluationId/undo",
    authMiddleware,
    companyAccess,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, revaluationId } = req.params;
      await assertCanWrite(req, companyId);
      if (!/^[0-9a-f-]{36}$/i.test(revaluationId)) {
        throw new DomainError("REVALUATION_NOT_FOUND", 404);
      }
      const userId = userIdOf(req);
      const result = await undoRevaluation(companyId, revaluationId, userId);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: "fx.revaluation.undo",
        entityType: "fx_revaluation",
        entityId: revaluationId,
        after: { undoEntryIds: result.undoEntryIds },
        req,
      });
      res.json(result);
    })
  );
}
