/**
 * STEP5 security audit fixes (S5-SEC-1 .. S5-SEC-6), end to end against the real app.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";
import { useHarness, type Tenant } from "./harness";

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

const h = useHarness();
const uniq = () => randomBytes(4).toString("hex");
const PASSWORD = FAKE_PASSWORD;
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

/** The token only exists in the emailed link; read it from the outbox row. */
async function tokenOf(invitationId: string) {
  const [mail] = await h.sql(
    `SELECT html FROM email_outbox WHERE category = 'portal_invite' AND related_entity_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [invitationId]
  );
  const token = TOKEN_RE.exec(mail?.html ?? "")?.[1];
  if (!token) throw new Error("Missing invitation email in test outbox");
  return token;
}

const lookup = (b: Awaited<ReturnType<typeof browser>>, token: string) =>
  b.post("/api/portal-invitations/lookup", { token });
const accept = (
  b: Awaited<ReturnType<typeof browser>>,
  token: string,
  email: string,
  extra: Record<string, unknown> = {}
) =>
  b.post("/api/portal-invitations/accept", {
    token,
    email,
    name: "Portal Person",
    password: PASSWORD,
    acceptTerms: true,
    ...extra,
  });

async function onboard(t: Tenant, name: string) {
  const email = `portal-${uniq()}@example.test`;
  const cid = await contact(t, name, email);
  const r = await invite(t, cid, { email });
  expect(r.status, r.text).toBe(201);
  const token = await tokenOf(r.body.invitation.id);
  const acc = await accept(await browser(), token, email);
  expect(acc.status, acc.text).toBe(200);
  const login = await h.anon.post("/api/auth/login", { email, password: PASSWORD });
  expect(login.status, login.text).toBe(200);
  return {
    email,
    cid,
    portal: h.client(login.body.token ?? login.body.accessToken),
  };
}

describe("S5-SEC-1 no invitation or share-link token in logs", () => {
  it("a full lookup and accept flow, including bad tokens, logs no token", async () => {
    const t = await verified();
    const email = `log-${uniq()}@example.test`;
    const cid = await contact(t, "Log Customer", email);
    const r = await invite(t, cid, { email });
    expect(r.status, r.text).toBe(201);
    expect(JSON.stringify(r.body)).not.toMatch(ANY_TOKEN);
    const token = await tokenOf(r.body.invitation.id);

    const b = await browser();
    expect((await lookup(b, token)).status).toBe(200);
    const weak = await accept(b, token, email, { password: "short" });
    expect(weak.status).toBe(400);
    expect((await accept(b, token, email)).status).toBe(200);
    expect((await accept(b, "nope", email)).status).toBe(404);
    // Retired token-in-path forms are refused and never echo the token into a log.
    await b.get(`/api/portal-invitations/${token}`);
    await b.post(`/api/portal-invitations/${token}/accept`, { acceptTerms: true });

    const leaked = captured.filter((c) => c.text.includes(token) || ANY_TOKEN.test(c.text));
    expect(leaked.map((l) => l.text.slice(0, 200))).toEqual([]);
    expect(captured.some((c) => c.level === "info" || c.level === "warn")).toBe(true);
  });

  it("share-link tokens in /api/portal/<token> paths never reach a log line", async () => {
    const t = await verified();
    const cid = await contact(t, "Share Customer");
    const gen = await t.as.post("/api/portal/generate-access", { contactId: cid });
    expect(gen.status, gen.text).toBeLessThan(300);
    const shareToken = gen.body.token as string;
    expect(shareToken).toMatch(/^[0-9a-f]{64}$/);
    await h.anon.get(`/api/portal/${shareToken}/invoices`);
    await h.anon.get(`/api/portal/${shareToken}/nope`);
    expect(captured.filter((c) => c.text.includes(shareToken))).toEqual([]);
  });
});

describe("S5-SEC-2 invitations need a verified inviter and never hand the link to the inviter", () => {
  it("an unverified inviter cannot invite or resend", async () => {
    const t = await h.createTenant({ name: "Unverified" });
    const cid = await contact(t, "Someone");
    const r = await invite(t, cid);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(
      await h.sql(`SELECT 1 FROM customer_portal_invitations WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);
  });

  it("the invite response never contains the link or the token", async () => {
    const t = await verified();
    const cid = await contact(t, "No Link Co");
    const r = await invite(t, cid);
    expect(r.status, r.text).toBe(201);
    expect(r.body.inviteUrl).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(ANY_TOKEN);
    expect(JSON.stringify(r.body)).not.toContain("/portal/join");
  });
});

describe("S5-SEC-3 an existing account (placeholder or not) is never claimed by accept", () => {
  it("a placeholder with company memberships answers LOGIN_REQUIRED and keeps its credential", async () => {
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
    expect(r.status, r.text).toBe(201);
    const token = await tokenOf(r.body.invitation.id);
    const acc = await accept(await browser(), token, email);
    expect(acc.status).toBe(409);
    expect(acc.body.code).toBe("LOGIN_REQUIRED");
    const [after] = await h.sql(`SELECT password_hash FROM users WHERE id = $1`, [row.id]);
    expect(after.password_hash).toBe("$placeholder$abc");
    expect(
      await h.sql(`SELECT 1 FROM customer_portal_accounts WHERE user_id = $1`, [row.id])
    ).toHaveLength(0);
  });
});

describe("S5-SEC-4 invitation abuse limits", () => {
  const fill = async (t: Tenant, cid: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await h.sql(
        `INSERT INTO customer_portal_invitations
           (company_id, contact_id, email, token_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'expired', now() + interval '1 day')`,
        [t.company.id, cid, `old-${i}@example.test`, randomBytes(32).toString("hex")]
      );
    }
  };

  it("a trial company is capped at 20 invitations a day, a paid company is not", async () => {
    const trial = await verified();
    const cid = await contact(trial, "Cap Co");
    await fill(trial, cid, 20);
    const blocked = await invite(trial, cid, { email: "new@example.test" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("PORTAL_INVITE_RATE_LIMITED");

    const paid = await verified({ planId: "professional" });
    const pcid = await contact(paid, "Paid Cap Co");
    await fill(paid, pcid, 20);
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
    expect(mail.text_body ?? mail.body ?? mail.text ?? "").not.toContain("phish");
    expect(mail.html).toContain("[link removed]");
    expect(String(mail.from_name)).not.toMatch(/[<>@"]|https?/);
    expect(String(mail.from_name)).toContain("Trusted Bank");
  });
});

describe("S5-SEC-5 portal users cannot create companies", () => {
  it("POST /api/companies is 403 PORTAL_USER_APP_DENIED and creates nothing", async () => {
    const t = await verified();
    const { portal } = await onboard(t, "Portal Co");
    const before = await h.sql(`SELECT count(*)::int AS n FROM companies`);
    const res = await portal.post("/api/companies", { name: `Portal Squat ${uniq()}` });
    expect(res.status, res.text).toBe(403);
    // Refused before the handler (portal scope guard, or PORTAL_USER_APP_DENIED from the route).
    expect(["PORTAL_SCOPE", "PORTAL_USER_APP_DENIED"]).toContain(res.body.code);
    const after = await h.sql(`SELECT count(*)::int AS n FROM companies`);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("S5-SEC-6 portal payment refusal, header and messages", () => {
  it("a refused payment is not reported as an error; the company endpoint shows no firm; messages are a DTO", async () => {
    const t = await verified();
    const { portal, cid } = await onboard(t, "Pay Co");

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

    const company = await portal.get("/api/client-portal/company");
    expect(company.status).toBe(200);
    expect(company.body.firmName).toBeUndefined();
    expect(JSON.stringify(company.body)).not.toMatch(/firm/i);

    const post = await portal.post(
      "/api/client-portal/messages",
      { content: "Hello" },
      { headers: { "X-Portal-Account": company.body.portalAccountId } }
    );
    expect(post.status, post.text).toBe(201);
    const list = await portal.get("/api/client-portal/messages");
    expect(list.status).toBe(200);
    expect(Object.keys(list.body[0]).sort()).toEqual(
      ["content", "createdAt", "fromMe", "id", "isRead", "subject", "threadId"].sort()
    );
  });
});
