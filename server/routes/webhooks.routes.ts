import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';
import crypto from 'crypto';

export function registerWebhookRoutes(app: Express) {
  // =====================================
  // WEBHOOK ENDPOINT MANAGEMENT
  // =====================================

  // List all webhook endpoints for a company
  app.get(
    '/api/companies/:companyId/webhooks',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const endpoints = await storage.getWebhookEndpointsByCompanyId(companyId);

      // Mask secrets — only show last 4 chars
      const masked = endpoints.map(({ secret, ...endpoint }) => ({
        ...endpoint,
        secretLast4: secret.slice(-4),
      }));

      res.json(masked);
    }),
  );

  // Create a new webhook endpoint
  app.post(
    '/api/companies/:companyId/webhooks',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;
      const { url, events } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ message: 'Webhook URL is required' });
      }

      if (!events || typeof events !== 'string' || events.trim().length === 0) {
        return res.status(400).json({ message: 'At least one event is required' });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ message: 'Invalid webhook URL' });
      }

      const secret = crypto.randomBytes(32).toString('hex');

      const created = await storage.createWebhookEndpoint({
        companyId,
        url,
        secret,
        events: events.trim(),
        isActive: true,
        createdBy: userId,
      });

      // Return the secret ONLY on creation
      res.status(201).json({
        ...created,
        secret, // full secret returned only once
      });
    }),
  );

  // Update a webhook endpoint (url, events, isActive)
  app.put(
    '/api/webhooks/:id',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;
      const { url, events, isActive } = req.body;

      const endpoint = await storage.getWebhookEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: 'Webhook endpoint not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, endpoint.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (url) {
        try {
          new URL(url);
        } catch {
          return res.status(400).json({ message: 'Invalid webhook URL' });
        }
      }

      const updateData: Record<string, any> = {};
      if (url !== undefined) updateData.url = url;
      if (events !== undefined) updateData.events = events;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await storage.updateWebhookEndpoint(id, updateData);
      const { secret, ...safeEndpoint } = updated;

      res.json({
        ...safeEndpoint,
        secretLast4: secret.slice(-4),
      });
    }),
  );

  // Delete a webhook endpoint
  app.delete(
    '/api/webhooks/:id',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const endpoint = await storage.getWebhookEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: 'Webhook endpoint not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, endpoint.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      await storage.deleteWebhookEndpoint(id);
      res.json({ message: 'Webhook endpoint deleted successfully' });
    }),
  );

  // List recent deliveries for a webhook endpoint
  app.get(
    '/api/webhooks/:id/deliveries',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const endpoint = await storage.getWebhookEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: 'Webhook endpoint not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, endpoint.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const deliveries = await storage.getWebhookDeliveriesByEndpointId(id);
      res.json(deliveries);
    }),
  );

  // Send a test webhook event
  app.post(
    '/api/webhooks/:id/test',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      const endpoint = await storage.getWebhookEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: 'Webhook endpoint not found' });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, endpoint.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        data: {
          message: 'This is a test webhook from Muhasib.ai',
          companyId: endpoint.companyId,
          webhookEndpointId: endpoint.id,
        },
      };

      const payloadStr = JSON.stringify(testPayload);
      const signature = crypto
        .createHmac('sha256', endpoint.secret)
        .update(payloadStr)
        .digest('hex');

      let responseStatus: number | null = null;
      let responseBody: string | null = null;
      let success = false;

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Event': 'test',
          },
          body: payloadStr,
          signal: AbortSignal.timeout(10000),
        });

        responseStatus = response.status;
        responseBody = await response.text().catch(() => null);
        success = response.ok;
      } catch (err: any) {
        responseBody = err.message || 'Network error';
        success = false;
      }

      // Record the delivery
      const delivery = await storage.createWebhookDelivery({
        webhookEndpointId: endpoint.id,
        event: 'test',
        payload: payloadStr,
        responseStatus,
        responseBody,
        success,
        attemptNumber: 1,
      });

      // Update last triggered
      await storage.updateWebhookEndpoint(id, {
        lastTriggeredAt: new Date(),
      } as any);

      if (!success) {
        await storage.incrementWebhookFailureCount(id);
      }

      res.json({
        success,
        delivery,
        responseStatus,
      });
    }),
  );
}
