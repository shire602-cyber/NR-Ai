/**
 * Public online-payment endpoints (W4-D, R16-14). No session auth: they are reached with an
 * unguessable link (payment link token or invoice share token) or a signed gateway webhook.
 *
 *   GET  /api/portal/pay/:token                         → 303 to the hosted checkout
 *   POST /api/portal/public-invoices/:shareToken/pay    → { url } for "Pay now" on the shared invoice
 *   POST /api/webhooks/invoice-payments/:provider       ← gateway webhook (raw body, signature)
 */
import type { Express, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { DomainError } from "../errors";
import {
  WebhookSignatureError,
  checkoutForInvoice,
  findLinkByToken,
  handleGatewayWebhook,
  paymentsAvailability,
  publicBaseUrl,
  startCheckout,
} from "../services/payments";
import { portalGuard } from "./portal.public.routes";

function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  return req.body && typeof req.body === "object" ? JSON.stringify(req.body) : "";
}

export function registerPublicPaymentRoutes(app: Express): void {
  app.get(
    "/api/portal/pay/:token",
    portalGuard("payment_link"),
    asyncHandler(async (req: Request, res: Response) => {
      const link = await findLinkByToken(req.params.token);
      if (!link) {
        return res.status(404).json({ code: "PAYMENT_LINK_NOT_FOUND", message: "Invalid link" });
      }
      if (link.status === "paid") {
        return res.status(410).json({ code: "PAYMENT_LINK_PAID", message: "Already paid" });
      }
      // Return the customer to the shared invoice view, which shows the payment state.
      const invoice = await storage.getInvoice(link.invoiceId, link.companyId);
      const shareToken = invoice ? await storage.ensureInvoiceShareToken(invoice) : null;
      const back = `${publicBaseUrl()}/view/invoice/${shareToken ?? ""}`;
      const { url } = await startCheckout(link, {
        successUrl: `${back}?payment=success`,
        cancelUrl: `${back}?payment=cancelled`,
      });
      res.redirect(303, url);
    })
  );

  app.post(
    "/api/portal/public-invoices/:shareToken/pay",
    portalGuard("share"),
    asyncHandler(async (req: Request, res: Response) => {
      const { shareToken } = req.params;
      const invoice = /^[0-9a-f]{32}$/i.test(shareToken)
        ? await storage.getInvoiceByShareToken(shareToken)
        : undefined;
      if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
      if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
        throw new DomainError("LINK_EXPIRED", 410, undefined, "This invoice link has expired");
      }
      if (!paymentsAvailability().available) {
        throw new DomainError(
          "PAYMENTS_REQUIRES_EXTERNAL",
          503,
          undefined,
          "Online payment is not available"
        );
      }
      const back = `${publicBaseUrl()}/view/invoice/${shareToken}`;
      const out = await checkoutForInvoice({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        successUrl: `${back}?payment=success`,
        cancelUrl: `${back}?payment=cancelled`,
      });
      res.json(out);
    })
  );

  app.post(
    "/api/webhooks/invoice-payments/:provider",
    asyncHandler(async (req: Request, res: Response) => {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }
      try {
        const out = await handleGatewayWebhook(req.params.provider, rawBody(req), headers);
        res.json({ received: true, ...out });
      } catch (err) {
        if (err instanceof WebhookSignatureError) {
          return res.status(400).json({ code: "INVALID_SIGNATURE", message: err.message });
        }
        throw err;
      }
    })
  );
}
