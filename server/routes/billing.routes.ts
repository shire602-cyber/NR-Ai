import type { Express, Request, Response } from "express";
import { billingCheckoutBody } from "../../shared/validators/route-bodies";
import { parsedBody } from "../http/parsed-body";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import {
  billingEnforced,
  getAllPlanDefinitions,
  getTierLimits,
  getUsage,
  usagePeriod,
} from "../middleware/featureGate";
import {
  changeSubscriptionPlan,
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  getStripe,
  isStripeConfigured,
  trialDays,
} from "../services/stripe.service";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { pq } from "../services/connectors/pq";
import { z } from "zod";
import { createLogger } from "../config/logger";
import { errorMessage } from "../errors";
import { TRIAL_DAYS, TRIAL_END_BEHAVIOUR, trialState } from "../../shared/trial";
import { companyStorageBytes } from "../services/storage-usage";

const log = createLogger("billing");

export function registerBillingRoutes(app: Express) {
  // Get available plans (public)
  app.get("/api/billing/plans", (_req: Request, res: Response) => {
    res.json(getAllPlanDefinitions());
  });

  // Get current subscription
  app.get(
    "/api/companies/:companyId/billing/subscription",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // A company with no subscription row is implicitly on the free tier —
      // mirror featureGate.getSubscriptionForRequest which defaults to 'free'.
      // Returning 404 made the billing page error for every unsubscribed
      // company (i.e. all of them until billing is live).
      const subscription = (await storage.getSubscription(companyId)) ?? {
        companyId,
        planId: "free",
        status: "active",
        isDefault: true,
        invoicesCreatedThisMonth: 0,
        receiptsCreatedThisMonth: 0,
        aiCreditsUsedThisMonth: 0,
      };

      const limits = getTierLimits(subscription.planId);
      // Mirrors server/middleware/featureGate.ts: until BILLING_ENFORCEMENT=true
      // the client paywall must fail open too, or the UI blocks features the
      // API happily serves.
      const enforcement = billingEnforced();
      res.json({
        subscription,
        limits,
        enforcement,
        trialDays: trialDays(),
        // X6b: the Upgrade button becomes "Contact us" while checkout cannot work.
        checkoutAvailable: isStripeConfigured(),
        // Free trial (shared/trial.ts): counted from the company's subscription row; only the
        // free plan is on a trial. Nothing is locked when it ends (TRIAL_END_BEHAVIOUR).
        trial:
          subscription.planId === "free"
            ? trialState(
                (subscription as { createdAt?: Date | string | null }).createdAt ??
                  (await storage.getCompany(companyId))?.createdAt,
                new Date(),
                TRIAL_DAYS
              )
            : null,
        trialEndBehaviour: TRIAL_END_BEHAVIOUR,
      });
    })
  );

  // Get usage counters
  app.get(
    "/api/companies/:companyId/billing/usage",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const subscription = (await storage.getSubscription(companyId)) ?? {
        companyId,
        planId: "free",
        status: "active",
        invoicesCreatedThisMonth: 0,
        receiptsCreatedThisMonth: 0,
        aiCreditsUsedThisMonth: 0,
      };

      const limits = getTierLimits(subscription.planId);
      const storageMb =
        Math.round(((await companyStorageBytes(companyId)) / (1024 * 1024)) * 10) / 10;
      const [invoices, receipts, aiCalls, users] = await Promise.all([
        getUsage(companyId, "invoices"),
        getUsage(companyId, "receipts"),
        getUsage(companyId, "ai_calls"),
        getUsage(companyId, "team_members"),
      ]);

      res.json({
        plan: subscription.planId,
        period: usagePeriod(),
        enforcement: billingEnforced(),
        usage: {
          invoices: { used: invoices, limit: limits.maxInvoicesPerMonth },
          receipts: { used: receipts, limit: limits.maxReceiptsPerMonth },
          aiCredits: { used: aiCalls, limit: limits.aiCreditsPerMonth },
          users: { used: users, limit: limits.maxUsers },
          storage: { used: storageMb, limit: limits.maxStorageMb },
        },
      });
    })
  );

  // VAT-inclusive subscription invoices and receipts (R19-16).
  app.get(
    "/api/companies/:companyId/billing/documents",
    authMiddleware,
    requireCustomer,
    requirePermission("billing.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq(
        `SELECT id, kind, number, stripe_invoice_id AS "stripeInvoiceId", plan_id AS "planId",
                billing_cycle AS "billingCycle", seat_count AS "seatCount", period_start AS "periodStart",
                period_end AS "periodEnd", subtotal_fils AS "subtotalFils", vat_fils AS "vatFils",
                discount_fils AS "discountFils", total_fils AS "totalFils", currency, status,
                issued_at AS "issuedAt", paid_at AS "paidAt"
           FROM billing_documents WHERE company_id = $1 ORDER BY issued_at DESC LIMIT 200`,
        [req.params.companyId]
      );
      res.json(rows);
    })
  );

  // Referral and other credits on this company (R19-11).
  app.get(
    "/api/companies/:companyId/billing/credits",
    authMiddleware,
    requireCustomer,
    requirePermission("billing.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq(
        `SELECT id, beneficiary, source, kind, amount_fils AS "amountFils", percent_off AS "percentOff",
                currency, status, stripe_ref AS "stripeRef", note, created_at AS "createdAt",
                applied_at AS "appliedAt"
           FROM billing_credits WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(rows);
    })
  );

  // Plan / cycle / seat change with proration (R19-16).
  const changePlanBody = z
    .object({
      planId: z.enum(["starter", "professional", "enterprise"]).optional(),
      billingCycle: z.enum(["monthly", "yearly"]).optional(),
      seats: z.number().int().min(1).max(1000).optional(),
    })
    .strict();
  app.post(
    "/api/companies/:companyId/billing/change-plan",
    authMiddleware,
    requireCustomer,
    requirePermission("billing.manage"),
    strictBody(changePlanBody),
    asyncHandler(async (req: Request, res: Response) => {
      if (!isStripeConfigured()) {
        return res
          .status(503)
          .json({ message: "Payment processing not configured", code: "STRIPE_NOT_CONFIGURED" });
      }
      const result = await changeSubscriptionPlan(
        req.params.companyId,
        parsedBody<z.output<typeof changePlanBody>>(req)
      );
      res.json({ ...result, proration: "create_prorations" });
    })
  );

  // Create Stripe Checkout session
  app.post(
    "/api/companies/:companyId/billing/checkout",
    authMiddleware,
    requireCustomer,
    strictBody(billingCheckoutBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { planId, billingCycle } = parsedBody<{
        planId: string;
        billingCycle: "monthly" | "yearly";
      }>(req);
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      if (!isStripeConfigured()) {
        return res
          .status(503)
          .json({ message: "Payment processing not configured", code: "STRIPE_NOT_CONFIGURED" });
      }

      if (!planId || !billingCycle) {
        return res.status(400).json({ message: "planId and billingCycle are required" });
      }

      if (!["starter", "professional", "enterprise"].includes(planId)) {
        return res.status(400).json({ message: "Invalid plan" });
      }

      if (!["monthly", "yearly"].includes(billingCycle)) {
        return res.status(400).json({ message: "Invalid billing cycle" });
      }

      const origin = req.headers.origin || req.headers.referer || "http://localhost:5000";
      const successUrl = `${origin}/subscription?success=true`;
      const cancelUrl = `${origin}/subscription?cancelled=true`;

      const url = await createCheckoutSession(
        companyId,
        planId,
        billingCycle,
        successUrl,
        cancelUrl
      );
      res.json({ url });
    })
  );

  // Create Stripe Customer Portal session
  app.post(
    "/api/companies/:companyId/billing/portal",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const subscription = await storage.getSubscription(companyId);
      if (!subscription?.stripeCustomerId) {
        return res
          .status(400)
          .json({ message: "No billing account found. Please subscribe first." });
      }

      const origin = req.headers.origin || req.headers.referer || "http://localhost:5000";
      const url = await createPortalSession(
        subscription.stripeCustomerId,
        `${origin}/subscription`
      );
      res.json({ url });
    })
  );

  // Stripe webhook (no auth — verified via signature)
  app.post(
    "/api/webhooks/stripe",
    asyncHandler(async (req: Request, res: Response) => {
      const stripeClient = getStripe();
      if (!stripeClient) {
        return res.status(503).json({ message: "Stripe not configured" });
      }

      const sig = req.headers["stripe-signature"];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!sig || !webhookSecret) {
        return res.status(400).json({ message: "Missing signature or webhook secret" });
      }

      let event;
      try {
        event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: unknown) {
        log.error({ error: errorMessage(err) }, "Stripe webhook signature verification failed");
        return res.status(400).json({ message: `Webhook Error: ${errorMessage(err)}` });
      }

      await handleWebhookEvent(event);
      res.json({ received: true });
    })
  );
}
