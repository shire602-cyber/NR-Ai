import { type Express, type Request, type Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import {
  hasSmtpConfig,
  sendInvoiceEmail,
  sendPaymentReminderEmail,
} from "../services/email.service";
import { findInvoiceForUser, invoicePdfOptions } from "./invoices.routes";

// Share-link, PDF and send-email endpoints moved verbatim from
// invoices.routes.ts (W3-A structure split, no behaviour change).
export function registerInvoiceShareRoutes(app: Express) {
  // =====================================
  // Invoice Sharing & PDF
  // =====================================

  // Customer-only: Generate share link for invoice
  app.post(
    "/api/invoices/:id/share",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Generate a random token
      const token = crypto.randomBytes(16).toString("hex");
      // 90-day expiry
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      await storage.setInvoiceShareToken(id, token, expiresAt);

      res.json({
        shareUrl: `/view/invoice/${token}`,
        token,
      });
    })
  );

  // Customer-only: Download invoice as PDF
  app.get(
    "/api/invoices/:id/pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // Public: View invoice by share token (NO auth required)
  app.get(
    "/api/public/invoices/:token",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = await storage.getInvoiceByShareToken(token);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found or link is invalid" });
      }

      // Check expiry
      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This invoice link has expired" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfOpts = await invoicePdfOptions(invoice);
      // Return sanitized data (no internal IDs exposed except what's needed)
      res.json({
        invoice: {
          number: invoice.number,
          customerName: invoice.customerName,
          customerTrn: invoice.customerTrn,
          date: invoice.date,
          currency: invoice.currency,
          subtotal: invoice.subtotal,
          vatAmount: invoice.vatAmount,
          total: invoice.total,
          status: invoice.status,
          // R03-14: what the customer needs to act on the document.
          invoiceType: invoice.invoiceType,
          isTaxInvoice: !!company.trnVatNumber,
          dueDate: invoice.dueDate,
          supplyDate: invoice.supplyDate,
          paymentTerms: invoice.paymentTerms,
          reverseCharge: invoice.reverseCharge,
          discountAmount: invoice.discountAmount,
          amountPaid: pdfOpts.amountPaid ?? 0,
          amountDue: Math.max(
            0,
            Math.round((Number(invoice.total) - Number(pdfOpts.amountPaid ?? 0)) * 100) / 100
          ),
          paymentStatus:
            invoice.status === "void" || invoice.status === "cancelled"
              ? "void"
              : invoice.status === "paid"
                ? "paid"
                : Number(pdfOpts.amountPaid ?? 0) > 0
                  ? "partially_paid"
                  : invoice.dueDate && new Date(invoice.dueDate) < new Date()
                    ? "overdue"
                    : "unpaid",
        },
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          vatSupplyType: l.vatSupplyType,
        })),
        company: {
          name: company.name,
          trnVatNumber: company.trnVatNumber,
          businessAddress: company.businessAddress,
          contactPhone: company.contactPhone,
          contactEmail: company.contactEmail,
          websiteUrl: company.websiteUrl,
          logoUrl: company.logoUrl,
        },
      });
    })
  );

  // Public: Download PDF by share token (NO auth required)
  app.get(
    "/api/public/invoices/:token/pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = await storage.getInvoiceByShareToken(token);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found or link is invalid" });
      }

      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This invoice link has expired" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // Customer-only: Send invoice by email
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/send-email",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const bodySchema = z.object({
        to: z.string().email("Invalid email address"),
        subject: z.string().optional(),
        message: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { to, subject, message } = parsed.data;

      if (!hasSmtpConfig()) {
        return res.status(503).json({
          message:
            "Email sending is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.",
          code: "SMTP_NOT_CONFIGURED",
        });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      await sendInvoiceEmail(to, invoice, company, pdfBuffer, subject, message);

      await storage.createActivityLog({
        userId,
        companyId,
        action: "send",
        entityType: "invoice",
        entityId: invoiceId,
        description: `Invoice ${invoice.number} sent by email to ${to}`,
        metadata: JSON.stringify({ to, invoiceNumber: invoice.number }),
      });

      res.json({ message: `Invoice ${invoice.number} sent to ${to}` });
    })
  );

  // Customer-only: Send payment reminder email
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/send-reminder",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;

      const bodySchema = z.object({
        to: z.string().email("Invalid email address"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }
      const { to } = parsed.data;

      if (!hasSmtpConfig()) {
        return res.status(503).json({
          message:
            "Email sending is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.",
          code: "SMTP_NOT_CONFIGURED",
        });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.status === "paid" || invoice.status === "void") {
        return res
          .status(400)
          .json({ message: `Cannot send reminder for a ${invoice.status} invoice` });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const newReminderCount = (invoice.reminderCount || 0) + 1;
      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      await sendPaymentReminderEmail(to, invoice, company, pdfBuffer, newReminderCount);

      await storage.updateInvoice(invoiceId, companyId, {
        reminderCount: newReminderCount,
        lastReminderSentAt: new Date(),
      });

      await storage.createActivityLog({
        userId,
        companyId,
        action: "send",
        entityType: "invoice",
        entityId: invoiceId,
        description: `Payment reminder #${newReminderCount} sent for invoice ${invoice.number} to ${to}`,
        metadata: JSON.stringify({
          to,
          reminderCount: newReminderCount,
          invoiceNumber: invoice.number,
        }),
      });

      res.json({
        message: `Payment reminder #${newReminderCount} sent to ${to}`,
        reminderCount: newReminderCount,
      });
    })
  );
}
