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

export function registerPaymentGatewayRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];
  const base = "/api/companies/:companyId/payment-gateway";

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
