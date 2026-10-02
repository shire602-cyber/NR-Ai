import type { Express, Request, Response } from "express";
import { authMiddleware, adminMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db } from "../db";
import { eq, and, desc, ne, sql } from "drizzle-orm";
import { exchangeRates, journalEntries } from "../../shared/schema";
import { buildFxRevaluationLines } from "../services/financial-statements";
import { computeRevaluation, type RevaluedItem } from "../services/fx-revaluation.service";
import { loadRevaluationItems } from "../services/fx-revaluation.db";
import { withDocumentLock, LOCK_NS } from "../services/document-lock";
import { ACCOUNT_CODES } from "../constants";
import { assertPeriodNotLocked, assertNotFutureDate } from "../services/period-lock.service";
import type {
  UnrealizedFxGainLoss,
  FxGainsLossesReport,
  ExchangeRate,
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
      const { from, to, amount, date } = req.query as {
        from?: string;
        to?: string;
        amount?: string;
        date?: string;
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
      // The rate on file for that day (the screens pass the payment date); today's when none is given.
      let asOf: Date | undefined;
      if (date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "date must be YYYY-MM-DD" });
        asOf = new Date(`${date}T23:59:59.999Z`);
        if (Number.isNaN(asOf.getTime())) return res.status(400).json({ message: "date is not a valid date" });
      }
      const found = await getLatestRateDetailed(from, to, asOf, companyId);
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
  // Unrealised FX gains/losses on the OPEN foreign-currency balances:
  //   receivables = issued invoices with an amount outstanding ON the as-of
  //     date (payments and credit notes dated later do not count);
  //   payables    = approved vendor bills with an amount outstanding on that date.
  // Drafts, void and cancelled documents are excluded, and every figure is on
  // what is still OUTSTANDING, not the document total.
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

      // ?asOf=YYYY-MM-DD reports the position on that day (default: today).
      const asOfParam = typeof req.query.asOf === "string" ? req.query.asOf : "";
      let asOf = new Date();
      if (asOfParam) {
        const requested = new Date(asOfParam);
        if (Number.isNaN(requested.getTime())) {
          return res.status(400).json({ message: "Invalid asOf date" });
        }
        asOf = new Date(`${requested.toISOString().slice(0, 10)}T00:00:00.000Z`);
        assertNotFutureDate(asOf);
      }
      const revalued = computeRevaluation(await loadRevaluationItems(companyId, asOf));

      const toRow = (item: RevaluedItem): UnrealizedFxGainLoss => ({
        entityType: item.kind === "receivable" ? "invoice" : "payable",
        entityId: item.id,
        entityNumber: item.number ?? item.id.slice(0, 8),
        counterparty: item.counterparty ?? "Unknown",
        currency: item.currency,
        foreignAmount: item.outstandingForeign,
        transactionRate: item.bookRate,
        currentRate: item.currentRate,
        bookValueAed: item.bookValueAed,
        currentValueAed: item.currentValueAed,
        unrealizedGainLoss: item.adjustmentAed,
      });
      const receivables = revalued.items.filter((i) => i.kind === "receivable").map(toRow);
      const payables = revalued.items.filter((i) => i.kind === "payable").map(toRow);

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
  // practice - the realised result is recognised on settlement instead).
  //
  //  * Each run recomputes the full unrealised amount on what is outstanding at
  //    the as-of date. Because the previous run is reversed the day after it,
  //    nothing stacks, so no delta against earlier runs is needed.
  //  * Idempotent per company and as-of date: a second request for a date that
  //    already has a revaluation entry is refused 409 REVALUATION_ALREADY_POSTED
  //    (the same convention as the month-end closing entries).
  //  * The entries are system-generated, so source_id stays NULL (it is a uuid
  //    column) and the as-of date lives in the entry date and memo.
  app.post(
    "/api/companies/:companyId/exchange-rates/revalue",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const requested = req.body?.asOf ? new Date(req.body.asOf) : new Date();
      if (Number.isNaN(requested.getTime())) {
        return res.status(400).json({ message: "Invalid asOf date" });
      }
      // The revaluation date is a calendar day (UTC midnight).
      const asOfYmd = requested.toISOString().slice(0, 10);
      const asOf = new Date(`${asOfYmd}T00:00:00.000Z`);
      const reversalDate = new Date(asOf.getTime() + 24 * 60 * 60 * 1000);

      // A future revaluation would book an unrealised result that has not
      // happened yet; a locked period must not be written into (either day).
      assertNotFutureDate(asOf);
      await assertPeriodNotLocked(companyId, asOf);
      await assertPeriodNotLocked(companyId, reversalDate);

      const items = await loadRevaluationItems(companyId, asOf);
      const revalued = computeRevaluation(items);
      if (revalued.skipped.length > 0) {
        const currencies = Array.from(
          new Set(items.filter((i) => revalued.skipped.some((s) => s.id === i.id)).map((i) => i.currency))
        ).sort();
        return res.status(422).json({
          message: `No ${currencies.join(", ")}→AED exchange rate is available on ${asOfYmd}, so those open balances cannot be revalued. Add the rate under Exchange Rates, then run the revaluation again.`,
          code: "NO_EXCHANGE_RATE",
          currencies,
        });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      const byCode = (code: string) => accounts.find((a) => a.code === code)?.id ?? null;
      const built = buildFxRevaluationLines({
        receivableRevalAed: revalued.receivableRevalAed,
        payableRevalAed: revalued.payableRevalAed,
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
        // Name the account: never post to a different one.
        const missing: Record<string, string> = {
          AR_ACCOUNT_MISSING: `Accounts Receivable (${ACCOUNT_CODES.AR})`,
          AP_ACCOUNT_MISSING: `Accounts Payable (${ACCOUNT_CODES.AP})`,
          FX_GAIN_ACCOUNT_MISSING: `Foreign Exchange Gain (${ACCOUNT_CODES.FX_GAIN})`,
          FX_LOSS_ACCOUNT_MISSING: `Foreign Exchange Loss (${ACCOUNT_CODES.FX_LOSS})`,
        };
        const name = missing[built.code];
        return res.status(422).json({
          message: name
            ? `The ${name} account is missing from the chart of accounts, so the revaluation cannot be posted. Add it, then run the revaluation again.`
            : built.message,
          code: built.code,
        });
      }

      const outcome = await withDocumentLock(`${companyId}:${asOfYmd}`, LOCK_NS.FX_REVALUATION, async (tx) => {
        const existing = await tx
          .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.companyId, companyId),
              eq(journalEntries.source, "fx_revaluation"),
              ne(journalEntries.status, "void"),
              sql`${journalEntries.date}::date = ${asOfYmd}::date`
            )
          );
        if (existing.length > 0) return { alreadyPosted: existing[0] };

        const entry = await storage.createJournalEntry(
          {
            companyId,
            date: asOf,
            memo: `Unrealised FX revaluation as of ${asOfYmd}`,
            entryNumber: "PENDING", // assigned inside the transaction
            status: "posted",
            source: "fx_revaluation",
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          } as any,
          built.lines,
          { tx }
        );
        const reversal = await storage.createJournalEntry(
          {
            companyId,
            date: reversalDate,
            memo: `Reversal of unrealised FX revaluation as of ${asOfYmd}`,
            entryNumber: "PENDING",
            status: "posted",
            source: "fx_revaluation_reversal",
            reversedEntryId: entry.id,
            reversalReason: "Automatic reversal of period-end unrealised FX revaluation",
            createdBy: userId,
            postedBy: userId,
            postedAt: new Date(),
          } as any,
          built.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
            description: `Reversal — ${l.description}`,
          })),
          { tx }
        );
        return { entry, reversal };
      });

      if ("alreadyPosted" in outcome) {
        return res.status(409).json({
          message: `An FX revaluation for ${asOfYmd} is already posted (entry ${outcome.alreadyPosted.entryNumber}). Reverse it before running it again.`,
          code: "REVALUATION_ALREADY_POSTED",
          journalEntryId: outcome.alreadyPosted.id,
        });
      }

      await recordAudit({
        userId,
        companyId,
        action: "fx.revaluation",
        entityType: "journal_entry",
        entityId: outcome.entry.id,
        after: {
          asOf: asOfYmd,
          receivableRevalAed: revalued.receivableRevalAed,
          payableRevalAed: revalued.payableRevalAed,
          reversalEntryId: outcome.reversal.id,
        },
        req,
      });

      res.status(201).json({
        posted: true,
        asOf: asOfYmd,
        journalEntryId: outcome.entry.id,
        reversalEntryId: outcome.reversal.id,
        reversalDate: reversalDate.toISOString().slice(0, 10),
        receivableRevalAed: revalued.receivableRevalAed,
        payableRevalAed: revalued.payableRevalAed,
        netGainLoss: Math.round((revalued.receivableRevalAed + revalued.payableRevalAed) * 100) / 100,
        documents: revalued.items.length,
      });
    })
  );
}
