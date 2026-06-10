import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';
import { createLogger } from '../config/logger';

const logger = createLogger('invoice-templates-routes');

export function registerInvoiceTemplateRoutes(app: Express) {
  // =====================================
  // Invoice Template Routes
  // =====================================

  // Customer-only: List templates by company
  app.get('/api/companies/:companyId/invoice-templates', authMiddleware, requireCustomer,
    requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const templates = await storage.getInvoiceTemplatesByCompanyId(companyId);
      res.json(templates);
    }));

  // Customer-only: Get single template
  app.get('/api/invoice-templates/:id', authMiddleware, requireCustomer, requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const template = await storage.getInvoiceTemplate(id);
    if (!template) {
      return res.status(404).json({ message: 'Invoice template not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, template.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(template);
  }));

  // Customer-only: Create template
  app.post('/api/companies/:companyId/invoice-templates', authMiddleware, requireCustomer,
    requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const template = await storage.createInvoiceTemplate({ ...req.body, companyId });

      logger.info({ templateId: template.id, companyId }, 'Invoice template created');
      res.status(201).json(template);
    }));

  // Customer-only: Update template
  app.put('/api/invoice-templates/:id', authMiddleware, requireCustomer, requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const template = await storage.getInvoiceTemplate(id);
    if (!template) {
      return res.status(404).json({ message: 'Invoice template not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, template.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updated = await storage.updateInvoiceTemplate(id, req.body);
    res.json(updated);
  }));

  // Customer-only: Delete template
  app.delete('/api/invoice-templates/:id', authMiddleware, requireCustomer, requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const template = await storage.getInvoiceTemplate(id);
    if (!template) {
      return res.status(404).json({ message: 'Invoice template not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, template.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.deleteInvoiceTemplate(id);
    res.json({ message: 'Invoice template deleted' });
  }));

  // Customer-only: Set template as default
  app.post('/api/invoice-templates/:id/set-default', authMiddleware, requireCustomer, requireFeature('invoiceTemplates'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const template = await storage.getInvoiceTemplate(id);
    if (!template) {
      return res.status(404).json({ message: 'Invoice template not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, template.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Unset any existing default for this company
    const allTemplates = await storage.getInvoiceTemplatesByCompanyId(template.companyId);
    for (const t of allTemplates) {
      if (t.isDefault) {
        await storage.updateInvoiceTemplate(t.id, { isDefault: false });
      }
    }

    // Set this template as default
    const updated = await storage.updateInvoiceTemplate(id, { isDefault: true });

    logger.info({ templateId: id }, 'Invoice template set as default');
    res.json({ ...updated, message: 'Template set as default' });
  }));
}
