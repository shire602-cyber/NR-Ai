/** Retired endpoints point to CSV without accessing previously configured integrations. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const redirect = "https://app.example.test/bank-feeds/callback";

function configuredDeployment() {
  vi.stubEnv("LEAN_APP_TOKEN", "mock-adapter-token");
  vi.stubEnv("BANK_FEED_REDIRECT_URIS", redirect);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const { setBankFeedFetch } = await import("../../server/services/bank-feeds/http");
  setBankFeedFetch(null);
});

describe("CSV-only banking routes", () => {
  it.each([false, true])(
    "only advertises CSV statement import (historical environment configured: %s)",
    async (configured) => {
      if (configured) configuredDeployment();
      const t = await h.createTenant();
      const status = await t.as.get(`/api/bank/providers`);
      expect(status.status, status.text).toBe(200);
      expect(status.body).toEqual({
        providers: [],
        isConfigured: false,
        statuses: [],
        redirectUris: [],
        capabilities: [],
        statementImport: { format: "csv", href: "/bank-reconciliation?import=1" },
      });
    }
  );

  it("leaves authorization and callback inactive even when legacy configuration is present", async () => {
    configuredDeployment();
    const { setBankFeedFetch } = await import("../../server/services/bank-feeds/http");
    const bankRequest = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "unexpected fixture call",
    }));
    setBankFeedFetch(bankRequest);
    const t = await h.createTenant();
    const url = `/api/companies/${t.company.id}/bank-connections`;
    const connect = await t.as.post(`${url}/connect`, { provider: "lean", redirectUrl: redirect });
    const callback = await t.as.post(`${url}/callback`, {
      provider: "lean",
      code: "mock-provider-response",
      state: "x".repeat(43),
    });
    for (const result of [connect, callback]) {
      expect(result.status, result.text).toBe(410);
      expect(result.body.code).toBe("BANK_FEED_NOT_SUPPORTED");
      expect(result.body.message).toContain("CSV");
    }
    expect(
      await h.sql("SELECT id FROM bank_feed_oauth_states WHERE company_id = $1", [t.company.id])
    ).toHaveLength(0);
    expect(bankRequest).not.toHaveBeenCalled();
  });

  it("preserves older records while preventing synchronization from the API and scheduler", async () => {
    configuredDeployment();
    const { setBankFeedFetch } = await import("../../server/services/bank-feeds/http");
    const bankRequest = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "unexpected fixture call",
    }));
    setBankFeedFetch(bankRequest);
    const t = await h.createTenant();
    const account = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
      nameEn: "Fixture account",
      bankName: "Emirates NBD",
    });
    expect(account.status, account.text).toBe(201);
    const { storage } = await import("../../server/storage");
    const connection = await storage.createBankConnection({
      companyId: t.company.id,
      bankAccountId: account.body.id,
      provider: "lean",
      connectionType: "open_banking",
      autoSync: true,
      status: "active",
      accessToken: "fake-historical-adapter-token",
      externalAccountId: "historical-account",
    });
    const historicalCiphertext = "enc:v1:fake-rotated-ciphertext";
    await h.sql("UPDATE bank_connections SET access_token = $1 WHERE id = $2", [
      historicalCiphertext,
      connection.id,
    ]);
    const result = await t.as.post(`/api/bank-connections/${connection.id}/sync`, {});
    expect(result.status, result.text).toBe(410);
    expect(result.body.code).toBe("BANK_FEED_NOT_SUPPORTED");
    expect(result.body.message).toContain("CSV");
    const { listJobs } = await import("../../server/platform/job-registry");
    expect(listJobs().some((job) => job.name === "bankFeeds.sync")).toBe(false);
    expect(
      await h.sql("SELECT id FROM bank_transactions WHERE company_id = $1", [t.company.id])
    ).toHaveLength(0);
    expect(bankRequest).not.toHaveBeenCalled();

    const listing = await t.as.get(`/api/companies/${t.company.id}/bank-connections`);
    expect(listing.status, listing.text).toBe(200);
    expect(listing.body).toContainEqual(
      expect.objectContaining({
        id: connection.id,
        autoSync: false,
        hasToken: false,
        status: "disconnected",
      })
    );
    expect(listing.text).not.toContain(historicalCiphertext);
    expect(
      await h.sql("SELECT auto_sync FROM bank_connections WHERE id = $1", [connection.id])
    ).toEqual([{ auto_sync: true }]);
    const unrelated = await h.createSecondTenant();
    expect(
      (await unrelated.as.post(`/api/bank-connections/${connection.id}/sync`, {})).status
    ).toBe(404);
  });
});
