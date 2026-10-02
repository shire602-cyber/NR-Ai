import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { db } from "../db";
import { gatewayPayments, gatewayRefunds, invoices } from "../../shared/schema";
import { getEnv } from "../config/env";
import {
  completeConnect,
  disconnect,
  getGatewayStatus,
  startConnect,
  updateSettings,
} from "../services/payment-gateway/connection.service";
import { createInvoiceCheckout, invoiceForShareToken } from "../services/payment-gateway/checkout.service";
import { isFakeGatewayOn } from "../services/payment-gateway";
import { getFakeSession } from "../services/payment-gateway/fake.adapter";
import { handleConnectEvent } from "../services/payment-gateway/webhook.service";
import { invoiceBelongsToContact } from "./portal.public.routes";

const checkoutSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9_000_000_000_000).optional(),
  // Test hook, honoured only by the fake gateway: AED per unit of a foreign invoice currency.
  fakeRate: z.coerce.number().finite().positive().optional(),
});

function originOf(req: Request): string {
  const configured = getEnv().FRONTEND_URL;
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

const settingsSchema = z.object({ allowPartial: z.boolean().optional(), enabled: z.boolean().optional() });

const escapeHtml = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function fakeCheckoutPage(sessionId: string, s: { amount: number; currency: string; invoiceNumber: string; expired: boolean }): string {
  const act = (what: string, label: string, primary: boolean) =>
    `<form method="post" action="/api/public/fake-pay/${escapeHtml(sessionId)}/${what}" style="display:inline"><button type="submit" style="padding:10px 22px;margin:6px;font-size:16px;border-radius:6px;border:1px solid #888;${primary ? "background:#0a7d3c;color:#fff" : "background:#fff"}">${label}</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated checkout</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px">
<p style="background:#fff3cd;border:1px solid #e0c36a;padding:8px;border-radius:6px;font-size:13px">Simulated checkout (test mode, no real card is charged).</p>
<h2>Pay invoice ${escapeHtml(s.invoiceNumber)}</h2>
<p style="font-size:22px"><strong>${escapeHtml(s.currency)} ${escapeHtml(s.amount.toFixed(2))}</strong></p>
${s.expired ? "<p>This payment page has expired.</p>" : `${act("pay", "Pay", true)}${act("fail", "Fail the payment", false)}`}
</body></html>`;
}

export function registerPaymentGatewayRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];
  const base = "/api/companies/:companyId/payment-gateway";

  // The simulated checkout page of the fake gateway (PAYMENT_GATEWAY_FAKE=1, never in production): "Pay" and "Fail"
  // fire the same webhook handler a real provider's event would reach, so the whole flow runs without Stripe.
  app.get("/api/public/fake-pay/:sessionId", (req: Request, res: Response) => {
    const session = isFakeGatewayOn() ? getFakeSession(req.params.sessionId) : undefined;
    if (!session) return res.status(404).type("text/plain").send("Not found");
    // Helmet's no-referrer makes the browser send "Origin: null" on the form post, which CORS refuses.
    res.setHeader("Referrer-Policy", "same-origin");
    res.type("html").send(fakeCheckoutPage(req.params.sessionId, session));
  });
  const fakeOutcome = (kind: "pay" | "fail") =>
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = req.params.sessionId;
      const session = isFakeGatewayOn() ? getFakeSession(sessionId) : undefined;
      if (!session) return res.status(404).type("text/plain").send("Not found");
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const minor = Math.round(session.amount * 100);
      const object = {
        id: sessionId,
        object: "checkout.session",
        payment_status: kind === "pay" ? "paid" : "unpaid",
        payment_intent: `pi_fake_${sessionId.slice(-10)}`,
        amount_total: minor,
        currency: session.currency.toLowerCase(),
        metadata: { kind: "invoice", invoiceId: session.invoiceId, ...(session.fakeRate ? { fakeRate: String(session.fakeRate) } : {}) },
      };
      await handleConnectEvent({
        id: `evt_fake_${stamp}`,
        type: kind === "pay" ? "checkout.session.completed" : "checkout.session.expired",
        account: session.accountId,
        data: { object },
      });
      if (kind === "fail") session.expired = true;
      const target = kind === "pay" ? session.successUrl : session.cancelUrl;
      res.redirect(303, target);
    });
  app.post("/api/public/fake-pay/:sessionId/pay", fakeOutcome("pay"));
  app.post("/api/public/fake-pay/:sessionId/fail", fakeOutcome("fail"));

  app.get(
    base,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getGatewayStatus(req.params.companyId));
    })
  );

  app.patch(
    `${base}/settings`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const input = settingsSchema.parse(req.body ?? {});
      res.json(await updateSettings({ companyId: req.params.companyId, userId: (req as any).user.id, ...input }));
    })
  );

  app.post(
    `${base}/stripe/connect`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const callbackUrl = `${originOf(req)}/api/payment-gateway/stripe/callback`;
      res.json(await startConnect({ companyId: req.params.companyId, userId: (req as any).user.id, callbackUrl }));
    })
  );

  app.delete(
    `${base}/stripe`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await disconnect({ companyId: req.params.companyId, userId: (req as any).user.id }));
    })
  );

  // Where Stripe sends the owner back to. No session here: the HMAC-signed, 10-minute `state` proves who started it.
  app.get(
    "/api/payment-gateway/stripe/callback",
    asyncHandler(async (req: Request, res: Response) => {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const denied = typeof req.query.error === "string";
      const outcome = denied || !code || !state ? { ok: false as const, reason: denied ? "access_denied" : "missing_params" } : await completeConnect({ code, state });
      res.redirect(302, outcome.ok ? "/settings/sales?stripe=connected" : `/settings/sales?stripe=error&reason=${encodeURIComponent(outcome.reason)}`);
    })
  );

  // Pay now from the public invoice page.
  app.post(
    "/api/public/invoices/:token/checkout",
    asyncHandler(async (req: Request, res: Response) => {
      const input = checkoutSchema.parse(req.body ?? {});
      const invoice = await invoiceForShareToken(req.params.token);
      const contact = invoice.contactId ? await storage.getCustomerContact(invoice.contactId) : undefined;
      res.json(
        await createInvoiceCheckout({
          invoice,
          amount: input.amount ?? null,
          via: "public",
          origin: originOf(req),
          returnPath: `/view/invoice/${req.params.token}`,
          customerEmail: contact?.email ?? null,
          fakeRate: isFakeGatewayOn() ? input.fakeRate : undefined,
        })
      );
    })
  );

  // Pay now from the customer portal: the invoice must belong to the portal's contact (contact link first).
  app.post(
    "/api/portal/:token/invoices/:invoiceId/checkout",
    asyncHandler(async (req: Request, res: Response) => {
      const contact = await storage.getCustomerContactByPortalToken(req.params.token);
      if (!contact) return res.status(404).json({ message: "Invalid or expired portal link" });
      if (contact.portalAccessExpiresAt && new Date(contact.portalAccessExpiresAt) < new Date()) {
        return res.status(410).json({ message: "This portal link has expired" });
      }
      const invoice = await storage.getInvoice(req.params.invoiceId, contact.companyId);
      if (!invoice || !invoiceBelongsToContact(invoice, contact)) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const input = checkoutSchema.parse(req.body ?? {});
      res.json(
        await createInvoiceCheckout({
          invoice,
          amount: input.amount ?? null,
          via: "portal",
          origin: originOf(req),
          returnPath: `/portal/${req.params.token}`,
          customerEmail: contact.email ?? null,
          fakeRate: isFakeGatewayOn() ? input.fakeRate : undefined,
        })
      );
    })
  );

  // For reconciliation: every online payment with its state, fee and refunds.
  app.get(
    `${base.replace("/payment-gateway", "")}/gateway-payments`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const payments = await db
        .select({ payment: gatewayPayments, invoiceNumber: invoices.number })
        .from(gatewayPayments)
        .innerJoin(invoices, eq(invoices.id, gatewayPayments.invoiceId))
        .where(eq(gatewayPayments.companyId, companyId))
        .orderBy(desc(gatewayPayments.createdAt))
        .limit(500);
      const refunds = await db.select().from(gatewayRefunds).where(eq(gatewayRefunds.companyId, companyId));
      res.json(
        payments.map((p: any) => ({
          ...p.payment,
          invoiceNumber: p.invoiceNumber,
          refunds: refunds.filter((r: any) => r.gatewayPaymentId === p.payment.id),
        }))
      );
    })
  );
}
