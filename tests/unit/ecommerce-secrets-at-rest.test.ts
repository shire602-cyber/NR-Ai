/**
 * Proves e-commerce integration credentials are encrypted before they reach
 * the database — same secret-vault as bank connection tokens.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "unit-test-session-secret-0123456789abcdef";

const captured: { inserted: any; updated: any } = { inserted: null, updated: null };

vi.mock("../../server/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: any) => {
        captured.inserted = v;
        return { returning: vi.fn(async () => [{ id: "int-1", ...v }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: any) => {
        captured.updated = v;
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "int-1", ...v }]) })),
        };
      }),
    })),
    select: vi.fn(),
    delete: vi.fn(),
  },
  pool: { query: vi.fn() },
}));

import { storage } from "../../server/storage";
import { decryptSecret, isEncryptedSecret } from "../../server/services/secret-vault";

describe("e-commerce secrets at rest", () => {
  beforeEach(() => {
    captured.inserted = null;
    captured.updated = null;
  });

  it("encrypts all four credential columns on create", async () => {
    await storage.createEcommerceIntegration({
      companyId: "company-1",
      platform: "shopify",
      apiKey: "sk_live_supersecret",
      accessToken: "shpat_token",
      refreshToken: "refresh_me",
      webhookSecret: "whsec_hook",
    } as any);

    for (const field of ["apiKey", "accessToken", "refreshToken", "webhookSecret"]) {
      expect(isEncryptedSecret(captured.inserted[field]), `${field} should be encrypted`).toBe(
        true
      );
    }
    expect(decryptSecret(captured.inserted.apiKey)).toBe("sk_live_supersecret");
    expect(decryptSecret(captured.inserted.webhookSecret)).toBe("whsec_hook");
    // Non-secret columns stay readable.
    expect(captured.inserted.platform).toBe("shopify");
  });

  it("encrypts credentials supplied in updates, leaves other fields alone", async () => {
    await storage.updateEcommerceIntegration("int-1", {
      apiKey: "sk_live_rotated",
      syncStatus: "success",
    } as any);

    expect(isEncryptedSecret(captured.updated.apiKey)).toBe(true);
    expect(decryptSecret(captured.updated.apiKey)).toBe("sk_live_rotated");
    expect(captured.updated.syncStatus).toBe("success");
  });

  it("passes null credentials through without inventing ciphertext", async () => {
    await storage.createEcommerceIntegration({
      companyId: "company-1",
      platform: "stripe",
      apiKey: null,
    } as any);

    expect(captured.inserted.apiKey).toBeNull();
    expect(captured.inserted.accessToken).toBeNull();
  });
});
