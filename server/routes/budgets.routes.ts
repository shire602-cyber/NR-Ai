import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { storage } from '../storage';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { createLogger } from '../config/logger';

const log = createLogger('budgets');

// =====================================
// Zod schemas
// =====================================

const isoDate = z
  .string()
  .min(1, 'Date is required')
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Must be a valid ISO date' });

const budgetPlanCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  fiscalYear: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'string' ? parseInt(v, 10) : v))
    .pipe(z.number().int().min(1900).max(2200)),
  startDate: isoDate,
  endDate: isoDate,
  notes: z.string().max(2000).optional().nullable(),
});

const budgetPlanUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fiscalYear: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'string' ? parseInt(v, 10) : v))
    .pipe(z.number().int().min(1900).max(2200))
    .optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'approved', 'closed']).optional(),
});

const monthAmount = z
  .union([z.string(), z.number()])
  .optional()
  .nullable();

const budgetLineCreateSchema = z.object({
  accountId: z.string().uuid().optional().nullable(),
  category: z.string().min(1, 'Category is required').max(255),
  description: z.string().max(1000).optional().nullable(),
  jan: monthAmount,
  feb: monthAmount,
  mar: monthAmount,
  apr: monthAmount,
  may: monthAmount,
  jun: monthAmount,
  jul: monthAmount,
  aug: monthAmount,
  sep: monthAmount,
  oct: monthAmount,
  nov: monthAmount,
  dec: monthAmount,
});

const budgetLineUpdateSchema = budgetLineCreateSchema.partial();

export function registerBudgetRoutes(app: Express) {
  // =====================================
  // Budget CRUD
  // =====================================

  // List all budget plans for a company
  app.get("/api/companies/:companyId/budget-plans", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT bp.*,
        COALESCE((SELECT SUM(annual_total) FROM budget_lines WHERE budget_id = bp.id), 0) as total_budget
       FROM budget_plans bp
       WHERE bp.company_id = $1
       ORDER BY bp.fiscal_year DESC, bp.created_at DESC`,
      [companyId]
    );
    res.json(result.rows);
  }));

  // Get single budget plan
  app.get("/api/budget-plans/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const result = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = result.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(budget);
  }));

  // Create budget plan
  app.post("/api/companies/:companyId/budget-plans", authMiddleware, requireCustomer, validate({ body: budgetPlanCreateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { name, fiscalYear, startDate, endDate, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO budget_plans (company_id, name, fiscal_year, start_date, end_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [companyId, name, fiscalYear, startDate, endDate, notes || null]
    );

    log.info({ budgetId: result.rows[0].id, companyId }, 'Budget plan created');
    res.json(result.rows[0]);
  }));

  // Update budget plan
  app.patch("/api/budget-plans/:id", authMiddleware, requireCustomer, validate({ body: budgetPlanUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = existing.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { name, fiscalYear, startDate, endDate, notes, status } = req.body;

    const result = await pool.query(
      `UPDATE budget_plans SET
        name = COALESCE($1, name),
        fiscal_year = COALESCE($2, fiscal_year),
        start_date = COALESCE($3, start_date),
        end_date = COALESCE($4, end_date),
        notes = COALESCE($5, notes),
        status = COALESCE($6, status)
       WHERE id = $7
       RETURNING *`,
      [name, fiscalYear, startDate, endDate, notes, status, id]
    );

    log.info({ budgetId: id }, 'Budget plan updated');
    res.json(result.rows[0]);
  }));

  // Delete budget plan (cascades to lines)
  app.delete("/api/budget-plans/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.rows[0].company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await pool.query(`DELETE FROM budget_plans WHERE id = $1`, [id]);
    log.info({ budgetId: id }, 'Budget plan deleted');
    res.json({ message: 'Budget plan deleted successfully' });
  }));

  // =====================================
  // Budget Lines
  // =====================================

  // Get budget lines for a budget
  app.get("/api/budget-plans/:id/lines", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const budgetResult = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (budgetResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = budgetResult.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category, created_at`,
      [id]
    );
    res.json(result.rows);
  }));

  // Add budget line
  app.post("/api/budget-plans/:id/lines", authMiddleware, requireCustomer, validate({ body: budgetLineCreateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const budgetResult = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (budgetResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = budgetResult.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      accountId, category, description,
      jan, feb, mar, apr, may, jun,
      jul, aug, sep, oct, nov, dec
    } = req.body;

    const months = [
      parseFloat(jan || 0), parseFloat(feb || 0), parseFloat(mar || 0),
      parseFloat(apr || 0), parseFloat(may || 0), parseFloat(jun || 0),
      parseFloat(jul || 0), parseFloat(aug || 0), parseFloat(sep || 0),
      parseFloat(oct || 0), parseFloat(nov || 0), parseFloat(dec || 0)
    ];
    const annualTotal = months.reduce((sum, m) => sum + m, 0);

    const result = await pool.query(
      `INSERT INTO budget_lines (budget_id, account_id, category, description, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, annual_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [id, accountId || null, category, description || null, ...months, annualTotal]
    );

    log.info({ budgetLineId: result.rows[0].id, budgetId: id }, 'Budget line added');
    res.json(result.rows[0]);
  }));

  // Update budget line
  app.patch("/api/budget-lines/:id", authMiddleware, requireCustomer, validate({ body: budgetLineUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const lineResult = await pool.query(`SELECT bl.*, bp.company_id FROM budget_lines bl JOIN budget_plans bp ON bl.budget_id = bp.id WHERE bl.id = $1`, [id]);
    if (lineResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget line not found' });
    }

    const line = lineResult.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, line.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      accountId, category, description,
      jan, feb, mar, apr, may, jun,
      jul, aug, sep, oct, nov, dec
    } = req.body;

    // Calculate new annual total from provided or existing values
    const getVal = (newVal: any, existing: string) =>
      newVal !== undefined ? parseFloat(newVal || 0) : parseFloat(existing || '0');

    const newMonths = [
      getVal(jan, line.jan), getVal(feb, line.feb), getVal(mar, line.mar),
      getVal(apr, line.apr), getVal(may, line.may), getVal(jun, line.jun),
      getVal(jul, line.jul), getVal(aug, line.aug), getVal(sep, line.sep),
      getVal(oct, line.oct), getVal(nov, line.nov), getVal(dec, line.dec),
    ];
    const annualTotal = newMonths.reduce((sum, m) => sum + m, 0);

    const result = await pool.query(
      `UPDATE budget_lines SET
        account_id = COALESCE($1, account_id),
        category = COALESCE($2, category),
        description = COALESCE($3, description),
        jan = $4, feb = $5, mar = $6,
        apr = $7, may = $8, jun = $9,
        jul = $10, aug = $11, sep = $12,
        oct = $13, nov = $14, dec = $15,
        annual_total = $16
       WHERE id = $17
       RETURNING *`,
      [accountId, category, description, ...newMonths, annualTotal, id]
    );

    log.info({ budgetLineId: id }, 'Budget line updated');
    res.json(result.rows[0]);
  }));

  // Delete budget line
  app.delete("/api/budget-lines/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const lineResult = await pool.query(`SELECT bl.*, bp.company_id FROM budget_lines bl JOIN budget_plans bp ON bl.budget_id = bp.id WHERE bl.id = $1`, [id]);
    if (lineResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget line not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, lineResult.rows[0].company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await pool.query(`DELETE FROM budget_lines WHERE id = $1`, [id]);
    log.info({ budgetLineId: id }, 'Budget line deleted');
    res.json({ message: 'Budget line deleted successfully' });
  }));

  // =====================================
  // Variance Analysis
  // =====================================

  // Compare budget vs actual from journal entries
  app.get("/api/budget-plans/:id/variance", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const budgetResult = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (budgetResult.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = budgetResult.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get budget lines
    const linesResult = await pool.query(
      `SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category`,
      [id]
    );
    const budgetLines = linesResult.rows;

    // Get actual amounts from journal entries for the budget period
    const companyId = budget.company_id;
    const startDate = new Date(budget.start_date);
    const endDate = new Date(budget.end_date);

    // Get all accounts to map account_id to type
    const allAccounts = await storage.getAccountsByCompanyId(companyId);
    const accountMap = new Map(allAccounts.map(a => [a.id, a]));

    // Get journal entries in the period
    const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
    const periodEntries = journalEntries.filter(entry => {
      const entryDate = new Date(entry.date);
      return entryDate >= startDate && entryDate <= endDate && entry.status === 'posted';
    });

    // Build actual amounts per account per month — fetch all period lines
    // up-front rather than one round-trip per entry.
    const actualsByAccountMonth: Map<string, Map<number, number>> = new Map();
    const entryDateById = new Map(periodEntries.map(e => [e.id, new Date(e.date)]));
    const periodLines = await storage.getJournalLinesByEntryIds(periodEntries.map(e => e.id));

    for (const line of periodLines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;
      const entryDate = entryDateById.get(line.entryId);
      if (!entryDate) continue;
      const month = entryDate.getMonth() + 1;

      const accountId = line.accountId;
      if (!actualsByAccountMonth.has(accountId)) {
        actualsByAccountMonth.set(accountId, new Map());
      }
      const monthMap = actualsByAccountMonth.get(accountId)!;
      const currentVal = monthMap.get(month) || 0;

      // For expense accounts, debit increases; for income, credit increases
      if (account.type === 'expense') {
        monthMap.set(month, currentVal + (line.debit || 0) - (line.credit || 0));
      } else if (account.type === 'income') {
        monthMap.set(month, currentVal + (line.credit || 0) - (line.debit || 0));
      } else {
        // For other account types, use net debit
        monthMap.set(month, currentVal + (line.debit || 0) - (line.credit || 0));
      }
    }

    // Build variance report per budget line
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const varianceLines = budgetLines.map((line: any) => {
      const accountActuals = line.account_id ? actualsByAccountMonth.get(line.account_id) : null;

      const monthlyData: Record<string, { budget: number; actual: number; variance: number; variancePercent: number }> = {};
      let totalBudget = 0;
      let totalActual = 0;

      monthNames.forEach((monthName, idx) => {
        const monthNum = idx + 1;
        const budgetAmt = parseFloat(line[monthName] || '0');
        const actualAmt = accountActuals ? Math.abs(accountActuals.get(monthNum) || 0) : 0;
        const variance = budgetAmt - actualAmt;
        const variancePercent = budgetAmt !== 0 ? ((variance / budgetAmt) * 100) : 0;

        monthlyData[monthName] = {
          budget: Math.round(budgetAmt * 100) / 100,
          actual: Math.round(actualAmt * 100) / 100,
          variance: Math.round(variance * 100) / 100,
          variancePercent: Math.round(variancePercent * 10) / 10,
        };

        totalBudget += budgetAmt;
        totalActual += actualAmt;
      });

      const totalVariance = totalBudget - totalActual;
      const totalVariancePercent = totalBudget !== 0 ? ((totalVariance / totalBudget) * 100) : 0;

      return {
        id: line.id,
        category: line.category,
        description: line.description,
        accountId: line.account_id,
        months: monthlyData,
        totals: {
          budget: Math.round(totalBudget * 100) / 100,
          actual: Math.round(totalActual * 100) / 100,
          variance: Math.round(totalVariance * 100) / 100,
          variancePercent: Math.round(totalVariancePercent * 10) / 10,
        },
      };
    });

    res.json({
      budget: {
        id: budget.id,
        name: budget.name,
        fiscalYear: budget.fiscal_year,
        startDate: budget.start_date,
        endDate: budget.end_date,
        status: budget.status,
      },
      varianceLines,
    });
  }));

  // =====================================
  // Approval
  // =====================================

  // Approve budget
  app.post("/api/budget-plans/:id/approve", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await pool.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Budget not found' });
    }

    const budget = existing.rows[0];
    const hasAccess = await storage.hasCompanyAccess(userId, budget.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (budget.status === 'approved') {
      return res.status(400).json({ message: 'Budget is already approved' });
    }

    const result = await pool.query(
      `UPDATE budget_plans SET status = 'approved' WHERE id = $1 RETURNING *`,
      [id]
    );

    log.info({ budgetId: id }, 'Budget approved');
    res.json(result.rows[0]);
  }));
}
