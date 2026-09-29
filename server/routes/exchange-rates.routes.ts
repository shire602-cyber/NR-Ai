import type { Express, Request, Response } from "express";
import { authMiddleware, adminMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { exchangeRates, invoices, receipts } from "../../shared/schema";
import { revalueForeignBalance, buildFxRevaluationLines } from "../services/financial-statements";
import { ACCOUNT_CODES } from "../constants";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import type {
  UnrealizedFxGainLoss,
  FxGainsLossesReport,
  ExchangeRate,
  Invoice,
  Receipt,
} from "../../shared/schema";
import { storage } from "../storage";
import {
  isIsoCurrencyCode,
  normalizeEffectiveDate,
  validateRateInput,
} from "../services/exchange-rate-rules";
import {
  companyRateExists,
  createCompanyRate,
  deleteCompanyRate,
  getCompanyRate,
  getLatestRate,
  getLatestRateDetailed,
  importSystemRates,
  listRatesForCompany,
  updateCompanyRate,
} from "../services/exchange-rate.service";
import { recordAudit } from "../services/audit.service";

// Callers import the lookup from here. CONVENTION: a rate row means
// "1 unit of baseCurrency = rate units of targetCurrency"; getLatestRate(from, to,
// asOf, companyId) returns how many `to` per 1 `from` (invoices: from = the
// foreign currency, to = AED, so the result is AED per 1 foreign unit).
export { getLatestRate, getLatestRateDetailed };

/**
 * Convert a foreign-currency amount to AED using the stored rate.
 * Falls back to 1:1 when no rate is available.
 */
export function toBaseCurrency(
  foreignAmount: number,
  foreignCurrency: string,
  rateToBase: number
): number {
  if (foreignCurrency === "AED") return foreignAmount;
  return foreignAmount * rateToBase;
}

/** Company-page shape: "1 fromCurrency = rate toCurrency", plus which scope owns the row. */
function toCompanyRateResponse(row: ExchangeRate) {
  return {
    ...row,
    scope: row.companyId === null ? ("system" as const) : ("company" as const),
    fromCurrency: row.baseCurrency,
    toCurrency: row.targetCurrency,
    effectiveDate: row.date,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

const DUPLICATE_MESSAGE =
  "You already have a rate for this currency pair on that date. Edit the existing rate instead.";

/** Company access check; sends the 403 itself and returns false when denied. */
async function requireAccess(req: Request, res: Response, companyId: string): Promise<boolean> {
  const userId = (req as any).user?.id;
  if (await storage.hasCompanyAccess(userId, companyId)) return true;
  res.status(403).json({ message: "Access denied" });
  return false;
}

export function registerExchangeRateRoutes(app: Express) {
  // Company rate management. Rows written here always carry the URL's company;
  // a company can list its own rows plus system rows, and can only change its own.
  app.get(
    "/api/companies/:companyId/exchange-rates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireAccess(req, res, companyId))) return;
      const rows = await listRatesForCompany(companyId);
      res.json(rows.map(toCompanyRateResponse));
    })
  );

  app.post(
    "/api/companies/:companyId/exchange-rates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireAccess(req, res, companyId))) return;

      const validation = validateRateInput(req.body ?? {});
      if (!validation.ok) return res.status(400).json({ message: validation.message });
      const date = normalizeEffectiveDate(req.body?.effectiveDate);
      if (!date) return res.status(400).json({ message: "effectiveDate is not a valid date" });

      const { baseCurrency, targetCurrency, rate } = validation.value;
      if (await companyRateExists(companyId, baseCurrency, targetCurrency, date)) {
        return res.status(409).json({ message: DUPLICATE_MESSAGE, code: "EXCHANGE_RATE_EXISTS" });
      }
      try {
        const created = await createCompanyRate(companyId, { baseCurrency, targetCurrency, rate, date });
        await recordAudit({
          userId: (req as any).user?.id,
          companyId,
          action: "exchange_rate.create",
          entityType: "exchange_rate",
          entityId: created.id,
          after: { baseCurrency, targetCurrency, rate, date },
          req,
        });
        res.status(201).json(toCompanyRateResponse(created));
      } catch (err) {
        if (isUniqueViolation(err)) {
          return res.status(409).json({ message: DUPLICATE_MESSAGE, code: "EXCHANGE_RATE_EXISTS" });
        }
        throw err;
      }
    })
  );

  // Converter (registered before /:id so "convert" is not read as an id).
  app.get(
    "/api/companies/:companyId/exchange-rates/convert",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { from, to, amount } = req.query as {
        from?: string;
        to?: string;
        amount?: string;
      };

      if (!(await requireAccess(req, res, companyId))) return;
      if (!from || !to || !amount) {
        return res.status(400).json({ message: "from, to, and amount are required" });
      }

      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: "amount must be a positive number" });
      }

      if (from === to) {
        return res.json({
          from,
          to,
          amount: numericAmount,
          convertedAmount: numericAmount,
          rate: 1,
          effectiveDate: new Date().toISOString(),
        });
      }

      // Own rate, then system rate, then the inverse pair (see resolveRate).
      const found = await getLatestRateDetailed(from, to, undefined, companyId);
      if (!found) {
        return res.status(404).json({ message: `No exchange rate found for ${from}/${to}` });
      }
      return res.json({
        from,
        to,
        amount: numericAmount,
        convertedAmount: numericAmount * found.rate,
        rate: found.rate,
        effectiveDate: found.date,
        scope: found.scope,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/exchange-rates/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      if (!(await requireAccess(req, res, companyId))) return;
      const row = await getCompanyRate(companyId, id);
      if (!row) return res.status(404).json({ message: "Exchange rate not found" });
      res.json(toCompanyRateResponse(row));
    })
  );

  app.put(
    "/api/companies/:companyId/exchange-rates/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      if (!(await requireAccess(req, res, companyId))) return;

      const existing = await getCompanyRate(companyId, id);
      if (!existing) return res.status(404).json({ message: "Exchange rate not found" });

      const validation = validateRateInput(req.body ?? {});
      if (!validation.ok) return res.status(400).json({ message: validation.message });
      const date = normalizeEffectiveDate(req.body?.effectiveDate ?? existing.date);
      if (!date) return res.status(400).json({ message: "effectiveDate is not a valid date" });

      const { baseCurrency, targetCurrency, rate } = validation.value;
      if (await companyRateExists(companyId, baseCurrency, targetCurrency, date, id)) {
        return res.status(409).json({ message: DUPLICATE_MESSAGE, code: "EXCHANGE_RATE_EXISTS" });
      }
      try {
        const updated = await updateCompanyRate(companyId, id, { baseCurrency, targetCurrency, rate, date });
        if (!updated) return res.status(404).json({ message: "Exchange rate not found" });
        await recordAudit({
          userId: (req as any).user?.id,
          companyId,
          action: "exchange_rate.update",
          entityType: "exchange_rate",
          entityId: id,
          before: { baseCurrency: existing.baseCurrency, targetCurrency: existing.targetCurrency, rate: existing.rate },
          after: { baseCurrency, targetCurrency, rate, date },
          req,
        });
        res.json(toCompanyRateResponse(updated));
      } catch (err) {
        if (isUniqueViolation(err)) {
          return res.status(409).json({ message: DUPLICATE_MESSAGE, code: "EXCHANGE_RATE_EXISTS" });
        }
        throw err;
      }
    })
  );

  app.delete(
    "/api/companies/:companyId/exchange-rates/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      if (!(await requireAccess(req, res, companyId))) return;
      const existing = await getCompanyRate(companyId, id);
      if (!existing) return res.status(404).json({ message: "Exchange rate not found" });
      await deleteCompanyRate(companyId, id);
      await recordAudit({
        userId: (req as any).user?.id,
        companyId,
        action: "exchange_rate.delete",
        entityType: "exchange_rate",
        entityId: id,
        before: { baseCurrency: existing.baseCurrency, targetCurrency: existing.targetCurrency, rate: existing.rate },
        req,
      });
      res.json({ deleted: true });
    })
  );

  // ─────────────────────────────────────────────
  // GET /api/exchange-rates?base=AED&target=USD&asOf=2025-01-01
  // Company-less: SYSTEM rates only (1 base = rate target). A company's own
  // rates are reachable only through /api/companies/:companyId/exchange-rates.
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
        const asOfDate = asOf ? new Date(asOf) : undefined;
        if (asOfDate && Number.isNaN(asOfDate.getTime())) {
          return res.status(400).json({ message: "asOf is not a valid date" });
        }
        const rate = await getLatestRate(base, target, asOfDate, null);
        if (rate === null) {
          return res.status(404).json({
            message: `No exchange rate found for ${base}/${target}`,
          });
        }
        return res.json({ baseCurrency: base, targetCurrency: target, rate });
      }

      // All latest system rates with this base (one per target currency)
      const allRates = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.baseCurrency, base),
            eq(exchangeRates.isTrusted, true),
            sql`${exchangeRates.companyId} IS NULL`
          )
        )
        .orderBy(desc(exchangeRates.date));

      const seen = new Set<string>();
      const latest = allRates.filter((r: ExchangeRate) => {
        if (seen.has(r.targetCurrency)) return false;
        seen.add(r.targetCurrency);
        return true;
      });

      res.json(latest);
    })
  );

  // ─────────────────────────────────────────────
  // POST /api/exchange-rates/fta/bulk  (platform admin only)
  // Body: { baseCurrency?, rates: [{ targetCurrency, rate, date }] }
  // Feeds SYSTEM rates (company_id NULL, source 'fta'): 1 baseCurrency = rate
  // targetCurrency. This is the only API path that writes system rows; ordinary
  // users and company owners cannot reach it. Duplicates are skipped.
  // ─────────────────────────────────────────────
  app.post(
    "/api/exchange-rates/fta/bulk",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { baseCurrency = "AED", rates } = req.body as {
        baseCurrency?: string;
        rates: Array<{ targetCurrency: string; rate: number; date: string }>;
      };

      if (!Array.isArray(rates) || rates.length === 0) {
        return res.status(400).json({ message: "rates array is required" });
      }

      const valid: Array<{ baseCurrency: string; targetCurrency: string; rate: number; date: Date }> = [];
      const skipped: Array<{ targetCurrency: string; date: string; reason: string }> = [];
      for (const r of rates) {
        const date = normalizeEffectiveDate(r?.date);
        const check = validateRateInput({ fromCurrency: baseCurrency, toCurrency: r?.targetCurrency, rate: r?.rate });
        if (!r?.date || !date || !check.ok) {
          skipped.push({
            targetCurrency: r?.targetCurrency ?? "?",
            date: r?.date ?? "?",
            reason: check.ok ? "invalid payload" : check.message,
          });
          continue;
        }
        valid.push({ ...check.value, date });
      }

      const result = await importSystemRates(valid);
      res.status(201).json({
        inserted: result.inserted,
        skipped: result.skipped + skipped.length,
        skippedDetails: skipped,
      });
    })
  );

  // ─────────────────────────────────────────────
  // GET /api/exchange-rates/lookup?base=AED&target=USD&asOf=2026-04-01
  // SYSTEM rate for the pair including its source (FTA audit trail).
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
      if (!target || !isIsoCurrencyCode(target) || !isIsoCurrencyCode(base)) {
        return res.status(400).json({ message: "base and target must be valid currency codes" });
      }
      const asOfDate = asOf ? new Date(asOf) : undefined;
      if (asOfDate && Number.isNaN(asOfDate.getTime())) {
        return res.status(400).json({ message: "asOf is not a valid date" });
      }
      const result = await getLatestRateDetailed(base, target, asOfDate, null);
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
    })
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
        .where(and(eq(invoices.companyId, companyId)));

      const foreignInvoices = openInvoices.filter(
        (inv: Invoice) => inv.currency !== "AED" && inv.status !== "paid" && inv.status !== "void"
      );

      const receivables: UnrealizedFxGainLoss[] = [];
      for (const inv of foreignInvoices) {
        // A-B4: canonical convention is AED per 1 unit of foreign currency, so
        // request foreign->AED (NOT AED->foreign) and MULTIPLY, matching the
        // invoice booking path (baseCurrencyAmount = total * exchangeRate).
        const currentRate = await getLatestRate(inv.currency, "AED", asOf, companyId);
        if (currentRate === null) continue;

        const txRate = inv.exchangeRate > 0 ? inv.exchangeRate : 1;
        const foreignTotal = inv.total;

        const { bookValueAed, currentValueAed, unrealizedGainLoss } = revalueForeignBalance({
          foreignAmount: foreignTotal,
          bookRateAedPerUnit: txRate,
          currentRateAedPerUnit: currentRate,
          kind: "receivable",
        });

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
      const allReceipts = await db.select().from(receipts).where(eq(receipts.companyId, companyId));

      const foreignReceipts = allReceipts.filter(
        (r: Receipt) => r.currency && r.currency !== "AED" && !r.posted
      );

      const payables: UnrealizedFxGainLoss[] = [];
      for (const rec of foreignReceipts) {
        const currency = rec.currency!;
        // A-B4: foreign->AED, MULTIPLY (AED per unit of foreign currency).
        const currentRate = await getLatestRate(currency, "AED", asOf, companyId);
        if (currentRate === null) continue;

        const txRate = rec.exchangeRate > 0 ? rec.exchangeRate : 1;
        const foreignAmount = rec.amount ?? 0;

        const { bookValueAed, currentValueAed, unrealizedGainLoss } = revalueForeignBalance({
          foreignAmount,
          bookRateAedPerUnit: txRate,
          currentRateAedPerUnit: currentRate,
          kind: "payable",
        });

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
    })
  );

  // A-B8: post an unrealised FX revaluation of open foreign A/R and A/P as of a
  // date, with an automatic reversing entry the next day (standard period-end
  // practice — the realised result is recognised on settlement instead).
  app.post(
    "/api/companies/:companyId/exchange-rates/revalue",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();
      if (Number.isNaN(asOf.getTime())) {
        return res.status(400).json({ message: "Invalid asOf date" });
      }

      // Net AED revaluation across open foreign receivables (unpaid invoices)…
      let receivableRevalAed = 0;
      const openInvoices = await db.select().from(invoices).where(eq(invoices.companyId, companyId));
      for (const inv of openInvoices) {
        if (inv.currency === "AED" || inv.status === "paid" || inv.status === "void") continue;
        const currentRate = await getLatestRate(inv.currency, "AED", asOf, companyId);
        if (currentRate === null) continue;
        receivableRevalAed += revalueForeignBalance({
          foreignAmount: inv.total,
          bookRateAedPerUnit: inv.exchangeRate > 0 ? inv.exchangeRate : 1,
          currentRateAedPerUnit: currentRate,
          kind: "receivable",
        }).unrealizedGainLoss;
      }
      // …and open foreign payables (unposted receipts).
      let payableRevalAed = 0;
      const openReceipts = await db.select().from(receipts).where(eq(receipts.companyId, companyId));
      for (const rec of openReceipts) {
        if (!rec.currency || rec.currency === "AED" || rec.posted) continue;
        const currentRate = await getLatestRate(rec.currency, "AED", asOf, companyId);
        if (currentRate === null) continue;
        payableRevalAed += revalueForeignBalance({
          foreignAmount: rec.amount ?? 0,
          bookRateAedPerUnit: rec.exchangeRate > 0 ? rec.exchangeRate : 1,
          currentRateAedPerUnit: currentRate,
          kind: "payable",
        }).unrealizedGainLoss;
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      const byCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? null;
      const built = buildFxRevaluationLines({
        receivableRevalAed,
        payableRevalAed,
        accounts: {
          arId: byCode(ACCOUNT_CODES.AR),
          apId: byCode(ACCOUNT_CODES.AP),
          fxGainId: byCode(ACCOUNT_CODES.FX_GAIN),
          fxLossId: byCode(ACCOUNT_CODES.FX_LOSS),
        },
      });
      if (!built.ok) {
        if (built.code === "NO_REVALUATION") {
          return res.json({ posted: false, message: "No open foreign-currency balances to revalue." });
        }
        return res.status(422).json({ message: built.message, code: built.code });
      }

      await assertPeriodNotLocked(companyId, asOf);
      const sourceId = asOf.toISOString().slice(0, 10); // one revaluation per as-of date
      const existing = await storage.getJournalEntriesBySource(companyId, "fx_revaluation", sourceId);
      if (existing.some((e) => e.status === "posted")) {
        return res.json({ posted: false, message: `Revaluation already posted for ${sourceId}.` });
      }

      const revNumber = await storage.generateEntryNumber(companyId, asOf);
      await storage.createJournalEntry(
        {
          companyId,
          date: asOf,
          memo: `Unrealised FX revaluation ${sourceId}`,
          entryNumber: revNumber,
          status: "posted",
          source: "fx_revaluation",
          sourceId,
          createdBy: userId,
          postedBy: userId,
          postedAt: asOf,
        } as any,
        built.lines
      );

      const reversalDate = new Date(asOf.getTime() + 24 * 60 * 60 * 1000);
      await assertPeriodNotLocked(companyId, reversalDate);
      const reversalNumber = await storage.generateEntryNumber(companyId, reversalDate);
      await storage.createJournalEntry(
        {
          companyId,
          date: reversalDate,
          memo: `Reversal of unrealised FX revaluation ${sourceId}`,
          entryNumber: reversalNumber,
          status: "posted",
          source: "fx_revaluation_reversal",
          sourceId,
          createdBy: userId,
          postedBy: userId,
          postedAt: reversalDate,
        } as any,
        built.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          description: `Reversal — ${l.description}`,
        }))
      );

      await recordAudit({
        userId,
        companyId,
        action: "fx.revaluation",
        entityType: "journal_entry",
        entityId: sourceId,
        after: { receivableRevalAed, payableRevalAed },
        req,
      });

      res.json({
        posted: true,
        asOf: sourceId,
        receivableRevalAed: Math.round(receivableRevalAed * 100) / 100,
        payableRevalAed: Math.round(payableRevalAed * 100) / 100,
        netGainLoss: Math.round((receivableRevalAed + payableRevalAed) * 100) / 100,
      });
    })
  );
}
