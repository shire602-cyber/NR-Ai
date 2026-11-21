import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";

const h = useHarness();
const redirectUrl = "https://app.example.test/bank-feeds/callback";

afterEach(async () => {
  vi.unstubAllEnvs();
  const { setBankFeedFetch } = await import("../../server/services/bank-feeds/http");
  setBankFeedFetch(null);
});

describe("Banking authorization retirement and CSV import", () => {
  it("ends new authorizations and old returns without contacting a configured provider", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "fixture-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", redirectUrl);
    const { setBankFeedFetch } = await import("../../server/services/bank-feeds/http");
    const fetch = vi.fn(async () => {
      throw new Error("Unexpected external request");
    });
    setBankFeedFetch(fetch);

    const t = await h.createTenant();
    const base = `/api/companies/${t.company.id}/bank-connections`;
    const status = await t.as.get("/api/bank/providers");
    expect(status.status, status.text).toBe(200);
    expect(status.body).toEqual({
      providers: [],
      isConfigured: false,
      statuses: [],
      redirectUris: [],
      capabilities: [],
      csvImport: { available: true, message: BANK_RECONCILIATION_COPY },
    });
    const connect = await t.as.post(`${base}/connect`, { provider: "lean", redirectUrl });
    const callback = await t.as.post(`${base}/callback`, {
      provider: "lean",
      code: "old-code",
      state: "old-state",
    });
    for (const result of [connect, callback]) {
      expect(result.status, result.text).toBe(410);
      expect(result.body).toMatchObject({
        code: "BANK_FEED_NOT_SUPPORTED",
        message: BANK_RECONCILIATION_COPY.en,
      });
      expect(result.body).not.toHaveProperty("authUrl");
    }
    expect(
      await h.sql("SELECT id FROM bank_feed_oauth_states WHERE company_id = $1", [t.company.id])
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("expires in-flight state, disables existing imports and preserves statement history", async () => {
    const t = await h.createTenant();
    const account = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
      nameEn: "Operating account",
      bankName: "Example Bank",
    });
    expect(account.status, account.text).toBe(201);

    const { storage } = await import("../../server/storage");
    const connection = await storage.createBankConnection({
      companyId: t.company.id,
      provider: "lean",
      connectionType: "open_banking",
      bankAccountId: account.body.id,
      autoSync: true,
      accessToken: "fixture-access-credential",
      status: "active",
    });
    const base = `/api/companies/${t.company.id}/bank-connections`;
    const imported = await t.as.post(`${base}/${connection.id}/import`, {
      csvContent: "Date,Description,Debit,Credit\n2026-10-01,Prior statement,,100.00",
    });
    expect(imported.status, imported.text).toBe(200);
    expect(imported.body.imported).toBe(1);
    const [oauth] = await h.sql<{ id: string }>(
      `INSERT INTO bank_feed_oauth_states (company_id, user_id, provider, state_hash, redirect_uri, expires_at)
       VALUES ($1, $2, 'lean', 'fixture-state-hash', $3, now() + interval '10 minutes')
       RETURNING id`,
      [t.company.id, t.user.id, redirectUrl]
    );
    const pinned = (
      await h.sql<{ access_token: string }>(
        "SELECT access_token FROM bank_connections WHERE id = $1",
        [connection.id]
      )
    )[0].access_token;
    expect(pinned).toMatch(/^enc:v1:/);

    const { retireAutomaticBanking } = await import("../../server/services/bank-feeds");
    await retireAutomaticBanking();
    const [state] = await h.sql<{ used_at: Date }>(
      "SELECT used_at FROM bank_feed_oauth_states WHERE id = $1",
      [oauth.id]
    );
    expect(state.used_at).toBeTruthy();
    await retireAutomaticBanking();
    expect(
      await h.sql("SELECT used_at FROM bank_feed_oauth_states WHERE id = $1", [oauth.id])
    ).toEqual([state]);
    expect(
      await h.sql("SELECT auto_sync, access_token FROM bank_connections WHERE id = $1", [
        connection.id,
      ])
    ).toEqual([{ auto_sync: false, access_token: pinned }]);
    const { listJobs } = await import("../../server/platform/job-registry");
    expect(listJobs().map((job) => job.name)).not.toContain("bankFeeds.sync");

    const list = await t.as.get(base);
    expect(list.status, list.text).toBe(200);
    expect(list.body).toContainEqual(
      expect.objectContaining({
        id: connection.id,
        bankAccountId: account.body.id,
        autoSync: false,
        hasToken: false,
      })
    );
    expect(list.text).not.toContain(pinned);
    expect(list.text).not.toContain("fixture-access-credential");
    const sync = `/api/bank-connections/${connection.id}/sync`;
    const stopped = await t.as.post(sync, {});
    expect(stopped.status, stopped.text).toBe(410);
    expect(stopped.body.message).toBe(BANK_RECONCILIATION_COPY.en);
    const other = await h.createSecondTenant();
    const hidden = await other.as.post(sync, {});
    expect(hidden.status, hidden.text).toBe(404);

    const manual = await t.as.post(base, {
      bankName: "Example Bank",
      bankAccountId: account.body.id,
    });
    expect(manual.status, manual.text).toBe(201);
    const csv = await t.as.post(`${base}/${manual.body.id}/import`, {
      csvContent: "Date,Description,Debit,Credit\n2026-10-02,CSV deposit,,200.00",
    });
    expect(csv.status, csv.text).toBe(200);
    expect(csv.body.imported).toBe(1);
    expect(
      await h.sql(
        "SELECT description, bank_statement_account_id FROM bank_transactions WHERE company_id = $1 ORDER BY description",
        [t.company.id]
      )
    ).toEqual([
      { description: "CSV deposit", bank_statement_account_id: account.body.id },
      { description: "Prior statement", bank_statement_account_id: account.body.id },
    ]);
  });
});
