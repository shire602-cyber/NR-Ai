/**
 * Authenticated customer portal (W4-D: R16-05, R16-15, R16-16).
 *
 * A client_portal user acts for exactly one customer contact (customer_portal_accounts,
 * bound by staff via POST /api/portal/contacts/:contactId/portal-users). Everything here is
 * scoped to that contact: its issued invoices, its statement of account, documents it shared
 * or that were shared with it, and its customer-visible message thread. Internal staff
 * threads and other customers' data are never returned. An unbound user gets 403.
 */
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import {
  firmClientLinks,
  firms,
  invoices,
  messages,
  type Company,
  type CustomerContact,
} from "../../shared/schema";
import { portalAccountForUser } from "../services/portal-access.service";
import { buildCustomerStatement, renderStatementPdf } from "../services/customer-statement.service";
import {
  createVaultDocument,
  listVaultDocuments,
  readValidatedUpload,
} from "../services/document-vault.service";
import {
  portalMessageBody,
  statementQuery,
  type PortalMessageBody,
} from "../../shared/validators/portal";
import { contactInvoices, ISSUED_STATUSES } from "./portal.public.routes";
import { paymentsAvailability } from "../services/payments";

interface PortalScope {
  companyId: string;
  company: Company;
  contact: CustomerContact;
  userId: string;
}

const scopeOf = (req: Request): PortalScope => (req as Request & { portal: PortalScope }).portal;

/** client_portal users only, bound to one active contact of a company they belong to. */
async function requirePortalUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user as { id: string; userType?: string; isAdmin?: boolean } | undefined;
  if (!user) {
    res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (user.userType !== "client_portal" && !user.isAdmin) {
    res
      .status(403)
      .json({ message: "Client portal access required", code: "PORTAL_CONTACT_NOT_LINKED" });
    return;
  }
  const binding = await portalAccountForUser(user.id);
  if (!binding || !(await storage.hasCompanyAccess(user.id, binding.companyId))) {
    res.status(403).json({
      code: "PORTAL_CONTACT_NOT_LINKED",
      message: "This account is not linked to a customer yet. Ask your supplier to link it.",
    });
    return;
  }
  const [company, contact] = await Promise.all([
    storage.getCompany(binding.companyId),
    storage.getCustomerContact(binding.contactId),
  ]);
  if (!company || !contact || contact.companyId !== company.id || !contact.isActive) {
    res.status(403).json({ code: "PORTAL_CONTACT_NOT_LINKED", message: "Customer not available" });
    return;
  }
  (req as Request & { portal: PortalScope }).portal = {
    companyId: company.id,
    company,
    contact,
    userId: user.id,
  };
  next();
}

export function registerClientPortalRoutes(app: Express): void {
  const chain: RequestHandler[] = [
    authMiddleware as RequestHandler,
    (req, res, next) => {
      requirePortalUser(req, res, next).catch(next);
    },
  ];

  app.get(
    "/api/client-portal/company",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { company, contact } = scopeOf(req);
      // The accounting firm serving this client (active engagement), for the portal header.
      const [firm] = await db
        .select({ name: firms.name })
        .from(firmClientLinks)
        .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
        .where(and(eq(firmClientLinks.companyId, company.id), eq(firmClientLinks.status, "active")))
        .limit(1);
      res.json({
        firmName: firm?.name ?? null,
        id: company.id,
        name: company.name,
        logoUrl: company.logoUrl ?? null,
        contactEmail: company.contactEmail ?? null,
        customer: { id: contact.id, name: contact.name, nameAr: contact.nameAr ?? null },
      });
    })
  );

  app.get(
    "/api/client-portal/dashboard",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      const rows = (await contactInvoices(companyId, contact.id)).filter(
        (r) => r.invoiceType !== "credit_note"
      );
      const outstanding = rows.filter((r) => r.amountDue > 0);
      const paid = rows.filter((r) => r.paymentStatus === "paid");
      const docs = await listVaultDocuments(companyId, { contactId: contact.id });
      res.json({
        invoices: {
          total: rows.length,
          outstanding: outstanding.length,
          outstandingTotal:
            Math.round(outstanding.reduce((s, r) => s + r.amountDue, 0) * 100) / 100,
          overdue: rows.filter((r) => r.paymentStatus === "overdue").length,
          paid: paid.length,
          paidTotal: Math.round(paid.reduce((s, r) => s + r.total, 0) * 100) / 100,
        },
        documents: { total: docs.length },
        recentInvoices: rows.slice(0, 5),
        onlinePayment: { available: paymentsAvailability().available },
      });
    })
  );

  app.get(
    "/api/client-portal/invoices",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      res.json(await contactInvoices(companyId, contact.id));
    })
  );

  app.get(
    "/api/client-portal/invoices/:id/pdf",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, company, contact } = scopeOf(req);
      const [invoice] = /^[0-9a-f-]{36}$/i.test(req.params.id)
        ? await db
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, req.params.id),
                eq(invoices.companyId, companyId),
                eq(invoices.contactId, contact.id),
                inArray(invoices.status, [...ISSUED_STATUSES])
              )
            )
        : [];
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const pdfBuffer = await generateInvoicePDF(invoice, lines, company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  app.get(
    "/api/client-portal/documents",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      res.json(await listVaultDocuments(companyId, { contactId: contact.id }));
    })
  );

  app.post(
    "/api/client-portal/documents",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact, userId } = scopeOf(req);
      const { meta, file } = await readValidatedUpload(req);
      const doc = await createVaultDocument({
        companyId,
        uploadedBy: userId,
        file,
        name: meta.name ?? file.fileName,
        nameAr: meta.nameAr ?? null,
        category: meta.category ?? "other",
        description: meta.description ?? null,
        expiryDate: meta.expiryDate ?? null,
        contactId: contact.id,
        source: "customer_portal",
        note: meta.note ?? null,
      });
      res.status(201).json(doc);
    })
  );

  // R16-15: the customer's statement of account (not the company's P&L / balance sheet).
  app.get(
    "/api/client-portal/statements",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      const q = statementQuery.parse(req.query);
      const st = await buildCustomerStatement({
        companyId,
        contactId: contact.id,
        from: q.from,
        asOf: q.asOf,
      });
      if (q.format === "pdf") {
        const pdf = await renderStatementPdf(st);
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="statement-${st.asOf}.pdf"`,
        });
        return res.send(pdf);
      }
      res.json(st);
    })
  );

  app.get(
    "/api/client-portal/messages",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.companyId, companyId),
            eq(messages.contactId, contact.id),
            eq(messages.visibility, "customer")
          )
        )
        .orderBy(asc(messages.createdAt));
      res.json(rows);
    })
  );

  app.post(
    "/api/client-portal/messages",
    ...chain,
    strictBody(portalMessageBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact, userId } = scopeOf(req);
      const body = parsedBody<PortalMessageBody>(req);
      if (body.threadId) {
        const [thread] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.companyId, companyId),
              eq(messages.contactId, contact.id),
              eq(messages.visibility, "customer"),
              eq(messages.threadId, body.threadId)
            )
          )
          .limit(1);
        if (!thread) throw new DomainError("THREAD_NOT_FOUND", 404, undefined, "Thread not found");
      }
      const [message] = await db
        .insert(messages)
        .values({
          companyId,
          threadId: body.threadId ?? null,
          subject: body.subject ?? null,
          content: body.content,
          senderId: userId,
          recipientId: null,
          isRead: false,
          readAt: null,
          attachmentUrl: null,
          attachmentName: null,
          messageType: "general",
          isArchived: false,
          contactId: contact.id,
          visibility: "customer",
        })
        .returning();
      res.status(201).json(message);
    })
  );
}
