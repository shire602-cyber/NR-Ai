/**
 * E-commerce integration rows must never leak credentials to the client and
 * must never claim a sync happened (no real sync exists).
 */
import { describe, expect, it } from "vitest";
import { serializeEcommerceIntegration } from "../../server/services/ecommerce-integration-view";

const row = {
  id: "int-1",
  companyId: "co-1",
  platform: "shopify",
  isActive: true,
  accessToken: "enc:shpat_secret",
  refreshToken: "enc:refresh",
  apiKey: "enc:key",
  webhookSecret: "enc:whsec",
  shopDomain: "shop.myshopify.com",
  tokenExpiresAt: new Date(),
  lastSyncAt: new Date("2026-01-01"),
  syncStatus: "success",
  syncError: null,
  settings: '{"token":"x"}',
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

describe("serializeEcommerceIntegration", () => {
  it("exposes only id, platform, status, lastSyncAt and hasCredentials", () => {
    const view = serializeEcommerceIntegration(row);
    expect(Object.keys(view).sort()).toEqual(
      ["hasCredentials", "id", "lastSyncAt", "platform", "status"].sort()
    );
    expect(view.hasCredentials).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/shpat|refresh|whsec|enc:|shop\.myshopify|token/);
  });

  it("never reports a stored fake sync result as real", () => {
    const view = serializeEcommerceIntegration(row);
    expect(view.status).not.toBe("success");
    expect(view.status).not.toBe("syncing");
    expect(view.lastSyncAt).toBeNull();
  });

  it("hasCredentials is false when nothing is stored", () => {
    const view = serializeEcommerceIntegration({
      ...row,
      accessToken: null,
      refreshToken: null,
      apiKey: null,
      webhookSecret: null,
    });
    expect(view.hasCredentials).toBe(false);
  });
});
