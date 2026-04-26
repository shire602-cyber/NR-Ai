import type { Express, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, desc, lte } from "drizzle-orm";
import { exchangeRates, invoices, receipts } from "../../shared/schema";
import type { UnrealizedFxGainLoss, FxGainsLossesReport, ExchangeRate, Invoice, Receipt } from "../../shared/schema";
import { storage } from "../storage";

export type ExchangeRateSource = 'manual' | 'api' | 'fta';

export interface RateLookupResult {
  rate: number;
  source: ExchangeRateSource;
  date: Date;
}

/**
 * Retrieve the most recent exchange rate for a currency pair on or before a
 * given date. Returns null when no rate is found.
 *
 * Per FTA: when an FTA-published rate exists it must be used for VAT-impacting
 * conversions. We therefore look for an FTA rate first; if none is available
 * for the period we fall back to manual / API entries. Callers can opt out of
 * the preference with `preferFta: false` when they need the literal newest rate.
 */
export async function getLatestRateDetailed(
  baseCurrency: string,
  targetCurrency: string,
  asOf?: Date,
  options: { preferFta?: boolean } = {},
): Promise<RateLookupResult | null> {
  if (baseCurrency === targetCurrency) {
    return { rate: 1, source: 'manual', date: asOf ?? new Date() };
  }

  const preferFta = options.preferFta !== false;

  const baseConditions = [
    eq(exchangeRates.baseCurrency, baseCurrency),
    eq(exchangeRates.targetCurrency, targetCurrency),
  ];
  if (asOf) baseConditions.push(lte(exchangeRates.date, asOf));

  if (preferFta) {
    const ftaRows = await db
      .select()
      .from(exchangeRates)
      .where(and(...baseConditions, eq(exchangeRates.source, 'fta')))
      .orderBy(desc(exchangeRates.date))
      .limit(1);
    if (ftaRows.length > 0) {
      return { rate: ftaRows[0].rate, source: 'fta', date: ftaRows[0].date };
    }
  }

  const rows = await db
    .select()
    .from(exchangeRates)
    .where(and(...baseConditions))
    .orderBy(desc(exchangeRates.date))
    .limit(1);

  if (rows.length === 0) return null;
  return {
    rate: rows[0].rate,
    source: (rows[0].source as ExchangeRateSource) ?? 'manual',
    date: rows[0].date,
  };
}

export async function getLatestRate(
  baseCurrency: string,
  targetCurrency: string,
  asOf?: Date,
): Promise<number | null> {
  const result = await getLatestRateDetailed(baseCurrency, targetCurrency, asOf);
  return result === null ? null : result.rate;
}

/**
 * Convert a foreign-currency amount to AED using the stored rate.
 * Falls back to 1:1 when no rate is available.
 */
export function toBaseCurrency(
  foreignAmount: number,
  foreignCurrency: string,
  rateToBase: number,
): number {
  if (foreignCurrency === "AED") return foreignAmount;
  return foreignAmount * rateToBase;
}

export function registerExchangeRateRoutes(app: Express) {
  // ─────────────────────────────────────────────
  // GET /api/exchange-rates
  // Query: ?base=AED&target=USD&asOf=2025-01-01
  // Returns the latest rate for the currency pair.
  // ─────────────────────────────────────────────
  app.get(
    "/api/exchange-rates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { base = "AED", target, asOf } = req.query as {
        base?: string;
        target?: string;
        asOf?: string;
      };

      if (target) {
        // Return a single rate for the pair
        const asOfDate = asOf ? new Date(asOf) : undefined;
        const rate = await getLatestRate(base, target, asOfDate);
        if (rate === null) {
          return res.status(404).json({
            message: `No exchange rate found for ${base}/${target}`,
          });
        }
        return res.json({ baseCurrency: base, targetCurrency: target, rate });
      }

      // Return all latest rates where base = AED (one per target currency)
      const allRates = await db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.baseCurrency, base))
        .orderBy(desc(exchangeRates.date));

      // Deduplicate: keep the latest rate per target currency
      const seen = new Set<string>();
      const latest = allRates.filter((r: ExchangeRate) => {
        if (seen.has(r.targetCurrency)) return false;
        seen.add(r.targetCurrency);
        return true;
      });

      res.json(latest);
    }),
  );

  // ─────────────────────────────────────────────
  // POST /api/exchange-rates
  // Body: { baseCurrency, targetCurrency, rate, date?, source? }
  // Manually record an exchange rate.
  // ─────────────────────────────────────────────
  app.post(
    "/api/exchange-rates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { baseCurrency = "AED", targetCurrency, rate, date, source = "manual" } = req.body;

      if (!targetCurrency || rate === undefined || rate === null) {
        return res.status(400).json({
          message: "targetCurrency and rate are required",
        });
      }
      if (typeof rate !== "number" || rate <= 0) {
        return res.status(400).json({ message: "rate must be a positive number" });
      }
      if (!['manual', 'api', 'fta'].includes(source)) {
        return res.status(400).json({ message: "source must be 'manual', 'api', or 'fta'" });
      }

      const [created] = await db
        .insert(exchangeRates)
        .values({
          baseCurrency,
          targetCurrency,
          rate,
          date: date ? new Date(date) : new Date(),
          source,
        })
        .returning();

      res.status(201).json(created);
    }),
  );

  // ─────────────────────────────────────────────
  // POST /api/exchange-rates/fta/bulk
  // Body: { baseCurrency?, rates: [{ targetCurrency, rate, date }] }
  // Bulk-load FTA-published rates. The (base, target, date::date, source)
  // unique index prevents duplicate entries on re-import.
  // ─────────────────────────────────────────────
  app.post(
    "/api/exchange-rates/fta/bulk",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { baseCurrency = "AED", rates } = req.body as {
        baseCurrency?: string;
        rates: Array<{ targetCurrency: string; rate: number; date: string }>;
      };

      if (!Array.isArray(rates) || rates.length === 0) {
        return res.status(400).json({ message: "rates array is required" });
      }

      const inserted: typeof exchangeRates.$inferSelect[] = [];
      const skipped: Array<{ targetCurrency: string; date: string; reason: string }> = [];

      for (const r of rates) {
        if (!r.targetCurrency || typeof r.rate !== 'number' || r.rate <= 0 || !r.date) {
          skipped.push({
            targetCurrency: r.targetCurrency ?? '?',
            date: r.date ?? '?',
            reason: 'invalid payload',
          });
          continue;
        }
        try {
          const [row] = await db
            .insert(exchangeRates)
            .values({
              baseCurrency,
              targetCurrency: r.targetCurrency,
              rate: r.rate,
              date: new Date(r.date),
              source: 'fta',
            })
            .returning();
          if (row) inserted.push(row);
        } catch (err: unknown) {
          // Unique-index collision — already imported. Skip cleanly.
          skipped.push({
            targetCurrency: r.targetCurrency,
            date: r.date,
            reason: err instanceof Error ? err.message : 'duplicate',
          });
        }
      }

      res.status(201).json({
        inserted: inserted.length,
        skipped: skipped.length,
        skippedDetails: skipped,
      });
    }),
  );

  // ─────────────────────────────────────────────
  // GET /api/exchange-rates/lookup
  // Query: ?base=AED&target=USD&asOf=2026-04-01
  // Returns the rate including its source — required for FTA audit trail.
  // ─────────────────────────────────────────────
  app.get(
    "/api/exchange-rates/lookup",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { base = "AED", target, asOf } = req.query as {
        base?: string;
        target?: string;
        asOf?: string;
      };
      if (!target) {
        return res.status(400).json({ message: "target is required" });
      }
      const result = await getLatestRateDetailed(base, target, asOf ? new Date(asOf) : undefined);
      if (result === null) {
        return res.status(404).json({ message: `No exchange rate found for ${base}/${target}` });
      }
      res.json({
        baseCurrency: base,
        targetCurrency: target,
        rate: result.rate,
        source: result.source,
        date: result.date,
      });
    }),
  );

  // ─────────────────────────────────────────────
  // GET /api/companies/:companyId/reports/fx-gains-losses
  // Returns unrealized FX gains/losses on open
  // receivables (unpaid invoices in foreign currency)
  // and open payables (unposted receipts in foreign currency).
  // ─────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/reports/fx-gains-losses",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const asOf = new Date();

      // ── Open foreign-currency receivables (invoices) ──
      const openInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
          ),
        );

      const foreignInvoices = openInvoices.filter(
        (inv: Invoice) =>
          inv.currency !== "AED" &&
          inv.status !== "paid" &&
          inv.status !== "void",
      );

      const receivables: UnrealizedFxGainLoss[] = [];
      for (const inv of foreignInvoices) {
        const currentRate = await getLatestRate("AED", inv.currency, asOf);
        if (currentRate === null) continue;

        // inv.exchangeRate is stored as: 1 AED = X foreignCurrency
        // so AED equivalent = foreignAmount / inv.exchangeRate
        const txRate = inv.exchangeRate > 0 ? inv.exchangeRate : 1;
        const foreignTotal = inv.total;

        // Convert: AED = foreignAmount / rate (rate = foreign per 1 AED)
        const bookValueAed = txRate > 0 ? foreignTotal / txRate : foreignTotal;
        const currentValueAed = currentRate > 0 ? foreignTotal / currentRate : foreignTotal;
        const unrealizedGainLoss = currentValueAed - bookValueAed;

        receivables.push({
          entityType: "invoice",
          entityId: inv.id,
          entityNumber: inv.number,
          counterparty: inv.customerName,
          currency: inv.currency,
          foreignAmount: foreignTotal,
          transactionRate: txRate,
          currentRate,
          bookValueAed,
          currentValueAed,
          unrealizedGainLoss,
        });
      }

      // ── Open foreign-currency payables (unposted receipts) ──
      const allReceipts = await db
        .select()
        .from(receipts)
        .where(eq(receipts.companyId, companyId));

      const foreignReceipts = allReceipts.filter(
        (r: Receipt) => r.currency && r.currency !== "AED" && !r.posted,
      );

      const payables: UnrealizedFxGainLoss[] = [];
      for (const rec of foreignReceipts) {
        const currency = rec.currency!;
        const currentRate = await getLatestRate("AED", currency, asOf);
        if (currentRate === null) continue;

        const txRate = rec.exchangeRate > 0 ? rec.exchangeRate : 1;
        const foreignAmount = rec.amount ?? 0;

        const bookValueAed = txRate > 0 ? foreignAmount / txRate : foreignAmount;
        const currentValueAed = currentRate > 0 ? foreignAmount / currentRate : foreignAmount;
        // For payables: gain when current cost in AED is lower
        const unrealizedGainLoss = bookValueAed - currentValueAed;

        payables.push({
          entityType: "payable",
          entityId: rec.id,
          entityNumber: `RCP-${rec.id.slice(0, 8)}`,
          counterparty: rec.merchant ?? "Unknown",
          currency,
          foreignAmount,
          transactionRate: txRate,
          currentRate,
          bookValueAed,
          currentValueAed,
          unrealizedGainLoss,
        });
      }

      const allItems = [...receivables, ...payables];
      const totalUnrealizedGain = allItems
        .filter((i) => i.unrealizedGainLoss > 0)
        .reduce((s, i) => s + i.unrealizedGainLoss, 0);
      const totalUnrealizedLoss = allItems
        .filter((i) => i.unrealizedGainLoss < 0)
        .reduce((s, i) => s + i.unrealizedGainLoss, 0);

      const report: FxGainsLossesReport = {
        asOf: asOf.toISOString(),
        baseCurrency: "AED",
        receivables,
        payables,
        totalUnrealizedGain,
        totalUnrealizedLoss,
        netUnrealizedGainLoss: totalUnrealizedGain + totalUnrealizedLoss,
      };

      res.json(report);
    }),
  );
}
