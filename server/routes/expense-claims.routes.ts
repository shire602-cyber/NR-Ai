import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { pool } from '../db';
import { createLogger } from '../config/logger';

const log = createLogger('expense-claims');

export function registerExpenseClaimRoutes(app: Express) {
  // =====================================
  // Expense Claims Routes
  // =====================================

  // List all expense claims for a company (filter by status, submitted_by)
  app.get("/api/companies/:companyId/expense-claims", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { status, submitted_by } = req.query;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let query = 'SELECT * FROM expense_claims WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    if (status && typeof status === 'string') {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (submitted_by && typeof submitted_by === 'string') {
      query += ` AND submitted_by = $${paramIndex}`;
      params.push(submitted_by);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // Get a single expense claim with its items
  app.get("/api/expense-claims/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const itemsResult = await pool.query(
      'SELECT * FROM expense_claim_items WHERE claim_id = $1 ORDER BY expense_date ASC',
      [id]
    );

    res.json({ ...claim, items: itemsResult.rows });
  }));

  // Create a new expense claim with items
  app.post("/api/companies/:companyId/expense-claims", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { title, description, currency, items } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Calculate total from items
    let totalAmount = 0;
    if (items && Array.isArray(items)) {
      totalAmount = items.reduce((sum: number, item: any) => {
        return sum + (parseFloat(item.amount) || 0) + (parseFloat(item.vat_amount) || 0);
      }, 0);
    }

    // Generate claim number
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM expense_claims WHERE company_id = $1',
      [companyId]
    );
    const claimNumber = `EXP-${String(parseInt(countResult.rows[0].count) + 1).padStart(4, '0')}`;

    const claimResult = await pool.query(
      `INSERT INTO expense_claims (company_id, submitted_by, claim_number, title, description, total_amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING *`,
      [companyId, userId, claimNumber, title, description || null, totalAmount, currency || 'AED']
    );

    const claim = claimResult.rows[0];

    // Insert items if provided
    const insertedItems: any[] = [];
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const itemResult = await pool.query(
          `INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount, receipt_url, merchant_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            claim.id,
            item.expense_date,
            item.category,
            item.description,
            item.amount,
            item.vat_amount || 0,
            item.receipt_url || null,
            item.merchant_name || null,
          ]
        );
        insertedItems.push(itemResult.rows[0]);
      }
    }

    log.info({ claimId: claim.id, companyId, claimNumber }, 'Expense claim created');
    res.json({ ...claim, items: insertedItems });
  }));

  // Update an expense claim (only if draft)
  app.patch("/api/expense-claims/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be updated' });
    }

    const { title, description, currency, items } = req.body;

    // Recalculate total if items provided
    let totalAmount = claim.total_amount;
    if (items && Array.isArray(items)) {
      totalAmount = items.reduce((sum: number, item: any) => {
        return sum + (parseFloat(item.amount) || 0) + (parseFloat(item.vat_amount) || 0);
      }, 0);
    }

    const updatedResult = await pool.query(
      `UPDATE expense_claims
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           currency = COALESCE($3, currency),
           total_amount = $4
       WHERE id = $5
       RETURNING *`,
      [title || null, description !== undefined ? description : null, currency || null, totalAmount, id]
    );

    // Replace items if new items provided
    if (items && Array.isArray(items)) {
      await pool.query('DELETE FROM expense_claim_items WHERE claim_id = $1', [id]);

      for (const item of items) {
        await pool.query(
          `INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount, receipt_url, merchant_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            item.expense_date,
            item.category,
            item.description,
            item.amount,
            item.vat_amount || 0,
            item.receipt_url || null,
            item.merchant_name || null,
          ]
        );
      }
    }

    const itemsResult = await pool.query(
      'SELECT * FROM expense_claim_items WHERE claim_id = $1 ORDER BY expense_date ASC',
      [id]
    );

    log.info({ claimId: id }, 'Expense claim updated');
    res.json({ ...updatedResult.rows[0], items: itemsResult.rows });
  }));

  // Delete an expense claim (only if draft)
  app.delete("/api/expense-claims/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be deleted' });
    }

    // Items are deleted via CASCADE
    await pool.query('DELETE FROM expense_claims WHERE id = $1', [id]);

    log.info({ claimId: id }, 'Expense claim deleted');
    res.json({ message: 'Expense claim deleted successfully' });
  }));

  // Submit an expense claim (draft -> submitted)
  app.post("/api/expense-claims/:id/submit", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be submitted' });
    }

    // Verify claim has items
    const itemsCount = await pool.query('SELECT COUNT(*) as count FROM expense_claim_items WHERE claim_id = $1', [id]);
    if (parseInt(itemsCount.rows[0].count) === 0) {
      return res.status(400).json({ message: 'Cannot submit a claim with no expense items' });
    }

    const updatedResult = await pool.query(
      `UPDATE expense_claims
       SET status = 'submitted', submitted_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    log.info({ claimId: id }, 'Expense claim submitted');
    res.json(updatedResult.rows[0]);
  }));

  // Approve an expense claim
  app.post("/api/expense-claims/:id/approve", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'submitted') {
      return res.status(400).json({ message: 'Only submitted claims can be approved' });
    }

    const { review_notes } = req.body;

    const updatedResult = await pool.query(
      `UPDATE expense_claims
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_notes = $2
       WHERE id = $3
       RETURNING *`,
      [userId, review_notes || null, id]
    );

    log.info({ claimId: id, reviewedBy: userId }, 'Expense claim approved');
    res.json(updatedResult.rows[0]);
  }));

  // Reject an expense claim
  app.post("/api/expense-claims/:id/reject", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'submitted') {
      return res.status(400).json({ message: 'Only submitted claims can be rejected' });
    }

    const { review_notes } = req.body;

    if (!review_notes) {
      return res.status(400).json({ message: 'Review notes are required when rejecting a claim' });
    }

    const updatedResult = await pool.query(
      `UPDATE expense_claims
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_notes = $2
       WHERE id = $3
       RETURNING *`,
      [userId, review_notes, id]
    );

    log.info({ claimId: id, reviewedBy: userId }, 'Expense claim rejected');
    res.json(updatedResult.rows[0]);
  }));

  // Mark an expense claim as paid
  app.post("/api/expense-claims/:id/mark-paid", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const claimResult = await pool.query('SELECT * FROM expense_claims WHERE id = $1', [id]);
    if (claimResult.rows.length === 0) {
      return res.status(404).json({ message: 'Expense claim not found' });
    }

    const claim = claimResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, claim.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (claim.status !== 'approved') {
      return res.status(400).json({ message: 'Only approved claims can be marked as paid' });
    }

    const { payment_reference } = req.body;

    const updatedResult = await pool.query(
      `UPDATE expense_claims
       SET status = 'paid', paid_at = NOW(), payment_reference = $1
       WHERE id = $2
       RETURNING *`,
      [payment_reference || null, id]
    );

    log.info({ claimId: id, paymentReference: payment_reference }, 'Expense claim marked as paid');
    res.json(updatedResult.rows[0]);
  }));

  // Summary of expense claims by status for a company
  app.get("/api/companies/:companyId/expense-claims/summary", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const summaryResult = await pool.query(
      `SELECT
         status,
         COUNT(*) as count,
         COALESCE(SUM(total_amount), 0) as total
       FROM expense_claims
       WHERE company_id = $1
       GROUP BY status`,
      [companyId]
    );

    // Also get this month's totals
    const monthResult = await pool.query(
      `SELECT
         status,
         COUNT(*) as count,
         COALESCE(SUM(total_amount), 0) as total
       FROM expense_claims
       WHERE company_id = $1
         AND created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY status`,
      [companyId]
    );

    const summary: Record<string, { count: number; total: number }> = {};
    for (const row of summaryResult.rows) {
      summary[row.status] = { count: parseInt(row.count), total: parseFloat(row.total) };
    }

    const monthSummary: Record<string, { count: number; total: number }> = {};
    for (const row of monthResult.rows) {
      monthSummary[row.status] = { count: parseInt(row.count), total: parseFloat(row.total) };
    }

    res.json({ all: summary, thisMonth: monthSummary });
  }));
}
