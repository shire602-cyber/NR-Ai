/**
 * STEP5 security audit fixes (S5-SEC-1 .. S5-SEC-6), end to end against the real app.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import type { OutgoingEmail } from "../../server/outbox";

// Capture everything the app logs, at any level, to prove no secret reaches a log line.
const captured: Array<{ level: string; text: string }> = vi.hoisted(() => []);
vi.mock("../../server/config/logger", () => {
  const safe = (v: unknown) => {
    try {
      return JSON.stringify(v, (_k, val) =>
        val instanceof Error ? { message: val.message, stack: val.stack } : val
      );
    } catch {
      return String(v);
    }
  };
  const stub: Record<string, unknown> = {};
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
    stub[level] = (...args: unknown[]) => {
      captured.push({ level, text: args.map(safe).join(" ") });
    };
  }
  stub.child = () => stub;
  stub.level = "trace";
  return { logger: stub, createLogger: () => stub };
});

const profiles: Array<Record<string, unknown>> = [];
vi.mock("../../server/services/oauth.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/oauth.service")>();
  return {
    ...actual,
    consumeOAuthState: vi.fn(async (provider: string) => ({
      state: "s",
      provider,
      codeVerifier: "v",
      nonce: "n",
      nextPath: "/dashboard",
    })),
    exchangeOAuthCallback: vi.fn(async () => {
      const next = profiles.shift();
      if (!next) throw new Error("no mocked profile queued");
      return next;
    }),
  };
});

const h = useHarness();
const uniq = () => randomBytes(4).toString("hex");
const PASSWORD = "Portal9Strong!x";
const TOKEN_RE = /#t=([0-9a-f]{64})/;
const ANY_TOKEN = /[0-9a-f]{64}/;
const verified = (o: Record<string, unknown> = {}) =>
  h.createTenant({ emailVerified: true, ...o } as never);

beforeEach(async () => {
  captured.length = 0;
  const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
  resetPortalThrottle();
});

afterEach(async () => {
  delete process.env.RESEND_API_KEY;
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

/** A browser-like anonymous client with cookies and the CSRF token. */
async function browser() {
  const cookies = new Map<string, string>();
  const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res: Response) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const call = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) => {
    let csrf: string | undefined;
    if (method !== "GET") {
      const r = await fetch(h.baseUrl + "/api/csrf-token", {
        headers: jar() ? { cookie: jar() } : {},
      });
      absorb(r);
      csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
    }
    const res = await fetch(h.baseUrl + url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(jar() ? { cookie: jar() } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    absorb(res);
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text };
  };
  return {
    get: (u: string, hd?: Record<string, string>) => call("GET", u, undefined, hd),
    post: (u: string, b: unknown, hd?: Record<string, string>) => call("POST", u, b, hd),
  };
}

async function contact(t: Tenant, name: string, email = `cust-${uniq()}@example.test`) {
  const r = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, { name, email });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

const invite = (t: Tenant, cid: string, body: Record<string, unknown> = {}) =>
  t.as.post(`/api/companies/${t.company.id}/customer-contacts/${cid}/portal-invitations`, {
    language: "en",
    ...body,
  });

const acceptBody = { name: "Squatter", password: PASSWORD, acceptTerms: true };

function loginStatus(email: string, password: string) {
  return h.anon
    .post("/api/auth/login", { email, password })
    .then((r: { status: number }) => r.status);
}

describe("S5-SEC-1 no invitation or share-link token in logs", () => {
  it("a full accept flow (header view, body accept, legacy path form) logs no token", async () => {
    const t = await verified();
    const cid = await contact(t, "Log Customer");
    const email = `log-${uniq()}@example.test`;
    const r = await invite(t, cid, { email });
    expect(r.status, r.text).toBe(201);
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];

    const b = await browser();
    // Header view and body accept: the token is never in a URL.
    const view = await b.get("/api/portal-invitations/current", {
      "x-portal-invite-token": token,
    });
    expect(view.status, view.text).toBe(200);
    expect(view.body.email).toBe(email);
    const weak = await b.post("/api/portal-invitations/accept", {
      token,
      name: "X",
      password: "short",
      acceptTerms: true,
    });
    expect(weak.status).toBe(400);
    // The old path forms still work for links in the wild, and are redacted when logged.
    expect((await b.get(`/api/portal-invitations/${token}`)).status).toBe(200);
    const acc = await b.post("/api/portal-invitations/accept", { token, ...acceptBody });
    expect(acc.status, acc.text).toBe(200);
    expect(acc.body.redirectTo).toBe("/client-portal/dashboard");

    const bad = await b.post("/api/portal-invitations/accept", { token: "nope", ...acceptBody });
    expect(bad.status).toBe(404);

    const leaked = captured.filter((c) => c.text.includes(token) || ANY_TOKEN.test(c.text));
    expect(leaked.map((l) => l.text.slice(0, 200))).toEqual([]);
    // The request logger did run for these calls (so the assertion above is meaningful).
    expect(captured.some((c) => c.text.includes("/api/portal-invitations/:token"))).toBe(true);
  });

  it("share-link tokens in /api/portal/<token> paths are redacted too", async () => {
    const t = await verified();
    const cid = await contact(t, "Share Customer");
    const gen = await t.as.post("/api/portal/generate-access", { contactId: cid });
    expect(gen.status, gen.text).toBeLessThan(300);
    const shareToken = gen.body.token as string;
    expect(shareToken).toMatch(/^[0-9a-f]{64}$/);
    await h.anon.get(`/api/portal/${shareToken}/invoices`);
    expect(captured.some((c) => c.text.includes("/api/portal/:token/invoices"))).toBe(true);
    expect(captured.filter((c) => c.text.includes(shareToken))).toEqual([]);
  });
});

describe("S5-SEC-2 email is verified only when the invite email was really delivered", () => {
  it("an unverified inviter cannot invite", async () => {
    const t = await h.createTenant({ name: "Unverified" });
    const cid = await contact(t, "Someone");
    const r = await invite(t, cid);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(
      await h.sql(`SELECT 1 FROM customer_portal_invitations WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);
  });

  it("no provider: the account stays unverified and the real owner claims it through /register", async () => {
    const t = await verified();
    const victim = `victim-${uniq()}@bigcorp.test`;
    const cid = await contact(t, "Victim Corp", victim);
    const r = await invite(t, cid, { email: victim });
    expect(r.body.delivery).toBe("link");
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    // The inviter (the squatter) accepts their own link with their own password.
    const acc = await (
      await browser()
    ).post("/api/portal-invitations/accept", {
      token,
      ...acceptBody,
    });
    expect(acc.status, acc.text).toBe(200);
    const [squat] = await h.sql(`SELECT * FROM users WHERE email = $1`, [victim]);
    expect(squat.user_type).toBe("client_portal");
    expect(squat.email_verified).toBe(false);
    expect(await loginStatus(victim, PASSWORD)).toBe(200); // the squatter's own session

    // The real owner registers: the account is theirs, the squatter's credential is gone.
    const owner = "Owner9Strong!pw";
    const reg = await h.anon.post("/api/auth/register", {
      name: "Real Owner",
      email: victim,
      password: owner,
      companyName: "Victim Corp Co",
    });
    expect(reg.status, reg.text).toBe(200);
    expect(await loginStatus(victim, PASSWORD)).toBe(401);
    expect(await loginStatus(victim, owner)).toBe(200);
    const [after] = await h.sql(`SELECT * FROM users WHERE id = $1`, [squat.id]);
    expect(after.user_type).toBe("customer");
    expect(
      await h.sql(
        `SELECT 1 FROM customer_portal_accounts WHERE user_id = $1 AND revoked_at IS NULL`,
        [squat.id]
      )
    ).toHaveLength(0);
  });

  it("no provider: OAuth sign-in by the verified owner does not attach to the squatted account", async () => {
    const t = await verified();
    const victim = `oauth-victim-${uniq()}@bigcorp.test`;
    const cid = await contact(t, "OAuth Victim", victim);
    const r = await invite(t, cid, { email: victim });
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    const sq = await browser();
    const acc = await sq.post("/api/portal-invitations/accept", { token, ...acceptBody });
    expect(acc.status, acc.text).toBe(200);
    expect(await loginStatus(victim, PASSWORD)).toBe(200);

    profiles.push({
      provider: "google",
      issuer: "https://accounts.google.com",
      subject: `sub-${uniq()}`,
      email: victim,
      emailVerified: true,
      name: "Real Owner",
      claims: {},
    });
    const cb = await h.anon.get("/api/auth/oauth/google/callback?state=s&code=c");
    expect(cb.status).toBe(302);
    // The squatter's password no longer works and the portal binding is gone.
    expect(await loginStatus(victim, PASSWORD)).toBe(401);
    const [u] = await h.sql(`SELECT * FROM users WHERE email = $1`, [victim]);
    expect(u.user_type).toBe("customer");
    expect(u.email_verified).toBe(true);
    expect(
      await h.sql(
        `SELECT 1 FROM customer_portal_accounts WHERE user_id = $1 AND revoked_at IS NULL`,
        [u.id]
      )
    ).toHaveLength(0);
  });

  it("with a provider that delivered the email, accepting verifies the address", async () => {
    const sent: OutgoingEmail[] = [];
    const { setEmailTransportOverride } = await import("../../server/outbox");
    setEmailTransportOverride({
      name: "test",
      send: async (m) => {
        sent.push(m);
        return { providerMessageId: `t-${sent.length}` };
      },
    });
    process.env.RESEND_API_KEY = "re_test_step5_sec";
    const t = await verified();
    const email = `real-${uniq()}@example.test`;
    const cid = await contact(t, "Real Customer", email);
    const r = await invite(t, cid, { email });
    expect(r.status, r.text).toBe(201);
    expect(r.body.delivery).toBe("email");
    expect(r.body.inviteUrl).toBeUndefined();
    const token = TOKEN_RE.exec(sent.find((m) => /portal\/join/.test(m.html ?? ""))!.html!)![1];
    const acc = await (
      await browser()
    ).post("/api/portal-invitations/accept", {
      token,
      ...acceptBody,
    });
    expect(acc.status, acc.text).toBe(200);
    const [u] = await h.sql(`SELECT email_verified FROM users WHERE email = $1`, [email]);
    expect(u.email_verified).toBe(true);
  });
});

describe("S5-SEC-3 a placeholder with company memberships is not claimable", () => {
  it("accept answers LOGIN_REQUIRED and leaves the credential alone", async () => {
    const t = await verified();
    const other = await h.createSecondTenant();
    const email = `placeholder-${uniq()}@example.test`;
    const [row] = await h.sql(
      `INSERT INTO users (email, name, password_hash, user_type)
       VALUES ($1, 'Placeholder', '$placeholder$abc', 'customer') RETURNING id`,
      [email]
    );
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'admin')`, [
      other.company.id,
      row.id,
    ]);
    const cid = await contact(t, "Placeholder Co", email);
    const r = await invite(t, cid, { email });
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    const b = await browser();
    const view = await b.get("/api/portal-invitations/current", { "x-portal-invite-token": token });
    expect(view.body.account).toBe("existing");
    const acc = await b.post("/api/portal-invitations/accept", { token, ...acceptBody });
    expect(acc.status).toBe(409);
    expect(acc.body.code).toBe("LOGIN_REQUIRED");
    const [after] = await h.sql(`SELECT password_hash FROM users WHERE id = $1`, [row.id]);
    expect(after.password_hash).toBe("$placeholder$abc");
    expect(
      await h.sql(`SELECT 1 FROM customer_portal_accounts WHERE user_id = $1`, [row.id])
    ).toHaveLength(0);
  });

  it("a membership-free placeholder is still claimable", async () => {
    const t = await verified();
    const email = `free-${uniq()}@example.test`;
    await h.sql(
      `INSERT INTO users (email, name, password_hash, user_type)
       VALUES ($1, 'Free', '$placeholder$zzz', 'customer')`,
      [email]
    );
    const cid = await contact(t, "Free Co", email);
    const r = await invite(t, cid, { email });
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    const acc = await (
      await browser()
    ).post("/api/portal-invitations/accept", {
      token,
      ...acceptBody,
    });
    expect(acc.status, acc.text).toBe(200);
  });
});

describe("S5-SEC-4 invitation abuse limits", () => {
  it("a trial company is capped at 20 invitations a day, a paid company is not", async () => {
    const trial = await verified();
    const cid = await contact(trial, "Cap Co");
    for (let i = 0; i < 20; i++) {
      await h.sql(
        `INSERT INTO customer_portal_invitations
           (company_id, contact_id, email, token_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'expired', now() + interval '1 day')`,
        [trial.company.id, cid, `old-${i}@example.test`, randomBytes(32).toString("hex")]
      );
    }
    const blocked = await invite(trial, cid, { email: "new@example.test" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("PORTAL_INVITE_RATE_LIMITED");

    const paid = await verified({ planId: "professional" });
    const pcid = await contact(paid, "Paid Cap Co");
    for (let i = 0; i < 20; i++) {
      await h.sql(
        `INSERT INTO customer_portal_invitations
           (company_id, contact_id, email, token_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'expired', now() + interval '1 day')`,
        [paid.company.id, pcid, `old-${i}@example.test`, randomBytes(32).toString("hex")]
      );
    }
    expect((await invite(paid, pcid, { email: "fine@example.test" })).status).toBe(201);
  });

  it("the note is plain text without links, and the sender is the registered name only", async () => {
    const t = await verified();
    await h.sql(`UPDATE companies SET name = $2, legal_name = NULL WHERE id = $1`, [
      t.company.id,
      'Trusted Bank <security@bank.test> https://bank.test/verify "Support"',
    ]);
    const cid = await contact(t, "Note Co");
    const r = await invite(t, cid, {
      message: "Urgent: confirm at https://phish.test/login or phish.test/x, ceo@phish.test",
    });
    expect(r.status, r.text).toBe(201);
    const [mail] = await h.sql(
      `SELECT * FROM email_outbox WHERE company_id = $1 AND category = 'portal_invite'`,
      [t.company.id]
    );
    expect(mail.html).not.toContain("phish");
    expect(mail.text_body ?? mail.body ?? "").not.toContain("phish");
    expect(mail.html).toContain("[link removed]");
    expect(String(mail.from_name)).not.toMatch(/[<>@"]|https?/);
    expect(String(mail.from_name)).toContain("Trusted Bank");
  });
});

describe("S5-SEC-5 portal users cannot create companies", () => {
  it("POST /api/companies is 403 PORTAL_USER_APP_DENIED and creates nothing", async () => {
    const t = await verified();
    const email = `portal-${uniq()}@example.test`;
    const cid = await contact(t, "Portal Co", email);
    const r = await invite(t, cid, { email });
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    const acc = await (
      await browser()
    ).post("/api/portal-invitations/accept", {
      token,
      ...acceptBody,
    });
    expect(acc.status).toBe(200);
    const login = await h.anon.post("/api/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    const portal = h.client(login.body.token ?? login.body.accessToken);
    const before = await h.sql(`SELECT count(*)::int AS n FROM companies`);
    const res = await portal.post("/api/companies", { name: `Portal Squat ${uniq()}` });
    expect(res.status, res.text).toBe(403);
    expect(res.body.code).toBe("PORTAL_USER_APP_DENIED");
    const after = await h.sql(`SELECT count(*)::int AS n FROM companies`);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("S5-SEC-6 portal payment refusal, header and messages", () => {
  it("a refused payment is not reported as an error; the company endpoint shows no firm; messages are a DTO", async () => {
    const t = await verified();
    const email = `pay-${uniq()}@example.test`;
    const cid = await contact(t, "Pay Co", email);
    const r = await invite(t, cid, { email });
    const token = TOKEN_RE.exec(r.body.inviteUrl)![1];
    await (await browser()).post("/api/portal-invitations/accept", { token, ...acceptBody });
    const login = await h.anon.post("/api/auth/login", { email, password: PASSWORD });
    const portal = h.client(login.body.token ?? login.body.accessToken);

    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      contactId: cid,
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });

    captured.length = 0;
    const pay = await portal.post(`/api/client-portal/invoices/${inv.body.id}/pay`, {});
    expect(pay.status).toBe(503);
    expect(pay.body.code).toBe("PAYMENTS_REQUIRES_EXTERNAL");
    expect(captured.filter((c) => c.level === "error" || c.level === "fatal")).toEqual([]);

    // A firm engagement exists for the supplier, but the customer never sees it.
    const company = await portal.get("/api/client-portal/company");
    expect(company.status).toBe(200);
    expect(company.body.firmName).toBeUndefined();
    expect(JSON.stringify(company.body)).not.toMatch(/firm/i);

    const post = await portal.post("/api/client-portal/messages", { content: "Hello" });
    expect(post.status, post.text).toBe(201);
    const list = await portal.get("/api/client-portal/messages");
    expect(list.status).toBe(200);
    expect(Object.keys(list.body[0]).sort()).toEqual(
      ["content", "createdAt", "fromMe", "id", "isRead", "subject", "threadId"].sort()
    );
  });
});
