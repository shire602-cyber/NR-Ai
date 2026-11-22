/**
 * W3-C bank feeds to the external boundary (R06-14, R06-19): connect is impossible without
 * provider credentials (503), the OAuth state is verified on callback, the redirect URI is
 * allow-listed, tokens are encrypted at rest and never returned, sync dedupes by provider id.
 * Provider HTTP is a recorded sandbox-shaped fixture; nothing calls a real bank.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import type { FetchLike } from "../../server/services/bank-feeds/types";

const h = useHarness();
const REDIRECT = "https://app.example.test/bank-feeds/callback";
const ENTITY_SECRET = "lean-entity-7f1c2d9e-secret";

function leanFixture(calls: string[]): FetchLike {
  return async (url, init) => {
    calls.push(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    const json = (data: unknown) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    });
    if (url.endsWith("/data/v1/accounts")) {
      expect(body.entity_id).toBe(ENTITY_SECRET);
      return json({
        status: "OK",
        payload: {
          accounts: [
            {
              account_id: "acc-0001",
              name: "Current Account",
              currency_code: "AED",
              iban: "AE070331234567890123456",
              institution: { name: "Emirates NBD" },
            },
          ],
        },
      });
    }
    if (url.endsWith("/data/v1/transactions")) {
      return json({
        status: "OK",
        payload: {
          transactions: [
            {
              transaction_id: "tx-1",
              timestamp: "2026-10-03T08:00:00Z",
              description: "POS CARREFOUR",
              amount: -105.5,
              balance: 9894.5,
            },
            {
              transaction_id: "tx-2",
              timestamp: "2026-10-04T09:00:00Z",
              description: "SALARY ACME",
              amount: "2000.00",
            },
            { transaction_id: "tx-3", timestamp: "not-a-date", description: "BROKEN", amount: 1 },
          ],
        },
      });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  };
}

// Server modules load lazily: importing them before the harness starts would bind the db
// module to the wrong database.
async function setBankFeedFetch(fn: FetchLike | null): Promise<void> {
  const mod = await import("../../server/services/bank-feeds");
  mod.setBankFeedFetch(fn);
}

async function clearEnv() {
  delete process.env.LEAN_APP_TOKEN;
  delete process.env.BANK_FEED_REDIRECT_URIS;
  await setBankFeedFetch(null);
}

afterEach(clearEnv);

async function tenant(): Promise<Tenant> {
  return h.createTenant({ name: "Feeds" });
}

describe("W3-C bank feeds", () => {
  it("advertises only CSV statement upload on the admin integration status surface", async () => {
    const admin = await h.createTenant({ isAdmin: true });
    const response = await admin.as.get("/api/admin/integration-status");
    expect(response.status, response.text).toBe(200);
    expect(response.body.integrations).toContainEqual({
      key: "openBanking",
      name: "Bank statement upload",
      configured: true,
      detail: null,
      requiredEnv: [],
      unlocks: "Upload CSV bank statements for reconciliation",
    });
  });

  it("[R06-14] connect with an unconfigured provider is 503 BANK_FEED_NOT_CONFIGURED", async () => {
    await clearEnv();
    const t = await tenant();
    for (const provider of ["lean", "tarabut", "wio"]) {
      const r = await t.as.post(`/api/companies/${t.company.id}/bank-connections/connect`, {
        provider,
        redirectUrl: REDIRECT,
      });
      expect(r.status, r.text).toBe(503);
      expect(r.body.code).toBe("BANK_FEED_NOT_CONFIGURED");
    }
    const status = await t.as.get(`/api/bank/providers`);
    expect(status.body.isConfigured).toBe(false);
    for (const s of status.body.statuses) {
      expect(s).toMatchObject({ configured: false, status: "requires_external" });
      expect(s.message.en).toBe("Not connected — requires provider contract");
    }
  });

  it("[R06-14] the redirect URI must be allow-listed and the callback state must match", async () => {
    process.env.LEAN_APP_TOKEN = "sandbox-app-token";
    process.env.BANK_FEED_REDIRECT_URIS = REDIRECT;
    const t = await tenant();
    const evil = await t.as.post(`/api/companies/${t.company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: "http://x",
    });
    expect(evil.status).toBe(400);
    expect(evil.body.code).toBe("REDIRECT_URI_NOT_ALLOWED");

    const ok = await t.as.post(`/api/companies/${t.company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: REDIRECT,
    });
    expect(ok.status, ok.text).toBe(200);
    const state = new URL(ok.body.authUrl).searchParams.get("state");
    expect(state && state.length >= 32).toBe(true);
    const stored = await h.sql<{ state_hash: string }>(
      `SELECT state_hash FROM bank_feed_oauth_states WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stored[0].state_hash).not.toBe(state);

    const wrong = await t.as.post(`/api/companies/${t.company.id}/bank-connections/callback`, {
      provider: "lean",
      code: ENTITY_SECRET,
      state: "x".repeat(43),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("INVALID_OAUTH_STATE");

    // Another tenant cannot redeem this tenant's state.
    const other = await h.createSecondTenant();
    const stolen = await other.as.post(
      `/api/companies/${other.company.id}/bank-connections/callback`,
      {
        provider: "lean",
        code: ENTITY_SECRET,
        state,
      }
    );
    expect(stolen.status).toBe(400);
  });

  it("[R06-14] tokens are encrypted at rest, never returned, and sync dedupes by provider id [R06-19]", async () => {
    process.env.LEAN_APP_TOKEN = "sandbox-app-token";
    process.env.BANK_FEED_REDIRECT_URIS = REDIRECT;
    const calls: string[] = [];
    await setBankFeedFetch(leanFixture(calls));
    const t = await tenant();
    const ba = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
      nameEn: "ENBD current",
      bankName: "Emirates NBD",
    });
    expect(ba.status, ba.text).toBe(201);
    const connect = await t.as.post(`/api/companies/${t.company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: REDIRECT,
      bankAccountId: ba.body.id,
    });
    const state = new URL(connect.body.authUrl).searchParams.get("state") as string;
    const cb = await t.as.post(`/api/companies/${t.company.id}/bank-connections/callback`, {
      provider: "lean",
      code: ENTITY_SECRET,
      state,
    });
    expect(cb.status, cb.text).toBe(201);
    expect(cb.text).not.toContain(ENTITY_SECRET);
    const conn = cb.body.connections[0];
    expect(conn.accessToken).toBeUndefined();
    expect(conn.bankAccountId).toBe(ba.body.id);

    const raw = await h.sql<{ access_token: string }>(
      `SELECT access_token FROM bank_connections WHERE id = $1`,
      [conn.id]
    );
    expect(raw[0].access_token).not.toBe(ENTITY_SECRET);
    expect(raw[0].access_token.startsWith("enc:v1:")).toBe(true);

    // The state is single use.
    const replay = await t.as.post(`/api/companies/${t.company.id}/bank-connections/callback`, {
      provider: "lean",
      code: ENTITY_SECRET,
      state,
    });
    expect(replay.status).toBe(400);

    const list = await t.as.get(`/api/companies/${t.company.id}/bank-connections`);
    expect(list.text).not.toContain(ENTITY_SECRET);

    const s1 = await t.as.post(`/api/bank-connections/${conn.id}/sync`, {
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
    });
    expect(s1.status, s1.text).toBe(200);
    expect(s1.body).toMatchObject({ fetched: 2, imported: 2, rejected: 1 });
    const s2 = await t.as.post(`/api/bank-connections/${conn.id}/sync`, {
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
    });
    expect(s2.body).toMatchObject({ imported: 0, duplicates: 2 });
    const rows = await h.sql<{
      amount: string;
      external_id: string;
      bank_statement_account_id: string;
    }>(
      `SELECT amount::text, external_id, bank_statement_account_id FROM bank_transactions WHERE company_id = $1 ORDER BY external_id`,
      [t.company.id]
    );
    expect(rows).toEqual([
      { amount: "-105.50", external_id: "tx-1", bank_statement_account_id: ba.body.id },
      { amount: "2000.00", external_id: "tx-2", bank_statement_account_id: ba.body.id },
    ]);
  });

  it("[R06-19] a provider failure marks the connection and emits bank.sync_failed", async () => {
    process.env.LEAN_APP_TOKEN = "sandbox-app-token";
    process.env.BANK_FEED_REDIRECT_URIS = REDIRECT;
    await setBankFeedFetch(leanFixture([]));
    const t = await tenant();
    const ba = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
      nameEn: "ENBD",
      bankName: "Emirates NBD",
    });
    const connect = await t.as.post(`/api/companies/${t.company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: REDIRECT,
      bankAccountId: ba.body.id,
    });
    const state = new URL(connect.body.authUrl).searchParams.get("state") as string;
    const cb = await t.as.post(`/api/companies/${t.company.id}/bank-connections/callback`, {
      provider: "lean",
      code: ENTITY_SECRET,
      state,
    });
    const id = cb.body.connections[0].id;
    const { onDomainEvent } = await import("../../server/platform/domain-events");
    const seen: string[] = [];
    const off = onDomainEvent("bank.sync_failed", (e) => {
      seen.push(e.payload.entityId);
    });
    await setBankFeedFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    }));
    const r = await t.as.post(`/api/bank-connections/${id}/sync`, {});
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("BANK_FEED_PROVIDER_ERROR");
    await new Promise((res) => setTimeout(res, 50));
    expect(seen).toContain(id);
    if (typeof off === "function") off();
    const row = await h.sql<{ status: string }>(
      `SELECT status FROM bank_connections WHERE id = $1`,
      [id]
    );
    expect(row[0].status).toBe("error");
  });
});
