/**
 * Customer portal (W4-D: R16-04, R16-05, R16-06, R16-07, R16-16, R16-19).
 *
 * Staff (authenticated, company access):
 *   POST   /api/portal/generate-access          { contactId, ttlDays? } → link shown once (90 days)
 *   POST   /api/portal/revoke-access            { contactId }
 *   GET    /api/portal/contacts/:contactId/access          link metadata + access log
 *   POST   /api/portal/contacts/:contactId/portal-users    { userId } bind a client_portal user
 *   DELETE /api/portal/contacts/:contactId/portal-users/:userId
 *
 * Customer (portal link or OTP session token; throttled and logged):
 *   POST /api/portal/login/request  { companyId, email }        one-time code by email
 *   POST /api/portal/login/verify   { companyId, email, code }  → session token (12 h)
 *   GET  /api/portal/:token/info | invoices | invoices/:id/pdf | invoices/:id/einvoice
 *   POST /api/portal/:token/invoices/:id/pay                   → hosted checkout URL
 *   GET  /api/portal/:token/statement[?from&asOf&format=pdf]
 *   GET  /api/portal/:token/quotes ; POST /api/portal/:token/quotes/:id/respond
 *   GET  /api/portal/:token/documents ; POST /api/portal/:token/documents (upload)
 *
 * Identity is the contact id carried by the token. Only issued documents (sent, posted,
 * partial, paid) are ever listed or downloadable; drafts, void and cancelled are 404.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { storage } from "../storage";
import { db, pool } from "../db";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { generateInvoicePDF } from "../services/pdf-invoice.service";
import {
  invoices,
  portalQuoteResponses,
  quotes,
  users,
  type CustomerContact,
} from "../../shared/schema";
import {
  bindPortalUserBody,
  generatePortalAccessBody,
  portalLoginRequestBody,
  portalLoginVerifyBody,
  portalQuoteResponseBody,
  revokePortalAccessBody,
  statementQuery,
  type GeneratePortalAccessBody,
  type PortalQuoteResponseBody,
} from "../../shared/validators/portal";
import {
  allowCodeRequest,
  bindPortalUser,
  checkPortalThrottle,
  clientIp,
  createLoginCode,
  hashPortalToken,
  issuePortalLink,
  listPortalAccessLog,
  listPortalLinks,
  logPortalAccess,
  recordPortalFailure,
  resolvePortalToken,
  revokePortalLinks,
  unbindPortalUser,
  verifyLoginCode,
} from "../services/portal-access.service";
import { buildCustomerStatement, renderStatementPdf } from "../services/customer-statement.service";
import {
  contentDisposition,
  createVaultDocument,
  listVaultDocuments,
  readValidatedUpload,
} from "../services/document-vault.service";
import { checkoutForInvoice, paymentsAvailability, publicBaseUrl } from "../services/payments";
import { escapeHtml, renderBilingualEmail, sendEmail } from "../services/email.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISSUED_STATUSES = ["sent", "posted", "partial", "paid"] as const;

/**
 * Throttle a public portal/share request per IP and per token (R16-07). Answers 429 with
 * Retry-After when the caller is over the limit.
 */
export function portalGuard(scope: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const raw = req.params.token ?? req.params.shareToken ?? null;
    const reason = checkPortalThrottle(ip, raw ? `${scope}:${hashPortalToken(raw)}` : null);
    if (reason) {
      void logPortalAccess({ req, outcome: "throttled" });
      res.setHeader("Retry-After", "600");
      res.status(429).json({
        code: "PORTAL_RATE_LIMITED",
        message: "Too many requests. Please wait a few minutes and try again.",
      });
      return;
    }
    next();
  };
}

/** Count a bad credential against the caller's IP (used by share-link routes too). */
export function notePortalFailure(req: Request, outcome = "invalid"): void {
  recordPortalFailure(clientIp(req));
  if (req.path.startsWith("/api/public/")) void logPortalAccess({ req, outcome });
}

interface PortalCtx {
  contact: CustomerContact;
  tokenId: string;
  companyId: string;
}

/** Resolve the token or answer 404 / 410; every outcome is logged. */
async function portalContact(req: Request, res: Response): Promise<PortalCtx | null> {
  const r = await resolvePortalToken(req.params.token);
  if (r.status !== "ok") {
    notePortalFailure(req);
    await logPortalAccess({
      req,
      outcome: r.status,
      companyId: r.token?.companyId,
      contactId: r.token?.contactId,
      tokenId: r.token?.id,
    });
    if (r.status === "invalid") {
      res
        .status(404)
        .json({ code: "PORTAL_LINK_INVALID", message: "Invalid or expired portal link" });
    } else {
      res.status(410).json({
        code: r.status === "expired" ? "PORTAL_LINK_EXPIRED" : "PORTAL_LINK_REVOKED",
        message:
          r.status === "expired" ? "This portal link has expired" : "This portal link was revoked",
      });
    }
    return null;
  }
  await logPortalAccess({
    req,
    outcome: "ok",
    companyId: r.token.companyId,
    contactId: r.contact.id,
    tokenId: r.token.id,
  });
  return { contact: r.contact, tokenId: r.token.id, companyId: r.token.companyId };
}

async function staffContact(req: Request, contactId: string): Promise<CustomerContact> {
  const userId = (req.user as { id: string }).id;
  const contact = UUID_RE.test(contactId) ? await storage.getCustomerContact(contactId) : undefined;
  // Another tenant's contact is answered like a missing one (no existence oracle).
  if (!contact || !(await storage.hasCompanyAccess(userId, contact.companyId))) {
    throw new DomainError("CONTACT_NOT_FOUND", 404, undefined, "Contact not found");
  }
  return contact;
}

export interface PortalInvoiceRow {
  id: string;
  number: string;
  invoiceType: string;
  date: string;
  dueDate: string | null;
  currency: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  status: string;
  paymentStatus: "paid" | "partially_paid" | "overdue" | "unpaid" | "credit";
  einvoice: { status: string; uuid: string | null; hasXml: boolean } | null;
}

/** Issued documents of one contact with their open balance (R16-04/R16-06). */
export async function contactInvoices(
  companyId: string,
  contactId: string,
  invoiceId?: string
): Promise<PortalInvoiceRow[]> {
  const params: unknown[] = [companyId, contactId];
  let extra = "";
  if (invoiceId) {
    params.push(invoiceId);
    extra = "AND i.id = $3";
  }
  const { rows } = await pool.query(
    `SELECT i.id, i.number, i.invoice_type, i.date, i.due_date, i.currency, i.subtotal, i.vat_amount,
            i.total, i.status, i.einvoice_status, i.einvoice_uuid, (i.einvoice_xml IS NOT NULL) AS has_xml,
            (coalesce((SELECT SUM(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)
             + coalesce((SELECT SUM(-total) FROM invoices cn WHERE cn.original_invoice_id = i.id
                           AND cn.invoice_type = 'credit_note'
                           AND cn.status NOT IN ('void', 'cancelled', 'draft')), 0)
             + coalesce((SELECT SUM(amount) FROM customer_credit_allocations a
                          WHERE a.invoice_id = i.id AND a.kind = 'apply'), 0))::text AS settled
       FROM invoices i
      WHERE i.company_id = $1 AND i.contact_id = $2
        AND i.status IN ('sent', 'posted', 'partial', 'paid') ${extra}
      ORDER BY i.date DESC, i.number DESC`,
    params
  );
  const now = Date.now();
  return rows.map((r: Record<string, unknown>) => {
    const total = Number(r.total);
    const isCredit = r.invoice_type === "credit_note";
    const settled = isCredit ? 0 : Number(r.settled);
    const due = isCredit ? 0 : Math.max(0, Math.round((total - settled) * 100) / 100);
    const dueDate = r.due_date ? new Date(r.due_date as string) : null;
    return {
      id: r.id as string,
      number: r.number as string,
      invoiceType: r.invoice_type as string,
      date: new Date(r.date as string).toISOString(),
      dueDate: dueDate ? dueDate.toISOString() : null,
      currency: (r.currency as string) ?? "AED",
      subtotal: Number(r.subtotal),
      vatAmount: Number(r.vat_amount),
      total,
      amountPaid: Math.min(total, settled),
      amountDue: due,
      status: r.status as string,
      paymentStatus: isCredit
        ? "credit"
        : r.status === "paid" || due === 0
          ? "paid"
          : settled > 0
            ? "partially_paid"
            : dueDate && dueDate.getTime() < now
              ? "overdue"
              : "unpaid",
      einvoice: r.einvoice_status
        ? {
            status: r.einvoice_status as string,
            uuid: (r.einvoice_uuid as string | null) ?? null,
            hasXml: r.has_xml === true,
          }
        : null,
    };
  });
}

export function registerPortalPublicRoutes(app: Express) {
  // ─── Staff: portal links ──────────────────────────────────────────────────
  app.post(
    "/api/portal/generate-access",
    authMiddleware,
    strictBody(generatePortalAccessBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<GeneratePortalAccessBody>(req);
      const contact = await staffContact(req, body.contactId);
      const { token, expiresAt } = await issuePortalLink({
        companyId: contact.companyId,
        contactId: contact.id,
        createdBy: (req.user as { id: string }).id,
        ttlDays: body.ttlDays,
      });
      // The token is shown once; only its hash is stored.
      res.json({
        portalUrl: `/portal/${token}`,
        token,
        expiresAt: expiresAt.toISOString(),
        shownOnce: true,
      });
    })
  );

  app.post(
    "/api/portal/revoke-access",
    authMiddleware,
    strictBody(revokePortalAccessBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { contactId } = parsedBody<{ contactId: string }>(req);
      const contact = await staffContact(req, contactId);
      const revoked = await revokePortalLinks(contact.companyId, contact.id);
      res.json({ revoked });
    })
  );

  app.get(
    "/api/portal/contacts/:contactId/access",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const contact = await staffContact(req, req.params.contactId);
      res.json({
        links: await listPortalLinks(contact.companyId, contact.id),
        accessLog: await listPortalAccessLog(contact.companyId, contact.id),
      });
    })
  );

  app.post(
    "/api/portal/contacts/:contactId/portal-users",
    authMiddleware,
    strictBody(bindPortalUserBody),
    asyncHandler(async (req: Request, res: Response) => {
      const contact = await staffContact(req, req.params.contactId);
      const { userId } = parsedBody<{ userId: string }>(req);
      const [target] = await db
        .select({ id: users.id, userType: users.userType })
        .from(users)
        .where(eq(users.id, userId));
      if (
        !target ||
        target.userType !== "client_portal" ||
        !(await storage.hasCompanyAccess(userId, contact.companyId))
      ) {
        throw new DomainError(
          "PORTAL_USER_INVALID",
          400,
          { field: "userId" },
          "The user must be a client-portal member of this company"
        );
      }
      await bindPortalUser({
        companyId: contact.companyId,
        contactId: contact.id,
        userId,
        createdBy: (req.user as { id: string }).id,
      });
      res.status(201).json({ contactId: contact.id, userId });
    })
  );

  app.delete(
    "/api/portal/contacts/:contactId/portal-users/:userId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const contact = await staffContact(req, req.params.contactId);
      if (!UUID_RE.test(req.params.userId)) throw new DomainError("PORTAL_USER_INVALID", 400);
      res.json({ revoked: await unbindPortalUser(contact.companyId, req.params.userId) });
    })
  );

  // ─── Customer: one-time-code sign-in ──────────────────────────────────────
  app.post(
    "/api/portal/login/request",
    portalGuard("login"),
    // companyId here only names which supplier's portal the customer signs in to.
    strictBody(portalLoginRequestBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, email } = parsedBody<{ companyId: string; email: string }>(req);
      const generic = {
        message:
          "If this email belongs to a customer of this company, a sign-in code is on its way.",
      };
      if (!allowCodeRequest(email)) return res.json(generic);
      const created = await createLoginCode(companyId, email);
      await logPortalAccess({
        req,
        outcome: created ? "code_sent" : "code_no_match",
        companyId: created ? companyId : null,
        contactId: created?.contact.id ?? null,
      });
      if (created) {
        const company = await storage.getCompany(companyId);
        const html = renderBilingualEmail(
          {
            brandName: company?.name ?? "Muhasib.ai",
            heading: { en: "Your sign-in code", ar: "رمز الدخول الخاص بك" },
            paragraphs: {
              en: [
                `Use <strong style="font-size:20px;letter-spacing:4px;">${escapeHtml(created.code)}</strong> to open your customer portal. The code expires in 10 minutes.`,
              ],
              ar: [
                `استخدم الرمز <strong dir="ltr">${escapeHtml(created.code)}</strong> للدخول إلى بوابة العملاء. تنتهي صلاحيته خلال 10 دقائق.`,
              ],
            },
          },
          "bilingual"
        );
        await sendEmail(
          email,
          `Your portal sign-in code: ${created.code}`,
          `Code: ${created.code}`,
          {
            html,
            companyId,
            category: "portal_login",
            sensitive: true,
          }
        );
      }
      res.json(generic);
    })
  );

  app.post(
    "/api/portal/login/verify",
    portalGuard("login"),
    strictBody(portalLoginVerifyBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, email, code } = parsedBody<{
        companyId: string;
        email: string;
        code: string;
      }>(req);
      const session = await verifyLoginCode(companyId, email, code);
      if (!session) {
        notePortalFailure(req);
        await logPortalAccess({ req, outcome: "code_invalid" });
        throw new DomainError(
          "PORTAL_CODE_INVALID",
          401,
          undefined,
          "The code is invalid or expired"
        );
      }
      await logPortalAccess({
        req,
        outcome: "session_issued",
        companyId,
        contactId: session.contactId,
      });
      res.json({ token: session.token, expiresAt: session.expiresAt.toISOString() });
    })
  );

  // ─── Customer: token routes ───────────────────────────────────────────────
  app.get(
    "/api/portal/:token/info",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const company = await storage.getCompany(ctx.companyId);
      const payments = paymentsAvailability();
      res.json({
        customerName: ctx.contact.name,
        customerNameAr: ctx.contact.nameAr ?? null,
        contactPerson: ctx.contact.contactPerson || null,
        companyId: ctx.companyId,
        companyName: company?.name || "Muhasib.ai",
        companyLogo: company?.logoUrl || null,
        preferredLanguage: ctx.contact.preferredLanguage ?? null,
        onlinePayment: { available: payments.available, status: payments.status },
      });
    })
  );

  app.get(
    "/api/portal/:token/invoices",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const payments = paymentsAvailability();
      const rows = await contactInvoices(ctx.companyId, ctx.contact.id);
      res.json(
        rows.map((r) => ({
          ...r,
          canPayOnline: payments.available && r.invoiceType !== "credit_note" && r.amountDue > 0,
        }))
      );
    })
  );

  async function ownIssuedInvoice(ctx: PortalCtx, invoiceId: string) {
    if (!UUID_RE.test(invoiceId)) return null;
    const [row] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, ctx.companyId),
          eq(invoices.contactId, ctx.contact.id),
          inArray(invoices.status, [...ISSUED_STATUSES])
        )
      );
    return row ?? null;
  }

  app.get(
    "/api/portal/:token/invoices/:invoiceId/pdf",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const invoice = await ownIssuedInvoice(ctx, req.params.invoiceId);
      if (!invoice) {
        return res.status(404).json({ code: "INVOICE_NOT_FOUND", message: "Invoice not found" });
      }
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      const { invoicePdfOptions } = await import("./invoices.routes");
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

  // R16-19: the e-invoice document (UBL XML) and its status when one was generated.
  app.get(
    "/api/portal/:token/invoices/:invoiceId/einvoice",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const invoice = await ownIssuedInvoice(ctx, req.params.invoiceId);
      if (!invoice || !invoice.einvoiceXml) {
        return res
          .status(404)
          .json({ code: "EINVOICE_NOT_FOUND", message: "No e-invoice for this invoice" });
      }
      res.set({
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="einvoice-${invoice.number}.xml"`,
        "X-Einvoice-Status": invoice.einvoiceStatus ?? "generated",
      });
      res.send(invoice.einvoiceXml);
    })
  );

  app.post(
    "/api/portal/:token/invoices/:invoiceId/pay",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const invoice = await ownIssuedInvoice(ctx, req.params.invoiceId);
      if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
      if (!paymentsAvailability().available) {
        throw new DomainError(
          "PAYMENTS_REQUIRES_EXTERNAL",
          503,
          undefined,
          "Online payment is not available"
        );
      }
      const back = `${publicBaseUrl()}/portal/${req.params.token}`;
      res.json(
        await checkoutForInvoice({
          companyId: ctx.companyId,
          invoiceId: invoice.id,
          successUrl: `${back}?payment=success`,
          cancelUrl: `${back}?payment=cancelled`,
        })
      );
    })
  );

  app.get(
    "/api/portal/:token/statement",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const q = statementQuery.parse(req.query);
      const st = await buildCustomerStatement({
        companyId: ctx.companyId,
        contactId: ctx.contact.id,
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
    "/api/portal/:token/quotes",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const rows = await db
        .select({
          id: quotes.id,
          number: quotes.number,
          date: quotes.date,
          expiryDate: quotes.expiryDate,
          currency: quotes.currency,
          subtotal: quotes.subtotal,
          vatAmount: quotes.vatAmount,
          total: quotes.total,
          status: quotes.status,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.companyId, ctx.companyId),
            eq(quotes.contactId, ctx.contact.id),
            inArray(quotes.status, ["sent", "accepted", "declined", "converted"])
          )
        );
      res.json(rows);
    })
  );

  app.post(
    "/api/portal/:token/quotes/:quoteId/respond",
    portalGuard("portal"),
    strictBody(portalQuoteResponseBody),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const body = parsedBody<PortalQuoteResponseBody>(req);
      if (!UUID_RE.test(req.params.quoteId)) throw new DomainError("QUOTE_NOT_FOUND", 404);
      const out = await db.transaction(async (tx: typeof db) => {
        // Only a sent, unexpired quote of THIS contact can be answered, once.
        const [q] = await tx
          .update(quotes)
          .set({ status: body.decision, updatedAt: new Date() })
          .where(
            and(
              eq(quotes.id, req.params.quoteId),
              eq(quotes.companyId, ctx.companyId),
              eq(quotes.contactId, ctx.contact.id),
              eq(quotes.status, "sent")
            )
          )
          .returning();
        if (!q) return null;
        if (q.expiryDate && new Date(q.expiryDate).getTime() < Date.now() - 86_400_000) {
          throw new DomainError("QUOTE_EXPIRED", 409, undefined, "This quote has expired");
        }
        await tx.insert(portalQuoteResponses).values({
          companyId: ctx.companyId,
          quoteId: q.id,
          contactId: ctx.contact.id,
          decision: body.decision,
          signerName: body.signerName,
          comment: body.comment ?? null,
          ip: clientIp(req),
        });
        return q;
      });
      if (!out) {
        throw new DomainError("QUOTE_NOT_OPEN", 409, undefined, "This quote cannot be answered");
      }
      res.json({ id: out.id, number: out.number, status: out.status });
    })
  );

  app.get(
    "/api/portal/:token/documents",
    portalGuard("portal"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const docs = await listVaultDocuments(ctx.companyId, { contactId: ctx.contact.id });
      res.json(
        docs.map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          fileName: d.fileName,
          fileSize: d.fileSize,
          mimeType: d.mimeType,
          source: d.source,
          createdAt: d.createdAt,
        }))
      );
    })
  );

  // R16-16: the customer uploads a file into the company's vault (bound to their contact).
  app.post(
    "/api/portal/:token/documents",
    portalGuard("portal_upload"),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await portalContact(req, res);
      if (!ctx) return;
      const { meta, file } = await readValidatedUpload(req);
      const actor = await pool.query(
        `SELECT user_id FROM company_users WHERE company_id = $1
          ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
        [ctx.companyId]
      );
      if (!actor.rows[0]) throw new DomainError("NO_COMPANY_USER", 409);
      const doc = await createVaultDocument({
        companyId: ctx.companyId,
        uploadedBy: actor.rows[0].user_id,
        file,
        name: meta.name ?? `${ctx.contact.name} — ${file.fileName}`,
        category: meta.category ?? "other",
        description:
          meta.description ?? `Uploaded by ${ctx.contact.name} through the customer portal`,
        contactId: ctx.contact.id,
        source: "customer_portal",
        note: meta.note ?? null,
      });
      res.status(201).json({
        id: doc.id,
        name: doc.name,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        contentDisposition: contentDisposition(doc.fileName),
      });
    })
  );
}
