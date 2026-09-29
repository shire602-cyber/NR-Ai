import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { getAllPlanDefinitions, getTierLimits } from "../middleware/featureGate";
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  getStripe,
  isStripeConfigured,
} from "../services/stripe.service";
import { createLogger } from "../config/logger";
import { getCompanyStorageBytes } from "../services/document-upload.service";
import { ensureSubscription } from "../services/billing-trial.service";
import { parseGrandfatherDate, resolveEffectivePlan, type EffectivePlan } from "../services/billing-plan";

const log = createLogger("billing");

/** Client-facing status word for an effective plan. */
function statusLabel(effective: EffectivePlan, rawStatus?: string | null): string {
  switch (effective.state) {
    case "trial":
      return "trialing";
    case "trial_expired":
      return "trial_expired";
    case "grace":
      return "past_due";
    case "paid":
      return rawStatus === "cancelled" ? "cancelled" : "active";
    default:
      return effective.state; // free | grandfathered | managed
  }
}

/** Resolve a company's subscription (creating its trial lazily) and effective plan. */
async function loadBilling(companyId: string) {
  const company = await storage.getCompany(companyId);
  let subscription: any = (await storage.getSubscription(companyId)) ?? null;
  if (!subscription && company && company.companyType !== "client") {
    subscription = (await ensureSubscription(companyId, { company })) ?? null;
  }
  const effective = resolveEffectivePlan({
    subscription,
    now: new Date(),
    company,
    grandfatherBefore: parseGrandfatherDate(process.env.BILLING_GRANDFATHER_BEFORE),
  });
  return { company, subscription, effective };
}

export function registerBillingRoutes(app: Express) {
  // Get available plans (public)
  app.get("/api/billing/plans", (_req: Request, res: Response) => {
    res.json(getAllPlanDefinitions());
  });

  // Plan/trial status for the current company (drives the trial banner).
  // ?companyId= selects the company; without it the user's first company is used.
  app.get(
    "/api/billing/status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      let companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      if (!companyId) {
        const owned = await storage.getCompaniesByUserId(userId);
        companyId = owned[0]?.id;
      }
      if (!companyId) return res.status(404).json({ message: "No company found" });

      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { subscription, effective } = await loadBilling(companyId);
      res.json({
        plan: effective.planId,
        status: statusLabel(effective, subscription?.status),
        trialEndsAt: effective.state === "trial" || effective.state === "trial_expired"
          ? (effective.trialEndsAt?.toISOString() ?? null)
          : null,
        daysLeft: effective.daysLeft,
        enforcement: process.env.BILLING_ENFORCEMENT === "true",
      });
    })
  );

  // Get current subscription
  app.get(
    "/api/companies/:companyId/billing/subscription",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // Effective plan: paid > live trial > free (see billing-plan.ts). A company
      // with no row gets its trial created here, counted from its creation date.
      const { subscription: row, effective } = await loadBilling(companyId);
      const subscription = {
        ...(row ?? {
          companyId,
          billingCycle: "monthly",
          invoicesCreatedThisMonth: 0,
          receiptsCreatedThisMonth: 0,
          aiCreditsUsedThisMonth: 0,
          isDefault: true,
        }),
        rawPlanId: row?.planId ?? "free",
        planId: effective.planId,
        planName: effective.planId.charAt(0).toUpperCase() + effective.planId.slice(1),
        status: statusLabel(effective, row?.status),
        daysLeft: effective.daysLeft,
      };

      const limits = getTierLimits(effective.planId);
      // Mirrors server/middleware/featureGate.ts: until BILLING_ENFORCEMENT=true
      // the client paywall must fail open too, or the UI blocks features the
      // API happily serves.
      const enforcement = process.env.BILLING_ENFORCEMENT === "true";
      res.json({ subscription, limits, enforcement });
    })
  );

  // Get usage counters
  app.get(
    "/api/companies/:companyId/billing/usage",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const { subscription: row, effective } = await loadBilling(companyId);
      const subscription = row ?? {
        invoicesCreatedThisMonth: 0,
        receiptsCreatedThisMonth: 0,
        aiCreditsUsedThisMonth: 0,
      };

      const limits = getTierLimits(effective.planId);
      const userCount = await storage.getUserCountByCompanyId(companyId);
      const storageBytes = await getCompanyStorageBytes(companyId);

      res.json({
        plan: effective.planId,
        usage: {
          invoices: {
            used: subscription.invoicesCreatedThisMonth || 0,
            limit: limits.maxInvoicesPerMonth,
          },
          receipts: {
            used: subscription.receiptsCreatedThisMonth || 0,
            limit: limits.maxReceiptsPerMonth,
          },
          aiCredits: {
            used: subscription.aiCreditsUsedThisMonth || 0,
            limit: limits.aiCreditsPerMonth,
          },
          users: { used: userCount, limit: limits.maxUsers },
          // Real usage: sum of stored file sizes (stored_files ledger), reported in MB.
          storage: {
            used: Math.round((storageBytes / (1024 * 1024)) * 100) / 100,
            usedBytes: storageBytes,
            limit: limits.maxStorageMb,
          },
        },
      });
    })
  );

  // Create Stripe Checkout session
  app.post(
    "/api/companies/:companyId/billing/checkout",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { planId, billingCycle } = req.body;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      if (!isStripeConfigured()) {
        return res.status(503).json({ message: "Payment processing not configured" });
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
      const userId = (req as any).user.id;

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

      // Signature verification needs the exact raw bytes (index.ts mounts
      // express.raw for this path); a parsed object can never verify.
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ message: "Webhook body must be the raw request payload" });
      }

      let event;
      try {
        event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        log.error({ error: err.message }, "Stripe webhook signature verification failed");
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
      }

      await handleWebhookEvent(event);
      res.json({ received: true });
    })
  );
}
