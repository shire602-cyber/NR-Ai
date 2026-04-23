import type { Express, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, desc, lte } from "drizzle-orm";
import { exchangeRates, invoices, receipts } from "../../shared/schema";
import type { UnrealizedFxGainLoss, FxGainsLossesReport } from "../../shared/schema";
import { storage } from "../storage";

/**
 * Retrieve the most recent exchange rate for a currency pair on or before
 * a given date. Returns null when no rate is found.
 */
export async function getLatestRate(
  baseCurrency: string,
  targetCurrency: string,
  asOf?: Date,
): Promise<number | null> {
  if (baseCurrency === targetCurrency) return 1;

  const conditions = [
    eq(exchangeRates.baseCurrency, baseCurrency),
    eq(exchangeRates.targetCurrency, targetCurrency),
  ];
  if (asOf) {
    conditions.push(lte(exchangeRates.date, asOf));
  }

  const rows = await db
    .select()
    .from(exchangeRates)
    .where(and(...conditions))
    .orderBy(desc(exchangeRates.date))
    .limit(1);

  return rows.length > 0 ? rows[0].rate : null;
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
      const latest = allRates.filter((r) => {
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
        (inv) =>
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
        (r) => r.currency && r.currency !== "AED" && !r.posted,
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
