import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { generateQuotePDF } from "../services/pdf-quote.service";
import { createLogger } from "../config/logger";
import { allocateInvoiceNumber } from "../services/invoice-numbering.service";
import { db } from "../db";
import { resolveDocumentExchangeRate } from "../services/document-fx-rate";
import { checkRevenueAccountsForCompany } from "../services/revenue-account-guard.service";
import { deriveVatSupplyType } from "../services/vat-supply-type";
import { UAE_VAT_RATE } from "../constants";
import { normalizeDocumentLines } from "../services/document-line-limits";
import { checkProductsForCompany } from "../services/inventory-costing.service";
import { QUOTE_WRITABLE_FIELDS, documentDiscountSchema, pickWritable } from "../services/sales-input";
import { checkContactForCompany, editableLinesOf, itemsSubtotalOf, replaceInvoiceLines, replaceQuoteLines, type SalesLineSource } from "../services/sales-lines.service";
import { checkPriceListsForCompany } from "../services/price-list.service";
import { deriveSalesLines } from "../../shared/sales-line-math";
import { isQuoteDeletable, isQuoteEditable, canQuoteTransition } from "../services/quote-state-machine";
import { AppError } from "../errors";
import { parseCalendarDay } from "../utils/date";
import { serviceRevenueAccountId } from "../services/service-revenue";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { reviseQuote, sendQuote, getSignature } from "../services/quote-acceptance.service";
import { convertQuoteToSalesOrder, getSalesOrder } from "../services/sales-order.service";
import { copyValues } from "../services/custom-fields.service";
import { and, asc, eq, inArray } from "drizzle-orm";
import { invoices as invoicesTable, quoteLines as quoteLinesTable, quotes as quotesTable } from "../../shared/schema";
import { z } from "zod";

// Quote lines are stored as the client sent them, so normalise the supply
// type (0% lines are zero-rated, never the column default) on the way in.
function withSupplyType(line: any) {
  const rate = Number(line?.vatRate ?? UAE_VAT_RATE);
  const productId =
    typeof line?.productId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.productId)
      ? line.productId
      : null;
  return {
    ...line,
    productId,
    vatSupplyType: deriveVatSupplyType(rate === 5 ? UAE_VAT_RATE : rate, line?.vatSupplyType),
  };
}

const logger = createLogger("quotes-routes");

// Client payloads carry ISO strings; Drizzle timestamp columns want Dates.
function normalizeQuoteDates<T extends { date?: unknown; expiryDate?: unknown }>(data: T): T {
  const out: any = { ...data };
  // Document-date contract (utils/date.ts): a calendar day or an instant, stored as the UAE calendar day.
  if (out.date) out.date = parseCalendarDay(out.date) ?? new Date(out.date);
  if (out.expiryDate) out.expiryDate = parseCalendarDay(out.expiryDate) ?? new Date(out.expiryDate);
  return out;
}

/** Client quote lines -> the input of the line derivation (shared/sales-line-math.ts). */
function toQuoteSources(lines: any[]): { ok: true; sources: SalesLineSource[] } | { ok: false; message: string } {
  const sources: SalesLineSource[] = [];
  for (const raw of lines) {
    const l = withSupplyType(raw);
    if (typeof l.description !== "string" || l.description.trim() === "") {
      return { ok: false, message: "Every quote line needs a description." };
    }
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice < 0) {
      return { ok: false, message: "Every quote line needs a quantity above 0 and a price of 0 or more." };
    }
    const rate = Number(l.vatRate ?? UAE_VAT_RATE);
    const shipping = l.lineKind === "shipping";
    const discountValue = l.discountValue === null || l.discountValue === undefined || l.discountValue === "" ? null : Number(l.discountValue);
    sources.push({
      kind: shipping ? "shipping" : "item",
      description: l.description,
      quantity,
      unitPrice,
      vatRate: (shipping && (raw?.vatRate === undefined || raw?.vatRate === null) ? undefined : (rate === 5 ? UAE_VAT_RATE : rate)) as number,
      vatSupplyType: l.vatSupplyType,
      discountType: shipping ? null : (l.discountType === "percent" || l.discountType === "amount" ? l.discountType : null),
      discountValue: shipping ? null : discountValue,
      revenueAccountId: l.revenueAccountId ?? null,
      productId: l.productId ?? null,
      priceListId: shipping ? null : (l.priceListId ?? null),
    });
  }
  return { ok: true, sources };
}

export function registerQuoteRoutes(app: Express) {
  // =====================================
  // Quote Routes
  // =====================================

  // Customer-only: List quotes by company
  app.get(
    "/api/companies/:companyId/quotes",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const quotes = await storage.getQuotesByCompanyId(companyId);
      res.json(quotes);
    })
  );

  // Customer-only: Get single quote with lines
  app.get(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const lines = await storage.getQuoteLinesByQuoteId(id);
      res.json({ ...quote, itemsSubtotal: itemsSubtotalOf(lines), lines });
    })
  );

  // Customer-only: Create quote with lines
  app.post(
    "/api/companies/:companyId/quotes",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const rawLines = req.body?.lines;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Allow-list: status, share token, signatures and every other server-owned column never come from a body.
      const quoteData: Record<string, any> = pickWritable(req.body, [...QUOTE_WRITABLE_FIELDS, "date"]);
      const documentDiscount = documentDiscountSchema.parse(req.body ?? {});
      const contactCheck = await checkContactForCompany(companyId, quoteData.contactId);
      if (!contactCheck.ok) return res.status(422).json({ message: contactCheck.message, code: contactCheck.code });
      if (typeof quoteData.customerName !== "string" || quoteData.customerName.trim() === "") {
        return res.status(400).json({ message: "customerName is required" });
      }
      if (!quoteData.date) quoteData.date = new Date();

      // Cap and round quantity / unit price to what the columns can store.
      const lines = Array.isArray(rawLines) ? normalizeDocumentLines(rawLines) : [];
      if (lines.length === 0) {
        return res.status(400).json({ message: "At least one quote line is required" });
      }
      const parsed = toQuoteSources(lines);
      if (!parsed.ok) return res.status(400).json({ message: parsed.message });

      const revenueCheck = await checkRevenueAccountsForCompany(companyId, parsed.sources.map((l) => l.revenueAccountId));
      if (!revenueCheck.ok) {
        return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
      }
      const productCheck = await checkProductsForCompany(companyId, parsed.sources.map((l) => l.productId));
      if (!productCheck.ok) {
        return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
      }
      const priceListCheck = await checkPriceListsForCompany(companyId, parsed.sources.map((l) => l.priceListId));
      if (!priceListCheck.ok) return res.status(422).json({ message: priceListCheck.message, code: priceListCheck.code });
      const pre = deriveSalesLines({ lines: parsed.sources, discountType: documentDiscount.discountType, discountValue: documentDiscount.discountValue });
      if (!pre.ok) return res.status(422).json({ message: pre.message, code: pre.code });

      // `quotes.number` is NOT NULL and this route never set it, so any caller
      // that did not hand-type a number got an HTTP 500 from Postgres. Allocate
      // one server-side (QT-YYYY-00001) when the client omits it; an explicit
      // number is still honoured for imports and migrations.
      const suppliedNumber =
        typeof req.body?.number === "string" && req.body.number.trim() !== "" ? req.body.number.trim() : null;

      const quote = await db.transaction(async (tx: typeof db) => {
        const quoteNumber = suppliedNumber ?? (await allocateInvoiceNumber(companyId, "quote", new Date(), tx));
        const [inserted] = await tx
          .insert(quotesTable)
          .values({ ...normalizeQuoteDates(quoteData), number: quoteNumber, companyId, status: "draft" } as any)
          .returning();
        await replaceQuoteLines(tx, {
          companyId,
          quoteId: inserted.id,
          lines: parsed.sources,
          discountType: documentDiscount.discountType,
          discountValue: documentDiscount.discountValue,
        });
        const [stored] = await tx.select().from(quotesTable).where(eq(quotesTable.id, inserted.id));
        return stored;
      });

      const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.status(201).json({ ...quote, itemsSubtotal: itemsSubtotalOf(quoteLines), lines: quoteLines });
    })
  );

  // Customer-only: Update quote (a draft only: a quote that went out is revised first)
  app.put(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const rawLines = req.body?.lines;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      // `status` used to be taken from the body, so a client could mark a quote accepted or converted by hand.
      if (!isQuoteEditable(quote.status)) {
        return res.status(409).json({
          message: `A ${quote.status} quote cannot be edited. Revise it first to make it a draft again.`,
          code: "QUOTE_NOT_EDITABLE",
        });
      }

      const updateData: Record<string, any> = pickWritable(req.body, [...QUOTE_WRITABLE_FIELDS, "date"]);
      const documentDiscount = documentDiscountSchema.parse(req.body ?? {});
      const contactCheck = await checkContactForCompany(quote.companyId, updateData.contactId);
      if (!contactCheck.ok) return res.status(422).json({ message: contactCheck.message, code: contactCheck.code });

      let parsedLines: SalesLineSource[] | null = null;
      if (Array.isArray(rawLines)) {
        const lines = normalizeDocumentLines(rawLines);
        if (lines.length === 0) return res.status(400).json({ message: "At least one quote line is required" });
        const parsed = toQuoteSources(lines);
        if (!parsed.ok) return res.status(400).json({ message: parsed.message });
        parsedLines = parsed.sources;
        const revenueCheck = await checkRevenueAccountsForCompany(quote.companyId, parsedLines.map((l) => l.revenueAccountId));
        if (!revenueCheck.ok) {
          return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
        }
        const productCheck = await checkProductsForCompany(quote.companyId, parsedLines.map((l) => l.productId));
        if (!productCheck.ok) {
          return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
        }
        const priceListCheck = await checkPriceListsForCompany(quote.companyId, parsedLines.map((l) => l.priceListId));
        if (!priceListCheck.ok) return res.status(422).json({ message: priceListCheck.message, code: priceListCheck.code });
        const pre = deriveSalesLines({ lines: parsedLines, discountType: documentDiscount.discountType, discountValue: documentDiscount.discountValue });
        if (!pre.ok) return res.status(422).json({ message: pre.message, code: pre.code });
      }

      const updated = await withDocumentLock(id, LOCK_NS.QUOTE, async (tx: typeof db) => {
        const [fresh] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id));
        if (!fresh || !isQuoteEditable(fresh.status)) {
          throw new AppError({ message: "This quote can no longer be edited. Revise it first.", statusCode: 409, code: "QUOTE_NOT_EDITABLE" });
        }
        await tx
          .update(quotesTable)
          .set({ ...normalizeQuoteDates(updateData), updatedAt: new Date() } as any)
          .where(and(eq(quotesTable.id, id), eq(quotesTable.companyId, quote.companyId)));
        if (parsedLines) {
          await replaceQuoteLines(tx, {
            companyId: quote.companyId,
            quoteId: id,
            lines: parsedLines,
            discountType: documentDiscount.discountType,
            discountValue: documentDiscount.discountValue,
          });
        }
        const [row] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id));
        return row;
      });

      const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.json({ ...updated, itemsSubtotal: itemsSubtotalOf(quoteLines), lines: quoteLines });
    })
  );

  // Customer-only: Delete quote
  app.delete(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // A quote that went out and was accepted (or converted) is a record of an agreement: only drafts and
      // answered-no / expired quotes may go. A declined quote's signature record is kept for 5 years.
      if (!isQuoteDeletable(quote.status)) {
        return res.status(409).json({
          message: `A ${quote.status} quote cannot be deleted.`,
          code: "QUOTE_NOT_DELETABLE",
        });
      }

      await storage.deleteQuote(id);
      res.json({ message: "Quote deleted" });
    })
  );

  // Customer-only: Convert quote to invoice. ONE transaction under the quote's lock: the invoice, its lines and the
  // quote's status flip (compare-and-swap) commit together, so a crash or a second click can never leave a
  // converted quote without an invoice, or two invoices for one quote.
  app.post(
    "/api/quotes/:id/convert-to-invoice",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (quote.status === "converted") {
        return res.status(409).json({ message: "Quote already converted", code: "QUOTE_ALREADY_CONVERTED" });
      }
      if (!canQuoteTransition(quote.status, "convert")) {
        return res.status(409).json({ message: `A ${quote.status} quote cannot be converted.`, code: "QUOTE_NOT_CONVERTIBLE" });
      }

      // Carry the quote's currency over. Quotes store no exchange rate, and a
      // stored rate may be stale anyway, so a foreign-currency invoice takes the
      // rate for the conversion date from exchange_rates - the same lookup
      // invoice creation uses when the caller supplies none. Resolved before
      // the number is allocated so a missing rate cannot burn a number.
      const invoiceDate = new Date();
      const docCurrency = (quote.currency || "AED").toUpperCase();
      const fxResult = await resolveDocumentExchangeRate({
        currency: docCurrency,
        date: invoiceDate,
        companyId: quote.companyId,
        hint: "Add one under Exchange Rates, then convert the quote again.",
      });
      if (!fxResult.ok) {
        return res.status(422).json({ message: fxResult.message, code: fxResult.code });
      }
      const exchangeRate = fxResult.rate;

      const invoice = await withDocumentLock(id, LOCK_NS.QUOTE, async (tx: typeof db) => {
        const [fresh] = await tx.select().from(quotesTable).where(eq(quotesTable.id, id));
        if (!fresh) throw new AppError({ message: "Quote not found", statusCode: 404, code: "QUOTE_NOT_FOUND" });
        if (fresh.status === "converted") {
          throw new AppError({ message: "Quote already converted", statusCode: 409, code: "QUOTE_ALREADY_CONVERTED" });
        }
        if (!canQuoteTransition(fresh.status, "convert")) {
          throw new AppError({ message: `A ${fresh.status} quote cannot be converted.`, statusCode: 409, code: "QUOTE_NOT_CONVERTIBLE" });
        }
        // The number MUST come from the FTA sequential allocator (gap-free), inside this transaction so a
        // failed conversion gives the number back.
        const invoiceNumber = await allocateInvoiceNumber(quote.companyId, "invoice", invoiceDate, tx);
        const [inserted] = await tx
          .insert(invoicesTable)
          .values({
            companyId: quote.companyId,
            number: invoiceNumber,
            customerName: quote.customerName,
            customerTrn: quote.customerTrn,
            contactId: quote.contactId ?? null,
            date: invoiceDate,
            currency: docCurrency,
            exchangeRate,
            invoiceType: "invoice",
            status: "draft",
            subtotal: 0,
            vatAmount: 0,
            total: 0,
          } as any)
          .returning();
        // Lines (with their discounts and shipping) are rebuilt by the same derivation as a hand-made invoice, so
        // the totals are recomputed from the lines, never trusted from the quote row.
        const stored = await tx.select().from(quoteLinesTable).where(eq(quoteLinesTable.quoteId, id)).orderBy(asc(quoteLinesTable.sortOrder), asc(quoteLinesTable.id));
        const serviceAccountId = await serviceRevenueAccountId(tx, quote.companyId);
        await replaceInvoiceLines(tx, {
          companyId: quote.companyId,
          invoiceId: inserted.id,
          // A quote line that is not a product (and names no account of its own) is service income: 4020.
          lines: editableLinesOf(stored as any[]).map((l: any) =>
            l.kind === "item" && !l.productId && !l.revenueAccountId && serviceAccountId ? { ...l, revenueAccountId: serviceAccountId } : l
          ),
          discountType: (fresh.discountType as any) ?? null,
          discountValue: fresh.discountValue === null ? null : Number(fresh.discountValue),
          exchangeRate,
          itemExtras: (source) => ({ priceListId: source.priceListId ?? null }),
        });
        await copyValues(quote.companyId, { entity: "quote", recordId: id }, { entity: "invoice", recordId: inserted.id }, tx);
        const swapped = await tx
          .update(quotesTable)
          .set({ status: "converted", convertedInvoiceId: inserted.id, updatedAt: new Date() } as any)
          .where(and(eq(quotesTable.id, id), inArray(quotesTable.status, ["draft", "sent", "accepted"])))
          .returning({ id: quotesTable.id });
        if (swapped.length === 0) {
          throw new AppError({ message: "Quote already converted", statusCode: 409, code: "QUOTE_ALREADY_CONVERTED" });
        }
        const [row] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, inserted.id));
        return row;
      });

      logger.info({ quoteId: id, invoiceId: invoice.id }, "Quote converted to invoice");
      res.json({ invoice, message: "Quote converted to invoice" });
    })
  );

  // Customer-only: send the quote (mints the public link; emails it when an address is known)
  app.post(
    "/api/quotes/:id/send",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const quote = await storage.getQuote(req.params.id);
      if (!quote || !(await storage.hasCompanyAccess(userId, quote.companyId))) {
        return res.status(404).json({ message: "Quote not found" });
      }
      const body = z.object({ email: z.string().email().optional().nullable(), message: z.string().max(2000).optional().nullable() }).parse(req.body ?? {});
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : `${req.protocol}://${req.get("host")}`;
      const result = await sendQuote({ companyId: quote.companyId, quoteId: quote.id, userId, email: body.email, message: body.message, origin });
      res.json(result);
    })
  );

  // Customer-only: revise a sent / declined / expired quote back to a draft (revokes the link)
  app.post(
    "/api/quotes/:id/revise",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const quote = await storage.getQuote(req.params.id);
      if (!quote || !(await storage.hasCompanyAccess(userId, quote.companyId))) {
        return res.status(404).json({ message: "Quote not found" });
      }
      res.json(await reviseQuote({ companyId: quote.companyId, quoteId: quote.id }));
    })
  );

  // Customer-only: the signature record (who accepted or declined, when, from where)
  app.get(
    "/api/quotes/:id/signature",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const quote = await storage.getQuote(req.params.id);
      if (!quote || !(await storage.hasCompanyAccess(userId, quote.companyId))) {
        return res.status(404).json({ message: "Quote not found" });
      }
      res.json(await getSignature(quote.companyId, quote.id));
    })
  );

  // Customer-only: convert to a sales order (201); one conversion per quote
  app.post(
    "/api/quotes/:id/convert-to-sales-order",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const quote = await storage.getQuote(req.params.id);
      if (!quote || !(await storage.hasCompanyAccess(userId, quote.companyId))) {
        return res.status(404).json({ message: "Quote not found" });
      }
      const order = await convertQuoteToSalesOrder({ companyId: quote.companyId, quoteId: quote.id, userId });
      res.status(201).json(await getSalesOrder(quote.companyId, order.id));
    })
  );

  // Customer-only: Generate PDF
  app.get(
    "/api/quotes/:id/pdf",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const lines = await storage.getQuoteLinesByQuoteId(id);
      const company = await storage.getCompany(quote.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const isProforma = req.query.variant === "proforma";
      const pdfBuffer = await generateQuotePDF(quote, lines, company, {
        variant: isProforma ? "proforma" : "quote",
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${isProforma ? "proforma" : "quote"}-${quote.number}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    })
  );
}
