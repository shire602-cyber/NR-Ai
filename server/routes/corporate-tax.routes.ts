import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { UAE_CT_EXEMPTION_THRESHOLD } from "../constants";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
  buildCtReturnWorkbook,
  buildCtTemplateWorkbook,
  ctReturnExportFilename,
  parseCtWorkbookRows,
} from "../services/ct-workpaper-export.service";
import {
  computeCtComputation,
  computeCtLiability,
  computeCtTotals,
  type CtBridgeAdjustment,
} from "../../shared/ct-workpaper";
import { insertCorporateTaxReturnSchema } from "../../shared/schema";
import { pickAllowed } from "../utils/pick-allowed";
import { pool } from "../db";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  accountTotals,
  aed,
  profitAndLoss,
  readRange,
} from "../reporting";

/** UAE calendar date of a stored timestamp. */
function uaeIsoDate(d: Date): string {
  return new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

/** Posted, non-closing journal entries in [from, to] (UAE dates). */
async function countPeriodEntries(companyId: string, from: string, to: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries je
      WHERE je.company_id = $1 AND je.status = 'posted' AND ${NOT_CLOSING_SQL}
        AND ${ENTRY_LOCAL_DATE_SQL} BETWEEN $2::date AND $3::date`,
    [companyId, from, to]
  );
  return Number(r.rows[0]?.n) || 0;
}

const CT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const CT_IMPORT_MAX_ROWS = 2000;

// Client payloads carry ISO strings; Drizzle timestamp columns want Dates.
function normalizeCtDates<
  T extends { taxPeriodStart?: unknown; taxPeriodEnd?: unknown; filedAt?: unknown },
>(data: T): T {
  const out: any = { ...data };
  if (out.taxPeriodStart) out.taxPeriodStart = new Date(out.taxPeriodStart);
  if (out.taxPeriodEnd) out.taxPeriodEnd = new Date(out.taxPeriodEnd);
  if (out.filedAt) out.filedAt = new Date(out.filedAt);
  return out;
}

export function registerCorporateTaxRoutes(app: Express) {
  // =====================================
  // CORPORATE TAX RETURNS (UAE 9% CT)
  // =====================================

  // List all corporate tax returns for a company
  app.get(
    "/api/companies/:companyId/corporate-tax/returns",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const returns = await storage.getCorporateTaxReturnsByCompanyId(companyId);
      res.json(returns);
    })
  );

  // Get a single corporate tax return
  // Blank workpaper template whose headers round-trip the shared parser.
  app.get(
    "/api/corporate-tax/returns/template",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      const buffer = await buildCtTemplateWorkbook();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="muhasib-ct-workpaper-template.xlsx"'
      );
      res.send(buffer);
    })
  );

  app.get(
    "/api/corporate-tax/returns/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const taxReturn = await storage.getCorporateTaxReturn(id);
      if (!taxReturn) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, taxReturn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(taxReturn);
    })
  );

  // Create a corporate tax return
  app.post(
    "/api/companies/:companyId/corporate-tax/returns",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // CT returns settle tax against periodEnd — block creation when the
      // period is already locked, since the tax provision JE could not post.
      const periodEnd = req.body?.taxPeriodEnd ?? req.body?.periodEnd;
      if (periodEnd) {
        await assertPeriodNotLocked(companyId, periodEnd);
      }

      // S-M1: allowlist body fields (strips id/createdAt/unknown) before the
      // spread into the Drizzle write, then force the tenant scope.
      const taxReturn = await storage.createCorporateTaxReturn(
        normalizeCtDates({
          ...(pickAllowed(req.body, insertCorporateTaxReturnSchema, ["companyId"]) as any),
          companyId,
        }) as any
      );

      res.status(201).json(taxReturn);
    })
  );

  // Compute the full taxable-profit bridge: disallowable add-backs,
  // deductions, small business relief, and loss carryforward pulled from the
  // company's prior return. Persists the schedule on the return so the UI
  // and Excel export show the exact same numbers.
  app.post(
    "/api/corporate-tax/returns/:id/compute",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const ctReturn = await storage.getCorporateTaxReturn(req.params.id);
      if (!ctReturn) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, ctReturn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (ctReturn.status !== "draft") {
        return res.status(400).json({ message: "Only draft returns can be recomputed" });
      }

      const adjustments: CtBridgeAdjustment[] = Array.isArray(req.body?.adjustments)
        ? req.body.adjustments
        : ((ctReturn.workpaper as any)?.adjustments ?? []);
      const smallBusinessReliefElected =
        typeof req.body?.smallBusinessReliefElected === "boolean"
          ? req.body.smallBusinessReliefElected
          : ctReturn.smallBusinessRelief === true;
      const relatedPartyNotes =
        typeof req.body?.relatedPartyNotes === "string"
          ? req.body.relatedPartyNotes
          : ctReturn.relatedPartyNotes;

      // Loss pool: closing carryforward of the latest earlier return.
      const lossBroughtForward = await storage.getCtLossBroughtForward(
        ctReturn.companyId,
        ctReturn.taxPeriodStart,
        ctReturn.id
      );

      // A-B16: Small Business Relief is denied if any prior period breached the
      // AED 3M revenue cap, not just the current one.
      const priorPeriodsExceededRevenueCap = await storage.getCtPriorPeriodRevenueExceededCap(
        ctReturn.companyId,
        ctReturn.taxPeriodStart,
        ctReturn.id
      );

      const computation = computeCtComputation({
        totalRevenue: Number(ctReturn.totalRevenue) || 0,
        totalExpenses: Number(ctReturn.totalExpenses) || 0,
        totalDeductions: Number(ctReturn.totalDeductions) || 0,
        adjustments,
        lossBroughtForward,
        smallBusinessReliefElected,
        priorPeriodsExceededRevenueCap,
        exemptionThreshold: Number(ctReturn.exemptionThreshold) || UAE_CT_EXEMPTION_THRESHOLD,
        taxRate: Number(ctReturn.taxRate) || 0.09,
      });

      const updated = await storage.updateCorporateTaxReturn(ctReturn.id, {
        taxableIncome: computation.taxableIncome,
        taxPayable: computation.taxPayable,
        lossBroughtForward: computation.lossBroughtForward,
        lossCarriedForward: computation.lossCarriedForward,
        smallBusinessRelief: computation.smallBusinessRelief.applied,
        relatedPartyNotes: relatedPartyNotes ?? null,
        workpaper: {
          ...((ctReturn.workpaper as Record<string, unknown>) ?? {}),
          adjustments,
          computation,
          computedAt: new Date().toISOString(),
        },
      } as any);

      res.json({ return: updated, computation });
    })
  );

  // Update a corporate tax return
  app.patch(
    "/api/corporate-tax/returns/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const existing = await storage.getCorporateTaxReturn(id);
      if (!existing) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const periodEnd = req.body?.taxPeriodEnd ?? req.body?.periodEnd;
      if (periodEnd) {
        await assertPeriodNotLocked(existing.companyId, periodEnd);
      }

      // S-M1: allowlist body fields and never let the tenant scope be changed.
      const taxReturn = await storage.updateCorporateTaxReturn(
        id,
        normalizeCtDates(
          pickAllowed(req.body, insertCorporateTaxReturnSchema, ["companyId"]) as any
        ) as any
      );
      res.json(taxReturn);
    })
  );

  // Downloadable Excel copy: workpaper schedule + copy-ready computation.
  app.get(
    "/api/corporate-tax/returns/:id/export",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const ctReturn = await storage.getCorporateTaxReturn(req.params.id);
      if (!ctReturn) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, ctReturn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const company = await storage.getCompany(ctReturn.companyId);
      const buffer = await buildCtReturnWorkbook(ctReturn, company ?? null);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${ctReturnExportFilename(ctReturn, company ?? null)}"`
      );
      res.send(buffer);
    })
  );

  // Import a filled .xlsx workpaper (the template or any sheet with
  // recognisable headers); replaces the workpaper rows and recomputes the
  // return's totals and liability.
  app.post(
    "/api/corporate-tax/returns/:id/import-file",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const ctReturn = await storage.getCorporateTaxReturn(req.params.id);
      if (!ctReturn) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, ctReturn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (ctReturn.status !== "draft") {
        return res.status(400).json({ message: "Only draft returns can be re-imported" });
      }

      const { fileName, fileDataBase64 } = req.body ?? {};
      if (typeof fileName !== "string" || !/\.xlsx$/i.test(fileName)) {
        return res.status(400).json({ message: "Only .xlsx workbooks are supported" });
      }
      if (typeof fileDataBase64 !== "string" || fileDataBase64.length === 0) {
        return res.status(400).json({ message: "Workbook payload is required" });
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(fileDataBase64, "base64");
      } catch {
        return res.status(400).json({ message: "Workbook payload is not valid base64" });
      }
      if (buffer.length === 0 || buffer.length > CT_IMPORT_MAX_BYTES) {
        return res.status(400).json({ message: "Workbook must be between 1 byte and 10 MB" });
      }

      let rows;
      try {
        rows = await parseCtWorkbookRows(buffer);
      } catch {
        return res
          .status(400)
          .json({ message: "Could not read the workbook — is it a valid .xlsx file?" });
      }
      if (rows.length === 0) {
        return res.status(400).json({ message: "No workpaper rows recognised in the workbook" });
      }
      if (rows.length > CT_IMPORT_MAX_ROWS) {
        return res
          .status(400)
          .json({ message: `Workbook has too many rows (max ${CT_IMPORT_MAX_ROWS})` });
      }

      const totals = computeCtTotals(rows);
      const liability = computeCtLiability({
        ...totals,
        totalDeductions: Number(ctReturn.totalDeductions ?? 0),
        exemptionThreshold: Number(ctReturn.exemptionThreshold ?? UAE_CT_EXEMPTION_THRESHOLD),
        taxRate: Number(ctReturn.taxRate ?? 0.09),
      });

      const updated = await storage.updateCorporateTaxReturn(ctReturn.id, {
        workpaper: {
          source: "manual_workpaper",
          rows,
          ...totals,
          preparedAt: new Date().toISOString(),
        },
        totalRevenue: totals.totalRevenue,
        totalExpenses: totals.totalExpenses,
        taxableIncome: liability.taxableIncome,
        taxPayable: liability.taxPayable,
      });

      res.json({ ...updated, imported: rows.length });
    })
  );

  // Populate the workpaper from the books: one row per income/expense account
  // with its posted net for the tax period. Replaces the previous workpaper.
  app.post(
    "/api/corporate-tax/returns/:id/pull-from-books",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const ctReturn = await storage.getCorporateTaxReturn(req.params.id);
      if (!ctReturn) {
        return res.status(404).json({ message: "Corporate tax return not found" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, ctReturn.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (ctReturn.status !== "draft") {
        return res
          .status(400)
          .json({ message: "Only draft returns can be repopulated from the books" });
      }

      // R08-02: posted, non-closing ledger activity only (reporting kernel).
      const startIso = uaeIsoDate(new Date(ctReturn.taxPeriodStart));
      const endIso = uaeIsoDate(new Date(ctReturn.taxPeriodEnd));
      const allAccounts = await storage.getAccountsByCompanyId(ctReturn.companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));
      const ledger = await accountTotals(ctReturn.companyId, { from: startIso, to: endIso });
      const netByAccount = new Map<string, number>();
      for (const [accountId, t] of Array.from(ledger.entries())) {
        const account = accountMap.get(accountId);
        if (!account || (account.type !== "income" && account.type !== "expense")) continue;
        const fils = account.type === "income" ? t.credit - t.debit : t.debit - t.credit;
        netByAccount.set(accountId, aed(fils));
      }
      const periodEntries = {
        length: await countPeriodEntries(ctReturn.companyId, startIso, endIso),
      };

      const rows = [...netByAccount.entries()]
        .map(([accountId, amount]) => {
          const account = accountMap.get(accountId)!;
          return {
            id: `books-${accountId}`,
            type: (account.type === "income" ? "revenue" : "expense") as "revenue" | "expense",
            label: account.nameEn,
            amount,
            notes: `Posted net for ${account.code ?? ""}`.trim(),
          };
        })
        .filter((row) => row.amount !== 0)
        .sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === "revenue" ? -1 : 1));

      const totals = computeCtTotals(rows);
      const liability = computeCtLiability({
        ...totals,
        totalDeductions: Number(ctReturn.totalDeductions ?? 0),
        exemptionThreshold: Number(ctReturn.exemptionThreshold ?? UAE_CT_EXEMPTION_THRESHOLD),
        taxRate: Number(ctReturn.taxRate ?? 0.09),
      });

      const updated = await storage.updateCorporateTaxReturn(ctReturn.id, {
        workpaper: {
          source: "journal_calculation",
          rows,
          ...totals,
          preparedAt: new Date().toISOString(),
        },
        totalRevenue: totals.totalRevenue,
        totalExpenses: totals.totalExpenses,
        taxableIncome: liability.taxableIncome,
        taxPayable: liability.taxPayable,
      });

      res.json({ ...updated, rows: rows.length, entriesProcessed: periodEntries.length });
    })
  );

  // Auto-calculate corporate tax for a period from journal entries
  app.get(
    "/api/companies/:companyId/corporate-tax/calculate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;
      // R12-05: accept periodStart/periodEnd, from/to or startDate/endDate.
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      if (!(req.query.periodEnd ?? req.query.to ?? req.query.endDate)) {
        return res.status(400).json({
          message: "periodStart and periodEnd query parameters are required",
          code: "REPORT_RANGE_REQUIRED",
        });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const startDate = new Date(`${range.from}T00:00:00.000Z`);
      const endDate = new Date(`${range.to}T00:00:00.000Z`);

      // R08-02: the ledger P&L from the reporting kernel — posted entries only,
      // closing / year-end entries excluded, so a close never zeroes the tax.
      const pl = await profitAndLoss({ companyId, from: range.from, to: range.to });
      let totalRevenue = pl.totalIncome;
      let totalExpenses = pl.totalExpenses;
      const periodEntries = { length: await countPeriodEntries(companyId, range.from!, range.to) };

      // Ensure non-negative values
      totalRevenue = Math.max(0, totalRevenue);
      totalExpenses = Math.max(0, totalExpenses);

      // A-B7: use the shared calculator instead of an inline formula so the
      // preview matches the import/export/filing paths exactly.
      const totalDeductions = 0; // User can adjust this on the frontend
      const liability = computeCtLiability({
        totalRevenue,
        totalExpenses,
        totalDeductions,
        exemptionThreshold: UAE_CT_EXEMPTION_THRESHOLD,
        taxRate: 0.09,
      });

      // Small Business Relief (Ministerial Decision 73 of 2023). A resident
      // taxable person with revenue at or below AED 3,000,000 in the tax period
      // — and in every prior period since 1 June 2023 — may ELECT to be treated
      // as having no taxable income, i.e. 0% corporate tax.
      //
      // It is an election, not an automatic exemption: the business chooses it
      // on the return, and electing forfeits the use of tax losses and certain
      // reliefs. So we surface eligibility and BOTH outcomes, and let the user
      // decide. `sbrElected=true` on the query applies it.
      //
      // This matters commercially: the overwhelming majority of UAE SMEs sit
      // under the threshold, and none of the mainstream competitors model it.
      const SBR_REVENUE_CAP = 3_000_000;
      const sbrEligible = totalRevenue <= SBR_REVENUE_CAP;
      const sbrElected = String(req.query.sbrElected ?? "").toLowerCase() === "true";
      const sbrApplied = sbrEligible && sbrElected;

      res.json({
        periodStart: startDate.toISOString(),
        periodEnd: endDate.toISOString(),
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        grossProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        totalDeductions,
        taxableIncome: liability.taxableIncome,
        exemptionThreshold: liability.exemptionThreshold,
        taxableAmount: sbrApplied ? 0 : liability.taxableAmount,
        taxRate: sbrApplied ? 0 : liability.taxRate,
        taxPayable: sbrApplied ? 0 : liability.taxPayable,
        smallBusinessRelief: {
          eligible: sbrEligible,
          elected: sbrElected,
          applied: sbrApplied,
          revenueCap: SBR_REVENUE_CAP,
          taxPayableWithRelief: 0,
          taxPayableWithoutRelief: liability.taxPayable,
          note: sbrEligible
            ? "Revenue is at or below AED 3,000,000, so Small Business Relief may be elected (Ministerial Decision 73 of 2023). Electing treats taxable income as nil, but forfeits the use of tax losses for the period. Eligibility also requires revenue to have stayed below the cap in every prior period since 1 June 2023 — confirm your history before electing."
            : "Revenue exceeds AED 3,000,000, so Small Business Relief is not available for this period.",
        },
        journalEntriesProcessed: periodEntries.length,
      });
    })
  );
}
