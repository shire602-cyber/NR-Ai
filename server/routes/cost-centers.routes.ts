import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { db } from "../db";
import { journalLines, journalEntries, accounts, costCenters } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "../config/logger";

const logger = createLogger("cost-centers-routes");

export function registerCostCenterRoutes(app: Express) {
  // =====================================
  // Cost Center CRUD Routes
  // =====================================

  // Customer-only: List all cost centers by company (includes hierarchy via parentId)
  app.get(
    "/api/companies/:companyId/cost-centers",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const costCentersList = await storage.getCostCentersByCompanyId(companyId);
      res.json(costCentersList);
    })
  );

  // Customer-only: Get single cost center
  app.get(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const costCenter = await storage.getCostCenter(id);
      if (!costCenter) {
        return res.status(404).json({ message: "Cost center not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, costCenter.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(costCenter);
    })
  );

  // Customer-only: Create cost center
  app.post(
    "/api/companies/:companyId/cost-centers",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const costCenter = await storage.createCostCenter({ ...req.body, companyId });
      logger.info({ costCenterId: costCenter.id, companyId }, "Cost center created");
      res.status(201).json(costCenter);
    })
  );

  // Customer-only: Update cost center
  app.put(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const costCenter = await storage.getCostCenter(id);
      if (!costCenter) {
        return res.status(404).json({ message: "Cost center not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, costCenter.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updated = await storage.updateCostCenter(id, req.body);
      res.json(updated);
    })
  );

  // Customer-only: Delete cost center (only if no journal lines reference it)
  app.delete(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const costCenter = await storage.getCostCenter(id);
      if (!costCenter) {
        return res.status(404).json({ message: "Cost center not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, costCenter.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Check if any journal lines reference this cost center
      const [refCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(journalLines)
        .where(eq(journalLines.costCenterId, id));

      if (refCount && refCount.count > 0) {
        return res.status(400).json({
          message: "Cannot delete cost center: journal lines still reference it",
          journalLineCount: refCount.count,
        });
      }

      await storage.deleteCostCenter(id);
      res.json({ message: "Cost center deleted" });
    })
  );

  // =====================================
  // Cost Center Report Routes
  // =====================================

  // Customer-only: P&L report by cost center
  app.get(
    "/api/companies/:companyId/cost-centers/:id/report",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id: costCenterId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const costCenter = await storage.getCostCenter(costCenterId);
      if (!costCenter) {
        return res.status(404).json({ message: "Cost center not found" });
      }

      if (costCenter.companyId !== companyId) {
        return res.status(403).json({ message: "Cost center does not belong to this company" });
      }

      // Query journal lines allocated to this cost center, joined with accounts for categorization
      const rows = await db
        .select({
          accountId: accounts.id,
          accountCode: accounts.code,
          accountName: accounts.nameEn,
          accountType: accounts.type,
          totalDebit: sql<number>`coalesce(sum(${journalLines.debit}), 0)`,
          totalCredit: sql<number>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(
          and(
            eq(journalLines.costCenterId, costCenterId),
            eq(journalEntries.companyId, companyId),
            eq(journalEntries.status, "posted")
          )
        )
        .groupBy(accounts.id, accounts.code, accounts.nameEn, accounts.type);

      // Categorize into income and expense
      const income: typeof rows = [];
      const expenses: typeof rows = [];
      let totalIncome = 0;
      let totalExpenses = 0;

      for (const row of rows) {
        if (row.accountType === "income") {
          income.push(row);
          // Income accounts: net = credits - debits
          totalIncome += Number(row.totalCredit) - Number(row.totalDebit);
        } else if (row.accountType === "expense") {
          expenses.push(row);
          // Expense accounts: net = debits - credits
          totalExpenses += Number(row.totalDebit) - Number(row.totalCredit);
        }
      }

      res.json({
        costCenter,
        income,
        expenses,
        totalIncome,
        totalExpenses,
        netIncome: totalIncome - totalExpenses,
        allLines: rows,
      });
    })
  );

  // Customer-only: Summary across all cost centers
  app.get(
    "/api/companies/:companyId/cost-centers/summary",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Aggregate debits, credits, and net by cost center
      const rows = await db
        .select({
          costCenterId: costCenters.id,
          costCenterCode: costCenters.code,
          costCenterName: costCenters.name,
          isActive: costCenters.isActive,
          totalDebit: sql<number>`coalesce(sum(${journalLines.debit}), 0)`,
          totalCredit: sql<number>`coalesce(sum(${journalLines.credit}), 0)`,
          netAmount: sql<number>`coalesce(sum(${journalLines.debit}) - sum(${journalLines.credit}), 0)`,
        })
        .from(costCenters)
        .leftJoin(journalLines, eq(journalLines.costCenterId, costCenters.id))
        .leftJoin(
          journalEntries,
          and(eq(journalLines.entryId, journalEntries.id), eq(journalEntries.status, "posted"))
        )
        .where(eq(costCenters.companyId, companyId))
        .groupBy(costCenters.id, costCenters.code, costCenters.name, costCenters.isActive)
        .orderBy(costCenters.code);

      const summary = rows.map((row: (typeof rows)[number]) => ({
        costCenterId: row.costCenterId,
        code: row.costCenterCode,
        name: row.costCenterName,
        isActive: row.isActive,
        totalDebit: Number(row.totalDebit),
        totalCredit: Number(row.totalCredit),
        netAmount: Number(row.netAmount),
      }));

      const grandTotalDebit = summary.reduce(
        (sum: number, r: (typeof summary)[number]) => sum + r.totalDebit,
        0
      );
      const grandTotalCredit = summary.reduce(
        (sum: number, r: (typeof summary)[number]) => sum + r.totalCredit,
        0
      );

      res.json({
        costCenters: summary,
        grandTotalDebit,
        grandTotalCredit,
        grandNetAmount: grandTotalDebit - grandTotalCredit,
      });
    })
  );
}
