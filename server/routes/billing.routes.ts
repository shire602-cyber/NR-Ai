import type { Express, Request, Response } from "express";
import { billingCheckoutBody } from "../../shared/validators/route-bodies";
import { parsedBody } from "../http/parsed-body";
import { adminMiddleware, authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import {
  billingEnforced,
  companyEntitlement,
  ensureFreeSubscription,
  getAllPlanDefinitions,
  getTierLimits,
  getUsage,
  usagePeriod,
  type CompanyEntitlement,
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
import { TRIAL_DAYS, TRIAL_END_BEHAVIOUR, trialState, type TrialState } from "../../shared/trial";
import { NO_PLAN_ID, PAID_PLAN_IDS } from "../../shared/plans";
import { adminSetPlanBody, type AdminSetPlanBody } from "../../shared/validators/plans";
import { zUuid } from "../../shared/validators/primitives";
import { recordAudit } from "../services/audit.service";
import { companyStorageBytes } from "../services/storage-usage";

const log = createLogger("billing");

const DAY_MS = 24 * 60 * 60 * 1000;

/** The trial banner's state for a company without a paid plan (null once on a paid plan). */
function trialFromEntitlement(ent: CompanyEntitlement): TrialState | null {
  if (ent.state === "active" || !ent.trialStartedAt) return null;
  const start = new Date(ent.trialStartedAt).getTime();
  const end = ent.trialEndsAt ? new Date(ent.trialEndsAt).getTime() : start + TRIAL_DAYS * DAY_MS;
  const days = Math.max(1, Math.round((end - start) / DAY_MS));
  return trialState(ent.trialStartedAt, new Date(), days);
}

export function registerBillingRoutes(app: Express) {
  // Plans (public): built from shared/plans.ts, the same module the pricing page renders.
  app.get("/api/billing/plans", (_req: Request, res: Response) => {
    res.json(getAllPlanDefinitions());
  });

  // Current subscription and what the company may do now (trial / active / expired).
  app.get(
    "/api/companies/:companyId/billing/subscription",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const ent = await companyEntitlement(companyId);
      // A company with no subscription row has no paid plan (the 0113 trigger normally creates
      // one); firm-billed client books (ent === null) are billed through the firm engagement.
      const subscription = (await storage.getSubscription(companyId)) ?? {
        companyId,
        planId: NO_PLAN_ID,
        status: "active",
        isDefault: true,
        invoicesCreatedThisMonth: 0,
        receiptsCreatedThisMonth: 0,
        aiCreditsUsedThisMonth: 0,
      };
      res.json({
        subscription,
        limits: ent?.limits ?? getTierLimits(subscription.planId),
        entitlement: ent
          ? {
              state: ent.state,
              planId: ent.planId,
              storedPlanId: ent.storedPlanId,
              features: ent.features,
              limits: ent.limits,
              trialEndsAt: ent.trialEndsAt,
            }
          : { state: "firm", planId: null, storedPlanId: subscription.planId, features: null },
        // Plan gates follow server/middleware/featureGate.ts billingEnforced(): the client locks
        // exactly what the API refuses, and nothing while enforcement is off.
        enforcement: billingEnforced() && ent !== null,
        trialDays: trialDays(),
        // The Upgrade button becomes "Contact us" while checkout cannot work.
        checkoutAvailable: isStripeConfigured(),
        trial: ent ? trialFromEntitlement(ent) : null,
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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const ent = await companyEntitlement(companyId);
      const limits = ent?.limits ?? getTierLimits(NO_PLAN_ID);
      const storageMb =
        Math.round(((await companyStorageBytes(companyId)) / (1024 * 1024)) * 10) / 10;
      const [invoices, receipts, aiCalls, users] = await Promise.all([
        getUsage(companyId, "invoices"),
        getUsage(companyId, "receipts"),
        getUsage(companyId, "ai_calls"),
        getUsage(companyId, "team_members"),
      ]);

      res.json({
        plan: ent?.planId ?? null,
        planState: ent?.state ?? "firm",
        period: usagePeriod(),
        enforcement: billingEnforced() && ent !== null,
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

  // NR admin: set a company's plan while online checkout is not configured (the "contact us"
  // path), or remove it ("none": trial if it has not ended, else read-only). Audited.
  app.put(
    "/api/admin/companies/:companyId/plan",
    authMiddleware,
    adminMiddleware,
    strictBody(adminSetPlanBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const company = zUuid.safeParse(companyId).success
        ? await storage.getCompany(companyId)
        : undefined;
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "NOT_FOUND" });
      }
      const body = parsedBody<AdminSetPlanBody>(req);
      const before = await companyEntitlement(companyId);
      await ensureFreeSubscription(companyId);
      const paid = body.planId !== "none";
      const planId = paid ? body.planId : NO_PLAN_ID;
      const limits = getTierLimits(planId);
      await pq(
        `UPDATE subscriptions
            SET plan_id = $2, plan_name = $3, status = 'active',
                billing_cycle = COALESCE($4, billing_cycle),
                max_users = $5, max_invoices = $6, max_receipts = $7, max_companies = $8,
                max_storage_mb = $9, ai_credits_per_month = $10,
                trial_ends_at = CASE WHEN $11::boolean THEN $12::timestamptz ELSE trial_ends_at END,
                current_period_start = CASE WHEN $13::boolean THEN now() ELSE current_period_start END,
                updated_at = now()
          WHERE id = (SELECT id FROM subscriptions WHERE company_id = $1
                       ORDER BY created_at DESC LIMIT 1)`,
        [
          companyId,
          planId,
          paid ? planId.charAt(0).toUpperCase() + planId.slice(1) : "Free",
          body.billingCycle ?? null,
          limits.maxUsers,
          limits.maxInvoicesPerMonth,
          limits.maxReceiptsPerMonth,
          limits.maxCompanies,
          limits.maxStorageMb,
          limits.aiCreditsPerMonth,
          body.trialEndsAt !== undefined,
          body.trialEndsAt ?? null,
          paid,
        ]
      );
      const after = await companyEntitlement(companyId);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "billing.plan_set",
        entityType: "subscription",
        entityId: companyId,
        before: before ? { planId: before.storedPlanId, state: before.state } : null,
        after: {
          planId: after?.storedPlanId ?? planId,
          state: after?.state ?? null,
          billingCycle: body.billingCycle ?? null,
          trialEndsAt: body.trialEndsAt ?? null,
          note: body.note ?? null,
        },
        req,
      });
      res.json({
        companyId,
        state: after?.state ?? null,
        planId: after?.planId ?? null,
        storedPlanId: after?.storedPlanId ?? planId,
        trialEndsAt: after?.trialEndsAt ?? null,
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
      planId: z.enum(PAID_PLAN_IDS).optional(),
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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      if (!isStripeConfigured()) {
        return res
          .status(503)
          .json({ message: "Payment processing not configured", code: "STRIPE_NOT_CONFIGURED" });
      }

      if (!planId || !billingCycle) {
        return res
          .status(400)
          .json({ message: "planId and billingCycle are required", code: "PLAN_REQUIRED_FIELDS" });
      }

      if (!(PAID_PLAN_IDS as readonly string[]).includes(planId)) {
        return res.status(400).json({ message: "Invalid plan", code: "INVALID_PLAN" });
      }

      if (!["monthly", "yearly"].includes(billingCycle)) {
        return res
          .status(400)
          .json({ message: "Invalid billing cycle", code: "INVALID_BILLING_CYCLE" });
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
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const subscription = await storage.getSubscription(companyId);
      if (!subscription?.stripeCustomerId) {
        return res
          .status(400)
          .json({
            message: "No billing account found. Please subscribe first.",
            code: "NO_BILLING_ACCOUNT",
          });
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
        return res
          .status(400)
          .json({ message: "Missing signature or webhook secret", code: "INVALID_SIGNATURE" });
      }

      let event;
      try {
        event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: unknown) {
        log.error({ error: errorMessage(err) }, "Stripe webhook signature verification failed");
        return res
          .status(400)
          .json({ message: `Webhook Error: ${errorMessage(err)}`, code: "INVALID_SIGNATURE" });
      }

      await handleWebhookEvent(event);
      res.json({ received: true });
    })
  );
}
