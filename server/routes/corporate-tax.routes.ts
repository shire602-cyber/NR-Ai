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

      const taxReturn = await storage.createCorporateTaxReturn(
        normalizeCtDates({
          ...req.body,
          companyId,
        })
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

      const computation = computeCtComputation({
        totalRevenue: Number(ctReturn.totalRevenue) || 0,
        totalExpenses: Number(ctReturn.totalExpenses) || 0,
        totalDeductions: Number(ctReturn.totalDeductions) || 0,
        adjustments,
        lossBroughtForward,
        smallBusinessReliefElected,
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

      const taxReturn = await storage.updateCorporateTaxReturn(id, normalizeCtDates(req.body));
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

      const startDate = new Date(ctReturn.taxPeriodStart);
      const endDate = new Date(ctReturn.taxPeriodEnd);

      const allAccounts = await storage.getAccountsByCompanyId(ctReturn.companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

      const journalEntries = await storage.getJournalEntriesByCompanyId(ctReturn.companyId);
      const periodEntries = journalEntries.filter((entry) => {
        const entryDate = new Date(entry.date);
        return entryDate >= startDate && entryDate <= endDate && entry.status === "posted";
      });

      const netByAccount = new Map<string, number>();
      const periodLines = await storage.getJournalLinesByEntryIds(periodEntries.map((e) => e.id));
      for (const line of periodLines) {
        const account = accountMap.get(line.accountId);
        if (!account || (account.type !== "income" && account.type !== "expense")) continue;
        const net =
          account.type === "income"
            ? (line.credit || 0) - (line.debit || 0)
            : (line.debit || 0) - (line.credit || 0);
        netByAccount.set(line.accountId, (netByAccount.get(line.accountId) ?? 0) + net);
      }

      const rows = [...netByAccount.entries()]
        .map(([accountId, amount]) => {
          const account = accountMap.get(accountId)!;
          return {
            id: `books-${accountId}`,
            type: (account.type === "income" ? "revenue" : "expense") as "revenue" | "expense",
            label: account.nameEn,
            amount: Math.round(amount * 100) / 100,
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
      const { periodStart, periodEnd } = req.query;

      if (!periodStart || !periodEnd) {
        return res
          .status(400)
          .json({ message: "periodStart and periodEnd query parameters are required" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const startDate = new Date(periodStart as string);
      const endDate = new Date(periodEnd as string);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ message: "Invalid date format for periodStart or periodEnd" });
      }

      // Get all accounts for this company to identify revenue vs expense accounts
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

      // Get all journal entries in the period
      const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
      const periodEntries = journalEntries.filter((entry) => {
        const entryDate = new Date(entry.date);
        return entryDate >= startDate && entryDate <= endDate && entry.status === "posted";
      });

      let totalRevenue = 0;
      let totalExpenses = 0;

      // Single batched fetch for all period lines.
      const periodLines = await storage.getJournalLinesByEntryIds(periodEntries.map((e) => e.id));
      for (const line of periodLines) {
        const account = accountMap.get(line.accountId);
        if (!account) continue;

        if (account.type === "income") {
          // Revenue accounts: credit side increases revenue
          totalRevenue += (line.credit || 0) - (line.debit || 0);
        } else if (account.type === "expense") {
          // Expense accounts: debit side increases expenses
          totalExpenses += (line.debit || 0) - (line.credit || 0);
        }
      }

      // Ensure non-negative values
      totalRevenue = Math.max(0, totalRevenue);
      totalExpenses = Math.max(0, totalExpenses);

      const exemptionThreshold = UAE_CT_EXEMPTION_THRESHOLD;
      const taxRate = 0.09;
      const totalDeductions = 0; // User can adjust this on the frontend
      const taxableIncome = totalRevenue - totalExpenses - totalDeductions;
      const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
      const taxPayable = taxableAmount * taxRate;

      res.json({
        periodStart: startDate.toISOString(),
        periodEnd: endDate.toISOString(),
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        grossProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        totalDeductions,
        taxableIncome: Math.round(taxableIncome * 100) / 100,
        exemptionThreshold,
        taxableAmount: Math.round(taxableAmount * 100) / 100,
        taxRate,
        taxPayable: Math.round(taxPayable * 100) / 100,
        journalEntriesProcessed: periodEntries.length,
      });
    })
  );
}
