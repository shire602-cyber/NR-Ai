import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { generateCreditNotePDF } from "../services/pdf-credit-note.service";

function canonicalCreditNoteStatus(status: string): string {
  if (status === "draft") return "draft";
  if (status === "void" || status === "cancelled") return "void";
  return "issued";
}

function toCanonicalCreditNote(invoice: any, originalInvoice?: any) {
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
    reason: "Invoice credit note",
    journalEntryId: null,
    createdAt: invoice.createdAt,
    updatedAt: invoice.createdAt,
  };
}

function toCanonicalCreditNoteLine(line: any) {
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
  if (!invoice || (invoice as any).invoiceType !== "credit_note") return null;
  const originalInvoice = invoice.originalInvoiceId
    ? await storage.getInvoiceById(invoice.originalInvoiceId)
    : undefined;
  return toCanonicalCreditNote(invoice, originalInvoice);
}

async function getCanonicalCreditNoteWithLines(id: string) {
  const creditNote = await getCanonicalCreditNote(id);
  if (!creditNote) return null;
  const invoiceLines = await storage.getInvoiceLinesByInvoiceId(id);
  return {
    ...creditNote,
    lines: invoiceLines.map(toCanonicalCreditNoteLine),
  };
}

function sendLegacyWriteDisabled(res: Response) {
  return res.status(410).json({
    message:
      "Standalone credit-note writes are retired. Create credit notes from the original invoice so VAT, FX, caps, and journal entries stay unified.",
    code: "STANDALONE_CREDIT_NOTES_RETIRED",
    replacement: "POST /api/companies/:companyId/invoices/:invoiceId/credit-note",
  });
}

export function registerCreditNoteRoutes(app: Express) {
  // =====================================
  // Credit Note Routes
  // =====================================

  // Customer-only: List credit notes by company
  app.get(
    "/api/companies/:companyId/credit-notes",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const byId = new Map(invoices.map((invoice: any) => [invoice.id, invoice]));
      const creditNotes = invoices
        .filter((invoice: any) => invoice.invoiceType === "credit_note")
        .map((invoice: any) => toCanonicalCreditNote(invoice, byId.get(invoice.originalInvoiceId)))
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      res.json(creditNotes);
    })
  );

  // Customer-only: Get single credit note with lines
  app.get(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const creditNote = await getCanonicalCreditNoteWithLines(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(creditNote);
    })
  );

  // Customer-only: Create credit note with lines
  app.post(
    "/api/companies/:companyId/credit-notes",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      return sendLegacyWriteDisabled(res);
    })
  );

  // Customer-only: Update credit note
  app.put(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const creditNote = await getCanonicalCreditNote(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      return sendLegacyWriteDisabled(res);
    })
  );

  // Customer-only: Delete credit note
  app.delete(
    "/api/credit-notes/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const creditNote = await getCanonicalCreditNote(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      return sendLegacyWriteDisabled(res);
    })
  );

  // Customer-only: Issue credit note (creates reversing journal entry)
  app.post(
    "/api/credit-notes/:id/issue",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const creditNote = await getCanonicalCreditNote(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      return sendLegacyWriteDisabled(res);
    })
  );

  // Customer-only: Void credit note
  app.post(
    "/api/credit-notes/:id/void",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const creditNote = await getCanonicalCreditNote(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      return sendLegacyWriteDisabled(res);
    })
  );

  // Customer-only: Generate PDF
  app.get(
    "/api/credit-notes/:id/pdf",
    authMiddleware,
    requireCustomer,
    requireFeature("creditNotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const creditNote = await getCanonicalCreditNoteWithLines(id);
      if (!creditNote) {
        return res.status(404).json({ message: "Credit note not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, creditNote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const company = await storage.getCompany(creditNote.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generateCreditNotePDF(creditNote as any, creditNote.lines as any, company);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="credit-note-${creditNote.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}
