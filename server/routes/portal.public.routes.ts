import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import { buildInvoiceBalances, receivableOutstanding } from "../services/invoice-outstanding";
import crypto from "crypto";
import { pdfFieldsForMany } from "../services/custom-fields.service";
import { getReadyConnection } from "../services/payment-gateway/connection.service";
import { onlinePaymentViewFrom } from "../services/payment-gateway/checkout.service";

/**
 * Does this invoice belong to the portal's customer? The contact link decides; only an invoice that has no
 * contact at all (older data) falls back to the customer name. Matching by name alone let a customer with the same
 * name as another contact see, and later pay, that contact's invoices.
 */
export function invoiceBelongsToContact(
  invoice: { contactId?: string | null; customerName: string },
  contact: { id: string; name: string }
): boolean {
  if (invoice.contactId) return invoice.contactId === contact.id;
  return invoice.customerName.toLowerCase() === contact.name.toLowerCase();
}

/**
 * Portal Public Routes
 * --------------------
 * Public endpoints for the client portal, accessible via portal access tokens.
 * No auth required for portal/:token routes — they use token-based access.
 */
export function registerPortalPublicRoutes(app: Express) {
  // =====================================
  // GENERATE PORTAL ACCESS (authenticated)
  // =====================================
  app.post(
    "/api/portal/generate-access",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { contactId } = req.body;

      if (!contactId) {
        return res.status(400).json({ message: "contactId is required" });
      }

      const contact = await storage.getCustomerContact(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      // S-H1: the contact lookup is not tenant-scoped, so we must verify the
      // caller has access to the contact's company before minting a portal
      // token. Without this any authenticated user could enumerate another
      // tenant's contactId and mint a 1-year link exposing that company's
      // invoices and PDFs (cross-tenant IDOR).
      const hasAccess = await storage.hasCompanyAccess(userId, contact.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Generate crypto-random token
      const token = crypto.randomBytes(32).toString("hex");

      // Set 1-year expiry
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      await storage.setPortalAccessToken(contactId, token, expiresAt);

      res.json({
        portalUrl: `/portal/${token}`,
        token,
        expiresAt: expiresAt.toISOString(),
      });
    })
  );

  // =====================================
  // PORTAL INFO (public, no auth)
  // =====================================
  app.get(
    "/api/portal/:token/info",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const contact = await storage.getCustomerContactByPortalToken(token);
      if (!contact) {
        return res.status(404).json({ message: "Invalid or expired portal link" });
      }

      // Check expiry
      if (contact.portalAccessExpiresAt && new Date(contact.portalAccessExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This portal link has expired" });
      }

      // Get the company name for branding
      const company = await storage.getCompany(contact.companyId);

      res.json({
        customerName: contact.name,
        contactPerson: contact.contactPerson || null,
        companyName: company?.name || "Najma Raeda Accounting",
        companyLogo: company?.logoUrl || null,
      });
    })
  );

  // =====================================
  // PORTAL INVOICES (public, no auth)
  // =====================================
  app.get(
    "/api/portal/:token/invoices",
    asyncHandler(async (req: Request, res: Response) => {
      const { token } = req.params;

      const contact = await storage.getCustomerContactByPortalToken(token);
      if (!contact) {
        return res.status(404).json({ message: "Invalid or expired portal link" });
      }

      if (contact.portalAccessExpiresAt && new Date(contact.portalAccessExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This portal link has expired" });
      }

      // Find this customer's invoices within the same company (contact link first, name only for legacy rows)
      const allInvoices = await storage.getInvoicesByCompanyId(contact.companyId);
      // A draft is a working document, not yet issued to the customer: never shown here.
      const customerInvoices = allInvoices.filter((inv) => inv.status !== "draft" && invoiceBelongsToContact(inv, contact));
      const readyConnection = await getReadyConnection(contact.companyId);
      const customFields = await pdfFieldsForMany(
        contact.companyId,
        "invoice",
        customerInvoices.map((inv) => inv.id)
      );
      // What the customer still owes: total - payments - credit notes (shared definition).
      const balances = buildInvoiceBalances(
        allInvoices,
        await storage.getInvoicePaymentsByCompanyId(contact.companyId)
      );

      // Return sanitized invoice data (no internal company details)
      const sanitizedInvoices = customerInvoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        date: inv.date,
        currency: inv.currency,
        subtotal: inv.subtotal,
        vatAmount: inv.vatAmount,
        total: inv.total,
        status: inv.status,
        invoiceType: inv.invoiceType,
        outstandingAmount: receivableOutstanding(inv, balances.get(inv.id)),
        isFullyCredited: balances.get(inv.id)?.isFullyCredited ?? false,
        dueDate: inv.dueDate,
        discountAmount: inv.discountAmount,
        shippingAmount: inv.shippingAmount,
        customFields: customFields.get(inv.id) ?? [],
        onlinePayment: onlinePaymentViewFrom(readyConnection, inv, receivableOutstanding(inv, balances.get(inv.id))),
      }));

      res.json(sanitizedInvoices);
    })
  );

  // =====================================
  // PORTAL INVOICE PDF (public, no auth)
  // =====================================
  app.get(
    "/api/portal/:token/invoices/:invoiceId/pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const { token, invoiceId } = req.params;

      const contact = await storage.getCustomerContactByPortalToken(token);
      if (!contact) {
        return res.status(404).json({ message: "Invalid or expired portal link" });
      }

      if (contact.portalAccessExpiresAt && new Date(contact.portalAccessExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This portal link has expired" });
      }

      // Get the invoice — tenant-scoped to the contact's company.
      const invoice = await storage.getInvoice(invoiceId, contact.companyId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Verify the invoice belongs to this customer
      if (invoice.status === "draft" || !invoiceBelongsToContact(invoice, contact)) {
        return res.status(403).json({ message: "Access denied to this invoice" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}
