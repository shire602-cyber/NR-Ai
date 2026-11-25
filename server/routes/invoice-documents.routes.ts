import { MAX_UPLOAD_BYTES } from "../../shared/upload-limits";
// WQ1: files kept with an invoice (7.2g) and its sent / viewed log (7.25).
//
//   GET    /api/invoices/:id/attachments
//   POST   /api/invoices/:id/attachments            base64 data URL, upload guard (type sniffing,
//                                                    size cap, virus scan when configured)
//   GET    /api/invoices/:id/attachments/:attachmentId
//   DELETE /api/invoices/:id/attachments/:attachmentId
//   GET    /api/invoices/:id/activity               emails (outbox status) and share-link views
//
// Tenancy: the invoice is resolved first and authorised like every invoice route
// (findInvoiceForUser); another tenant's invoice or attachment is a 404.
import { type Express, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { db } from "../db";
import { invoiceAttachments, type Invoice } from "../../shared/schema";
import {
  invoiceAttachmentBody,
  type InvoiceAttachmentBody,
} from "../../shared/validators/sales-documents";
import { inspectUpload } from "../services/upload-guard";
import { readReceiptImage, saveReceiptFile } from "../services/fileStorage";
import { recordAudit } from "../services/audit.service";
import { listInvoiceActivity } from "../services/invoice-activity.service";
import { findInvoiceForUser } from "./invoices.routes";

export const MAX_INVOICE_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;
const UUID = /^[0-9a-f-]{36}$/i;

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

async function requireInvoice(req: Request): Promise<Invoice> {
  const invoice = await findInvoiceForUser(userOf(req), req.params.id);
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
  return invoice;
}

const publicRow = (row: typeof invoiceAttachments.$inferSelect) => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

export function registerInvoiceDocumentRoutes(app: Express) {
  app.get(
    "/api/invoices/:id/attachments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await requireInvoice(req);
      const rows = await db
        .select()
        .from(invoiceAttachments)
        .where(
          and(
            eq(invoiceAttachments.invoiceId, invoice.id),
            eq(invoiceAttachments.companyId, invoice.companyId)
          )
        )
        .orderBy(desc(invoiceAttachments.createdAt));
      res.json(rows.map(publicRow));
    })
  );

  app.post(
    "/api/invoices/:id/attachments",
    authMiddleware,
    requireCustomer,
    strictBody(invoiceAttachmentBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const invoice = await requireInvoice(req);
      const body = parsedBody<InvoiceAttachmentBody>(req);
      const inspected = await inspectUpload(body.data, { maxBytes: MAX_INVOICE_ATTACHMENT_BYTES });
      const storageKey = await saveReceiptFile(inspected.buffer, {
        mime: inspected.mime,
        ext: inspected.ext,
      });
      const [row] = await db
        .insert(invoiceAttachments)
        .values({
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          fileName: body.fileName,
          contentType: inspected.mime,
          storageKey,
          sizeBytes: inspected.size,
          uploadedBy: userId,
        })
        .returning();
      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.attachment_add",
        entityType: "invoice",
        entityId: invoice.id,
        after: { attachmentId: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes },
        req,
      });
      res.status(201).json(publicRow(row));
    })
  );

  app.get(
    "/api/invoices/:id/attachments/:attachmentId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await requireInvoice(req);
      if (!UUID.test(req.params.attachmentId)) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      const [row] = await db
        .select()
        .from(invoiceAttachments)
        .where(
          and(
            eq(invoiceAttachments.id, req.params.attachmentId),
            eq(invoiceAttachments.invoiceId, invoice.id),
            eq(invoiceAttachments.companyId, invoice.companyId)
          )
        );
      if (!row) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      const file = await readReceiptImage(row.storageKey);
      if (!file) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      res.setHeader("Content-Type", row.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${row.fileName.replace(/[^\w.\- ]/g, "_")}"`
      );
      res.send(file.buffer);
    })
  );

  app.delete(
    "/api/invoices/:id/attachments/:attachmentId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const invoice = await requireInvoice(req);
      if (!UUID.test(req.params.attachmentId)) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      const deleted = await db
        .delete(invoiceAttachments)
        .where(
          and(
            eq(invoiceAttachments.id, req.params.attachmentId),
            eq(invoiceAttachments.invoiceId, invoice.id),
            eq(invoiceAttachments.companyId, invoice.companyId)
          )
        )
        .returning({ id: invoiceAttachments.id });
      if (deleted.length === 0) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.attachment_remove",
        entityType: "invoice",
        entityId: invoice.id,
        before: { attachmentId: req.params.attachmentId },
        req,
      });
      res.json({ message: "Attachment removed" });
    })
  );

  app.get(
    "/api/invoices/:id/activity",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await requireInvoice(req);
      res.json(await listInvoiceActivity(invoice));
    })
  );
}
