import type { EcommerceIntegration } from "../../shared/schema";

/**
 * The only shape of an e-commerce integration that may leave the server.
 *
 * There is no working Shopify/WooCommerce sync. Earlier builds stamped
 * `lastSyncAt` and `syncStatus = "success"` from a timer, so those stored
 * values are not evidence of a real sync and are deliberately not reported:
 * status is always "sync_unavailable" and lastSyncAt is always null. When a
 * real sync ships, derive both from genuine sync results here.
 */
export interface EcommerceIntegrationView {
  id: string;
  platform: string;
  status: "sync_unavailable";
  lastSyncAt: null;
  hasCredentials: boolean;
}

export function serializeEcommerceIntegration(
  integration: EcommerceIntegration
): EcommerceIntegrationView {
  return {
    id: integration.id,
    platform: integration.platform,
    status: "sync_unavailable",
    lastSyncAt: null,
    hasCredentials: !!(
      integration.apiKey ||
      integration.accessToken ||
      integration.refreshToken ||
      integration.webhookSecret
    ),
  };
}
