import { type Express, type Request, type Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import {
  hasEmailProvider,
  sendInvoiceEmail,
  sendPaymentReminderEmail,
  type SendEmailResult,
} from "../services/email.service";
import { resolveEmailLanguage } from "../services/email-layout";
import { findInvoiceForUser, invoicePdfOptions } from "./invoices.routes";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { zEmail, zText } from "../../shared/validators/primitives";
import { DomainError } from "../errors";
import { notePortalFailure, portalGuard } from "./portal.public.routes";
import { paymentsAvailability, publicBaseUrl } from "../services/payments";
import { logPortalAccess } from "../services/portal-access.service";
import { db } from "../db";
import { invoiceOpenFils } from "../services/invoice-posting.service";
import { recordInvoiceView } from "../services/invoice-activity.service";
import { getCustomerEInvoiceStatus } from "../services/einvoice/customer-outcome";

const sendEmailBody = z.object({
  to: zEmail,
  subject: zText(300).optional(),
  message: zText(5000).optional(),
  language: z.enum(["en", "ar", "bilingual"]).optional(),
});
const sendReminderBody = z.object({ to: zEmail });

/** Honest API answer for an outbox result (R16-08): never "sent" unless it was. */
function emailOutcome(result: SendEmailResult, what: string, to: string) {
  const message = result.sent
    ? `${what} sent to ${to}`
    : result.status === "blocked_no_provider"
      ? `Email not configured — ${what.toLowerCase()} is queued, not sent.`
      : `${what} is queued for delivery (${result.status}).`;
  return {
    message,
    sent: result.sent,
    queued: result.queued,
    status: result.status,
    outboxId: result.id ?? null,
    emailConfigured: hasEmailProvider(),
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Make sure the invoice has a live share link and return its public URL. */
async function ensureShareUrl(invoice: {
  id: string;
  shareToken: string | null;
  shareTokenExpiresAt: Date | null;
}) {
  let token = invoice.shareToken;
  if (
    !token ||
    (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date())
  ) {
    token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    await storage.setInvoiceShareToken(invoice.id, token, expiresAt);
  }
  return `${publicBaseUrl()}/view/invoice/${token}`;
}

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
      const userId = req.user!.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      }
      // W4-D (R16-04): a draft or cancelled document is never shared with a customer.
      if (invoice.status === "draft" || invoice.status === "cancelled") {
        throw new DomainError(
          "INVOICE_NOT_ISSUED",
          409,
          { status: invoice.status },
          "Issue the invoice before sharing it"
        );
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
      const userId = req.user!.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
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
    portalGuard("share"),
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = /^[0-9a-f]{32}$/i.test(token)
        ? await storage.getInvoiceByShareToken(token)
        : undefined;
      if (!invoice || invoice.status === "draft" || invoice.status === "cancelled") {
        notePortalFailure(req);
        return res
          .status(404)
          .json({ message: "Invoice not found or link is invalid", code: "INVOICE_NOT_FOUND" });
      }

      // Check expiry
      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        notePortalFailure(req);
        return res
          .status(410)
          .json({ message: "This invoice link has expired", code: "LINK_EXPIRED" });
      }

      void logPortalAccess({ req, outcome: "share_ok", companyId: invoice.companyId });
      // WQ1 (7.25): the invoice's viewed log (throttled; never blocks the page).
      void recordInvoiceView(invoice);
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      }

      const pdfOpts = await invoicePdfOptions(invoice);
      const payments = paymentsAvailability();
      const openFils =
        invoice.invoiceType === "credit_note" ? 0 : await invoiceOpenFils(db, invoice);
      // The page opens in the customer's own language, else the browser's, else the company's.
      const contact = invoice.contactId
        ? await storage.getCustomerContact(invoice.contactId)
        : null;
      const eInvoiceStatus = await getCustomerEInvoiceStatus(invoice);
      // Return sanitized data (no internal IDs exposed except what's needed)
      res.json({
        // R16-14: "Pay now" only when a gateway is live/sandbox and something is owed.
        onlinePayment: {
          available: payments.available && openFils > 0 && invoice.status !== "void",
          status: payments.status,
          provider: payments.available ? payments.provider : null,
        },
        einvoice: eInvoiceStatus
          ? { status: eInvoiceStatus, uuid: invoice.einvoiceUuid ?? null }
          : null,
        preferredLanguage: contact?.preferredLanguage ?? null,
        companyLocale: company.locale === "ar" ? "ar" : "en",
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
    portalGuard("share"),
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const invoice = /^[0-9a-f]{32}$/i.test(token)
        ? await storage.getInvoiceByShareToken(token)
        : undefined;
      if (!invoice || invoice.status === "draft" || invoice.status === "cancelled") {
        notePortalFailure(req);
        return res
          .status(404)
          .json({ message: "Invoice not found or link is invalid", code: "INVOICE_NOT_FOUND" });
      }

      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        notePortalFailure(req);
        return res
          .status(410)
          .json({ message: "This invoice link has expired", code: "LINK_EXPIRED" });
      }

      void logPortalAccess({ req, outcome: "share_ok", companyId: invoice.companyId });
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
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
    strictBody(sendEmailBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = req.user!.id;
      const { to, subject, message, language } = parsedBody<z.output<typeof sendEmailBody>>(req);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      const shareUrl =
        invoice.status === "draft" || invoice.status === "cancelled"
          ? null
          : await ensureShareUrl(invoice);
      const customer = invoice.contactId
        ? await storage.getCustomerContact(invoice.contactId)
        : null;
      const result = await sendInvoiceEmail(to, invoice, company, pdfBuffer, subject, message, {
        throwOnFailure: false,
        language: resolveEmailLanguage(language, customer?.preferredLanguage),
        customerNameAr: customer?.nameAr ?? null,
        portalUrl: shareUrl,
        payUrl: shareUrl && paymentsAvailability().available ? shareUrl : null,
      });

      await storage.createActivityLog({
        userId,
        companyId,
        action: "send",
        entityType: "invoice",
        entityId: invoiceId,
        description: result.sent
          ? `Invoice ${invoice.number} sent by email to ${to}`
          : `Invoice ${invoice.number} email to ${to} queued (${result.status})`,
        metadata: JSON.stringify({
          to,
          invoiceNumber: invoice.number,
          outbox: result.id,
          status: result.status,
        }),
      });

      res
        .status(result.sent ? 200 : 202)
        .json(emailOutcome(result, `Invoice ${invoice.number}`, to));
    })
  );

  // Customer-only: Send payment reminder email
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/send-reminder",
    authMiddleware,
    requireCustomer,
    strictBody(sendReminderBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = req.user!.id;

      const { to } = parsedBody<z.output<typeof sendReminderBody>>(req);

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const invoice = await storage.getInvoice(invoiceId, companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      }

      // W4-D (R16-03): only issued, unpaid invoices are chased.
      if (
        !["sent", "posted", "partial"].includes(invoice.status) ||
        invoice.invoiceType === "credit_note"
      ) {
        return res.status(400).json({
          code: "INVOICE_NOT_CHASEABLE",
          message: `Cannot send reminder for a ${invoice.status} invoice`,
        });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      }

      const newReminderCount = (invoice.reminderCount || 0) + 1;
      const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
      const pdfBuffer = await generateInvoicePDF(
        invoice,
        lines,
        company,
        await invoicePdfOptions(invoice)
      );

      const shareUrl = await ensureShareUrl(invoice);
      const customer = invoice.contactId
        ? await storage.getCustomerContact(invoice.contactId)
        : null;
      const result = await sendPaymentReminderEmail(
        to,
        invoice,
        company,
        pdfBuffer,
        newReminderCount,
        {
          openFils: await invoiceOpenFils(db, invoice),
          // "Pay now" only when online payment is actually available; else "View invoice".
          payUrl: paymentsAvailability().available ? shareUrl : null,
          portalUrl: shareUrl,
          language: resolveEmailLanguage(null, customer?.preferredLanguage),
          customerNameAr: customer?.nameAr ?? null,
          throwOnFailure: false,
        }
      );

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
        description: result.sent
          ? `Payment reminder #${newReminderCount} sent for invoice ${invoice.number} to ${to}`
          : `Payment reminder #${newReminderCount} for invoice ${invoice.number} queued (${result.status})`,
        metadata: JSON.stringify({
          to,
          reminderCount: newReminderCount,
          invoiceNumber: invoice.number,
        }),
      });

      res.status(result.sent ? 200 : 202).json({
        ...emailOutcome(result, `Payment reminder #${newReminderCount}`, to),
        reminderCount: newReminderCount,
      });
    })
  );
}
