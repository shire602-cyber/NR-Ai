// Credit notes (W3-A: R03-08, R03-21).
//
// Credit notes live in `invoices` (invoice_type = 'credit_note', negative
// totals). A standalone credit note is created as a DRAFT (no journal),
// issued with /issue — which mirrors the original invoice's revenue / VAT legs
// through the ledger kernel and turns any excess over the invoice's open
// balance into a customer credit — and voided with /void (kernel reversal,
// unused customer credit closed, invoice settlement restored).
// POST /api/companies/:id/invoices/:invoiceId/credit-note creates and issues
// in one step.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import type { Invoice, InvoiceLine } from "../../shared/schema";
import { renderCreditNotePdf } from "../services/credit-note-pdf";
import { salesLinesSchema } from "../../shared/validators/invoices";
import { zDate, zText, zUuid } from "../../shared/validators/primitives";
import {
  createDraftCreditNote,
  issueDraftCreditNote,
  voidCreditNote,
} from "../services/invoice-posting.service";
import { toCreditLines } from "./invoices.routes";
import { emitDomainEvent } from "../platform/domain-events";
import { fromFils, toFils } from "../../shared/money";

function canonicalCreditNoteStatus(status: string): string {
  if (status === "draft") return "draft";
  if (status === "void" || status === "cancelled") return "void";
  return "issued";
}

function toCanonicalCreditNote(invoice: Invoice, originalInvoice?: Invoice) {
  return {
    id: invoice.id,
    companyId: invoice.companyId,
    number: invoice.number,
    customerName: invoice.customerName,
    customerTrn: invoice.customerTrn,
    invoiceId: invoice.originalInvoiceId,
    invoiceNumber: originalInvoice?.number ?? null,
    date: invoice.date,
    currency: invoice.currency,
    subtotal: Math.abs(Number(invoice.subtotal) || 0),
    vatAmount: Math.abs(Number(invoice.vatAmount) || 0),
    total: Math.abs(Number(invoice.total) || 0),
    status: canonicalCreditNoteStatus(invoice.status),
    reason: invoice.notes || "Invoice credit note",
    journalEntryId: null,
    createdAt: invoice.createdAt,
    updatedAt: invoice.createdAt,
  };
}

function toCanonicalCreditNoteLine(line: InvoiceLine) {
  return {
    id: line.id,
    creditNoteId: line.invoiceId,
    description: String(line.description || "").replace(/^\[Credit\]\s*/u, ""),
    quantity: Math.abs(Number(line.quantity) || 0),
    unitPrice: Math.abs(Number(line.unitPrice) || 0),
    vatRate: line.vatRate,
    vatSupplyType: line.vatSupplyType,
  };
}

async function getCanonicalCreditNote(id: string) {
  const invoice = await storage.getInvoiceById(id);
  if (!invoice || invoice.invoiceType !== "credit_note") return null;
  const originalInvoice = invoice.originalInvoiceId
    ? await storage.getInvoiceById(invoice.originalInvoiceId)
    : undefined;
  return toCanonicalCreditNote(invoice, originalInvoice);
}

async function getCanonicalCreditNoteWithLines(id: string) {
  const creditNote = await getCanonicalCreditNote(id);
  if (!creditNote) return null;
  const invoiceLines = await storage.getInvoiceLinesByInvoiceId(id);
  return { ...creditNote, lines: invoiceLines.map(toCanonicalCreditNoteLine) };
}

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}

/** A credit note the user may see; another tenant's id is a 404 (never 403). */
async function creditNoteForUser(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("CREDIT_NOTE_NOT_FOUND", 404);
  const creditNote = await getCanonicalCreditNote(id);
  if (!creditNote || !(await storage.hasCompanyAccess(userId, creditNote.companyId))) {
    throw new DomainError("CREDIT_NOTE_NOT_FOUND", 404, undefined, "Credit note not found");
  }
  return creditNote;
}

const standaloneCreditNoteSchema = z
  .object({
    invoiceId: zUuid,
    lines: salesLinesSchema.optional(),
    restock: z.boolean().optional(),
    reason: zText(500).optional(),
    date: zDate.optional(),
  })
  .strict();

export function registerCreditNoteRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/credit-notes",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      const creditNotes = invoices
        .filter((invoice) => invoice.invoiceType === "credit_note")
        .map((invoice) =>
          toCanonicalCreditNote(
            invoice,
            invoice.originalInvoiceId ? byId.get(invoice.originalInvoiceId) : undefined
          )
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      res.json(creditNotes);
    })
  );

  app.get(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      await creditNoteForUser(userOf(req), req.params.id);
      res.json(await getCanonicalCreditNoteWithLines(req.params.id));
    })
  );

  // Create a DRAFT credit note against an issued invoice (no journal yet).
  app.post(
    "/api/companies/:companyId/credit-notes",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    strictBody(standaloneCreditNoteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const body = validated<z.output<typeof standaloneCreditNoteSchema>>(req);
      const original = await storage.getInvoice(body.invoiceId, companyId);
      if (!original) throw new DomainError("INVOICE_NOT_FOUND", 404);
      const draft = await createDraftCreditNote({
        invoiceId: body.invoiceId,
        companyId,
        lines: body.lines ? toCreditLines(body.lines, original) : undefined,
        restock: body.restock,
        date: body.date,
        reason: body.reason,
      });
      res.status(201).json(await getCanonicalCreditNoteWithLines(draft.id));
    })
  );

  // Issued credit notes are immutable; drafts are replaced (delete + create).
  app.put(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request) => {
      const creditNote = await creditNoteForUser(userOf(req), req.params.id);
      if (creditNote.status === "draft") {
        throw new DomainError(
          "CREDIT_NOTE_EDIT_BY_REPLACE",
          409,
          undefined,
          "Delete the draft credit note and create a new one."
        );
      }
      throw new DomainError(
        "CREDIT_NOTE_ISSUED_IMMUTABLE",
        409,
        undefined,
        "An issued credit note cannot be changed; void it and issue a new one."
      );
    })
  );

  app.delete(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const creditNote = await creditNoteForUser(userId, req.params.id);
      if (creditNote.status !== "draft") {
        throw new DomainError(
          "CREDIT_NOTE_ISSUED_IMMUTABLE",
          409,
          undefined,
          "An issued credit note cannot be deleted; void it instead."
        );
      }
      await storage.safeDeleteInvoice(creditNote.id, userId);
      res.json({ message: "Credit note deleted" });
    })
  );

  // Issue a draft credit note: posts the mirrored reversal through the kernel.
  app.post(
    "/api/credit-notes/:id/issue",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const creditNote = await creditNoteForUser(userId, req.params.id);
      const result = await issueDraftCreditNote(creditNote.id, creditNote.companyId, userId);
      emitDomainEvent("credit_note.issued", {
        companyId: creditNote.companyId,
        entityId: creditNote.id,
        invoiceId: creditNote.invoiceId ?? undefined,
        totalFils: toFils(creditNote.total, { rounding: "halfUp" }),
        actorUserId: userId,
      });
      res.json({
        ...(await getCanonicalCreditNoteWithLines(creditNote.id)),
        journalEntryId: result.journalEntryId,
        customerCredit: result.customerCreditId
          ? { id: result.customerCreditId, amount: fromFils(result.customerCreditFils) }
          : null,
      });
    })
  );

  // Void a credit note: kernel reversal, unused customer credit closed,
  // invoice balance restored. Refused when its customer credit was used.
  app.post(
    "/api/credit-notes/:id/void",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const creditNote = await creditNoteForUser(userId, req.params.id);
      await voidCreditNote(creditNote.id, creditNote.companyId, userId);
      res.json(await getCanonicalCreditNoteWithLines(creditNote.id));
    })
  );

  app.get(
    "/api/credit-notes/:id/pdf",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const canonical = await creditNoteForUser(userOf(req), req.params.id);
      const row = await storage.getInvoice(canonical.id, canonical.companyId);
      const company = await storage.getCompany(canonical.companyId);
      if (!row || !company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const creditNote = canonical;
      const pdfBuffer = await renderCreditNotePdf(
        row,
        await storage.getInvoiceLinesByInvoiceId(row.id),
        company
      );
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="credit-note-${creditNote.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}
