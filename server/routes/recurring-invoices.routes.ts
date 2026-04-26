import { type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';

const log = createLogger('recurring-invoices');

export function registerRecurringInvoiceRoutes(app: Express) {
  // =====================================
  // Recurring Invoice Routes
  // =====================================

  // List all recurring invoices for a company
  app.get("/api/companies/:companyId/recurring-invoices", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const items = await storage.getRecurringInvoicesByCompanyId(companyId);
    res.json(items);
  }));

  // Get a single recurring invoice
  app.get("/api/recurring-invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const item = await storage.getRecurringInvoice(id);
    if (!item) {
      return res.status(404).json({ message: 'Recurring invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, item.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(item);
  }));

  // Create a recurring invoice
  app.post("/api/companies/:companyId/recurring-invoices", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { customerName, customerTrn, currency, frequency, startDate, endDate, linesJson } = req.body;

    // Validate required fields
    if (!customerName || !frequency || !startDate || !linesJson) {
      return res.status(400).json({ message: 'customerName, frequency, startDate, and linesJson are required' });
    }

    // Validate frequency
    const validFrequencies = ['weekly', 'monthly', 'quarterly', 'yearly'];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ message: 'frequency must be one of: weekly, monthly, quarterly, yearly' });
    }

    // Validate linesJson is valid JSON with at least one line
    try {
      const lines = JSON.parse(typeof linesJson === 'string' ? linesJson : JSON.stringify(linesJson));
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'linesJson must contain at least one line item' });
      }
    } catch {
      return res.status(400).json({ message: 'linesJson must be valid JSON' });
    }

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = endDate ? new Date(endDate) : null;

    const item = await storage.createRecurringInvoice({
      companyId,
      customerName,
      customerTrn: customerTrn || null,
      currency: currency || 'AED',
      frequency,
      startDate: parsedStartDate,
      nextRunDate: parsedStartDate,
      endDate: parsedEndDate,
      linesJson: typeof linesJson === 'string' ? linesJson : JSON.stringify(linesJson),
      isActive: true,
      lastGeneratedInvoiceId: null,
      totalGenerated: 0,
    });

    log.info({ id: item.id, companyId }, 'Created recurring invoice');
    res.json(item);
  }));

  // Update a recurring invoice
  app.patch("/api/recurring-invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await storage.getRecurringInvoice(id);
    if (!existing) {
      return res.status(404).json({ message: 'Recurring invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { customerName, customerTrn, currency, frequency, startDate, nextRunDate, endDate, linesJson } = req.body;

    // Validate frequency if provided
    if (frequency) {
      const validFrequencies = ['weekly', 'monthly', 'quarterly', 'yearly'];
      if (!validFrequencies.includes(frequency)) {
        return res.status(400).json({ message: 'frequency must be one of: weekly, monthly, quarterly, yearly' });
      }
    }

    const updateData: any = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerTrn !== undefined) updateData.customerTrn = customerTrn;
    if (currency !== undefined) updateData.currency = currency;
    if (frequency !== undefined) updateData.frequency = frequency;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (nextRunDate !== undefined) updateData.nextRunDate = new Date(nextRunDate);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (linesJson !== undefined) updateData.linesJson = typeof linesJson === 'string' ? linesJson : JSON.stringify(linesJson);

    const item = await storage.updateRecurringInvoice(id, updateData);
    log.info({ id }, 'Updated recurring invoice');
    res.json(item);
  }));

  // Toggle active status
  app.patch("/api/recurring-invoices/:id/toggle", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await storage.getRecurringInvoice(id);
    if (!existing) {
      return res.status(404).json({ message: 'Recurring invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const item = await storage.updateRecurringInvoice(id, {
      isActive: !existing.isActive,
    });

    log.info({ id, isActive: item.isActive }, 'Toggled recurring invoice');
    res.json(item);
  }));

  // Delete a recurring invoice
  app.delete("/api/recurring-invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const existing = await storage.getRecurringInvoice(id);
    if (!existing) {
      return res.status(404).json({ message: 'Recurring invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.deleteRecurringInvoice(id);
    log.info({ id }, 'Deleted recurring invoice');
    res.json({ message: 'Recurring invoice deleted successfully' });
  }));
}
