import type { Express, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { getPublicQuote, respondToQuote } from "../services/quote-acceptance.service";
import { generateQuotePDF } from "../services/pdf-quote.service";
import { itemsSubtotalOf } from "../services/sales-lines.service";

const answerBase = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
});
const acceptSchema = answerBase.extend({ agree: z.literal(true, { errorMap: () => ({ message: "You must agree to the quote to accept it" }) }) });
const declineSchema = answerBase.extend({ reason: z.string().trim().max(1000).optional().nullable() });

/** What a customer may see of a quote: no internal ids, no company internals. */
function publicShape(view: Awaited<ReturnType<typeof getPublicQuote>>) {
  const { quote, lines, company, customFields, signature, canRespond } = view;
  return {
    quote: {
      number: quote.number,
      customerName: quote.customerName,
      customerTrn: quote.customerTrn,
      date: quote.date,
      expiryDate: quote.expiryDate,
      currency: quote.currency,
      subtotal: quote.subtotal,
      vatAmount: quote.vatAmount,
      total: quote.total,
      discountAmount: quote.discountAmount,
      shippingAmount: quote.shippingAmount,
      itemsSubtotal: itemsSubtotalOf(lines),
      status: quote.status,
      notes: quote.notes,
      sentAt: quote.sentAt,
      acceptedAt: quote.acceptedAt,
      declinedAt: quote.declinedAt,
    },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      vatSupplyType: l.vatSupplyType,
      lineKind: l.lineKind,
      discountType: l.discountType,
      discountValue: l.discountValue,
      hasParent: !!l.parentLineId,
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
    customFields,
    signature,
    canRespond,
  };
}

export function registerPublicQuoteRoutes(app: Express) {
  app.get(
    "/api/public/quotes/:token",
    asyncHandler(async (req: Request, res: Response) => {
      res.json(publicShape(await getPublicQuote(req.params.token)));
    })
  );

  app.get(
    "/api/public/quotes/:token/pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const view = await getPublicQuote(req.params.token);
      const pdf = await generateQuotePDF(view.quote, view.lines, view.company);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quote-${view.quote.number}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );

  app.post(
    "/api/public/quotes/:token/accept",
    asyncHandler(async (req: Request, res: Response) => {
      const input = acceptSchema.parse(req.body ?? {});
      const result = await respondToQuote({
        token: req.params.token,
        action: "accept",
        name: input.name,
        email: input.email,
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      });
      res.json({ status: result.quote.status, signedAt: result.signature.signedAt });
    })
  );

  app.post(
    "/api/public/quotes/:token/decline",
    asyncHandler(async (req: Request, res: Response) => {
      const input = declineSchema.parse(req.body ?? {});
      const result = await respondToQuote({
        token: req.params.token,
        action: "decline",
        name: input.name,
        email: input.email,
        reason: input.reason ?? null,
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      });
      res.json({ status: result.quote.status, signedAt: result.signature.signedAt });
    })
  );
}
