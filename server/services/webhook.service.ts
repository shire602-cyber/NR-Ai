import crypto from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../config/logger';

const log = createLogger('webhook-service');

/**
 * Dispatch a webhook event to all active endpoints for a company
 * that subscribe to this event type.
 *
 * Signs each request with HMAC-SHA256 and records delivery results.
 */
export async function dispatchWebhookEvent(
  companyId: string,
  event: string,
  payload: object,
): Promise<void> {
  let endpoints;
  try {
    endpoints = await storage.getActiveWebhookEndpointsForEvent(companyId, event);
  } catch (err) {
    log.error({ err, companyId, event }, 'Failed to fetch webhook endpoints');
    return;
  }

  if (endpoints.length === 0) {
    return;
  }

  log.info(
    { companyId, event, endpointCount: endpoints.length },
    'Dispatching webhook event',
  );

  const fullPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  const payloadStr = JSON.stringify(fullPayload);

  // Fire all webhook deliveries in parallel
  const deliveryPromises = endpoints.map(async (endpoint) => {
    if (!endpoint.secret) {
      log.warn({ endpointId: endpoint.id }, 'Webhook endpoint has no secret, skipping');
      return;
    }

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
          'X-Webhook-Event': event,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      responseStatus = response.status;
      responseBody = await response.text().catch(() => null);
      success = response.ok;

      log.info(
        { endpointId: endpoint.id, url: endpoint.url, status: responseStatus, success },
        'Webhook delivered',
      );
    } catch (err: any) {
      responseBody = err.message || 'Network error';
      success = false;

      log.warn(
        { endpointId: endpoint.id, url: endpoint.url, error: err.message },
        'Webhook delivery failed',
      );
    }

    // Record the delivery
    try {
      await storage.createWebhookDelivery({
        webhookEndpointId: endpoint.id,
        event,
        payload: payloadStr,
        responseStatus,
        responseBody,
        success,
        attemptNumber: 1,
      });
    } catch (err) {
      log.error({ err, endpointId: endpoint.id }, 'Failed to record webhook delivery');
    }

    // Update endpoint metadata
    try {
      await storage.updateWebhookEndpoint(endpoint.id, {
        lastTriggeredAt: new Date(),
      } as any);

      if (!success) {
        await storage.incrementWebhookFailureCount(endpoint.id);
      }
    } catch (err) {
      log.error({ err, endpointId: endpoint.id }, 'Failed to update webhook endpoint metadata');
    }
  });

  // Wait for all deliveries to complete (non-blocking to caller if desired)
  await Promise.allSettled(deliveryPromises);
}
