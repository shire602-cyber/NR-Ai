import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireFirmAdmin } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { recordAudit } from '../services/audit.service';
import { resolveAccessibleClientIds } from '../services/firm-command-center.service';
import {
  addVatWorkpaperRow,
  createVatWorkpaper,
  generateVatReturnFromWorkpaper,
  getVatWorkpaperDetail,
  listVatWorkpapers,
  recalculateVatWorkpaper,
  scanVatWorkpaperEvidence,
  updateVatWorkpaperRow,
  updateVatWorkpaperStatus,
  VAT_WORKPAPER_CATEGORIES,
  type VatWorkpaperCategory,
} from '../services/firm-vat-workspace.service';

const logger = createLogger('firm-vat-workspace-routes');

const uuidParamSchema = z.object({ id: z.string().uuid() });
const rowParamSchema = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });

const vatRowSchema = z.object({
  rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES),
  vat201Box: z.string().trim().optional().nullable(),
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  documentDate: z.string().optional().nullable(),
  counterpartyName: z.string().trim().max(255).optional().nullable(),
  counterpartyTrn: z.string().trim().max(32).optional().nullable(),
  emirate: z.string().trim().max(80).optional().nullable(),
  taxableAmount: z.coerce.number().optional().nullable(),
  vatAmount: z.coerce.number().optional().nullable(),
  adjustmentAmount: z.coerce.number().optional().nullable(),
  grossAmount: z.coerce.number().optional().nullable(),
  status: z.enum(['draft', 'approved', 'excluded']).optional(),
  sourceMethod: z.enum(['manual', 'ocr', 'import', 'generated']).optional(),
  sourceDocumentType: z.string().trim().max(80).optional().nullable(),
  sourceDocumentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  auditReason: z.string().trim().max(2000).optional().nullable(),
});

const partialVatRowSchema = vatRowSchema.partial().extend({
  rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES).optional(),
});

const createWorkpaperSchema = z.object({
  companyId: z.string().uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string().optional().nullable(),
  reviewerUserId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const scanSchema = z.object({
  attachment: z.object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    filePath: z.string().trim().max(1000).optional().nullable(),
    extractedText: z.string().max(100000).optional().nullable(),
    extractionJson: z.record(z.string(), z.unknown()).optional(),
  }),
  draftRow: vatRowSchema.extend({
    rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES).default('standard_expense' as VatWorkpaperCategory),
    status: z.enum(['draft']).optional(),
    sourceMethod: z.enum(['ocr']).optional(),
  }),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'in_review', 'ready', 'generated', 'filed', 'locked']),
  reviewerUserId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

async function accessibleClientIdsFor(req: Request): Promise<string[]> {
  const { id: userId, firmRole } = (req as any).user;
  return resolveAccessibleClientIds(userId, firmRole ?? null);
}

async function requireCompanyAccess(req: Request, res: Response, companyId: string): Promise<boolean> {
  const accessible = await accessibleClientIdsFor(req);
  if (!accessible.includes(companyId)) {
    res.status(403).json({ message: 'Access denied to this client' });
    return false;
  }
  return true;
}

async function requireWorkpaperAccess(req: Request, res: Response, workpaperId: string) {
  const detail = await getVatWorkpaperDetail(workpaperId);
  const accessible = await accessibleClientIdsFor(req);
  if (!accessible.includes(detail.workpaper.companyId)) {
    res.status(403).json({ message: 'Access denied to this VAT workpaper' });
    return null;
  }
  return detail;
}

export function registerFirmVatWorkspaceRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware as any);
  router.use(requireFirmAdmin());

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
      const accessible = await accessibleClientIdsFor(req);
      const workpapers = await listVatWorkpapers(accessible, companyId);
      res.json({ workpapers });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = createWorkpaperSchema.parse(req.body);
      if (!(await requireCompanyAccess(req, res, parsed.companyId))) return;

      const workpaper = await createVatWorkpaper({
        ...parsed,
        createdBy: (req as any).user.id,
      });

      await recordAudit({
        userId: (req as any).user?.id,
        companyId: workpaper.companyId,
        action: 'firm_vat_workpaper_create',
        entityType: 'vat_workpaper',
        entityId: workpaper.id,
        after: workpaper,
        req,
      });

      res.status(201).json(workpaper);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;
      res.json(detail);
    }),
  );

  router.post(
    '/:id/rows',
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = vatRowSchema.parse(req.body);
      const row = await addVatWorkpaperRow(parsedParams.data.id, (req as any).user.id, parsed);
      await recordAudit({
        userId: (req as any).user?.id,
        companyId: detail.workpaper.companyId,
        action: 'firm_vat_workpaper_row_create',
        entityType: 'vat_workpaper_row',
        entityId: row.id,
        after: row,
        req,
      });
      res.status(201).json(row);
    }),
  );

  router.patch(
    '/:id/rows/:rowId',
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = rowParamSchema.safeParse(req.params);
      if (!parsedParams.success) return res.status(400).json({ message: 'Invalid VAT workpaper row id' });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = partialVatRowSchema.parse(req.body);
      const row = await updateVatWorkpaperRow(
        parsedParams.data.id,
        parsedParams.data.rowId,
        (req as any).user.id,
        parsed,
      );
      await recordAudit({
        userId: (req as any).user?.id,
        companyId: detail.workpaper.companyId,
        action: 'firm_vat_workpaper_row_update',
        entityType: 'vat_workpaper_row',
        entityId: row.id,
        after: row,
        req,
      });
      res.json(row);
    }),
  );

  router.post(
    '/:id/scan',
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = scanSchema.parse(req.body);
      const result = await scanVatWorkpaperEvidence(
        parsedParams.data.id,
        (req as any).user.id,
        parsed.attachment,
        parsed.draftRow,
      );
      await recordAudit({
        userId: (req as any).user?.id,
        companyId: detail.workpaper.companyId,
        action: 'firm_vat_workpaper_scan_logged',
        entityType: 'vat_workpaper_attachment',
        entityId: result.attachment.id,
        after: result,
        req,
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    '/:id/recalculate',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;
      const result = await recalculateVatWorkpaper(parsed.data.id);
      res.json(result);
    }),
  );

  router.post(
    '/:id/generate-return',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;

      const result = await generateVatReturnFromWorkpaper(parsed.data.id, (req as any).user.id);
      await recordAudit({
        userId: (req as any).user?.id,
        companyId: detail.workpaper.companyId,
        action: 'firm_vat_workpaper_generate_return',
        entityType: 'vat_workpaper',
        entityId: result.workpaper.id,
        after: { generatedVatReturnId: result.vatReturn.id, totals: result.totals },
        req,
      });
      res.json({
        ...result,
        message: 'VAT return generated for review. No FTA submission was performed.',
      });
    }),
  );

  router.patch(
    '/:id/status',
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success) return res.status(400).json({ message: 'Invalid VAT workpaper id' });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = statusSchema.parse(req.body);
      const workpaper = await updateVatWorkpaperStatus(parsedParams.data.id, parsed.status, {
        reviewerUserId: parsed.reviewerUserId,
        notes: parsed.notes,
      });
      await recordAudit({
        userId: (req as any).user?.id,
        companyId: detail.workpaper.companyId,
        action: `firm_vat_workpaper_status_${parsed.status}`,
        entityType: 'vat_workpaper',
        entityId: workpaper.id,
        after: workpaper,
        req,
      });
      res.json(workpaper);
    }),
  );

  app.use('/api/firm/vat-workpapers', router);
  logger.info('Firm VAT workspace routes registered at /api/firm/vat-workpapers/*');
}
