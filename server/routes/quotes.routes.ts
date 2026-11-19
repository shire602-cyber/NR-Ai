// Quotes (W3-A: R03-11, R03-24).
//
// * Create / update are strict (shared/validators/quotes.ts): number, status,
//   convertedInvoiceId, companyId and totals are server-owned; lines carry the
//   same supply-type / discount contract as invoices; totals come from
//   document-totals (fils).
// * Conversion to an invoice is ATOMIC: the quote row is locked, the invoice
//   number is allocated, the invoice + lines are inserted, the quote lines'
//   billed quantities advance and — when everything is billed — the quote is
//   marked converted with a conditional UPDATE ... WHERE status <> 'converted'
//   RETURNING, all in ONE transaction. Twenty parallel conversions produce
//   exactly one invoice.
// * Progress billing: convert with `lines: [{ quoteLineId, quantity }]` to
//   invoice part of a quote; the rest stays billable.
import type { Express, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { db, pool } from "../db";
import { assertRefsOwned } from "../tenancy";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  quoteLines as quoteLinesTable,
  quotes as quotesTable,
  type Quote,
  type QuoteLine,
} from "../../shared/schema";
import {
  convertQuoteSchema,
  createQuoteSchema,
  quoteStatusSchema,
  updateQuoteSchema,
  type ConvertQuoteInput,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from "../../shared/validators/quotes";
import type { SalesLineInput } from "../../shared/validators/invoices";
import { generateQuotePDF } from "../services/pdf-quote.service";
import { hasEmailProvider, sendEmail } from "../services/email.service";
import { issuePortalLink } from "../services/portal-access.service";
import { publicBaseUrl } from "../services/payments";
import {
  quoteSendEmailSchema,
  type QuoteSendEmailInput,
} from "../../shared/validators/sales-documents";
import { createLogger } from "../config/logger";
import { allocateInvoiceNumber } from "../services/invoice-numbering.service";
import {
  dueDateFromTerms,
  prepareSalesLines,
  termsFromDays,
  type PreparedSalesLine,
} from "../services/invoice-lifecycle";
import {
  assertPlaceOfSupply,
  loadVatJurisdiction,
  resolveCustomerHeader,
} from "../services/invoice-posting.service";
import { documentCurrency, loadBaseCurrency } from "../ledger";
import { transitionQuote, type QuoteStatus } from "../services/quote-state.service";
import { fromFils, mulRate, toFils } from "../../shared/money";
import { resolveDocumentRate } from "./invoices.routes";
import { emitDomainEvent } from "../platform/domain-events";
import type { SupplyType, VatJurisdiction } from "../../shared/vat-classification";

const logger = createLogger("quotes-routes");

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date | string | null | undefined): string | null =>
  d ? (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10) : null;

/** Load a quote the user may see (404 otherwise, never 403 for another tenant's id). */
async function quoteForUser(userId: string, id: string): Promise<Quote> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("QUOTE_NOT_FOUND", 404);
  const quote = await storage.getQuote(id);
  if (!quote || !(await storage.hasCompanyAccess(userId, quote.companyId))) {
    throw new DomainError("QUOTE_NOT_FOUND", 404, undefined, "Quote not found");
  }
  return quote;
}

function draftsOf(lines: SalesLineInput[]) {
  return lines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    vatRate: l.vatRate,
    vatSupplyType: l.vatSupplyType ?? null,
    discountType: l.discountType ?? null,
    discountValue: l.discountValue ?? null,
    productId: l.productId ?? null,
    costCenterId: l.costCenterId ?? null,
  }));
}

function quoteLineRow(quoteId: string, r: PreparedSalesLine) {
  return {
    quoteId,
    description: r.description,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    vatRate: r.vatRate,
    vatSupplyType: r.vatSupplyType,
    discountType: r.discountType,
    discountValue: r.discountValue,
    discountAmount: r.discountAmount,
    productId: r.productId,
    costCenterId: r.costCenterId,
  };
}

async function prepareQuote(companyId: string, body: CreateQuoteInput) {
  const header = await resolveCustomerHeader(
    companyId,
    {
      contactId: body.contactId,
      customerName: body.customerName,
      customerTrn: body.customerTrn,
      customerAddress: body.customerAddress,
      paymentTerms: body.paymentTerms,
      placeOfSupplyEmirate: body.placeOfSupplyEmirate,
      date: body.date,
    },
    { dueDateFromTerms, termsFromDays }
  );
  await assertRefsOwned(pool, companyId, {
    product: body.lines.map((l) => l.productId),
    costCenter: body.lines.map((l) => l.costCenterId),
  });
  const { rows, totals } = prepareSalesLines(draftsOf(body.lines), {
    discountType: body.discountType,
    discountValue: body.discountValue,
    jurisdiction: await loadVatJurisdiction(companyId),
  });
  return { header, rows, totals };
}

export function registerQuoteRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/quotes",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      res.json(await storage.getQuotesByCompanyId(companyId));
    })
  );

  app.get(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await quoteForUser(userOf(req), req.params.id);
      const lines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.json({ ...quote, lines });
    })
  );

  app.post(
    "/api/companies/:companyId/quotes",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    strictBody(createQuoteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(userOf(req), companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const body = validated<CreateQuoteInput>(req);
      const q = await prepareQuote(companyId, body);
      const currency = documentCurrency(body.currency, await loadBaseCurrency(companyId));
      const quote = await db.transaction(async (tx: typeof db) => {
        const number = await allocateInvoiceNumber(companyId, "quote", toDate(body.date), tx);
        const [row] = await tx
          .insert(quotesTable)
          .values({
            companyId,
            number,
            customerName: q.header.customerName,
            customerTrn: q.header.customerTrn,
            customerAddress: q.header.customerAddress,
            contactId: q.header.contactId,
            paymentTerms: q.header.paymentTerms,
            placeOfSupplyEmirate: q.header.placeOfSupplyEmirate,
            date: toDate(body.date),
            expiryDate: body.expiryDate ? toDate(body.expiryDate) : null,
            // S1 (W5-C follow-up): default to the company's functional currency, not AED.
            currency,
            subtotal: Number(fromFils(q.totals.subtotalFils)),
            vatAmount: Number(fromFils(q.totals.vatFils)),
            total: Number(fromFils(q.totals.totalFils)),
            discountType: body.discountType ?? null,
            discountValue: body.discountValue ?? null,
            discountAmount: Number(fromFils(q.totals.discountFils)),
            notes: body.notes ?? null,
            status: "draft",
          })
          .returning();
        for (const r of q.rows) await tx.insert(quoteLinesTable).values(quoteLineRow(row.id, r));
        return row;
      });
      const lines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.status(201).json({ ...quote, lines });
    })
  );

  app.put(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    strictBody(updateQuoteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await quoteForUser(userOf(req), req.params.id);
      if (!["draft", "sent"].includes(quote.status)) {
        throw new DomainError(
          "QUOTE_NOT_EDITABLE",
          409,
          { status: quote.status },
          `A ${quote.status} quote cannot be edited.`
        );
      }
      const body = validated<UpdateQuoteInput>(req);
      const stored = await storage.getQuoteLinesByQuoteId(quote.id);
      if (body.lines && stored.some((l) => Number(l.billedQuantity) > 0)) {
        throw new DomainError(
          "QUOTE_PARTLY_BILLED",
          409,
          undefined,
          "Lines of a partly billed quote cannot be changed."
        );
      }
      const merged: CreateQuoteInput = {
        contactId: body.contactId !== undefined ? body.contactId : quote.contactId,
        customerName: body.customerName ?? (body.contactId ? undefined : quote.customerName),
        customerTrn: body.customerTrn !== undefined ? body.customerTrn : quote.customerTrn,
        customerAddress:
          body.customerAddress !== undefined ? body.customerAddress : quote.customerAddress,
        date: body.date ?? isoOf(quote.date)!,
        expiryDate: body.expiryDate !== undefined ? body.expiryDate : isoOf(quote.expiryDate),
        currency: body.currency ?? quote.currency,
        paymentTerms: body.paymentTerms !== undefined ? body.paymentTerms : quote.paymentTerms,
        placeOfSupplyEmirate:
          body.placeOfSupplyEmirate !== undefined
            ? body.placeOfSupplyEmirate
            : quote.placeOfSupplyEmirate,
        discountType: body.discountType !== undefined ? body.discountType : quote.discountType,
        discountValue: body.discountValue !== undefined ? body.discountValue : quote.discountValue,
        notes: body.notes !== undefined ? body.notes : quote.notes,
        lines:
          body.lines ??
          stored.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: toFils(l.unitPrice, { rounding: "halfUp" }),
            vatRate: Number(l.vatRate),
            vatSupplyType: (l.vatSupplyType as SupplyType | null) ?? null,
            discountType: (l.discountType as "amount" | "percent" | null) ?? null,
            discountValue: l.discountValue ?? null,
            productId: l.productId ?? null,
            costCenterId: l.costCenterId ?? null,
          })),
      } as CreateQuoteInput;
      const q = await prepareQuote(quote.companyId, merged);
      const currency = documentCurrency(merged.currency, await loadBaseCurrency(quote.companyId));
      const updated = await db.transaction(async (tx: typeof db) => {
        // companyId is never taken from the body (R03-11 route-matrix finding).
        const [row] = await tx
          .update(quotesTable)
          .set({
            customerName: q.header.customerName,
            customerTrn: q.header.customerTrn,
            customerAddress: q.header.customerAddress,
            contactId: q.header.contactId,
            paymentTerms: q.header.paymentTerms,
            placeOfSupplyEmirate: q.header.placeOfSupplyEmirate,
            date: toDate(merged.date),
            expiryDate: merged.expiryDate ? toDate(merged.expiryDate) : null,
            currency,
            subtotal: Number(fromFils(q.totals.subtotalFils)),
            vatAmount: Number(fromFils(q.totals.vatFils)),
            total: Number(fromFils(q.totals.totalFils)),
            discountType: merged.discountType ?? null,
            discountValue: merged.discountValue ?? null,
            discountAmount: Number(fromFils(q.totals.discountFils)),
            notes: merged.notes ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(quotesTable.id, quote.id), eq(quotesTable.companyId, quote.companyId)))
          .returning();
        if (body.lines) {
          await tx.delete(quoteLinesTable).where(eq(quoteLinesTable.quoteId, quote.id));
          for (const r of q.rows)
            await tx.insert(quoteLinesTable).values(quoteLineRow(quote.id, r));
        }
        return row;
      });
      const lines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.json({ ...updated, lines });
    })
  );

  app.patch(
    "/api/quotes/:id/status",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    strictBody(quoteStatusSchema, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await quoteForUser(userOf(req), req.params.id);
      const { status } = req.body as { status: QuoteStatus };
      // S1: the quote state machine owns status changes (conditional UPDATE, 409 on a bad move).
      const row = await transitionQuote({
        companyId: quote.companyId,
        quoteId: quote.id,
        to: status,
      });
      res.json(row);
    })
  );

  app.delete(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await quoteForUser(userOf(req), req.params.id);
      if (quote.status === "converted" || quote.convertedInvoiceId) {
        throw new DomainError(
          "QUOTE_ALREADY_CONVERTED",
          409,
          undefined,
          "A converted quote cannot be deleted."
        );
      }
      await storage.deleteQuote(quote.id);
      res.json({ message: "Quote deleted" });
    })
  );

  app.post(
    "/api/quotes/:id/convert-to-invoice",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    strictBody(convertQuoteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const quote = await quoteForUser(userId, req.params.id);
      const body = validated<ConvertQuoteInput>(req);
      const dateIso = body.date ?? new Date().toISOString().slice(0, 10);
      const currency = documentCurrency(quote.currency, await loadBaseCurrency(quote.companyId));
      // Outside the transaction (may read the pool): rate and terms.
      const rate = await resolveDocumentRate(quote.companyId, currency, dateIso, null);
      const result = await convertQuoteAtomically(
        quote,
        body,
        dateIso,
        rate,
        await loadVatJurisdiction(quote.companyId)
      );
      logger.info(
        { quoteId: quote.id, invoiceId: result.invoice.id, full: result.fullyBilled },
        "Quote converted to invoice"
      );
      emitDomainEvent("invoice.created", {
        companyId: quote.companyId,
        entityId: result.invoice.id,
        number: result.invoice.number,
        totalFils: toFils(result.invoice.total, { rounding: "halfUp" }),
        actorUserId: userId,
      });
      res.json({
        invoice: result.invoice,
        fullyBilled: result.fullyBilled,
        message: result.fullyBilled
          ? "Quote converted to invoice"
          : "Partial invoice created from quote",
      });
    })
  );

  app.get(
    "/api/quotes/:id/pdf",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await quoteForUser(userOf(req), req.params.id);
      const lines = await storage.getQuoteLinesByQuoteId(quote.id);
      const company = await storage.getCompany(quote.companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const pdfBuffer = await generateQuotePDF(quote, lines, company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quote-${quote.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );

  // WQ1 (7.5): send a quote by email through the durable outbox — the PDF is attached and, when
  // the quote has a contact, a customer-portal link where the customer can accept or decline it.
  // Nothing reads "sent" without an email provider: the message stays queued and a draft quote
  // keeps its status until the provider has taken it.
  app.post(
    "/api/quotes/:id/send-email",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    strictBody(quoteSendEmailSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userOf(req);
      const quote = await quoteForUser(userId, req.params.id);
      if (["declined", "expired", "converted"].includes(quote.status)) {
        throw new DomainError(
          "QUOTE_NOT_SENDABLE",
          409,
          { status: quote.status },
          `A ${quote.status} quote is not sent again`
        );
      }
      const { to, subject, message } = req.body as QuoteSendEmailInput;
      const company = await storage.getCompany(quote.companyId);
      if (!company)
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      const lines = await storage.getQuoteLinesByQuoteId(quote.id);
      const pdf = await generateQuotePDF(quote, lines, company);
      let portalUrl: string | null = null;
      if (quote.contactId) {
        const link = await issuePortalLink({
          companyId: quote.companyId,
          contactId: quote.contactId,
          createdBy: userId,
          revokeExisting: false,
        });
        portalUrl = `${publicBaseUrl()}/portal/${link.token}`;
      }
      const body = [
        message?.trim() || `Please find quote ${quote.number} from ${company.name} attached.`,
        portalUrl ? `View, accept or decline the quote online: ${portalUrl}` : null,
        `يرجى الاطلاع على عرض السعر ${quote.number} المرفق.`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const result = await sendEmail(
        to,
        subject?.trim() || `Quote ${quote.number} from ${company.name}`,
        body,
        {
          fromName: company.name,
          companyId: company.id,
          category: "quote",
          relatedEntityType: "quote",
          relatedEntityId: quote.id,
          replyTo: company.contactEmail ?? null,
          attachments: [
            { filename: `quote-${quote.number}.pdf`, content: pdf, contentType: "application/pdf" },
          ],
        }
      );
      let status = quote.status;
      if (result.sent && quote.status === "draft") {
        status = (
          await transitionQuote({ companyId: quote.companyId, quoteId: quote.id, to: "sent" })
        ).status;
      }
      await storage.createActivityLog({
        userId,
        companyId: quote.companyId,
        action: "send",
        entityType: "quote",
        entityId: quote.id,
        description: result.sent
          ? `Quote ${quote.number} sent by email to ${to}`
          : `Quote ${quote.number} email to ${to} queued (${result.status})`,
        metadata: JSON.stringify({ to, outbox: result.id ?? null, status: result.status }),
      });
      res.status(result.sent ? 200 : 202).json({
        sent: result.sent,
        queued: result.queued,
        status: result.status,
        outboxId: result.id ?? null,
        emailConfigured: hasEmailProvider(),
        quoteStatus: status,
        message: result.sent
          ? `Quote ${quote.number} sent to ${to}`
          : result.status === "blocked_no_provider"
            ? `Email not configured — quote ${quote.number} is queued, not sent.`
            : `Quote ${quote.number} is queued for delivery (${result.status}).`,
      });
    })
  );
}

/**
 * Convert (all or the requested part of) a quote to ONE draft invoice inside a
 * single transaction (see header comment).
 */
export async function convertQuoteAtomically(
  quote: Quote,
  body: ConvertQuoteInput,
  dateIso: string,
  rate: number,
  jurisdiction: VatJurisdiction = "AE"
): Promise<{ invoice: typeof invoicesTable.$inferSelect; fullyBilled: boolean }> {
  return db.transaction(async (tx: typeof db) => {
    const locked = await tx.execute(
      sql`SELECT status FROM quotes WHERE id = ${quote.id} AND company_id = ${quote.companyId} FOR UPDATE`
    );
    const status = (
      ((locked as { rows?: unknown[] }).rows ?? locked) as Array<{ status: string }>
    )[0]?.status;
    if (!status) throw new DomainError("QUOTE_NOT_FOUND", 404);
    if (status === "converted") {
      throw new DomainError("QUOTE_ALREADY_CONVERTED", 409, undefined, "Quote already converted");
    }
    if (status === "declined" || status === "expired") {
      throw new DomainError("QUOTE_NOT_CONVERTIBLE", 409, { status });
    }
    const lines: QuoteLine[] = await tx
      .select()
      .from(quoteLinesTable)
      .where(eq(quoteLinesTable.quoteId, quote.id));
    const remainingOf = (l: QuoteLine) =>
      Math.max(0, Number(l.quantity) - Number(l.billedQuantity ?? 0));
    let bill: Array<{ line: QuoteLine; quantity: number }>;
    if (body.lines?.length) {
      bill = body.lines.map((req) => {
        const line = lines.find((l) => l.id === req.quoteLineId);
        if (!line)
          throw new DomainError("QUOTE_LINE_NOT_FOUND", 404, { quoteLineId: req.quoteLineId });
        if (req.quantity > remainingOf(line) + 1e-9) {
          throw new DomainError(
            "QUOTE_LINE_OVERBILLED",
            409,
            { quoteLineId: line.id, remaining: remainingOf(line) },
            "Requested quantity exceeds what is left to bill on the quote line."
          );
        }
        return { line, quantity: req.quantity };
      });
    } else {
      bill = lines
        .filter((l) => remainingOf(l) > 0)
        .map((l) => ({ line: l, quantity: remainingOf(l) }));
    }
    if (!bill.length) throw new DomainError("QUOTE_FULLY_BILLED", 409);

    // A document discount on the quote applies pro-rata to what is billed only
    // when the whole quote is billed in one go; partial bills carry line discounts.
    const wholeQuote =
      !body.lines?.length && lines.every((l) => Number(l.billedQuantity ?? 0) === 0);
    const { rows, totals } = prepareSalesLines(
      bill.map(({ line, quantity }) => ({
        description: line.description,
        quantity,
        unitPrice: toFils(line.unitPrice, { rounding: "halfUp" }),
        vatRate: Number(line.vatRate),
        vatSupplyType: (line.vatSupplyType as SupplyType | null) ?? null,
        discountType:
          line.discountType === "amount" && quantity !== Number(line.quantity)
            ? null
            : ((line.discountType as "amount" | "percent" | null) ?? null),
        discountValue:
          line.discountType === "amount" && quantity !== Number(line.quantity)
            ? null
            : (line.discountValue ?? null),
        productId: line.productId ?? null,
        costCenterId: line.costCenterId ?? null,
      })),
      {
        ...(wholeQuote
          ? { discountType: quote.discountType, discountValue: quote.discountValue }
          : {}),
        jurisdiction,
      }
    );
    await assertPlaceOfSupply(
      quote.companyId,
      quote.placeOfSupplyEmirate,
      rows.map((r) => r.vatSupplyType)
    );

    const invoiceDate = toDate(dateIso);
    const number = await allocateInvoiceNumber(quote.companyId, "invoice", invoiceDate, tx);
    const terms = quote.paymentTerms ?? "net30";
    const due = dueDateFromTerms(dateIso, terms);
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        companyId: quote.companyId,
        number,
        customerName: quote.customerName,
        customerTrn: quote.customerTrn,
        customerAddress: quote.customerAddress,
        contactId: quote.contactId,
        paymentTerms: terms,
        dueDate: due ? toDate(due) : null,
        placeOfSupplyEmirate: quote.placeOfSupplyEmirate,
        date: invoiceDate,
        currency: quote.currency,
        exchangeRate: rate,
        baseCurrencyAmount: Number(
          fromFils(totals.totalFils ? mulRate(totals.totalFils, rate) : 0)
        ),
        subtotal: Number(fromFils(totals.subtotalFils)),
        vatAmount: Number(fromFils(totals.vatFils)),
        total: Number(fromFils(totals.totalFils)),
        discountType: wholeQuote ? quote.discountType : null,
        discountValue: wholeQuote ? quote.discountValue : null,
        discountAmount: Number(fromFils(totals.discountFils)),
        notes: quote.notes,
        sourceQuoteId: quote.id,
        status: "draft",
        invoiceType: "invoice",
      })
      .returning();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await tx.insert(invoiceLinesTable).values({
        invoiceId: invoice.id,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        vatRate: r.vatRate,
        vatSupplyType: r.vatSupplyType,
        discountType: r.discountType,
        discountValue: r.discountValue,
        discountAmount: r.discountAmount,
        netAmount: r.netAmount,
        productId: r.productId,
        costCenterId: r.costCenterId,
        quoteLineId: bill[i].line.id,
      });
      await tx
        .update(quoteLinesTable)
        .set({ billedQuantity: sql`${quoteLinesTable.billedQuantity} + ${bill[i].quantity}` })
        .where(eq(quoteLinesTable.id, bill[i].line.id));
    }
    const after: QuoteLine[] = await tx
      .select()
      .from(quoteLinesTable)
      .where(eq(quoteLinesTable.quoteId, quote.id));
    const fullyBilled = after.every((l) => Number(l.billedQuantity) >= Number(l.quantity) - 1e-9);
    if (fullyBilled) {
      const [row] = await tx
        .update(quotesTable)
        .set({ status: "converted", convertedInvoiceId: invoice.id, updatedAt: new Date() })
        .where(and(eq(quotesTable.id, quote.id), sql`${quotesTable.status} <> 'converted'`))
        .returning({ id: quotesTable.id });
      if (!row) throw new DomainError("QUOTE_ALREADY_CONVERTED", 409);
    } else if (status !== "accepted") {
      // Part billed: the quote is accepted (state machine; draft/sent -> accepted).
      await transitionQuote({ companyId: quote.companyId, quoteId: quote.id, to: "accepted", tx });
    }
    return { invoice, fullyBilled };
  });
}
