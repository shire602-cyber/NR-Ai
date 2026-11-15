/**
 * W2-C rate limiting and lockout (R01-09, R01-10, R01-12, R17-06).
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
const mail = () => `rl-${randomBytes(4).toString("hex")}@example.test`;

afterEach(async () => {
  await h.resetRateLimits();
});

const cheapWrite = (t: Tenant) =>
  t.as.post(`/api/companies/${t.company.id}/customer-contacts/import-preview`, {});

describe("R01-10 per-user budgets after authentication", () => {
  it("R01-10: two users behind one IP get independent write budgets", async () => {
    const a = await h.createTenant({ name: "NatA" });
    const b = await h.createSecondTenant({ name: "NatB" });
    await h.setRateLimits({ api: 3 });
    for (let i = 0; i < 3; i++) expect((await cheapWrite(a)).status).not.toBe(429);
    const fourth = await cheapWrite(a);
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe("RATE_LIMITED");
    // Same IP (127.0.0.1), different user: unaffected.
    expect((await cheapWrite(b)).status).not.toBe(429);
  });

  it("R01-10: a refresh token or forged bearer does not buy a per-user bucket", async () => {
    const a = await h.createTenant({ name: "NatForge" });
    await h.setRateLimits({ api: 2 });
    const forged = h.client("not-a-jwt");
    await forged.post(`/api/companies/${a.company.id}/customer-contacts/import-preview`, {});
    await h.anon.post(`/api/companies/${a.company.id}/customer-contacts/import-preview`, {});
    const third = await h.anon.post(
      `/api/companies/${a.company.id}/customer-contacts/import-preview`,
      {}
    );
    expect(third.status).toBe(429);
    // The signed-in user still has their own budget.
    expect((await cheapWrite(a)).status).not.toBe(429);
  });
});

describe("R17-06 rejected requests are not counted", () => {
  it("R17-06: retrying while throttled does not extend the throttle", async () => {
    const a = await h.createTenant({ name: "Retry" });
    await h.setRateLimits({ api: 2 });
    expect((await cheapWrite(a)).status).not.toBe(429);
    expect((await cheapWrite(a)).status).not.toBe(429);
    for (let i = 0; i < 5; i++) expect((await cheapWrite(a)).status).toBe(429);
    const restore = freezeTime(Date.now() + 61_000);
    try {
      expect((await cheapWrite(a)).status).not.toBe(429);
    } finally {
      restore();
    }
  });

  it("R17-06: /auth/refresh and /auth/logout are outside the strict auth bucket", async () => {
    await h.setRateLimits({ auth: 2 });
    for (let i = 0; i < 6; i++) {
      expect((await h.anon.post("/api/auth/refresh", {})).status).not.toBe(429);
      expect((await h.anon.post("/api/auth/logout", {})).status).not.toBe(429);
    }
  });
});

describe("R01-09 trusted proxy hops", () => {
  const badLogin = (xff: string) =>
    h.anon.post(
      "/api/auth/login",
      { email: mail(), password: "Wrong-password-1" },
      { headers: { "X-Forwarded-For": xff } }
    );

  it("R01-09: spoofed X-Forwarded-For entries beyond the trusted hop share one bucket", async () => {
    await h.setRateLimits({ auth: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await badLogin(`10.66.0.${i}, 203.0.113.7`)).status).toBe(401);
    }
    const blocked = await badLogin("10.66.0.99, 203.0.113.7");
    expect(blocked.status).toBe(429);
    // The address appended by the trusted proxy is a different client.
    expect((await badLogin("10.66.0.99, 203.0.113.8")).status).toBe(401);
  });

  it("R01-09: TRUST_PROXY_HOPS=0 ignores X-Forwarded-For entirely", async () => {
    const prev = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = "0";
    try {
      await h.setRateLimits({ auth: 2 });
      expect((await badLogin("198.51.100.1")).status).toBe(401);
      expect((await badLogin("198.51.100.2")).status).toBe(401);
      expect((await badLogin("198.51.100.3")).status).toBe(429);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = prev;
    }
  });
});

describe("R01-12 progressive lockout", () => {
  it("R01-12: the sixth bad login for one email is 429 only for that email; locked retries do not extend it", async () => {
    const t = await h.createTenant({ name: "Lock" });
    for (let i = 0; i < 5; i++) {
      const r = await h.anon.post("/api/auth/login", { email: t.email, password: `Bad${i}xx` });
      expect(r.status).toBe(401);
    }
    const sixth = await h.anon.post("/api/auth/login", { email: t.email, password: "Bad6xx" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe("ACCOUNT_LOCKED");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);

    // Another email on the same IP is unaffected.
    const other = await h.anon.post("/api/auth/login", { email: mail(), password: "Bad1xx" });
    expect(other.status).toBe(401);

    // Even the right password is refused while locked, and these rejected
    // attempts are not recorded...
    for (let i = 0; i < 5; i++) {
      const r = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
      expect(r.status).toBe(429);
    }
    // ...so the lockout ends 15 minutes after the failures, not after the retries.
    const restore = freezeTime(Date.now() + 15 * 60_000 + 5_000);
    try {
      const ok = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
      expect(ok.status, ok.text).toBe(200);
    } finally {
      restore();
    }

    const audit = await h.sql(
      `SELECT 1 FROM audit_logs WHERE action = 'auth.lockout' AND user_id = $1`,
      [t.user.id]
    );
    expect(audit.length).toBe(1);
    const notes = await h.sql(
      `SELECT priority FROM notifications WHERE user_id = $1 AND type = 'system'`,
      [t.user.id]
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });
});
