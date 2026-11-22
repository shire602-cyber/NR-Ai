/**
 * Authenticated customer portal (W4-D: R16-05, R16-15, R16-16; STEP5 invitations).
 *
 * A portal login acts for exactly one customer contact per supplier (customer_portal_accounts,
 * created when the customer accepts an invitation). Access comes ONLY from that binding: a portal
 * user is never a company_users member, so nothing here (or anywhere) reads company data on their
 * behalf. Everything is scoped by (company, contact): its issued invoices, its statement of
 * account, documents it shared or that were shared with it, and its customer-visible message
 * thread. Internal staff threads and other customers' data are never returned; another contact's
 * invoice is a 404. A login with no (or a removed) binding gets 403.
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
  customerPortalAccounts,
  firmClientLinks,
  firms,
  invoices,
  messages,
  type Company,
  type CustomerContact,
} from "../../shared/schema";
import {
  portalAccountForUser,
  portalAccountsForUser,
  touchPortalAccount,
} from "../services/portal-access.service";
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
import { getCustomerEInvoiceOutcome } from "../services/einvoice/customer-outcome";
import { checkoutForInvoice, paymentsAvailability, publicBaseUrl } from "../services/payments";
import { fromFils, sumFils, toFils } from "../../shared/money";

interface PortalScope {
  companyId: string;
  company: Company;
  contact: CustomerContact;
  userId: string;
  accountId: string;
}

const scopeOf = (req: Request): PortalScope => (req as Request & { portal: PortalScope }).portal;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A signed-in user with an active binding to an active contact. The binding is the only source of
 * access: the user's type and any company membership are irrelevant here. `X-Portal-Account`
 * picks one of the user's OWN bindings. An unavailable selection fails without switching scope.
 */
async function requirePortalUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set("Cache-Control", "no-store");
  const user = req.user as { id: string } | undefined;
  if (!user) {
    res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  const header = req.headers["x-portal-account"];
  const preferred = typeof header === "string" && UUID_RE.test(header) ? header : null;
  const binding =
    header === undefined || preferred ? await portalAccountForUser(user.id, preferred) : null;
  if (!binding) {
    const [removed] = await db
      .select({ id: customerPortalAccounts.id })
      .from(customerPortalAccounts)
      .where(eq(customerPortalAccounts.userId, user.id))
      .limit(1);
    res.status(403).json(
      removed
        ? {
            code: "PORTAL_ACCESS_REVOKED",
            message: "Your access to this customer portal was removed.",
          }
        : {
            code: "PORTAL_CONTACT_NOT_LINKED",
            message:
              "This account is not linked to a customer portal. Ask your supplier to invite you.",
          }
    );
    return;
  }
  const [company, contact] = await Promise.all([
    storage.getCompany(binding.companyId),
    storage.getCustomerContact(binding.contactId),
  ]);
  if (!company || !contact || contact.companyId !== company.id || !contact.isActive) {
    res.status(403).json({
      code: "PORTAL_ACCESS_REVOKED",
      message: "Your access to this customer portal was removed.",
    });
    return;
  }
  void touchPortalAccount(binding.id);
  (req as Request & { portal: PortalScope }).portal = {
    companyId: company.id,
    company,
    contact,
    userId: user.id,
    accountId: binding.id,
  };
  next();
}

/** One issued invoice of the signed-in customer's own contact, or null (a 404 for all others). */
async function ownInvoice(scope: PortalScope, id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.id, id),
        eq(invoices.companyId, scope.companyId),
        eq(invoices.contactId, scope.contact.id),
        inArray(invoices.status, [...ISSUED_STATUSES])
      )
    );
  return row ?? null;
}

interface CurrencyTotal {
  currency: string;
  fils: number;
  amount: string;
  count: number;
}

/** Sum by currency in integer fils; amounts of different currencies are never added together. */
export function totalsByCurrency(
  rows: Array<{ currency: string; amountDue: number }>
): CurrencyTotal[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const list = groups.get(r.currency) ?? [];
    list.push(toFils(r.amountDue, { rounding: "halfUp" }));
    groups.set(r.currency, list);
  }
  return [...groups.entries()]
    .map(([currency, list]) => {
      const fils = sumFils(list);
      return { currency, fils, amount: fromFils(fils), count: list.length };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
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
      const { accountId, company, contact } = scopeOf(req);
      // The accounting firm serving this client (active engagement), for the portal header.
      const [firm] = await db
        .select({ name: firms.name })
        .from(firmClientLinks)
        .innerJoin(firms, eq(firms.id, firmClientLinks.firmId))
        .where(and(eq(firmClientLinks.companyId, company.id), eq(firmClientLinks.status, "active")))
        .limit(1);
      res.json({
        portalAccountId: accountId,
        firmName: firm?.name ?? null,
        id: company.id,
        name: company.name,
        logoUrl: company.logoUrl ?? null,
        contactEmail: company.contactEmail ?? null,
        customer: { id: contact.id, name: contact.name, nameAr: contact.nameAr ?? null },
      });
    })
  );

  // The signed-in customer's supplier portals (the switcher).
  app.get(
    "/api/client-portal/accounts",
    authMiddleware as RequestHandler,
    asyncHandler(async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      const userId = (req.user as { id: string }).id;
      const bindings = await portalAccountsForUser(userId);
      const out = [];
      for (const b of bindings) {
        const [company, contact] = await Promise.all([
          storage.getCompany(b.companyId),
          storage.getCustomerContact(b.contactId),
        ]);
        if (!company || !contact || contact.companyId !== company.id || !contact.isActive) continue;
        out.push({
          id: b.id,
          company: { id: company.id, name: company.name, logoUrl: company.logoUrl ?? null },
          customer: { id: contact.id, name: contact.name, nameAr: contact.nameAr ?? null },
        });
      }
      res.json(out);
    })
  );

  app.get(
    "/api/client-portal/dashboard",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contact } = scopeOf(req);
      const all = await contactInvoices(companyId, contact.id);
      const rows = all.filter((r) => r.invoiceType !== "credit_note");
      const outstanding = rows.filter((r) => r.amountDue > 0);
      const overdue = rows.filter((r) => r.paymentStatus === "overdue");
      const paid = rows.filter((r) => r.paymentStatus === "paid");
      const nextDue =
        outstanding
          .filter((r) => r.dueDate)
          .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0] ?? null;
      const docs = await listVaultDocuments(companyId, { contactId: contact.id });
      res.json({
        invoices: {
          total: rows.length,
          outstanding: outstanding.length,
          overdue: overdue.length,
          paid: paid.length,
        },
        // Per currency, summed in integer fils (G5): AED and USD are never added together.
        outstandingByCurrency: totalsByCurrency(outstanding),
        overdueByCurrency: totalsByCurrency(overdue),
        nextDue: nextDue
          ? {
              id: nextDue.id,
              number: nextDue.number,
              dueDate: nextDue.dueDate,
              currency: nextDue.currency,
              amountDue: nextDue.amountDue,
            }
          : null,
        documents: { total: docs.length },
        recentInvoices: all.slice(0, 5),
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
      const scope = scopeOf(req);
      const invoice = await ownInvoice(scope, req.params.id);
      if (!invoice)
        return res.status(404).json({ message: "Invoice not found", code: "INVOICE_NOT_FOUND" });
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const pdfBuffer = await generateInvoicePDF(invoice, lines, scope.company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  app.get(
    "/api/client-portal/invoices/:id/einvoice",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await ownInvoice(scopeOf(req), req.params.id);
      if (!invoice || !invoice.einvoiceXml) {
        return res
          .status(404)
          .json({ code: "EINVOICE_NOT_FOUND", message: "No e-invoice for this invoice" });
      }
      const outcome = await getCustomerEInvoiceOutcome(invoice);
      res.set({
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="einvoice-${invoice.number}.xml"`,
        "X-Einvoice-Status": outcome?.status ?? "generated",
        "X-Einvoice-Environment": outcome?.environment ?? "unknown",
      });
      res.send(invoice.einvoiceXml);
    })
  );

  // Pay now: the same hosted checkout as the token portal, for the customer's own open invoice.
  app.post(
    "/api/client-portal/invoices/:id/pay",
    ...chain,
    asyncHandler(async (req: Request, res: Response) => {
      const scope = scopeOf(req);
      const invoice = await ownInvoice(scope, req.params.id);
      if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
      if (!paymentsAvailability().available) {
        throw new DomainError(
          "PAYMENTS_REQUIRES_EXTERNAL",
          503,
          undefined,
          "Online payment is not available"
        );
      }
      const back = `${publicBaseUrl()}/client-portal/invoices`;
      res.json(
        await checkoutForInvoice({
          companyId: scope.companyId,
          invoiceId: invoice.id,
          successUrl: `${back}?payment=success`,
          cancelUrl: `${back}?payment=cancelled`,
        })
      );
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
