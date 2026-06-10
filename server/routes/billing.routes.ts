import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { getAllPlanDefinitions, getTierLimits } from '../middleware/featureGate';
import {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  getStripe,
  isStripeConfigured,
} from '../services/stripe.service';
import { createLogger } from '../config/logger';

const log = createLogger('billing');

export function registerBillingRoutes(app: Express) {

  // Get available plans (public)
  app.get('/api/billing/plans', (_req: Request, res: Response) => {
    res.json(getAllPlanDefinitions());
  });

  // Get current subscription
  app.get(
    '/api/companies/:companyId/billing/subscription',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const subscription = await storage.getSubscription(companyId);
      if (!subscription) {
        return res.status(404).json({ message: 'No subscription found' });
      }

      const limits = getTierLimits(subscription.planId);
      res.json({ subscription, limits });
    })
  );

  // Get usage counters
  app.get(
    '/api/companies/:companyId/billing/usage',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const subscription = await storage.getSubscription(companyId);
      if (!subscription) {
        return res.status(404).json({ message: 'No subscription found' });
      }

      const limits = getTierLimits(subscription.planId);
      const userCount = await storage.getUserCountByCompanyId(companyId);

      res.json({
        plan: subscription.planId,
        usage: {
          invoices: { used: subscription.invoicesCreatedThisMonth || 0, limit: limits.maxInvoicesPerMonth },
          receipts: { used: subscription.receiptsCreatedThisMonth || 0, limit: limits.maxReceiptsPerMonth },
          aiCredits: { used: subscription.aiCreditsUsedThisMonth || 0, limit: limits.aiCreditsPerMonth },
          users: { used: userCount, limit: limits.maxUsers },
          storage: { used: 0, limit: limits.maxStorageMb }, // TODO: calculate actual storage
        },
      });
    })
  );

  // Create Stripe Checkout session
  app.post(
    '/api/companies/:companyId/billing/checkout',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { planId, billingCycle } = req.body;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      if (!isStripeConfigured()) {
        return res.status(503).json({ message: 'Payment processing not configured' });
      }

      if (!planId || !billingCycle) {
        return res.status(400).json({ message: 'planId and billingCycle are required' });
      }

      if (!['starter', 'professional', 'enterprise'].includes(planId)) {
        return res.status(400).json({ message: 'Invalid plan' });
      }

      if (!['monthly', 'yearly'].includes(billingCycle)) {
        return res.status(400).json({ message: 'Invalid billing cycle' });
      }

      const origin = req.headers.origin || req.headers.referer || 'http://localhost:5000';
      const successUrl = `${origin}/subscription?success=true`;
      const cancelUrl = `${origin}/subscription?cancelled=true`;

      const url = await createCheckoutSession(companyId, planId, billingCycle, successUrl, cancelUrl);
      res.json({ url });
    })
  );

  // Create Stripe Customer Portal session
  app.post(
    '/api/companies/:companyId/billing/portal',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const subscription = await storage.getSubscription(companyId);
      if (!subscription?.stripeCustomerId) {
        return res.status(400).json({ message: 'No billing account found. Please subscribe first.' });
      }

      const origin = req.headers.origin || req.headers.referer || 'http://localhost:5000';
      const url = await createPortalSession(subscription.stripeCustomerId, `${origin}/subscription`);
      res.json({ url });
    })
  );

  // Stripe webhook (no auth — verified via signature)
  app.post(
    '/api/webhooks/stripe',
    asyncHandler(async (req: Request, res: Response) => {
      const stripeClient = getStripe();
      if (!stripeClient) {
        return res.status(503).json({ message: 'Stripe not configured' });
      }

      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!sig || !webhookSecret) {
        return res.status(400).json({ message: 'Missing signature or webhook secret' });
      }

      let event;
      try {
        event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        log.error({ error: err.message }, 'Stripe webhook signature verification failed');
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
      }

      await handleWebhookEvent(event);
      res.json({ received: true });
    })
  );
}
