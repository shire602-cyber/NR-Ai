/**
 * W3-C financial-data authorization (R06-14, R06-19): initiation requires
 * provider credentials (503), the OAuth state is verified on callback, the redirect URI is
 * allow-listed, tokens are encrypted at rest and never returned, sync dedupes by provider id.
 * Provider HTTP is a recorded sandbox-shaped fixture; nothing calls a real bank.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import session from "express-session";
import { freezeTime, useHarness, type Tenant } from "./harness";
import type { FetchLike } from "../../server/services/bank-feeds/types";
import { bankStatementCopy, bankStatementTitle } from "../../shared/bank-statement-copy";
import { LEGACY_BANK_AUTHORIZATION_RETURN_PATH } from "../../shared/bank-authorization-paths";

const h = useHarness();
const REDIRECT = "https://app.example.test/bank-feeds/callback";
const ENTITY_SECRET = "lean-entity-7f1c2d9e-secret";

function leanFixture(calls: string[], expectedCode = ENTITY_SECRET): FetchLike {
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
      expect(body.entity_id).toBe(expectedCode);
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
  vi.unstubAllEnvs();
  delete process.env.LEAN_APP_TOKEN;
  delete process.env.BANK_FEED_REDIRECT_URIS;
  await setBankFeedFetch(null);
}

afterEach(clearEnv);

async function tenant(): Promise<Tenant> {
  return h.createTenant({ name: "Feeds" });
}

async function browserHeaders() {
  const csrf = await h.anon.get("/api/csrf-token");
  return {
    cookie: csrf.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; "),
    "x-csrf-token": csrf.body.csrfToken,
  };
}

async function stageReturn(search: string, initial?: Awaited<ReturnType<typeof browserHeaders>>) {
  const headers = initial ?? (await browserHeaders());
  const reference = { returnId: randomUUID(), tabKey: randomUUID() };
  const reply = await h.anon.post(
    "/api/bank-connections/handoff",
    { search, ...reference },
    { headers }
  );
  expect(reply.status, reply.text).toBe(200);
  expect(reply.body).toEqual({ returnId: reference.returnId });
  return { reference, headers };
}

const resumeEndpoint = "/api/bank-connections/callback/resume";

describe("W3-C financial-data authorization", () => {
  it("stages an anonymous return and resumes it once for its initiating user after signing in", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "sandbox-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", REDIRECT);
    const calls: string[] = [];
    const code = "return%2F+sample%252F/";
    await setBankFeedFetch(leanFixture(calls, code));
    const owner = await tenant();
    const other = await h.createSecondTenant();
    const started = await owner.as.post(
      `/api/companies/${owner.company.id}/bank-connections/connect`,
      {
        provider: "lean",
        redirectUrl: REDIRECT,
      }
    );
    expect(started.status, started.text).toBe(200);
    const state = new URL(started.body.authUrl).searchParams.get("state")!;
    const search = `?${new URLSearchParams({ entity_id: code, state })}`;
    const withoutCsrf = await h.anon.post("/api/bank-connections/handoff", {
      search,
      returnId: randomUUID(),
      tabKey: randomUUID(),
    });
    expect(withoutCsrf.status).toBe(403);

    const browser = await browserHeaders();
    const { headers, reference } = await stageReturn(search, browser);
    // Resume using only cookies issued before staging. A tab can reload before the
    // staging response arrives.
    expect(headers).toEqual(browser);
    const endpoint = "/api/bank-connections/callback/resume";
    expect((await h.anon.post(endpoint, reference, { headers })).status).toBe(401);
    expect((await other.as.post(endpoint, reference, { headers })).body.code).toBe(
      "INVALID_OAUTH_STATE"
    );
    expect(
      (await owner.as.post(endpoint, reference, { headers: await browserHeaders() })).body
    ).toEqual({ outcome: "expired" });
    const premature = await owner.as.post(
      endpoint,
      { ...reference, acknowledge: true },
      { headers }
    );
    expect(premature.status, premature.text).toBe(409);
    expect(premature.body.code).toBe("AUTHORIZATION_RETRY");
    expect(calls).toEqual([]);

    const login = await h.anon.post("/api/auth/login", {
      email: owner.email,
      password: owner.password,
    });
    expect(login.status, login.text).toBe(200);
    const access = login.headers
      .getSetCookie()
      .find((header) => header.startsWith("muhasib-access="));
    expect(access).toBeDefined();
    headers.cookie += `; ${access!.split(";")[0]}`;
    const replies = await Promise.all([
      h.anon.post(endpoint, reference, { headers }),
      h.anon.post(endpoint, reference, { headers }),
    ]);
    const completed = replies.find((reply) => reply.status === 201);
    expect(completed?.body.connections).toMatchObject([
      { companyId: owner.company.id, provider: "lean" },
    ]);
    const replay = await h.anon.post(endpoint, reference, { headers });
    expect(replay.body).toEqual(completed?.body);
    const destroy = vi
      .spyOn(session.MemoryStore.prototype, "destroy")
      .mockImplementationOnce((_key, callback) => callback?.(new Error("Unavailable store")));
    try {
      const failedAck = await h.anon.post(
        endpoint,
        { ...reference, acknowledge: true },
        { headers }
      );
      expect(failedAck.status, failedAck.text).toBe(503);
      expect((await h.anon.post(endpoint, reference, { headers })).body).toEqual(completed?.body);
    } finally {
      destroy.mockRestore();
    }
    const acknowledged = await h.anon.post(
      endpoint,
      { ...reference, acknowledge: true },
      { headers }
    );
    expect(acknowledged.body).toEqual({ acknowledged: true });
    expect((await h.anon.post(endpoint, reference, { headers })).body).toEqual({
      outcome: "expired",
    });
    expect(calls).toHaveLength(1);
  });

  it("expires the handoff with the original state and preserves a cancellation outcome", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "sandbox-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", REDIRECT);
    const calls: string[] = [];
    await setBankFeedFetch(leanFixture(calls));
    const owner = await tenant();
    const started = await owner.as.post(
      `/api/companies/${owner.company.id}/bank-connections/connect`,
      {
        provider: "lean",
        redirectUrl: REDIRECT,
      }
    );
    expect(started.status, started.text).toBe(200);
    const state = new URL(started.body.authUrl).searchParams.get("state")!;
    const saved = await stageReturn(`?${new URLSearchParams({ code: ENTITY_SECRET, state })}`);
    const endpoint = "/api/bank-connections/callback/resume";
    const restore = freezeTime(new Date(started.body.expiresAt).getTime() + 1000);
    try {
      const expired = await owner.as.post(endpoint, saved.reference, { headers: saved.headers });
      expect(expired.status, expired.text).toBe(200);
      expect(expired.body).toEqual({ outcome: "expired" });
    } finally {
      restore();
    }
    const cancelled = await stageReturn("?error=access_denied&error_description=fixture");
    expect(
      (await owner.as.post(endpoint, cancelled.reference, { headers: cancelled.headers })).body
    ).toEqual({ outcome: "cancelled" });
    expect(calls).toEqual([]);
  });

  it("keeps two simultaneous returns in one browser bound to their own tab and workspace", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "sandbox-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", REDIRECT);
    const a = await tenant();
    const b = await h.createSecondTenant();
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      b.company.id,
      a.user.id,
    ]);
    const { getAdapter } = await import("../../server/services/bank-feeds");
    const adapter = getAdapter("lean");
    const list = vi.spyOn(adapter, "listAccounts").mockImplementation(async ({ accessToken }) => [
      {
        externalId: accessToken,
        name: "Fixture account",
        bankName: "Fixture",
        currency: "AED",
        iban: null,
        last4: null,
      },
    ]);
    try {
      const initial = await browserHeaders();
      const stage = async (companyId: string, code: string) => {
        const started = await a.as.post(`/api/companies/${companyId}/bank-connections/connect`, {
          provider: "lean",
          redirectUrl: REDIRECT,
        });
        expect(started.status, started.text).toBe(200);
        const state = new URL(started.body.authUrl).searchParams.get("state")!;
        return stageReturn(`?${new URLSearchParams({ code, state })}`, initial);
      };
      const [tabA, tabB] = await Promise.all([
        stage(a.company.id, "account-a"),
        stage(b.company.id, "account-b"),
      ]);
      const headers = initial;
      const mismatch = await a.as.post(
        resumeEndpoint,
        { ...tabB.reference, tabKey: tabA.reference.tabKey },
        { headers }
      );
      expect(mismatch.body).toEqual({ outcome: "expired" });
      expect(list).not.toHaveBeenCalled();

      const first = await a.as.post(resumeEndpoint, tabA.reference, { headers });
      expect(first.status, first.text).toBe(201);
      expect(first.body.connections).toMatchObject([
        { externalAccountId: "account-a", companyId: a.company.id },
      ]);
      const closed = await a.as.post(
        resumeEndpoint,
        { ...tabA.reference, acknowledge: true },
        { headers }
      );
      expect(closed.body).toEqual({ acknowledged: true });
      expect((await a.as.post(resumeEndpoint, tabA.reference, { headers })).body).toEqual({
        outcome: "expired",
      });
      const second = await a.as.post(resumeEndpoint, tabB.reference, { headers });
      expect(second.status, second.text).toBe(201);
      expect(second.body.connections).toMatchObject([
        { externalAccountId: "account-b", companyId: b.company.id },
      ]);
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      list.mockRestore();
    }
  });

  it("rolls back all accounts and retries the saved exchange when the second insert fails", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "sandbox-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", REDIRECT);
    const owner = await tenant();
    const { getAdapter } = await import("../../server/services/bank-feeds");
    const { storage } = await import("../../server/storage");
    const handoff = await import("../../server/services/bank-feeds/return-handoff");
    const receipt = vi.spyOn(handoff, "recordReturnReceipt").mockResolvedValueOnce(undefined);
    const adapter = getAdapter("lean");
    const exchange = vi
      .spyOn(adapter, "exchangeCode")
      .mockResolvedValue({ accessToken: "fixture-value", refreshToken: null, expiresAt: null });
    let discovering!: () => void;
    let releaseDiscovery!: () => void;
    const startedDiscovery = new Promise<void>((resolve) => {
      discovering = resolve;
    });
    const finishDiscovery = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const list = vi.spyOn(adapter, "listAccounts").mockImplementation(async () => {
      discovering();
      await finishDiscovery;
      return ["first", "second"].map((externalId) => ({
        externalId,
        name: "Fixture account",
        bankName: "Fixture",
        currency: "AED",
        iban: null,
        last4: null,
      }));
    });
    const insert = storage.createBankConnection.bind(storage);
    let fail = true;
    const writes = vi
      .spyOn(storage, "createBankConnection")
      .mockImplementation(async (data, writer) => {
        if (fail && data.externalAccountId === "second") throw new Error("Second insert fixture");
        return insert(data, writer);
      });
    try {
      const started = await owner.as.post(
        `/api/companies/${owner.company.id}/bank-connections/connect`,
        { provider: "lean", redirectUrl: REDIRECT }
      );
      expect(started.status, started.text).toBe(200);
      const state = new URL(started.body.authUrl).searchParams.get("state")!;
      const { reference, headers } = await stageReturn(
        `?${new URLSearchParams({ code: "fixture-code", state })}`
      );
      const pending = owner.as.post(resumeEndpoint, reference, { headers });
      await startedDiscovery;
      const readWithLock = h.sql(
        "SELECT id FROM bank_feed_oauth_states WHERE company_id = $1 FOR UPDATE NOWAIT",
        [owner.company.id]
      );
      try {
        expect(await readWithLock).toHaveLength(1);
      } finally {
        releaseDiscovery();
      }
      const initial = await pending;
      expect(initial.status, initial.text).toBe(503);
      expect(initial.body.code).toBe("AUTHORIZATION_RETRY");
      expect(
        await h.sql("SELECT id FROM bank_connections WHERE company_id = $1", [owner.company.id])
      ).toEqual([]);
      expect(
        await h.sql("SELECT used_at FROM bank_feed_oauth_states WHERE company_id = $1", [
          owner.company.id,
        ])
      ).toEqual([{ used_at: null }]);

      fail = false;
      const recovered = await owner.as.post(resumeEndpoint, reference, { headers });
      expect(recovered.status, recovered.text).toBe(201);
      expect(
        recovered.body.connections.map(
          (item: { externalAccountId: string }) => item.externalAccountId
        )
      ).toEqual(["first", "second"]);
      const fallback = await owner.as.post(resumeEndpoint, reference, { headers });
      expect(fallback.body).toEqual(recovered.body);
      const replay = await owner.as.post(resumeEndpoint, reference, { headers });
      expect(replay.status, replay.text).toBe(200);
      expect(replay.body).toEqual(recovered.body);
      expect(
        await h.sql("SELECT id FROM bank_connections WHERE company_id = $1", [owner.company.id])
      ).toHaveLength(2);
      expect(exchange).toHaveBeenCalledOnce();
      expect(list).toHaveBeenCalledOnce();
    } finally {
      writes.mockRestore();
      exchange.mockRestore();
      list.mockRestore();
      receipt.mockRestore();
    }
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
      expect(r.body.message).toBe(bankStatementCopy.en);
    }
    const status = await t.as.get(`/api/bank/providers`);
    expect(status.body.isConfigured).toBe(false);
    expect(status.body.csvImport).toEqual({ available: true, message: bankStatementCopy });
    expect(status.body.statuses).toEqual(
      ["lean", "tarabut", "wio"].map((id) => ({
        id,
        configured: false,
        status: "requires_external",
      }))
    );
    expect(status.text.match(/"csvImport"/g)).toHaveLength(1);
    const admin = await h.createTenant({ isAdmin: true });
    const integrations = await admin.as.get("/api/admin/integration-status");
    expect(integrations.status, integrations.text).toBe(200);
    expect(integrations.body.integrations).toContainEqual({
      key: "bankStatementImport",
      name: bankStatementTitle.en,
      configured: true,
      detail: bankStatementCopy.en,
      requiredEnv: [],
      unlocks: "",
    });
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
    const mismatched = await t.as.post(`/api/companies/${t.company.id}/bank-connections/callback`, {
      provider: "wio",
      code: ENTITY_SECRET,
      state,
    });
    expect(mismatched.status).toBe(400);

    // Another tenant cannot redeem this tenant's state.
    const other = await h.createSecondTenant();
    const stolen = await other.as.post(
      `/api/companies/${other.company.id}/bank-connections/callback`,
      {
        code: ENTITY_SECRET,
        state,
      }
    );
    expect(stolen.status).toBe(400);
  });

  it("redeems the saved workspace and user after switching, rechecking permission before consuming state", async () => {
    const origin = "https://app.example.test";
    const legacyRedirect = `${origin}${LEGACY_BANK_AUTHORIZATION_RETURN_PATH}`;
    vi.stubEnv("FRONTEND_URL", origin);
    process.env.LEAN_APP_TOKEN = "sandbox-app-token";
    const calls: string[] = [];
    const code = "fixture%2F+sample%252F/";
    await setBankFeedFetch(leanFixture(calls, code));
    const a = await tenant();
    const b = await h.createSecondTenant();
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [b.company.id, a.user.id, a.company.id, b.user.id]
    );
    const providers = await a.as.get("/api/bank/providers");
    expect(providers.body.redirectUris).toEqual(expect.arrayContaining([REDIRECT, legacyRedirect]));
    const started = await a.as.post(`/api/companies/${a.company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: legacyRedirect,
    });
    expect(started.status, started.text).toBe(200);
    const state = new URL(started.body.authUrl).searchParams.get("state");
    const payload = { code, state };
    expect(
      (await a.as.post(`/api/companies/${b.company.id}/bank-connections/callback`, payload)).status
    ).toBe(400);
    const wrongUser = await b.as.post("/api/bank-connections/callback", payload);
    expect(wrongUser.body.code).toBe("INVALID_OAUTH_STATE");

    await h.sql(`UPDATE company_users SET role = 'viewer' WHERE company_id = $1 AND user_id = $2`, [
      a.company.id,
      a.user.id,
    ]);
    const forbidden = await a.as.post("/api/bank-connections/callback", payload);
    expect(forbidden.status, forbidden.text).toBe(403);
    expect(forbidden.body.code).toBe("PERMISSION_DENIED");
    expect(calls).toHaveLength(0);
    const [unspent] = await h.sql(
      `SELECT used_at FROM bank_feed_oauth_states WHERE company_id = $1`,
      [a.company.id]
    );
    expect(unspent.used_at).toBeNull();

    await h.sql(`UPDATE company_users SET role = 'owner' WHERE company_id = $1 AND user_id = $2`, [
      a.company.id,
      a.user.id,
    ]);
    const originalBillingEnforcement = process.env.BILLING_ENFORCEMENT;
    vi.stubEnv("BILLING_ENFORCEMENT", "true");
    await h.sql(
      `UPDATE subscriptions SET plan_id = 'free', trial_ends_at = now() - interval '1 day' WHERE company_id = $1`,
      [a.company.id]
    );
    const locked = await a.as.post("/api/bank-connections/callback", payload);
    expect(locked.status, locked.text).toBe(402);
    expect(locked.body.code).toBe("PLAN_REQUIRED");
    expect(calls).toHaveLength(0);
    vi.stubEnv("BILLING_ENFORCEMENT", originalBillingEnforcement);
    await h.sql(
      `UPDATE subscriptions SET trial_ends_at = now() + interval '1 day' WHERE company_id = $1`,
      [a.company.id]
    );
    const returns = await Promise.all([
      a.as.post("/api/bank-connections/callback", payload),
      a.as.post("/api/bank-connections/callback", payload),
    ]);
    expect(returns.map((reply) => reply.status).sort()).toEqual([201, 400]);
    expect(calls).toHaveLength(1);
    const aConnections = await a.as.get(`/api/companies/${a.company.id}/bank-connections`);
    const bConnections = await a.as.get(`/api/companies/${b.company.id}/bank-connections`);
    expect(aConnections.body).toMatchObject([{ companyId: a.company.id, provider: "lean" }]);
    expect(bConnections.body).toEqual([]);
  });

  it("honors MFA enrollment required after the authorization was initiated", async () => {
    vi.stubEnv("LEAN_APP_TOKEN", "sandbox-app-token");
    vi.stubEnv("BANK_FEED_REDIRECT_URIS", REDIRECT);
    const { setCompanyMfaPolicy } = await import("../../server/services/security/policy");
    const calls: string[] = [];
    await setBankFeedFetch(leanFixture(calls));
    const { as, company, user } = await tenant();
    const started = await as.post(`/api/companies/${company.id}/bank-connections/connect`, {
      provider: "lean",
      redirectUrl: REDIRECT,
    });
    expect(started.status, started.text).toBe(200);
    const state = new URL(started.body.authUrl).searchParams.get("state")!;
    const { headers, reference } = await stageReturn(
      `?${new URLSearchParams({ code: ENTITY_SECRET, state })}`
    );
    const endpoint = "/api/bank-connections/callback/resume";

    await setCompanyMfaPolicy(company.id, "owners_admins", user.id);
    const denied = await as.post(endpoint, reference, { headers });
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
      details: { companyId: company.id, policy: "owners_admins", setupUrl: "/settings/security" },
    });
    expect(calls).toEqual([]);
    const [authorization] = await h.sql(
      `SELECT used_at FROM bank_feed_oauth_states WHERE company_id = $1`,
      [company.id]
    );
    expect(authorization.used_at).toBeNull();

    await setCompanyMfaPolicy(company.id, "none", user.id);
    const completed = await as.post(endpoint, reference, { headers });
    expect(completed.status, completed.text).toBe(201);
    expect(calls).toHaveLength(1);
  });

  it("confirms deletion with neutral wording", async () => {
    const { as, company } = await tenant();
    const created = await as.post(`/api/companies/${company.id}/bank-connections`, {
      bankName: "Fixture institution",
    });
    expect(created.status, created.text).toBe(201);
    const deleted = await as.delete(`/api/bank-connections/${created.body.id}`);
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toEqual({ message: "Record deleted" });
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
      code: ENTITY_SECRET,
      state,
    });
    expect(cb.status, cb.text).toBe(201);
    expect(cb.text).not.toContain(ENTITY_SECRET);
    const conn = cb.body.connections[0];
    expect(conn.accessToken).toBeUndefined();
    expect(conn.bankAccountId).toBe(ba.body.id);
    const balance = await t.as.get(`/api/bank-connections/${conn.id}/balance`);
    expect(balance.status, balance.text).toBe(503);
    expect(balance.body).toMatchObject({
      code: "BANK_FEED_BALANCE_UNAVAILABLE",
      message: bankStatementCopy.en,
    });
    const status = await t.as.get("/api/bank/providers");
    expect(status.body.isConfigured).toBe(true);
    expect(status.body.csvImport).toEqual({ available: true, message: bankStatementCopy });
    expect(status.body.statuses).toContainEqual({
      id: "lean",
      configured: true,
      status: "sandbox",
    });

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
    expect(r.body.message).toBe(bankStatementCopy.en);
    await new Promise((res) => setTimeout(res, 50));
    expect(seen).toContain(id);
    if (typeof off === "function") off();
    const row = await h.sql<{ status: string }>(
      `SELECT status FROM bank_connections WHERE id = $1`,
      [id]
    );
    expect(row[0].status).toBe("error");
    await h.sql("UPDATE bank_connections SET last_error = $2 WHERE id = $1", [
      id,
      "Legacy instructions",
    ]);
    const connections = await t.as.get(`/api/companies/${t.company.id}/bank-connections`);
    expect(connections.status, connections.text).toBe(200);
    expect(connections.body).toContainEqual(
      expect.objectContaining({ id, lastError: bankStatementCopy.en })
    );
  });
});
