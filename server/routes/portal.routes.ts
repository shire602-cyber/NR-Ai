import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { zDate, zMoney, zText, zUuid } from "../../shared/validators/primitives";
import { recordAudit } from "../services/audit.service";
import { assertNoServerOwned } from "../http/strict-body";
import { resolve } from "../platform/service-registry";
import { attachmentDisposition, downloadFileName } from "../utils/download-filename";
import {
  addVaultVersion,
  contentDisposition,
  createVaultDocument,
  isMultipart,
  listVaultDocuments,
  listVaultVersions,
  readValidatedUpload,
  readVaultFile,
  restoreVaultVersion,
  softDeleteVaultDocument,
  undeleteVaultDocument,
} from "../services/document-vault.service";
import {
  registerStatementServices,
  renderStatementPdf,
  type CustomerStatementService,
  type Statement,
  type SupplierStatementService,
} from "../services/customer-statement.service";
import {
  emailStatementBody,
  statementQuery,
  type EmailStatementBody,
} from "../../shared/validators/portal";
import { buildStatementEmail, sendEmail } from "../services/email.service";
import { resolveEmailLanguage } from "../services/email-layout";

// ─── Validators (W2-D: R08-10, R16-13, R17-09) ───────────────────────────────

/** "" means "not provided" for optional text inputs sent by the portal forms. */
const optText = (max: number) =>
  z
    .union([z.literal(""), zText(max), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

/**
 * File reference: an https:// URL, or an internal storage key (`/uploads/<name>` or
 * `receipts/<name>`). Never javascript:, data:, file: or protocol-relative URLs.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32) return true;
  return false;
}

const fileRef = z
  .union([z.literal(""), z.string().trim().max(1000), z.null()])
  .transform((v, ctx) => {
    if (v === "" || v === null) return null;
    if (/^https:\/\/[^\s/]+/i.test(v)) {
      try {
        if (new URL(v).protocol === "https:") return v;
      } catch {
        // fall through
      }
    } else if (
      /^\/?(uploads|receipts|documents)\/[^\\]+$/.test(v) &&
      !hasControlChars(v) &&
      !v.split("/").includes("..")
    ) {
      return v;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "File reference must be an https:// URL or an internal storage key",
    });
    return z.NEVER;
  })
  .optional();

const DOC_CATEGORIES = [
  "trade_license",
  "contract",
  "tax_certificate",
  "audit_report",
  "bank_statement",
  "insurance",
  "visa",
  "other",
] as const;

const MAX_DOC_SIZE = 50 * 1024 * 1024; // 50MB

const documentBody = z.object({
  name: zText(255, { min: 1 }).optional(),
  nameAr: optText(255),
  category: z.enum(DOC_CATEGORIES).optional(),
  description: optText(2000),
  fileUrl: fileRef,
  fileName: zText(255, { min: 1 }).optional(),
  fileSize: z.number().int().min(0).max(MAX_DOC_SIZE).optional().nullable(),
  mimeType: z.string().trim().toLowerCase().optional(),
  expiryDate: z
    .union([z.literal(""), zDate, z.null()])
    .transform((v) => (v === "" || v === null ? null : v))
    .optional(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  tags: z
    .union([zText(1000), z.array(zText(50)).max(50)])
    .transform((v) => (Array.isArray(v) ? JSON.stringify(v) : v))
    .optional()
    .nullable(),
});

const RETURN_TYPES = ["vat", "corporate_tax", "excise_tax"] as const;
const PAYMENT_STATUSES = ["paid", "partial", "unpaid"] as const;

const archiveFields = {
  returnType: z.enum(RETURN_TYPES),
  periodLabel: zText(100, { min: 1 }),
  periodStart: zDate,
  periodEnd: zDate,
  filingDate: zDate,
  ftaReferenceNumber: optText(100),
  taxAmount: zMoney.transform((v) => Number(v)),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  fileUrl: fileRef,
  fileName: optText(255),
  notes: optText(2000),
};

function refineArchivePeriod(
  v: { periodStart?: string; periodEnd?: string },
  ctx: z.RefinementCtx
) {
  if (v.periodStart && v.periodEnd && v.periodEnd < v.periodStart) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Period end cannot be before period start",
    });
  }
}

const createArchiveBody = z
  .object({
    ...archiveFields,
    taxAmount: archiveFields.taxAmount.optional(),
    paymentStatus: archiveFields.paymentStatus.optional(),
    returnType: archiveFields.returnType.optional(),
  })
  .superRefine(refineArchivePeriod);
const updateArchiveBody = z.object(archiveFields).partial().superRefine(refineArchivePeriod);

const TASK_CATEGORIES = [
  "vat_filing",
  "corporate_tax",
  "document_upload",
  "payment",
  "review",
  "other",
] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const TASK_STATUSES = ["pending", "in_progress", "completed", "overdue", "cancelled"] as const;

const optDate = z
  .union([z.literal(""), zDate, z.null()])
  .transform((v) => (v === "" || v === null ? null : v))
  .optional();

const createTaskBody = z.object({
  title: zText(255, { min: 1 }),
  titleAr: optText(255),
  description: optText(2000),
  category: z.enum(TASK_CATEGORIES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: zDate,
  reminderDate: optDate,
  isRecurring: z.boolean().optional(),
  recurrencePattern: z
    .union([z.literal(""), z.enum(["monthly", "quarterly", "yearly"]), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional(),
  assignedTo: zUuid.optional().nullable(),
  relatedDocumentId: zUuid.optional().nullable(),
  relatedVatReturnId: zUuid.optional().nullable(),
  notes: optText(2000),
});

const updateTaskBody = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: zDate.optional(),
  notes: optText(2000),
});

const createMessageBody = z.object({
  threadId: zUuid.optional().nullable(),
  /** W4-D (R16-05): set to post in the customer-visible thread of this contact. */
  contactId: zUuid.optional().nullable(),
  subject: optText(255),
  content: zText(10_000, { min: 1 }),
  recipientId: zUuid.optional().nullable(),
  attachmentUrl: fileRef,
  attachmentName: optText(255),
  messageType: z.enum(["general", "inquiry", "update", "urgent"]).optional(),
});

const toDate = (iso: string | null | undefined): Date | null =>
  iso ? new Date(`${iso}T00:00:00.000Z`) : null;

export function registerPortalRoutes(app: Express) {
  registerStatementServices();

  // =====================================
  // CUSTOMER ACTIVITY LOGS (History)
  // =====================================

  // Get activity logs for user's company
  app.get(
    "/api/companies/:companyId/activity-logs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const logs = await storage.getActivityLogsByCompany(companyId, limit);
      res.json(logs);
    })
  );

  // Allowed MIME types for document uploads — checked instead of trusting filename extensions.
  const ALLOWED_DOC_MIME_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
  ];

  // =====================================
  // CLIENT PORTAL - DOCUMENT VAULT (W4-D: R16-09 real storage, versions, soft delete)
  // =====================================

  const vaultDocument = async (req: Request) => {
    const userId = req.user!.id;
    const document = /^[0-9a-f-]{36}$/i.test(req.params.documentId)
      ? await storage.getDocument(req.params.documentId)
      : undefined;
    if (!document || !(await storage.hasCompanyAccess(userId, document.companyId))) {
      throw new DomainError("DOCUMENT_NOT_FOUND", 404, undefined, "Document not found");
    }
    return document;
  };

  // List documents (soft-deleted ones only with ?includeDeleted=true)
  app.get(
    "/api/companies/:companyId/documents",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const contactId =
        typeof req.query.contactId === "string" && /^[0-9a-f-]{36}$/i.test(req.query.contactId)
          ? req.query.contactId
          : undefined;
      res.json(
        await listVaultDocuments(companyId, {
          contactId,
          includeDeleted: req.query.includeDeleted === "true",
        })
      );
    })
  );

  // Upload: multipart/form-data (`file` + metadata fields) or JSON with base64 `fileData`. A JSON
  // body without a file may only reference an external https:// document (stored as a link,
  // never fetched); internal storage keys can no longer be asserted by the client.
  app.post(
    "/api/companies/:companyId/documents",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const jsonBody = (req.body ?? {}) as Record<string, unknown>;
      if (!isMultipart(req) && jsonBody.fileData === undefined) {
        // External link documents (legacy JSON contract, R16-13 validation kept).
        assertNoServerOwned(req.body);
        const body = documentBody.strict().parse(req.body);
        if (!body.fileUrl || !/^https:\/\//i.test(body.fileUrl)) {
          throw new DomainError(
            "UPLOAD_REQUIRED",
            400,
            { field: "fileUrl" },
            "Upload the file (multipart `file` or `fileData`), or link an external https:// URL"
          );
        }
        const mimeType = body.mimeType || "application/pdf";
        if (!ALLOWED_DOC_MIME_TYPES.includes(mimeType)) {
          return res.status(400).json({
            message: "Invalid file type. Allowed: PDF, images, Word, Excel, and text files.",
            code: "UNSUPPORTED_FILE",
          });
        }
        const document = await storage.createDocument({
          companyId,
          name: body.name || "Linked Document",
          nameAr: body.nameAr ?? null,
          category: body.category || "other",
          description: body.description ?? null,
          fileUrl: body.fileUrl,
          fileName: body.fileName || "document.pdf",
          fileSize: body.fileSize || null,
          mimeType,
          expiryDate: toDate(body.expiryDate),
          reminderDays: body.reminderDays ?? 30,
          reminderSent: false,
          tags: body.tags ?? null,
          isArchived: false,
          uploadedBy: userId,
          source: "external_link",
        });
        return res.status(201).json(document);
      }
      const { meta, file } = await readValidatedUpload(req);
      const document = await createVaultDocument({
        companyId,
        uploadedBy: userId,
        file,
        name: meta.name ?? null,
        nameAr: meta.nameAr ?? null,
        category: meta.category ?? null,
        description: meta.description ?? null,
        expiryDate: meta.expiryDate ?? null,
        reminderDays: meta.reminderDays ?? null,
        note: meta.note ?? null,
      });
      res.status(201).json(document);
    })
  );

  app.get(
    "/api/documents/:documentId/download",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      const version = Number(req.query.version);
      const file = await readVaultFile(
        document.companyId,
        document.id,
        Number.isInteger(version) && version > 0 ? version : null
      );
      if (!file) throw new DomainError("FILE_NOT_FOUND", 404, undefined, "File not found");
      res.set({
        "Content-Type": file.mimeType,
        "Content-Disposition": contentDisposition(file.fileName),
        "Content-Length": String(file.buffer.length),
        "X-Content-Type-Options": "nosniff",
      });
      res.send(file.buffer);
    })
  );

  app.get(
    "/api/documents/:documentId/versions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      res.json(await listVaultVersions(document.companyId, document.id));
    })
  );

  app.post(
    "/api/documents/:documentId/versions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      const { meta, file } = await readValidatedUpload(req);
      const version = await addVaultVersion({
        companyId: document.companyId,
        documentId: document.id,
        file,
        uploadedBy: req.user!.id,
        note: meta.note ?? null,
      });
      res.status(201).json(version);
    })
  );

  app.post(
    "/api/documents/:documentId/versions/:version/restore",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      const version = Number(req.params.version);
      if (!Number.isInteger(version) || version < 1) {
        throw new DomainError("VERSION_NOT_FOUND", 404);
      }
      res.status(201).json(
        await restoreVaultVersion({
          companyId: document.companyId,
          documentId: document.id,
          version,
          userId: req.user!.id,
        })
      );
    })
  );

  // Soft delete (history and bytes are kept; restore with POST /restore).
  app.delete(
    "/api/documents/:documentId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      await softDeleteVaultDocument(document.companyId, document.id, req.user!.id);
      res.json({ success: true, deleted: "soft" });
    })
  );

  app.post(
    "/api/documents/:documentId/restore",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const document = await vaultDocument(req);
      await undeleteVaultDocument(document.companyId, document.id);
      res.json({ success: true });
    })
  );

  // =====================================
  // STATEMENTS OF ACCOUNT (W4-D: R16-15, R11-15 carry-over)
  // =====================================

  const statementAccess = async (req: Request) => {
    const { companyId } = req.params;
    const userId = req.user!.id;
    if (!(await storage.hasCompanyAccess(userId, companyId))) {
      throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
    }
    return companyId;
  };

  const sendStatement = async (res: Response, st: Statement, format?: string) => {
    if (format === "pdf") {
      const pdf = await renderStatementPdf(st);
      res.set({
        "Content-Type": "application/pdf",
        // P-f: the customer's name stays readable in any script (never "statement-_-…").
        "Content-Disposition": attachmentDisposition(
          downloadFileName("statement", [st.party.name, st.asOf], "pdf")
        ),
      });
      return res.send(pdf);
    }
    return res.json(st);
  };

  app.get(
    "/api/companies/:companyId/customer-statements/:contactId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await statementAccess(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.contactId)) {
        throw new DomainError("CONTACT_NOT_FOUND", 404);
      }
      const q = statementQuery.parse(req.query);
      const st = await resolve<CustomerStatementService>("statements.customer")({
        companyId,
        contactId: req.params.contactId,
        from: q.from,
        asOf: q.asOf,
      });
      await sendStatement(res, st, q.format);
    })
  );

  app.post(
    "/api/companies/:companyId/customer-statements/:contactId/email",
    authMiddleware,
    requireCustomer,
    strictBody(emailStatementBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await statementAccess(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.contactId)) {
        throw new DomainError("CONTACT_NOT_FOUND", 404);
      }
      const body = parsedBody<EmailStatementBody>(req);
      const st = await resolve<CustomerStatementService>("statements.customer")({
        companyId,
        contactId: req.params.contactId,
        from: body.from,
        asOf: body.asOf,
      });
      const to = body.to ?? st.party.email;
      if (!to) {
        throw new DomainError(
          "RECIPIENT_REQUIRED",
          400,
          { field: "to" },
          "The customer has no email address"
        );
      }
      const pdf = await renderStatementPdf(st);
      const customer = await storage.getCustomerContact(st.party.id);
      const company = await storage.getCompany(companyId);
      const built = buildStatementEmail({
        company: company ?? { name: st.company.name, businessAddress: null, contactEmail: null },
        customerName: st.party.name,
        customerNameAr: customer?.nameAr ?? null,
        asOf: st.asOf,
        balances: st.sections.map((s) => ({
          currency: s.currency,
          closingBalance: s.closingBalance,
        })),
        message: body.message ?? null,
        language: resolveEmailLanguage(body.language, customer?.preferredLanguage),
      });
      const result = await sendEmail(to, built.subject, built.text, {
        html: built.html,
        fromName: st.company.name,
        replyTo: company?.contactEmail ?? null,
        companyId,
        category: "statement",
        relatedEntityType: "customer_contact",
        relatedEntityId: st.party.id,
        attachments: [
          {
            filename: `statement-${st.asOf}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        ],
      });
      res.status(result.sent ? 200 : 202).json({
        ...result,
        message: result.sent
          ? `Statement sent to ${to}`
          : result.status === "blocked_no_provider"
            ? "Email not configured — the statement is queued, not sent."
            : `Statement queued for delivery (${result.status}).`,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/supplier-statements/:vendorId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await statementAccess(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.vendorId)) {
        throw new DomainError("VENDOR_NOT_FOUND", 404);
      }
      const q = statementQuery.parse(req.query);
      const st = await resolve<SupplierStatementService>("statements.supplier")({
        companyId,
        vendorId: req.params.vendorId,
        from: q.from,
        asOf: q.asOf,
      });
      await sendStatement(res, st, q.format);
    })
  );

  // =====================================
  // CLIENT PORTAL - TAX RETURN ARCHIVE
  // =====================================

  // Get tax return archive for a company
  app.get(
    "/api/companies/:companyId/tax-returns-archive",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const returns = await storage.getTaxReturnArchive(companyId);
      res.json(returns);
    })
  );

  // Add tax return to archive. Never a 500: every field is validated (R08-10).
  app.post(
    "/api/companies/:companyId/tax-returns-archive",
    authMiddleware,
    requireCustomer,
    strictBody(createArchiveBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<z.output<typeof createArchiveBody>>(req);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const taxReturn = await storage.createTaxReturnArchive({
        companyId,
        returnType: body.returnType ?? "vat",
        periodLabel: body.periodLabel,
        periodStart: toDate(body.periodStart)!,
        periodEnd: toDate(body.periodEnd)!,
        filingDate: toDate(body.filingDate)!,
        ftaReferenceNumber: body.ftaReferenceNumber ?? null,
        taxAmount: body.taxAmount ?? 0,
        paymentStatus: body.paymentStatus ?? "paid",
        fileUrl: body.fileUrl ?? null,
        fileName: body.fileName ?? null,
        notes: body.notes ?? null,
        filedBy: userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "tax_return_archive.create",
        entityType: "tax_return_archive",
        entityId: taxReturn.id,
        before: null,
        after: { returnType: taxReturn.returnType, periodLabel: taxReturn.periodLabel },
        req,
      });
      res.status(201).json(taxReturn);
    })
  );

  app.put(
    "/api/tax-returns-archive/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateArchiveBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<z.output<typeof updateArchiveBody>>(req);

      const existing = await storage.getTaxReturnArchiveItem(id);
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) {
        throw new DomainError("TAX_RETURN_NOT_FOUND", 404, undefined, "Tax return not found");
      }
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        patch[key] = ["periodStart", "periodEnd", "filingDate"].includes(key)
          ? toDate(value as string)
          : value;
      }
      const start = (patch.periodStart as Date | undefined) ?? existing.periodStart;
      const end = (patch.periodEnd as Date | undefined) ?? existing.periodEnd;
      if (end.getTime() < start.getTime()) {
        throw new DomainError(
          "VALIDATION_ERROR",
          400,
          undefined,
          "Period end cannot be before period start"
        );
      }
      const updated = await storage.updateTaxReturnArchive(id, existing.companyId, patch as never);
      if (!updated) {
        throw new DomainError("TAX_RETURN_NOT_FOUND", 404, undefined, "Tax return not found");
      }
      await recordAudit({
        userId,
        companyId: existing.companyId,
        action: "tax_return_archive.update",
        entityType: "tax_return_archive",
        entityId: id,
        before: { periodLabel: existing.periodLabel, paymentStatus: existing.paymentStatus },
        after: { periodLabel: updated.periodLabel, paymentStatus: updated.paymentStatus },
        req,
      });
      res.json(updated);
    })
  );

  app.delete(
    "/api/tax-returns-archive/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      const existing = await storage.getTaxReturnArchiveItem(id);
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) {
        throw new DomainError("TAX_RETURN_NOT_FOUND", 404, undefined, "Tax return not found");
      }
      await storage.deleteTaxReturnArchive(id, existing.companyId);
      await recordAudit({
        userId,
        companyId: existing.companyId,
        action: "tax_return_archive.delete",
        entityType: "tax_return_archive",
        entityId: id,
        before: { periodLabel: existing.periodLabel, returnType: existing.returnType },
        after: null,
        req,
      });
      res.json({ success: true });
    })
  );

  // =====================================
  // CLIENT PORTAL - COMPLIANCE TASKS
  // =====================================

  // Get compliance tasks for a company
  app.get(
    "/api/companies/:companyId/compliance-tasks",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const tasks = await storage.getComplianceTasks(companyId);
      res.json(tasks);
    })
  );

  // Create compliance task
  app.post(
    "/api/companies/:companyId/compliance-tasks",
    authMiddleware,
    strictBody(createTaskBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<z.output<typeof createTaskBody>>(req);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      if (body.assignedTo && !(await storage.hasCompanyAccess(body.assignedTo, companyId))) {
        throw new DomainError(
          "ASSIGNEE_NOT_IN_COMPANY",
          400,
          undefined,
          "Assignee must belong to this company"
        );
      }
      if (body.relatedDocumentId) {
        const doc = await storage.getDocument(body.relatedDocumentId);
        if (!doc || doc.companyId !== companyId) {
          throw new DomainError("DOCUMENT_NOT_FOUND", 404, undefined, "Related document not found");
        }
      }

      const task = await storage.createComplianceTask({
        companyId,
        title: body.title,
        titleAr: body.titleAr ?? null,
        description: body.description ?? null,
        category: body.category || "other",
        priority: body.priority || "medium",
        status: "pending",
        dueDate: toDate(body.dueDate)!,
        reminderDate: toDate(body.reminderDate),
        reminderSent: false,
        isRecurring: body.isRecurring || false,
        recurrencePattern: body.recurrencePattern ?? null,
        completedAt: null,
        completedBy: null,
        assignedTo: body.assignedTo ?? null,
        createdBy: userId,
        relatedDocumentId: body.relatedDocumentId ?? null,
        relatedVatReturnId: body.relatedVatReturnId ?? null,
        notes: body.notes ?? null,
      });
      res.status(201).json(task);
    })
  );

  // Update compliance task
  app.patch(
    "/api/compliance-tasks/:taskId",
    authMiddleware,
    strictBody(updateTaskBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { taskId } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<z.output<typeof updateTaskBody>>(req);

      const existing = await storage.getComplianceTask(taskId);
      if (!existing) {
        return res
          .status(404)
          .json({ message: "Compliance task not found", code: "COMPLIANCE_TASK_NOT_FOUND" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const updates: Record<string, unknown> = {};
      if (body.status) {
        updates.status = body.status;
        if (body.status === "completed") {
          updates.completedAt = new Date();
          updates.completedBy = userId;
        }
      }
      if (body.priority) updates.priority = body.priority;
      if (body.dueDate) updates.dueDate = toDate(body.dueDate);
      if (body.notes !== undefined) updates.notes = body.notes;

      const task = await storage.updateComplianceTask(taskId, updates as never);
      res.json(task);
    })
  );

  // Delete compliance task
  app.delete(
    "/api/compliance-tasks/:taskId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { taskId } = req.params;
      const userId = req.user!.id;
      const existing = await storage.getComplianceTask(taskId);
      if (!existing) {
        return res
          .status(404)
          .json({ message: "Compliance task not found", code: "COMPLIANCE_TASK_NOT_FOUND" });
      }
      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      await storage.deleteComplianceTask(taskId);
      res.json({ success: true });
    })
  );

  // =====================================
  // CLIENT PORTAL - MESSAGES
  // =====================================

  // Get messages for a company
  app.get(
    "/api/companies/:companyId/messages",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const all = await storage.getMessages(companyId);
      const contactId = typeof req.query.contactId === "string" ? req.query.contactId : null;
      res.json(contactId ? all.filter((m) => m.contactId === contactId) : all);
    })
  );

  // Send message
  app.post(
    "/api/companies/:companyId/messages",
    authMiddleware,
    strictBody(createMessageBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const body = parsedBody<z.output<typeof createMessageBody>>(req);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      // A recipient must be someone who can see this company's messages (R16-13).
      if (body.recipientId && !(await storage.hasCompanyAccess(body.recipientId, companyId))) {
        throw new DomainError(
          "RECIPIENT_NOT_IN_COMPANY",
          400,
          { field: "recipientId" },
          "Recipient must belong to this company"
        );
      }

      if (body.contactId) {
        const contact = await storage.getCustomerContact(body.contactId);
        if (!contact || contact.companyId !== companyId) {
          throw new DomainError(
            "CONTACT_NOT_FOUND",
            400,
            { field: "contactId" },
            "Customer contact not found"
          );
        }
      }
      const message = await storage.createMessage({
        companyId,
        contactId: body.contactId ?? null,
        visibility: body.contactId ? "customer" : "internal",
        threadId: body.threadId ?? null,
        subject: body.subject ?? null,
        content: body.content,
        senderId: userId,
        recipientId: body.recipientId ?? null,
        isRead: false,
        readAt: null,
        attachmentUrl: body.attachmentUrl ?? null,
        attachmentName: body.attachmentName ?? null,
        messageType: body.messageType || "general",
        isArchived: false,
      });
      res.status(201).json(message);
    })
  );

  // =====================================
  // CLIENT PORTAL - NEWS FEED
  // =====================================

  // Get news items
  app.get(
    "/api/news",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const news = await storage.getNewsItems();
      res.json(news);
    })
  );
}
