import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { storage } from '../storage';
import { pool } from '../db';
import { createLogger } from '../config/logger';
import { assertRetentionExpired } from '../services/retention.service';
import { assertPeriodNotLocked } from '../services/period-lock.service';

const log = createLogger('bill-pay');

// =====================================
// Zod schemas
// =====================================

const billIsoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Must be a valid ISO date' });

const billLineItemSchema = z.object({
  description: z.string().min(1, 'Line description is required').max(500),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit_price: z.union([z.number(), z.string()]),
  vat_rate: z.union([z.number(), z.string()]).optional().nullable(),
  account_id: z.string().uuid().optional().nullable(),
});

const billCreateSchema = z.object({
  vendor_name: z.string().min(1, 'Vendor name is required').max(255),
  vendor_trn: z.string().max(20).optional().nullable(),
  bill_number: z.string().max(64).optional().nullable(),
  bill_date: billIsoDate,
  due_date: billIsoDate.optional().nullable(),
  currency: z.string().length(3).optional(),
  category: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  reverse_charge: z.boolean().optional(),
  line_items: z.array(billLineItemSchema).min(1, 'At least one line item is required'),
});

const billUpdateSchema = z.object({
  vendor_name: z.string().min(1).max(255).optional(),
  vendor_trn: z.string().max(20).optional().nullable(),
  bill_number: z.string().max(64).optional().nullable(),
  bill_date: billIsoDate.optional(),
  due_date: billIsoDate.optional().nullable(),
  currency: z.string().length(3).optional(),
  category: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  line_items: z.array(billLineItemSchema).min(1).optional(),
});

const billPaymentSchema = z.object({
  payment_date: billIsoDate,
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'string' ? Number(v) : v))
    .pipe(z.number().positive('Payment amount must be positive')),
  payment_method: z
    .enum(['bank_transfer', 'cash', 'cheque', 'credit_card', 'other'])
    .optional(),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// Resolve a VAT rate (stored as percent in bill_line_items.vat_rate) honouring
// explicit zero-rated lines. Only treat null/undefined/non-numeric as missing
// and fall back to the UAE standard 5%; explicit 0 must remain 0.
function resolveVatRatePercent(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 5;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5;
}

export function registerBillPayRoutes(app: Express) {
  // =====================================
  // Vendor Bill Routes
  // =====================================

  // List all bills for a company (with filters)
  app.get("/api/companies/:companyId/bills", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = req.user!.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { status, vendor, dateFrom, dateTo } = req.query;

    let query = `
      SELECT * FROM vendor_bills
      WHERE company_id = $1
    `;
    const params: any[] = [companyId];
    let paramIndex = 2;

    if (status && status !== 'all') {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (vendor) {
      query += ` AND vendor_name ILIKE $${paramIndex}`;
      params.push(`%${vendor}%`);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND bill_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND bill_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ` ORDER BY bill_date DESC`;

    const result = await pool.query(query, params);

    // Mark overdue bills
    const now = new Date();
    const bills = result.rows.map((bill: any) => {
      if (
        bill.due_date &&
        new Date(bill.due_date) < now &&
        bill.status !== 'paid' &&
        bill.status !== 'overdue'
      ) {
        return { ...bill, status: 'overdue' };
      }
      return bill;
    });

    res.json(bills);
  }));

  // Get single bill with line items and payments
  app.get("/api/bills/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const billResult = await pool.query(
      'SELECT * FROM vendor_bills WHERE id = $1',
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const linesResult = await pool.query(
      'SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at ASC',
      [id]
    );

    const paymentsResult = await pool.query(
      'SELECT * FROM bill_payments WHERE bill_id = $1 ORDER BY payment_date DESC',
      [id]
    );

    res.json({
      ...bill,
      line_items: linesResult.rows,
      payments: paymentsResult.rows,
    });
  }));

  // Create bill with line items
  app.post("/api/companies/:companyId/bills", authMiddleware, requireCustomer, validate({ body: billCreateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = req.user!.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      vendor_name,
      vendor_trn,
      bill_number,
      bill_date,
      due_date,
      currency,
      category,
      notes,
      attachment_url,
      line_items,
      reverse_charge,
    } = req.body;

    // Bills post a JE on the bill_date once approved — refuse to even draft
    // one inside a closed period.
    await assertPeriodNotLocked(companyId, bill_date);


    // Reverse charge: when the vendor has no TRN (typically a foreign supplier or
    // unregistered domestic supplier), the buyer self-assesses VAT. Auto-flag when
    // not explicitly provided and TRN is absent — gives accountants a default.
    const billReverseCharge = typeof reverse_charge === 'boolean'
      ? reverse_charge
      : !vendor_trn;

    // Calculate totals from line items
    let subtotal = 0;
    let vatAmount = 0;

    for (const line of line_items) {
      const lineAmount = (Number(line.quantity) || 1) * Number(line.unit_price);
      const lineVat = lineAmount * (resolveVatRatePercent(line.vat_rate) / 100);
      subtotal += lineAmount;
      vatAmount += lineVat;
    }

    // For reverse-charge bills the vendor does not charge VAT — the cash payable
    // is just the subtotal. The VAT is still tracked for the VAT return (input
    // and output legs net to zero).
    const totalAmount = billReverseCharge ? subtotal : subtotal + vatAmount;

    const billResult = await pool.query(
      `INSERT INTO vendor_bills (
        company_id, vendor_name, vendor_trn, bill_number, bill_date, due_date,
        currency, subtotal, vat_amount, total_amount, amount_paid, status,
        category, notes, attachment_url, reverse_charge
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        companyId,
        vendor_name,
        vendor_trn || null,
        bill_number || null,
        bill_date,
        due_date || null,
        currency || 'AED',
        subtotal.toFixed(2),
        vatAmount.toFixed(2),
        totalAmount.toFixed(2),
        '0.00',
        'pending',
        category || null,
        notes || null,
        attachment_url || null,
        billReverseCharge,
      ]
    );

    const bill = billResult.rows[0];

    // Create line items
    for (const line of line_items) {
      const lineAmount = (Number(line.quantity) || 1) * Number(line.unit_price);
      await pool.query(
        `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount, account_id, reverse_charge)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          bill.id,
          line.description,
          Number(line.quantity) || 1,
          Number(line.unit_price),
          resolveVatRatePercent(line.vat_rate),
          lineAmount.toFixed(2),
          line.account_id || null,
          billReverseCharge,
        ]
      );
    }

    log.info({ billId: bill.id, companyId }, 'Vendor bill created');
    res.json(bill);
  }));

  // Update bill
  app.patch("/api/bills/:id", authMiddleware, requireCustomer, validate({ body: billUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const billResult = await pool.query(
      'SELECT * FROM vendor_bills WHERE id = $1',
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      vendor_name,
      vendor_trn,
      bill_number,
      bill_date,
      due_date,
      currency,
      category,
      notes,
      attachment_url,
      line_items,
    } = req.body;

    // Block edits that touch a locked period — the existing bill_date and any
    // requested new bill_date must both be outside any closed period.
    await assertPeriodNotLocked(bill.company_id, bill.bill_date);
    if (bill_date) {
      await assertPeriodNotLocked(bill.company_id, bill_date);
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const addUpdate = (field: string, value: any) => {
      if (value !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }
    };

    addUpdate('vendor_name', vendor_name);
    addUpdate('vendor_trn', vendor_trn);
    addUpdate('bill_number', bill_number);
    addUpdate('bill_date', bill_date);
    addUpdate('due_date', due_date);
    addUpdate('currency', currency);
    addUpdate('category', category);
    addUpdate('notes', notes);
    addUpdate('attachment_url', attachment_url);

    // If line_items provided, recalculate totals
    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      let subtotal = 0;
      let vatAmount = 0;

      for (const line of line_items) {
        const lineAmount = (Number(line.quantity) || 1) * Number(line.unit_price);
        const lineVat = lineAmount * (resolveVatRatePercent(line.vat_rate) / 100);
        subtotal += lineAmount;
        vatAmount += lineVat;
      }

      const totalAmount = subtotal + vatAmount;

      addUpdate('subtotal', subtotal.toFixed(2));
      addUpdate('vat_amount', vatAmount.toFixed(2));
      addUpdate('total_amount', totalAmount.toFixed(2));
    }

    if (updates.length === 0 && !line_items) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    let updatedBill = bill;
    if (updates.length > 0) {
      values.push(id);
      const updateResult = await pool.query(
        `UPDATE vendor_bills SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        values
      );
      updatedBill = updateResult.rows[0];
    }

    // Replace line items if provided
    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      await pool.query('DELETE FROM bill_line_items WHERE bill_id = $1', [id]);

      for (const line of line_items) {
        const lineAmount = (Number(line.quantity) || 1) * Number(line.unit_price);
        await pool.query(
          `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount, account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            line.description,
            Number(line.quantity) || 1,
            Number(line.unit_price),
            resolveVatRatePercent(line.vat_rate),
            lineAmount.toFixed(2),
            line.account_id || null,
          ]
        );
      }
    }

    log.info({ billId: id }, 'Vendor bill updated');
    res.json(updatedBill);
  }));

  // Delete bill
  app.delete("/api/bills/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const billResult = await pool.query(
      'SELECT * FROM vendor_bills WHERE id = $1',
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // FTA 5-year retention.
    assertRetentionExpired({ createdAt: bill.created_at, retentionExpiresAt: bill.retention_expires_at }, 'Vendor bill');

    // Cascade delete will handle line_items and payments
    await pool.query('DELETE FROM vendor_bills WHERE id = $1', [id]);

    log.info({ billId: id }, 'Vendor bill deleted');
    res.json({ message: 'Bill deleted successfully' });
  }));

  // Approve bill
  app.post("/api/bills/:id/approve", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const billResult = await pool.query(
      'SELECT * FROM vendor_bills WHERE id = $1',
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (bill.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending bills can be approved' });
    }

    // Approval triggers the AP journal entry on bill_date — block if locked.
    await assertPeriodNotLocked(bill.company_id, bill.bill_date);

    const updateResult = await pool.query(
      `UPDATE vendor_bills
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2 RETURNING *`,
      [userId, id]
    );

    log.info({ billId: id, approvedBy: userId }, 'Vendor bill approved');
    res.json(updateResult.rows[0]);
  }));

  // Record payment against bill
  app.post("/api/bills/:id/payments", authMiddleware, requireCustomer, validate({ body: billPaymentSchema }), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const billResult = await pool.query(
      'SELECT * FROM vendor_bills WHERE id = $1',
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { payment_date, amount, payment_method, reference, notes } = req.body;

    const paymentAmount = amount;

    // Recording a payment posts a cash JE on payment_date — block if locked.
    await assertPeriodNotLocked(bill.company_id, payment_date);

    const currentPaid = Number(bill.amount_paid) || 0;
    const totalAmount = Number(bill.total_amount) || 0;
    const remainingBalance = totalAmount - currentPaid;

    if (paymentAmount > remainingBalance + 0.01) {
      return res.status(400).json({
        message: `Payment amount (${paymentAmount.toFixed(2)}) exceeds remaining balance (${remainingBalance.toFixed(2)})`,
      });
    }

    // Record the payment
    const paymentResult = await pool.query(
      `INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        payment_date,
        paymentAmount.toFixed(2),
        payment_method || 'bank_transfer',
        reference || null,
        notes || null,
      ]
    );

    // Update bill amount_paid and status
    const newAmountPaid = currentPaid + paymentAmount;
    let newStatus: string;

    if (newAmountPaid >= totalAmount - 0.01) {
      newStatus = 'paid';
    } else {
      newStatus = 'partial';
    }

    const paidAt = newStatus === 'paid' ? 'NOW()' : 'paid_at';
    await pool.query(
      `UPDATE vendor_bills
       SET amount_paid = $1, status = $2, paid_at = ${newStatus === 'paid' ? 'NOW()' : 'paid_at'}
       WHERE id = $3`,
      [newAmountPaid.toFixed(2), newStatus, id]
    );

    log.info({ billId: id, paymentId: paymentResult.rows[0].id, amount: paymentAmount, newStatus }, 'Bill payment recorded');
    res.json({
      payment: paymentResult.rows[0],
      bill_status: newStatus,
      amount_paid: newAmountPaid,
      remaining: totalAmount - newAmountPaid,
    });
  }));

  // =====================================
  // Summary & Reports
  // =====================================

  // Bills summary (totals by status)
  app.get("/api/companies/:companyId/bills/summary", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = req.user!.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending'), 0) AS pending_total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0) AS approved_total,
        COUNT(*) FILTER (WHERE status = 'partial') AS partial_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'partial'), 0) AS partial_total,
        COALESCE(SUM(amount_paid) FILTER (WHERE status = 'partial'), 0) AS partial_paid,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS paid_total,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid')) AS overdue_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid')), 0) AS overdue_total
      FROM vendor_bills
      WHERE company_id = $1`,
      [companyId]
    );

    const summary = result.rows[0];

    res.json({
      pending: { count: Number(summary.pending_count), total: Number(summary.pending_total) },
      approved: { count: Number(summary.approved_count), total: Number(summary.approved_total) },
      partial: { count: Number(summary.partial_count), total: Number(summary.partial_total), paid: Number(summary.partial_paid) },
      paid: { count: Number(summary.paid_count), total: Number(summary.paid_total) },
      overdue: { count: Number(summary.overdue_count), total: Number(summary.overdue_total) },
    });
  }));

  // Aging report
  app.get("/api/companies/:companyId/bills/aging", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = req.user!.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date >= NOW() OR due_date IS NULL
        ), 0) AS current_amount,
        COUNT(*) FILTER (
          WHERE due_date >= NOW() OR due_date IS NULL
        ) AS current_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'
        ), 0) AS days_1_30_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'
        ) AS days_1_30_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'
        ), 0) AS days_31_60_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'
        ) AS days_31_60_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'
        ), 0) AS days_61_90_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'
        ) AS days_61_90_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '90 days'
        ), 0) AS days_90_plus_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '90 days'
        ) AS days_90_plus_count
      FROM vendor_bills
      WHERE company_id = $1 AND status NOT IN ('paid')`,
      [companyId]
    );

    const aging = result.rows[0];

    res.json({
      current: { amount: Number(aging.current_amount), count: Number(aging.current_count) },
      days_1_30: { amount: Number(aging.days_1_30_amount), count: Number(aging.days_1_30_count) },
      days_31_60: { amount: Number(aging.days_31_60_amount), count: Number(aging.days_31_60_count) },
      days_61_90: { amount: Number(aging.days_61_90_amount), count: Number(aging.days_61_90_count) },
      days_90_plus: { amount: Number(aging.days_90_plus_amount), count: Number(aging.days_90_plus_count) },
    });
  }));
}
