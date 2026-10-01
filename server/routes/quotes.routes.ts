import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { generateQuotePDF } from "../services/pdf-quote.service";
import { createLogger } from "../config/logger";
import { calculateDocumentTotals } from "../services/document-totals.service";
import { allocateInvoiceNumber } from "../services/invoice-numbering.service";
import { db } from "../db";
import { resolveDocumentExchangeRate } from "../services/document-fx-rate";
import { checkRevenueAccountsForCompany } from "../services/revenue-account-guard.service";
import { deriveVatSupplyType } from "../services/vat-supply-type";
import { UAE_VAT_RATE } from "../constants";
import { normalizeDocumentLines } from "../services/document-line-limits";
import { checkProductsForCompany } from "../services/inventory-costing.service";

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
  if (out.date) out.date = new Date(out.date);
  if (out.expiryDate) out.expiryDate = new Date(out.expiryDate);
  return out;
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
      res.json({ ...quote, lines });
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
      const { lines: rawLines, ...quoteData } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Cap and round quantity / unit price to what the columns can store.
      const lines = Array.isArray(rawLines) ? normalizeDocumentLines(rawLines) : rawLines;

      // `quotes.number` is NOT NULL and this route never set it, so any caller
      // that did not hand-type a number got an HTTP 500 from Postgres. Allocate
      // one server-side (QT-YYYY-00001) when the client omits it; an explicit
      // number is still honoured for imports and migrations.
      const suppliedNumber =
        typeof quoteData.number === "string" && quoteData.number.trim() !== ""
          ? quoteData.number.trim()
          : null;
      const quoteNumber =
        suppliedNumber ?? (await allocateInvoiceNumber(companyId, "quote", new Date()));

      if (Array.isArray(lines)) {
        const revenueCheck = await checkRevenueAccountsForCompany(
          companyId,
          lines.map((l: any) => l?.revenueAccountId)
        );
        if (!revenueCheck.ok) {
          return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
        }
        const productCheck = await checkProductsForCompany(companyId, lines.map((l: any) => withSupplyType(l).productId));
        if (!productCheck.ok) {
          return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
        }
      }

      const totals = calculateDocumentTotals(lines);
      const quote = await storage.createQuote(
        normalizeQuoteDates({ ...quoteData, ...totals, number: quoteNumber, companyId })
      );

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          await storage.createQuoteLine({ ...withSupplyType(line), quoteId: quote.id });
        }
      }

      const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.status(201).json({ ...quote, lines: quoteLines });
    })
  );

  // Customer-only: Update quote
  app.put(
    "/api/quotes/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("quotes"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { lines: rawLines, ...updateData } = req.body;

      const quote = await storage.getQuote(id);
      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const lines = Array.isArray(rawLines) ? normalizeDocumentLines(rawLines) : rawLines;

      if (Array.isArray(lines)) {
        const revenueCheck = await checkRevenueAccountsForCompany(
          quote.companyId,
          lines.map((l: any) => l?.revenueAccountId)
        );
        if (!revenueCheck.ok) {
          return res.status(revenueCheck.status).json({ message: revenueCheck.message, code: revenueCheck.code });
        }
        const productCheck = await checkProductsForCompany(quote.companyId, lines.map((l: any) => withSupplyType(l).productId));
        if (!productCheck.ok) {
          return res.status(productCheck.status).json({ message: productCheck.message, code: productCheck.code });
        }
      }

      const updated = await storage.updateQuote(
        id,
        normalizeQuoteDates(
          lines && Array.isArray(lines)
            ? { ...updateData, ...calculateDocumentTotals(lines) }
            : updateData
        )
      );

      if (lines && Array.isArray(lines)) {
        await storage.deleteQuoteLinesByQuoteId(quote.id);
        for (const line of lines) {
          await storage.createQuoteLine({ ...withSupplyType(line), quoteId: quote.id });
        }
      }

      const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.json({ ...updated, lines: quoteLines });
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

      await storage.deleteQuote(id);
      res.json({ message: "Quote deleted" });
    })
  );

  // Customer-only: Convert quote to invoice
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
        return res.status(400).json({ message: "Quote already converted" });
      }

      const lines = await storage.getQuoteLinesByQuoteId(id);

      // Create invoice from quote. The number MUST come from the FTA
      // sequential allocator (gap-free) — a timestamp here would break the
      // numbering sequence the moment the invoice is issued. Totals are
      // recomputed from the quote lines, not trusted from the quote row.
      const invoiceDate = new Date();
      const totals = calculateDocumentTotals(lines as any);

      // Carry the quote's currency over. Quotes store no exchange rate, and a
      // stored rate may be stale anyway, so a foreign-currency invoice takes the
      // rate for the conversion date from exchange_rates - the same lookup
      // invoice creation uses when the caller supplies none. Resolved before
      // the number is allocated so a missing rate cannot burn a number.
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
      const invoiceNumber = await allocateInvoiceNumber(
        quote.companyId,
        "invoice",
        invoiceDate,
        db
      );
      const invoice = await storage.createInvoice({
        companyId: quote.companyId,
        number: invoiceNumber,
        customerName: quote.customerName,
        customerTrn: quote.customerTrn,
        date: invoiceDate,
        currency: docCurrency,
        exchangeRate,
        baseCurrencyAmount: Math.round(totals.total * exchangeRate * 100) / 100,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        status: "draft",
      });

      // Copy lines to invoice
      for (const line of lines) {
        await storage.createInvoiceLine({
          invoiceId: invoice.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate,
          // The rate decides: a stale exempt / out-of-scope tag on a taxed
          // quote line must not survive the conversion.
          vatSupplyType: deriveVatSupplyType(Number(line.vatRate), line.vatSupplyType),
          revenueAccountId: line.revenueAccountId,
          productId: (line as any).productId ?? null,
        });
      }

      // Mark quote as converted
      await storage.updateQuote(id, {
        status: "converted",
        convertedInvoiceId: invoice.id,
      });

      logger.info({ quoteId: id, invoiceId: invoice.id }, "Quote converted to invoice");
      res.json({ invoice, message: "Quote converted to invoice" });
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
