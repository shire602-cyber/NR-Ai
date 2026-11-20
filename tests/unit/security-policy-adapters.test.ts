/**
 * W5-E security adapters and the central policy middleware without a database
 * (R01-11, R17-19, R17-24). The DB suites (tests/db/security-*.test.ts) exercise the same
 * code through HTTP against Postgres; this suite pins the branch logic: env parsing,
 * CAPTCHA fail-closed behaviour, the k-anonymity range lookup and its offline fallback,
 * path-rule matching, company MFA policy, step-up and email-verification gating.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => ({
  users: new Map<string, { mfa_enabled: boolean; email_verified: boolean; created_at: Date }>(),
  policies: new Map<string, string>(),
  auth: null as null | { user: Record<string, unknown>; mfaAt?: number | null } | { code: string },
  company: null as string | null,
  role: null as string | null,
  emailProvider: false,
}));

vi.mock("../../server/services/security/sql", () => ({
  sql: vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM company_security_policies")) {
      const v = h.policies.get(String(params[0]));
      return { rows: v ? [{ require_mfa: v }] : [], rowCount: v ? 1 : 0 };
    }
    if (text.includes("INSERT INTO company_security_policies")) {
      h.policies.set(String(params[0]), String(params[1]));
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM users")) {
      const u = h.users.get(String(params[0]));
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }),
}));

vi.mock("../../server/middleware/auth", () => ({
  authenticateRequest: vi.fn(async () => h.auth),
}));

vi.mock("../../server/middleware/companyRolePolicy", () => ({
  resolveRequestCompany: vi.fn(async () => h.company),
  getCompanyRole: vi.fn(async () => h.role),
}));

vi.mock("../../server/services/email.service", () => ({
  hasEmailProvider: () => h.emailProvider,
}));

import {
  breachedPasswordMode,
  breachedPasswordRangeUrl,
  emailVerificationConfig,
  mfaStepUpWindowMs,
  turnstileKeys,
} from "../../server/services/security/config";
import {
  __setCaptchaFetchForTests,
  captchaStatus,
  verifyCaptcha,
} from "../../server/services/security/captcha";
import {
  __setBreachedPasswordFetchForTests,
  breachedPasswordStatus,
  checkBreachedPassword,
} from "../../server/services/security/breached-password";
import {
  EMAIL_VERIFICATION_ROLLOUT_AT,
  STEP_UP_RULES,
  VERIFIED_EMAIL_RULES,
  emailVerificationState,
  getCompanyMfaPolicy,
  hasRecentMfa,
  isCompanyMfaPolicy,
  policyCoversRole,
  requestMfaAt,
  requireRecentMfa,
  securityPolicyMiddleware,
  setCompanyMfaPolicy,
} from "../../server/services/security/policy";

const ENV_KEYS = [
  "MFA_STEP_UP_WINDOW_MINUTES",
  "EMAIL_VERIFICATION_ENFORCE",
  "EMAIL_VERIFICATION_GRACE_DAYS",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
  "BREACHED_PASSWORD_CHECK",
  "BREACHED_PASSWORD_RANGE_URL",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  h.users.clear();
  h.policies.clear();
  h.auth = null;
  h.company = null;
  h.role = null;
  h.emailProvider = false;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __setCaptchaFetchForTests(null);
  __setBreachedPasswordFetchForTests(null);
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("security config", () => {
  it("reads and clamps env values", () => {
    expect(mfaStepUpWindowMs()).toBe(10 * 60_000);
    process.env.MFA_STEP_UP_WINDOW_MINUTES = "0";
    expect(mfaStepUpWindowMs()).toBe(60_000);
    process.env.MFA_STEP_UP_WINDOW_MINUTES = "abc";
    expect(mfaStepUpWindowMs()).toBe(10 * 60_000);

    expect(emailVerificationConfig()).toEqual({
      flag: true,
      providerConfigured: false,
      enforced: false,
      graceDays: 7,
    });
    h.emailProvider = true;
    process.env.EMAIL_VERIFICATION_GRACE_DAYS = "999";
    expect(emailVerificationConfig()).toMatchObject({ enforced: true, graceDays: 365 });
    process.env.EMAIL_VERIFICATION_ENFORCE = "off";
    expect(emailVerificationConfig().enforced).toBe(false);

    expect(breachedPasswordMode()).toBe("offline");
    process.env.BREACHED_PASSWORD_CHECK = "HIBP";
    expect(breachedPasswordMode()).toBe("range");
    process.env.BREACHED_PASSWORD_CHECK = "0";
    expect(breachedPasswordMode()).toBe("off");
    expect(breachedPasswordStatus()).toEqual({ mode: "off" });

    expect(breachedPasswordRangeUrl()).toBe("https://api.pwnedpasswords.com/range/");
    process.env.BREACHED_PASSWORD_RANGE_URL = "https://range.example/api";
    expect(breachedPasswordRangeUrl()).toBe("https://range.example/api/");

    expect(turnstileKeys()).toEqual({ secretKey: null, siteKey: null });
  });
});

describe("CAPTCHA adapter", () => {
  it("is skipped and reports requires_external without a secret", async () => {
    expect(captchaStatus()).toEqual({
      provider: "turnstile",
      status: "requires_external",
      siteKey: null,
    });
    expect(await verifyCaptcha(undefined, null)).toEqual({ ok: true, skipped: true });
  });

  it("fails closed once configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.TURNSTILE_SITE_KEY = "site";
    expect(captchaStatus()).toMatchObject({ status: "live", siteKey: "site" });
    expect(await verifyCaptcha("", "1.2.3.4")).toMatchObject({ reason: "missing_token" });
    expect(await verifyCaptcha("x".repeat(5000), null)).toMatchObject({ reason: "missing_token" });

    const seen: string[] = [];
    __setCaptchaFetchForTests(async (_url, init) => {
      seen.push(String(init.body));
      return jsonResponse(200, { success: true });
    });
    expect(await verifyCaptcha("tok", "1.2.3.4")).toEqual({ ok: true, skipped: false });
    expect(seen[0]).toContain("remoteip=1.2.3.4");

    __setCaptchaFetchForTests(async () =>
      jsonResponse(200, { success: false, "error-codes": ["x"] })
    );
    expect(await verifyCaptcha("tok", "unknown")).toMatchObject({ reason: "rejected" });
    __setCaptchaFetchForTests(async () => jsonResponse(503, {}));
    expect(await verifyCaptcha("tok", null)).toMatchObject({ reason: "unavailable" });
    __setCaptchaFetchForTests(async () => {
      throw new Error("offline");
    });
    expect(await verifyCaptcha("tok", null)).toMatchObject({ reason: "unavailable" });
  });
});

describe("breached-password check", () => {
  it("uses the offline list by default and can be switched off", async () => {
    expect(await checkBreachedPassword("password")).toEqual({
      breached: true,
      source: "offline_list",
    });
    process.env.BREACHED_PASSWORD_CHECK = "off";
    expect(await checkBreachedPassword("password")).toEqual({
      breached: false,
      source: "disabled",
    });
  });

  it("sends only the SHA-1 prefix to the range API and falls back offline", async () => {
    process.env.BREACHED_PASSWORD_CHECK = "range";
    const pw = "correct horse battery staple 42";
    const sha1 = createHash("sha1").update(pw).digest("hex").toUpperCase();
    const urls: string[] = [];
    __setBreachedPasswordFetchForTests(async (url) => {
      urls.push(url);
      return new Response(`0000000000000000000000000000000000A:1\r\n${sha1.slice(5)}:17\n`, {
        status: 200,
      });
    });
    expect(await checkBreachedPassword(pw)).toEqual({
      breached: true,
      source: "range_api",
      count: 17,
    });
    expect(urls[0].endsWith(`/${sha1.slice(0, 5)}`)).toBe(true);
    expect(urls[0]).not.toContain(sha1.slice(5));

    __setBreachedPasswordFetchForTests(async () => new Response("ABC:2", { status: 200 }));
    expect(await checkBreachedPassword(pw)).toMatchObject({ breached: false, count: 0 });

    __setBreachedPasswordFetchForTests(async () => new Response("", { status: 500 }));
    expect(await checkBreachedPassword("password")).toEqual({
      breached: true,
      source: "offline_list",
      fellBack: true,
    });
  });
});

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function mockReq(method: string, path: string, extra: Partial<Request> = {}): Request {
  return { method, path, headers: {}, body: {}, ...extra } as unknown as Request;
}

async function run(req: Request) {
  const res = mockRes();
  let nextArg: unknown = "not-called";
  await securityPolicyMiddleware(
    req,
    res as unknown as Response,
    ((err?: unknown) => {
      nextArg = err;
    }) as NextFunction
  );
  return { res, nextArg, passed: nextArg === undefined };
}

describe("company MFA policy store and helpers", () => {
  it("validates, caches and stores policies", async () => {
    expect(isCompanyMfaPolicy("all")).toBe(true);
    expect(isCompanyMfaPolicy("sometimes")).toBe(false);
    expect(await getCompanyMfaPolicy("co-none")).toBe("none");
    await setCompanyMfaPolicy("co-all", "all", "u1");
    expect(await getCompanyMfaPolicy("co-all")).toBe("all");
    expect(policyCoversRole("none", "owner")).toBe(false);
    expect(policyCoversRole("all", null)).toBe(false);
    expect(policyCoversRole("all", "viewer")).toBe(true);
    expect(policyCoversRole("owners_admins", "admin")).toBe(true);
    expect(policyCoversRole("owners_admins", "accountant")).toBe(false);
  });

  it("computes email-verification grace from the rollout date", () => {
    h.emailProvider = true;
    const before = new Date("2026-01-01T00:00:00Z");
    const s = emailVerificationState(
      { emailVerified: false, createdAt: before },
      new Date(EMAIL_VERIFICATION_ROLLOUT_AT.getTime() + 8 * 86_400_000)
    );
    expect(s.restricted).toBe(true);
    expect(s.graceEndsAt).toBe(
      new Date(EMAIL_VERIFICATION_ROLLOUT_AT.getTime() + 7 * 86_400_000).toISOString()
    );
    const verified = emailVerificationState({ emailVerified: true, createdAt: before });
    expect(verified).toMatchObject({ restricted: false, graceEndsAt: null });
  });

  it("reads the MFA time carried by the request", () => {
    expect(requestMfaAt(mockReq("GET", "/x"))).toBeNull();
    const req = mockReq("GET", "/x", { authMfaAt: Date.now() - 1000 } as Partial<Request>);
    expect(hasRecentMfa(req)).toBe(true);
    expect(hasRecentMfa(req, 10)).toBe(false);
  });

  it("declares step-up and verified-email rules for sensitive paths", () => {
    expect(STEP_UP_RULES.length).toBeGreaterThan(3);
    expect(VERIFIED_EMAIL_RULES.length).toBeGreaterThan(3);
  });
});

describe("securityPolicyMiddleware", () => {
  const user = (over: Record<string, unknown> = {}) => ({ id: "u1", isAdmin: false, ...over });

  it("skips exempt and unscoped paths", async () => {
    expect((await run(mockReq("GET", "/"))).passed).toBe(true);
    expect((await run(mockReq("POST", "/auth/login"))).passed).toBe(true);
    expect((await run(mockReq("GET", "/dashboard"))).passed).toBe(true);
  });

  it("lets the route answer unauthenticated requests", async () => {
    h.auth = { code: "AUTH_REQUIRED" };
    expect((await run(mockReq("GET", "/companies/c1/invoices"))).passed).toBe(true);
    h.auth = { user: user() };
    expect((await run(mockReq("GET", "/companies/c1/invoices"))).passed).toBe(true);
  });

  it("requires enrolment when the company policy covers the role", async () => {
    h.auth = { user: user() };
    h.users.set("u1", { mfa_enabled: false, email_verified: true, created_at: new Date() });
    h.company = "c-policy";
    h.role = "owner";
    await setCompanyMfaPolicy("c-policy", "owners_admins", "u1");
    const blocked = await run(mockReq("GET", "/companies/c-policy/invoices"));
    expect(blocked.res.statusCode).toBe(403);
    expect((blocked.res.body as { code: string }).code).toBe("MFA_ENROLLMENT_REQUIRED");

    h.role = "viewer";
    expect((await run(mockReq("GET", "/companies/c-policy/invoices"))).passed).toBe(true);
    h.auth = { user: user({ isAdmin: true }) };
    h.role = "owner";
    expect((await run(mockReq("GET", "/companies/c-policy/invoices"))).passed).toBe(true);
  });

  it("asks for step-up on sensitive actions when MFA is enabled", async () => {
    h.users.set("u1", { mfa_enabled: true, email_verified: true, created_at: new Date() });
    h.auth = { user: user(), mfaAt: null };
    const stale = await run(mockReq("POST", "/backups/b1/restore"));
    expect((stale.res.body as { code: string }).code).toBe("MFA_STEP_UP_REQUIRED");
    h.auth = { user: user(), mfaAt: Date.now() };
    expect((await run(mockReq("POST", "/backups/b1/restore"))).passed).toBe(true);
    h.auth = { user: user(), mfaAt: null };
    expect((await run(mockReq("GET", "/backups/b1"))).passed).toBe(true);
  });

  it("gates document issue on email verification after the grace period", async () => {
    h.emailProvider = true;
    process.env.EMAIL_VERIFICATION_GRACE_DAYS = "0";
    h.users.set("u1", {
      mfa_enabled: false,
      email_verified: false,
      created_at: new Date("2026-01-01T00:00:00Z"),
    });
    h.auth = { user: user() };
    const issue = await run(
      mockReq("PATCH", "/invoices/i1/status", { body: { status: "sent" } } as Partial<Request>)
    );
    expect((issue.res.body as { code: string }).code).toBe("EMAIL_VERIFICATION_REQUIRED");
    const draft = await run(
      mockReq("PATCH", "/invoices/i1/status", { body: { status: "draft" } } as Partial<Request>)
    );
    expect(draft.passed).toBe(true);
  });

  it("passes errors to next", async () => {
    const { authenticateRequest } = await import("../../server/middleware/auth");
    vi.mocked(authenticateRequest).mockRejectedValueOnce(new Error("boom"));
    const r = await run(mockReq("POST", "/backups/b1/restore"));
    expect(r.nextArg).toBeInstanceOf(Error);
  });
});

describe("requireRecentMfa", () => {
  const call = async (req: Request) => {
    const res = mockRes();
    const next = vi.fn();
    requireRecentMfa()(req, res as unknown as Response, next);
    await new Promise((r) => setTimeout(r, 0));
    return { res, next };
  };

  it("refuses anonymous callers and stale MFA, allows fresh MFA and non-MFA users", async () => {
    expect((await call(mockReq("POST", "/x"))).res.statusCode).toBe(401);
    h.users.set("m", { mfa_enabled: true, email_verified: true, created_at: new Date() });
    h.users.set("n", { mfa_enabled: false, email_verified: true, created_at: new Date() });
    const stale = await call(mockReq("POST", "/x", { user: { id: "m" } } as Partial<Request>));
    expect(stale.res.statusCode).toBe(403);
    const fresh = await call(
      mockReq("POST", "/x", { user: { id: "m" }, authMfaAt: Date.now() } as Partial<Request>)
    );
    expect(fresh.next).toHaveBeenCalledWith();
    const none = await call(mockReq("POST", "/x", { user: { id: "n" } } as Partial<Request>));
    expect(none.next).toHaveBeenCalledWith();
  });
});
