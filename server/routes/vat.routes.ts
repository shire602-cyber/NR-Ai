import { recordFiledElsewhere } from "../services/vat-filed-elsewhere.service";
import { currentVatFilingPeriod } from "../services/vat-autopilot.service";
import type { Express, Request, Response } from "express";
import { invalidateVatDueNext } from "../reports/kpis";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { computeVatReturnForPeriod } from "../services/vat-return-compute.service";
import { overlayVatReturns, recordVatFiling } from "../services/vat-filing.service";
import { pool } from "../db";
import { recordAudit } from "../services/audit.service";
import { round2 } from "../services/financial-statements";
import { MIN_MANUAL_EDIT_REASON, editedFigureKeys, mergeManualEdits } from "../services/tax-filing-core";
import {
  assertVatPeriodEnded,
  classifyVatPeriod,
  vatPeriodPreviewMeta,
} from "../services/vat-period-status.service";
import {
  buildGeneratedVatReturnValues,
  evaluateVatReturnPatch,
  stripLegacyVatReturnFields,
  vatReturnPatchSchema,
} from "../services/vat-return-payload.service";
import {
  addVatWorkpaperRow,
  addVatWorkpaperRowsBulk,
  bulkUpdateVatWorkpaperRowStatus,
  createVatWorkpaper,
  deleteVatWorkpaperRow,
  generateVatReturnFromWorkpaper,
  getVatWorkpaperDetail,
  listVatWorkpapers,
  postVatWorkpaperRowToLedger,
  pullVatWorkpaperRowsFromBooks,
  recalculateVatWorkpaper,
  updateVatWorkpaperRow,
  VAT_WORKPAPER_CATEGORIES,
} from "../services/firm-vat-workspace.service";
import {
  buildVatWorkpaperWorkbook,
  vatWorkpaperExportFilename,
} from "../services/vat-workpaper-export.service";

const companyScopedWorkpaperParams = z.object({
  companyId: z.string().uuid(),
  workpaperId: z.string().uuid(),
});

const companyScopedWorkpaperRowParams = companyScopedWorkpaperParams.extend({
  rowId: z.string().uuid(),
});

const vatWorkpaperRowSchema = z.object({
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
  status: z.enum(["draft", "approved", "excluded"]).optional(),
  sourceMethod: z.enum(["manual", "ocr", "import", "generated"]).optional(),
  sourceDocumentType: z.string().trim().max(80).optional().nullable(),
  sourceDocumentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  auditReason: z.string().trim().max(2000).optional().nullable(),
});

const partialVatWorkpaperRowSchema = vatWorkpaperRowSchema.partial().extend({
  rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES).optional(),
});

const createCompanyWorkpaperSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const bulkVatWorkpaperRowsSchema = z.object({
  rows: z.array(vatWorkpaperRowSchema).min(1).max(2000),
});

async function requireCompanyAccess(req: Request, res: Response, companyId: string) {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return null;
  }
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  return userId as string;
}

async function requireCompanyWorkpaperAccess(
  req: Request,
  res: Response,
  companyId: string,
  workpaperId: string
) {
  const userId = await requireCompanyAccess(req, res, companyId);
  if (!userId) return null;
  const detail = await getVatWorkpaperDetail(workpaperId);
  if (detail.workpaper.companyId !== companyId) {
    res.status(404).json({ message: "VAT workpaper not found" });
    return null;
  }
  return { userId, detail };
}

/** The money on a VAT return row (every numeric box and total) plus its period, for the audit trail. */
function vatDraftFigures(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    period: `${new Date(row.periodStart).toISOString().slice(0, 10)}..${new Date(row.periodEnd).toISOString().slice(0, 10)}`,
    status: row.status ?? null,
  };
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" && /^box|vat|total|net|payable|due|refund/i.test(k)) out[k] = v;
  }
  return out;
}

export function registerVATRoutes(app: Express) {
  // =====================================
  // VAT WORKPAPERS
  // =====================================

  app.get(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const workpapers = await listVatWorkpapers([companyId], companyId, { clientOnly: false });
      res.json({ workpapers });
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const parsed = createCompanyWorkpaperSchema.parse(req.body);
      const workpaper = await createVatWorkpaper({
        companyId,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        dueDate: parsed.dueDate ?? null,
        notes: parsed.notes ?? null,
        createdBy: userId,
      });
      res.status(201).json(workpaper);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;
      res.json(result.detail);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = vatWorkpaperRowSchema.parse(req.body);
      const created = await addVatWorkpaperRow(parsedParams.data.workpaperId, result.userId, row);
      res.status(201).json(created);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const parsed = bulkVatWorkpaperRowsSchema.parse(req.body);
      const created = await addVatWorkpaperRowsBulk(
        parsedParams.data.workpaperId,
        result.userId,
        parsed.rows
      );
      res.status(201).json({ created: created.length });
    })
  );

  app.patch(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = partialVatWorkpaperRowSchema.parse(req.body);
      const updated = await updateVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId,
        row
      );
      res.json(updated);
    })
  );

  app.delete(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const deleted = await deleteVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId
      );
      res.json(deleted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId/post",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const posted = await postVatWorkpaperRowToLedger(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId
      );
      res.json(posted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk-status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const body = z
        .object({
          to: z.enum(["approved", "excluded"]),
          rowIds: z.array(z.string().uuid()).max(2000).optional(),
        })
        .parse(req.body);
      const updated = await bulkUpdateVatWorkpaperRowStatus(
        parsedParams.data.workpaperId,
        result.userId,
        body
      );
      res.json(updated);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/pull-from-books",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const pulled = await pullVatWorkpaperRowsFromBooks(parsed.data.workpaperId, result.userId);
      res.json(pulled);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/recalculate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const recalculated = await recalculateVatWorkpaper(parsed.data.workpaperId);
      res.json(recalculated);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const buffer = await buildVatWorkpaperWorkbook(result.detail);
      const filename = vatWorkpaperExportFilename(result.detail);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/generate-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const company = await storage.getCompany(parsed.data.companyId);
      if (!company?.trnVatNumber) {
        return res.status(400).json({
          message:
            "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.",
          code: "NO_TRN",
        });
      }

      const generated = await generateVatReturnFromWorkpaper(
        parsed.data.workpaperId,
        result.userId
      );
      res.json({
        ...generated,
        message: "VAT return generated from approved workpaper rows. No FTA submission was made.",
      });
    })
  );

  // =====================================
  // VAT RETURNS
  // =====================================

  // Get VAT returns by company
  // "Filed outside Muhasib": record a historical period as filed elsewhere (posts nothing, audit-logged, owner / accountant / CFO).
  // Body: { periodStart, periodEnd, filingDate, reference? } (UAE-day strings).
  app.post(
    "/api/companies/:companyId/vat-returns/filed-elsewhere",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const u = (req as any).user;
      const result = await recordFiledElsewhere({
        user: { id: u.id, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null },
        companyId,
        periodStart: req.body?.periodStart,
        periodEnd: req.body?.periodEnd,
        filingDate: req.body?.filingDate,
        reference: req.body?.reference,
        req,
      });
      res.status(201).json(result);
    })
  );

  // The period the VAT Filing page works on: the last ended period not yet filed (Q3 due 28 Oct while it is early October),
  // else the period that contains today. Never a quarter before the company's VAT start day.
  app.get(
    "/api/companies/:companyId/vat-returns/current-period",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const current = await currentVatFilingPeriod(companyId);
      if (!current) return res.status(404).json({ message: "Company not found" });
      res.json(current);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-returns",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      // A filed return reads as the snapshot frozen at filing (never the live row).
      const overlaid = await overlayVatReturns(vatReturns);
      res.json(overlaid.map((r) => stripLegacyVatReturnFields(r)));
    })
  );

  // Generate VAT return (FTA VAT 201 format with emirate breakdown)
  app.post(
    "/api/companies/:companyId/vat-returns/generate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { periodStart, periodEnd } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      // The dashboard's "VAT due next" is cached per company; a generated return changes it.
      invalidateVatDueNext(companyId);

      // Validate the period before doing anything else. A UAE VAT period is a
      // month or a quarter; absurd spans (e.g. 1900-01-01 → 2999-12-31) must be
      // rejected rather than generating a nonsense return with a due date
      // centuries away.
      const startMs = Date.parse(periodStart);
      const endMs = Date.parse(periodEnd);
      if (!periodStart || !periodEnd || Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return res.status(422).json({
          message: "periodStart and periodEnd are required and must be valid dates (YYYY-MM-DD).",
          code: "INVALID_PERIOD",
        });
      }
      if (startMs > endMs) {
        return res.status(422).json({
          message: "periodStart must be on or before periodEnd.",
          code: "INVALID_PERIOD",
        });
      }
      // A quarter is ~92 days; allow up to 366 to cover an annual filing, and
      // reject anything longer as not a real FTA period.
      const spanDays = (endMs - startMs) / 86_400_000;
      if (spanDays > 366) {
        return res.status(422).json({
          message: `A VAT return period cannot exceed one year (got ${Math.round(spanDays)} days). Use a monthly or quarterly period.`,
          code: "PERIOD_TOO_LONG",
        });
      }
      // A period that has not started yet cannot be generated. A period that has
      // started but not ended is allowed as a non-persisted draft preview
      // (isDraftPreview) so accountants can watch the open quarter; it can never
      // be saved, submitted or filed until the period is over.
      const now = new Date();
      const periodClass = classifyVatPeriod(periodStart, periodEnd, now);
      if (periodClass === "future") {
        return res.status(422).json({
          message: "A VAT return period cannot start in the future.",
          code: "PERIOD_IN_FUTURE",
        });
      }
      const previewMeta = vatPeriodPreviewMeta(periodStart, periodEnd, now);

      // Computing a draft return is a READ of the books: it never hits the period lock (locking September must not stop the
      // Q3 return from being prepared). Only a posting is subject to the lock; filing's clearing journal goes through the
      // filing flow (vat-filing.service.ts).

      const { returnValues, metadata } = await computeVatReturnForPeriod({
        companyId,
        userId,
        periodStart,
        periodEnd,
      });
      const startDate = returnValues.periodStart as Date;
      const endDate = returnValues.periodEnd as Date;

      // Open period: compute-only draft preview. Nothing is persisted, so an
      // unfinished period can never be submitted, filed or listed as a return.
      if (periodClass === "open") {
        return res.status(200).json({
          id: null,
          ...returnValues,
          ...previewMeta,
          _metadata: metadata,
        });
      }

      // One return per period: regenerating refreshes the existing draft
      // instead of stacking duplicates (and some production databases carry a
      // unique (company, period) index that hard-rejects a second insert).
      // A submitted/filed return is immutable — refuse to regenerate over it.
      const existingReturns = await storage.getVatReturnsByCompanyId(companyId);
      const samePeriod = existingReturns.find(
        (r) =>
          !r.isAmendment &&
          new Date(r.periodStart).getTime() === startDate.getTime() &&
          new Date(r.periodEnd).getTime() === endDate.getTime()
      );
      if (samePeriod && samePeriod.status !== "draft") {
        return res.status(409).json({
          message: `A ${samePeriod.status} VAT return already exists for this period. Submitted returns cannot be regenerated.`,
          code: "VAT_RETURN_EXISTS",
        });
      }

      const persistVatReturn = (data: any) =>
        samePeriod ? storage.updateVatReturn(samePeriod.id, data) : storage.createVatReturn(data);

      // Regenerating replaces every figure with the books' figures: hand edits are gone with them.
      const vatReturn = await persistVatReturn({ ...returnValues, manualEdits: null });
      // Keep the replaced draft's figures: a regenerated draft used to overwrite the earlier one without a trace.
      await recordAudit({
        userId,
        companyId,
        action: samePeriod ? "vat.draft.regenerate" : "vat.draft.generate",
        entityType: "vat_return",
        entityId: vatReturn.id,
        before: samePeriod ? vatDraftFigures(samePeriod) : null,
        after: vatDraftFigures(vatReturn),
        req,
      });

      // Return with additional metadata for the UI
      res.status(201).json({
        ...stripLegacyVatReturnFields(vatReturn),
        ...previewMeta,
        _metadata: metadata,
      });
    })
  );

  // Submit VAT return
  app.post(
    "/api/vat-returns/:id/submit",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { adjustmentAmount, adjustmentReason, notes, ftaReferenceNumber } = req.body;

      const existing = await storage.getVatReturn(id);
      if (!existing) {
        return res.status(404).json({ message: "VAT return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // A filed return is final: it is never re-submitted or overwritten.
      if (existing.status === "filed") {
        return res.status(409).json({
          message: "This VAT return is already recorded as filed.",
          code: "VAT_RETURN_ALREADY_FILED",
        });
      }

      // A return can only be submitted once its period has ended.
      assertVatPeriodEnded(existing.periodStart as any, existing.periodEnd as any);

      // With an FTA reference this IS the filing record (reference + date +
      // snapshot + period lock + clearing journal), handled by the filing service.
      // Kept on this endpoint for older clients; `filedAt` is now required.
      if (typeof ftaReferenceNumber === "string" && ftaReferenceNumber.trim() !== "") {
        const u = (req as any).user;
        const { filing } = await recordVatFiling({
          user: { id: u.id, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null },
          returnId: id,
          input: { ftaReferenceNumber, filedAt: req.body?.filedAt, notes },
          req,
        });
        const filedReturn = await storage.getVatReturn(id);
        return res.json({
          ...stripLegacyVatReturnFields(filedReturn as any),
          isDraftPreview: false,
          filing: {
            transmittedByMuhasib: false,
            channel: "manual-emaratax",
            id: filing.id,
            snapshotHash: filing.snapshotHash,
            message: `Recorded as filed with FTA reference ${filing.referenceNumber}. Muhasib did not transmit this return; this is your record of a filing you made through the official channel.`,
          },
        });
      }

      // Marking a return submitted posts nothing (the settlement journal is posted by the filing flow), so the period lock
      // is not consulted here.

      // H2 — HONEST FILING STATUS.
      //
      // This application does NOT transmit anything to the FTA. There is no
      // EmaraTax integration. Two distinct things must never be conflated:
      //
      //   "submitted" = internally finalised for review. Nothing was sent
      //                 anywhere. The user still has to file via EmaraTax.
      //   "filed"     = the user has filed through the official channel and
      //                 records the FTA reference, filing date and acknowledgement
      //                 (POST /api/vat-returns/:id/file, or this endpoint with an
      //                 ftaReferenceNumber above). Filing freezes the figures,
      //                 clears the VAT accounts and locks the period.
      const vatReturn = await storage.updateVatReturn(id, {
        status: "submitted",
        adjustmentAmount: adjustmentAmount || 0,
        adjustmentReason: adjustmentReason || null,
        notes: notes || null,
        submittedBy: userId,
        submittedAt: new Date(),
      });

      res.json({
        ...stripLegacyVatReturnFields(vatReturn),
        isDraftPreview: false,
        filing: {
          transmittedByMuhasib: false,
          channel: "none",
          message:
            "Finalised for review. Muhasib does NOT file with the FTA — you must still submit this return through EmaraTax, then record the FTA reference number and filing date here.",
        },
      });
    })
  );

  // Update VAT return (for editing draft returns)
  app.patch(
    "/api/vat-returns/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id } = req.params;

      const existing = await storage.getVatReturn(id);
      if (!existing) {
        return res.status(404).json({ message: "VAT return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Validated body: dates coerced, status enum-checked, amounts numeric.
      // companyId / id / createdBy are dropped by the schema, so the client can
      // never rewrite the tenant scope of a VAT return.
      const parsed = vatReturnPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid VAT return update",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      // Legacy 8-box aliases are no longer client-writable.
      const cleanUpdate = stripLegacyVatReturnFields(parsed.data);

      // The period is immutable, a submitted/filed return keeps its figures,
      // and no non-draft status is allowed before the period has ended.
      const decision = evaluateVatReturnPatch({ existing: existing as any, body: req.body, patch: cleanUpdate });
      if (!decision.ok) {
        return res
          .status(decision.status)
          .json({ message: decision.message, code: decision.code });
      }

      // Every manual edit of a figure needs a written reason, given in the same request
      // (adjustmentReason, at least MIN_MANUAL_EDIT_REASON characters). It is stored in the edit
      // log with the user and the time; filing on the stored figures needs it for every edit.
      const reason =
        typeof (cleanUpdate as any).adjustmentReason === "string" ? (cleanUpdate as any).adjustmentReason.trim() : "";
      const editedKeys = editedFigureKeys(existing as any, cleanUpdate as any);
      if (editedKeys.length > 0 && reason.length < MIN_MANUAL_EDIT_REASON) {
        return res.status(422).json({
          message: `Changing a figure of the return by hand needs a written reason (at least ${MIN_MANUAL_EDIT_REASON} characters): say why the books' figure is being overridden. Nothing was saved.`,
          code: "MANUAL_EDIT_REASON_REQUIRED",
          details: { boxes: editedKeys },
        });
      }

      // Record which boxes were changed by hand: filing recomputes the return from the
      // books and must not silently throw these away (VAT_RETURN_STALE).
      const manualEdits = mergeManualEdits(
        (existing as any).manualEdits ?? null,
        existing as any,
        cleanUpdate as any,
        { userId, reason }
      );
      const patchData: any = { ...cleanUpdate };
      if (manualEdits || (existing as any).manualEdits) patchData.manualEdits = manualEdits;

      // storage.updateVatReturn stamps updatedAt itself.
      const vatReturn = await storage.updateVatReturn(id, patchData);

      res.json(stripLegacyVatReturnFields(vatReturn));
    })
  );
}
