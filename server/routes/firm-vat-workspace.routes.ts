import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";

import { ValidationError } from "../errors";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { firmContextOf, requireFirmAdmin } from "../middleware/rbac";
import { canPrepareFirmWorkpaper, canReviewFirmWorkpaper } from "../../shared/access";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { resolveAccessibleClientIds } from "../services/firm-command-center.service";
import { requireFirmCompanyMfa } from "../services/security/policy";
import {
  addVatWorkpaperRow,
  addVatWorkpaperRowsBulk,
  bulkUpdateVatWorkpaperRowStatus,
  createVatWorkpaper,
  deleteVatWorkpaperRow,
  postVatWorkpaperRowToLedger,
  pullVatWorkpaperRowsFromBooks,
  generateVatReturnFromWorkpaper,
  getVatWorkpaperDetail,
  listVatWorkpapers,
  normalizeWorkpaperStatus,
  recalculateVatWorkpaper,
  resolveFirmVatWorkpaperListCompanies,
  scanVatWorkpaperEvidence,
  updateVatWorkpaperRow,
  updateVatWorkpaperStatus,
  VAT_WORKPAPER_CATEGORIES,
  type VatWorkpaperCategory,
} from "../services/firm-vat-workspace.service";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import {
  vatWorkpaperBulkStatusBody,
  vatWorkpaperRowBody,
  vatWorkpaperRowPatchBody,
  vatWorkpaperStatusBody,
} from "../../shared/validators/vat";
import {
  buildVatWorkpaperTemplateWorkbook,
  buildVatWorkpaperWorkbook,
  parseVatWorkbookRows,
  vatWorkpaperExportFilename,
} from "../services/vat-workpaper-export.service";

const logger = createLogger("firm-vat-workspace-routes");

const uuidParamSchema = z.object({ id: z.string().guid() });
const rowParamSchema = z.object({ id: z.string().guid(), rowId: z.string().guid() });
const attachmentParamSchema = z.object({ id: z.string().guid(), attachmentId: z.string().guid() });

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
  status: z.enum(["draft", "approved", "excluded"]).optional(),
  sourceMethod: z.enum(["manual", "ocr", "import", "generated"]).optional(),
  sourceDocumentType: z.string().trim().max(80).optional().nullable(),
  sourceDocumentId: z.string().guid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  auditReason: z.string().trim().max(2000).optional().nullable(),
  vatOverrideReason: z.string().trim().max(2000).optional().nullable(),
});

const createWorkpaperSchema = z.object({
  companyId: z.string().guid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string().optional().nullable(),
  reviewerUserId: z.string().guid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const scanSchema = z.object({
  attachment: z.object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    filePath: z.string().trim().max(1000).optional().nullable(),
    fileDataBase64: z.string().max(15_000_000).optional().nullable(),
    extractedText: z.string().max(100000).optional().nullable(),
    extractionJson: z.record(z.string(), z.unknown()).optional(),
  }),
  draftRow: vatRowSchema.extend({
    rowCategory: z
      .enum(VAT_WORKPAPER_CATEGORIES)
      .default("standard_expense" as VatWorkpaperCategory),
    status: z.enum(["draft"]).optional(),
    sourceMethod: z.enum(["ocr"]).optional(),
  }),
});

const VAT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const VAT_IMPORT_MAX_ROWS = 2000;

const importFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileDataBase64: z.string().min(1).max(15_000_000),
  defaultEmirate: z.string().trim().max(40).optional(),
});

const VAT_EVIDENCE_MAX_BYTES = Number(
  process.env.VAT_EVIDENCE_UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024
);
const VAT_EVIDENCE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
  "application/octet-stream",
]);

function sanitizeFileName(fileName: string) {
  const normalized = fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "vat-evidence").slice(0, 140);
}

async function persistEvidenceUpload(attachment: z.infer<typeof scanSchema>["attachment"]) {
  const fileDataBase64 = attachment.fileDataBase64;
  if (!fileDataBase64) {
    const { fileDataBase64: _unused, ...withoutData } = attachment;
    return withoutData;
  }

  if (!VAT_EVIDENCE_MIME_TYPES.has(attachment.mimeType)) {
    throw new ValidationError("Unsupported VAT evidence file type");
  }

  const rawBase64 = fileDataBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(rawBase64, "base64");
  if (buffer.length === 0) throw new ValidationError("VAT evidence upload is empty");
  if (buffer.length > VAT_EVIDENCE_MAX_BYTES)
    throw new ValidationError("VAT evidence upload is too large");

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const datedFolder = new Date().toISOString().slice(0, 10);
  const relativeFolder = path.join("vat-workpapers", datedFolder);
  const absoluteFolder = path.resolve(uploadsRoot, relativeFolder);
  if (!absoluteFolder.startsWith(uploadsRoot + path.sep)) {
    throw new ValidationError("Invalid VAT evidence upload path");
  }

  await fs.mkdir(absoluteFolder, { recursive: true });
  const storedFileName = `${crypto.randomUUID()}-${sanitizeFileName(attachment.fileName)}`;
  const absolutePath = path.resolve(absoluteFolder, storedFileName);
  if (!absolutePath.startsWith(uploadsRoot + path.sep)) {
    throw new ValidationError("Invalid VAT evidence upload path");
  }
  await fs.writeFile(absolutePath, buffer, { flag: "wx" });

  const { fileDataBase64: _unused, ...withoutData } = attachment;
  return {
    ...withoutData,
    filePath: path.posix.join("vat-workpapers", datedFolder, storedFileName),
    extractionJson: {
      ...(withoutData.extractionJson ?? {}),
      uploadedBytes: buffer.length,
      storedAt: new Date().toISOString(),
    },
  };
}

async function resolveEvidencePath(filePath: string | null | undefined) {
  if (!filePath) return null;
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(uploadsRoot, filePath);
  if (absolutePath !== uploadsRoot && !absolutePath.startsWith(uploadsRoot + path.sep)) return null;
  return absolutePath;
}

async function accessibleClientIdsFor(req: Request): Promise<string[]> {
  const { id: userId, firmRole } = req.user!;
  return resolveAccessibleClientIds(userId, firmRole ?? null);
}

async function requireCompanyAccess(
  req: Request,
  res: Response,
  companyId: string
): Promise<boolean> {
  const accessible = await accessibleClientIdsFor(req);
  if (!accessible.includes(companyId)) {
    res.status(403).json({ message: "Access denied to this client" });
    return false;
  }
  return true;
}

async function requireWorkpaperAccess(req: Request, res: Response, workpaperId: string) {
  const detail = await getVatWorkpaperDetail(workpaperId);
  const accessible = await accessibleClientIdsFor(req);
  if (!accessible.includes(detail.workpaper.companyId)) {
    res.status(403).json({ message: "Access denied to this VAT workpaper" });
    return null;
  }
  return detail;
}

export type WorkpaperSide = "prepare" | "review" | null;

/**
 * S4 (W5-D follow-up): which side of the maker-checker a workpaper request
 * needs. Building the workpaper (create, rows, pull/import/scan, row status,
 * recalculate) is the maker side; generating the return is the checker side;
 * status changes are decided per transition (statusSide). Reads need neither.
 */
export function workpaperRequestSide(method: string, path: string): WorkpaperSide {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (/^\/[^/]+\/status\/?$/.test(path)) return null; // decided by the transition
  if (/^\/[^/]+\/generate-return\/?$/.test(path)) return "review";
  return "prepare";
}

/** Draft <-> prepared is the maker side; review, send-back, file and lock the checker side. */
export function statusSide(from: string, to: string): Exclude<WorkpaperSide, null> {
  const current = normalizeWorkpaperStatus(from);
  if (to === "draft" || (to === "prepared" && current === "draft")) return "prepare";
  return "review";
}

function hasWorkpaperSide(res: Response, side: Exclude<WorkpaperSide, null>): boolean {
  const role = firmContextOf(res).role;
  const ok = side === "prepare" ? canPrepareFirmWorkpaper(role) : canReviewFirmWorkpaper(role);
  if (!ok) {
    res.status(403).json({
      message:
        side === "prepare"
          ? "Your firm role cannot prepare VAT workpapers"
          : "Your firm role cannot review, file or lock VAT workpapers",
      code: side === "prepare" ? "FIRM_WORKPAPER_PREPARE_DENIED" : "FIRM_WORKPAPER_REVIEW_DENIED",
      role,
    });
  }
  return ok;
}

export function registerFirmVatWorkspaceRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware);
  router.use(requireFirmAdmin());
  // Maker-checker by firm role (shared/access.ts canPrepare/canReviewFirmWorkpaper).
  router.use((req: Request, res: Response, next) => {
    const side = workpaperRequestSide(req.method, req.path);
    if (side && !hasWorkpaperSide(res, side)) return;
    next();
  });

  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      const accessible = await accessibleClientIdsFor(req);
      const targetIds = await resolveFirmVatWorkpaperListCompanies(accessible, companyId);
      if (!(await requireFirmCompanyMfa(req.user!, res, targetIds))) return;
      const workpapers = await listVatWorkpapers(targetIds);
      res.json({ workpapers });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = createWorkpaperSchema.parse(req.body);
      if (!(await requireCompanyAccess(req, res, parsed.companyId))) return;

      const workpaper = await createVatWorkpaper({
        ...parsed,
        createdBy: req.user!.id,
      });

      await recordAudit({
        userId: req.user?.id,
        companyId: workpaper.companyId,
        action: "firm_vat_workpaper_create",
        entityType: "vat_workpaper",
        entityId: workpaper.id,
        after: workpaper,
        req,
      });

      res.status(201).json(workpaper);
    })
  );

  // Registered before '/:id' so the literal path wins over the uuid matcher.
  router.get(
    "/template",
    asyncHandler(async (_req: Request, res: Response) => {
      const buffer = await buildVatWorkpaperTemplateWorkbook();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="muhasib-vat-workpaper-template.xlsx"'
      );
      res.send(buffer);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;
      res.json(detail);
    })
  );

  router.post(
    "/:id/rows",
    strictBody(vatWorkpaperRowBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = parsedBody<z.output<typeof vatWorkpaperRowBody>>(req);
      const row = await addVatWorkpaperRow(parsedParams.data.id, req.user!.id, parsed);
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_row_create",
        entityType: "vat_workpaper_row",
        entityId: row.id,
        after: row,
        req,
      });
      res.status(201).json(row);
    })
  );

  router.patch(
    "/:id/rows/:rowId",
    strictBody(vatWorkpaperRowPatchBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = rowParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = parsedBody<z.output<typeof vatWorkpaperRowPatchBody>>(req);
      const row = await updateVatWorkpaperRow(
        parsedParams.data.id,
        parsedParams.data.rowId,
        req.user!.id,
        parsed
      );
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_row_update",
        entityType: "vat_workpaper_row",
        entityId: row.id,
        after: row,
        req,
      });
      res.json(row);
    })
  );

  router.delete(
    "/:id/rows/:rowId",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = rowParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const result = await deleteVatWorkpaperRow(parsedParams.data.id, parsedParams.data.rowId);
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_row_delete",
        entityType: "vat_workpaper_row",
        entityId: parsedParams.data.rowId,
        req,
      });
      res.json(result);
    })
  );

  // Post a manual VAT sales row to the general ledger (so it shows up across
  // the books). Idempotent per row; reversed if the row is later deleted.
  router.post(
    "/:id/rows/:rowId/post",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = rowParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const result = await postVatWorkpaperRowToLedger(
        parsedParams.data.id,
        parsedParams.data.rowId,
        req.user!.id
      );
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_row_post",
        entityType: "vat_workpaper_row",
        entityId: parsedParams.data.rowId,
        after: result,
        req,
      });
      res.json(result);
    })
  );

  // Drilldown: VAT 201 line evidence — resolve a workpaper row back to its
  // source invoice/receipt/journal so every box amount is traceable.
  router.get(
    "/:id/rows/:rowId/source",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = rowParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const row = detail.rows.find((r) => r.id === parsedParams.data.rowId);
      if (!row) return res.status(404).json({ message: "Workpaper row not found" });
      if (!row.sourceDocumentType || !row.sourceDocumentId) {
        return res.json({ row, sourceDocumentType: null, document: null });
      }

      // Tenant-scoped fetch: the workpaper's company is the only tenant the
      // row may reference, so a forged sourceDocumentId resolves to nothing.
      const companyId = detail.workpaper.companyId;
      let document: unknown = null;
      if (row.sourceDocumentType === "invoice") {
        document = (await storage.getInvoice(row.sourceDocumentId, companyId)) ?? null;
      } else if (row.sourceDocumentType === "receipt") {
        document = (await storage.getReceipt(row.sourceDocumentId, companyId)) ?? null;
      } else if (row.sourceDocumentType === "journal") {
        document = (await storage.getJournalEntry(row.sourceDocumentId, companyId)) ?? null;
      }

      res.json({ row, sourceDocumentType: row.sourceDocumentType, document });
    })
  );

  router.post(
    "/:id/scan",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = scanSchema.parse(req.body);
      const attachment = await persistEvidenceUpload(parsed.attachment);
      const result = await scanVatWorkpaperEvidence(
        parsedParams.data.id,
        req.user!.id,
        attachment,
        parsed.draftRow
      );
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_scan_logged",
        entityType: "vat_workpaper_attachment",
        entityId: result.attachment.id,
        after: result,
        req,
      });
      res.status(201).json(result);
    })
  );

  router.get(
    "/:id/attachments/:attachmentId/download",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = attachmentParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper attachment id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const attachment = detail.attachments.find(
        (item) => item.id === parsedParams.data.attachmentId
      );
      if (!attachment) return res.status(404).json({ message: "VAT evidence file not found" });

      const absolutePath = await resolveEvidencePath(attachment.filePath);
      if (!absolutePath)
        return res.status(404).json({ message: "VAT evidence file is not stored" });

      try {
        await fs.access(absolutePath);
      } catch {
        return res.status(404).json({ message: "VAT evidence file is missing from storage" });
      }

      res.download(absolutePath, attachment.fileName);
    })
  );

  // Populate the workpaper from the client's books: issued invoices (split
  // standard / zero-rated / exempt) and posted receipts land as draft rows
  // for review. Idempotent — already-pulled documents are skipped.
  router.post(
    "/:id/pull-from-books",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;

      const result = await pullVatWorkpaperRowsFromBooks(parsed.data.id, req.user!.id);

      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_pull_from_books",
        entityType: "vat_workpaper",
        entityId: detail.workpaper.id,
        after: result,
        req,
      });

      res.json(result);
    })
  );

  // Import a filled .xlsx workpaper (the downloadable template or any sheet
  // with recognisable headers). Same parsing rules as the paste box.
  router.post(
    "/:id/import-file",
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = importFileSchema.parse(req.body);
      if (!/\.xlsx$/i.test(parsed.fileName)) {
        return res.status(400).json({ message: "Only .xlsx workbooks are supported" });
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(parsed.fileDataBase64, "base64");
      } catch {
        return res.status(400).json({ message: "Workbook payload is not valid base64" });
      }
      if (buffer.length === 0 || buffer.length > VAT_IMPORT_MAX_BYTES) {
        return res.status(400).json({ message: "Workbook must be between 1 byte and 10 MB" });
      }

      let rows;
      try {
        // R07-09: no default emirate. Rows without one fail validation and are listed.
        rows = await parseVatWorkbookRows(buffer, parsed.defaultEmirate || "");
      } catch {
        return res
          .status(400)
          .json({ message: "Could not read the workbook — is it a valid .xlsx file?" });
      }
      if (rows.length === 0) {
        return res.status(400).json({ message: "No VAT rows recognised in the workbook" });
      }
      if (rows.length > VAT_IMPORT_MAX_ROWS) {
        return res
          .status(400)
          .json({ message: `Workbook has too many rows (max ${VAT_IMPORT_MAX_ROWS})` });
      }

      const created = await addVatWorkpaperRowsBulk(
        parsedParams.data.id,
        req.user!.id,
        rows.map((row) => ({ ...row, auditReason: "Imported from Excel file" }))
      );

      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_import_file",
        entityType: "vat_workpaper",
        entityId: detail.workpaper.id,
        after: { fileName: parsed.fileName, created: created.length },
        req,
      });

      res.status(201).json({ created: created.length });
    })
  );

  // Review queue: approve (or exclude) all draft rows in one action.
  router.post(
    "/:id/rows/bulk-status",
    strictBody(vatWorkpaperBulkStatusBody),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;

      const body = parsedBody<z.output<typeof vatWorkpaperBulkStatusBody>>(req);

      const result = await bulkUpdateVatWorkpaperRowStatus(parsed.data.id, req.user!.id, body);

      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_rows_bulk_status",
        entityType: "vat_workpaper",
        entityId: detail.workpaper.id,
        after: { to: body.to, updated: result.updated },
        req,
      });

      res.json(result);
    })
  );

  // Downloadable Excel copy of the workpaper — the grid the accountant used
  // to keep in a standalone spreadsheet, plus a copy-ready VAT 201 sheet.
  router.get(
    "/:id/export",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;

      const buffer = await buildVatWorkpaperWorkbook(detail);
      const filename = vatWorkpaperExportFilename(detail);

      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_export",
        entityType: "vat_workpaper",
        entityId: detail.workpaper.id,
        req,
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    })
  );

  router.post(
    "/:id/recalculate",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;
      const result = await recalculateVatWorkpaper(parsed.data.id);
      res.json(result);
    })
  );

  router.post(
    "/:id/generate-return",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = uuidParamSchema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsed.data.id);
      if (!detail) return;

      const result = await generateVatReturnFromWorkpaper(parsed.data.id, req.user!.id);
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: "firm_vat_workpaper_generate_return",
        entityType: "vat_workpaper",
        entityId: result.workpaper.id,
        after: { generatedVatReturnId: result.vatReturn.id, totals: result.totals },
        req,
      });
      res.json({
        ...result,
        message: "VAT return generated for review. No FTA submission was performed.",
      });
    })
  );

  router.patch(
    "/:id/status",
    strictBody(vatWorkpaperStatusBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = uuidParamSchema.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const detail = await requireWorkpaperAccess(req, res, parsedParams.data.id);
      if (!detail) return;

      const parsed = parsedBody<z.output<typeof vatWorkpaperStatusBody>>(req);
      if (!hasWorkpaperSide(res, statusSide(detail.workpaper.status, parsed.status))) return;
      // R15-02: maker-checker state machine; the reviewer is always the caller.
      const workpaper = await updateVatWorkpaperStatus(
        parsedParams.data.id,
        parsed.status,
        req.user!.id,
        { notes: parsed.notes, reason: parsed.reason },
        req
      );
      await recordAudit({
        userId: req.user?.id,
        companyId: detail.workpaper.companyId,
        action: `firm_vat_workpaper_status_${parsed.status}`,
        entityType: "vat_workpaper",
        entityId: workpaper.id,
        after: workpaper,
        req,
      });
      res.json(workpaper);
    })
  );

  app.use("/api/firm/vat-workpapers", router);
  logger.info("Firm VAT workspace routes registered at /api/firm/vat-workpapers/*");
}
