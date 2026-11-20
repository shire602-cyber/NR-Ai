/**
 * W5-E email verification, registration enumeration, CAPTCHA and breached-password
 * adapters (R01-11, R17-14 carry-over, R17-24).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { freezeTime, useHarness } from "./harness";
import type { OutgoingEmail } from "../../server/outbox";

const h = useHarness();
const uniq = () => randomBytes(4).toString("hex");
const STRONG = "Verify9Strong!x";

const sent: OutgoingEmail[] = [];
let restoreTime: (() => void) | null = null;

beforeEach(async () => {
  sent.length = 0;
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride({
    name: "test",
    send: async (m) => {
      sent.push(m);
      return { providerMessageId: `test-${sent.length}` };
    },
  });
});

afterEach(async () => {
  restoreTime?.();
  restoreTime = null;
  delete process.env.RESEND_API_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.BREACHED_PASSWORD_CHECK;
  delete process.env.EMAIL_VERIFICATION_ENFORCE;
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
  const { __setCaptchaFetchForTests } = await import("../../server/services/security/captcha");
  __setCaptchaFetchForTests(null);
  const { __setBreachedPasswordFetchForTests } =
    await import("../../server/services/security/breached-password");
  __setBreachedPasswordFetchForTests(null);
});

function tokenFrom(mail: OutgoingEmail | undefined): string {
  const m = /verify-email\?token=([0-9a-f]{64})/.exec(mail?.html ?? "");
  if (!m) throw new Error("no verification link in email");
  return m[1];
}

describe("W5-E registration does not reveal existing accounts", () => {
  it("[R17-14] new and existing emails get byte-identical answers and neither gets a session", async () => {
    const existing = await h.createTenant({ name: "Enum2" });
    sent.length = 0; // ignore the fixture's own verification email
    const fresh = await h.anon.post("/api/auth/register", {
      name: "Fresh",
      email: `fresh-${uniq()}@example.test`,
      password: STRONG,
    });
    const taken = await h.anon.post("/api/auth/register", {
      name: "Taken",
      email: existing.email,
      password: STRONG,
    });
    expect(fresh.status).toBe(200);
    expect(taken.status).toBe(200);
    expect(taken.text).toBe(fresh.text);
    expect(fresh.body.token).toBeUndefined();
    expect(fresh.headers.get("set-cookie") ?? "").not.toMatch(/muhasib-access=/);
    expect(taken.headers.get("set-cookie") ?? "").not.toMatch(/muhasib-access=/);
    // New account: a verification link. Existing account: a notice, no link.
    expect(sent.some((m) => /verify-email\?token=/.test(m.html))).toBe(true);
    const toExisting = sent.filter((m) => m.to === existing.email);
    expect(toExisting.every((m) => !/verify-email\?token=/.test(m.html))).toBe(true);
  });
});

describe("W5-E email verification", () => {
  it("[R01-11] the emailed link verifies the account once", async () => {
    const email = `verify-${uniq()}@example.test`;
    await h.anon.post("/api/auth/register", { name: "Ver", email, password: STRONG });
    const token = tokenFrom(sent.find((m) => m.to === email));
    const [before] = await h.sql(`SELECT email_verified FROM users WHERE email = $1`, [email]);
    expect(before.email_verified).toBe(false);

    const ok = await h.anon.post("/api/auth/verify-email", { token });
    expect(ok.status, ok.text).toBe(200);
    const [after] = await h.sql(
      `SELECT email_verified, email_verified_at FROM users WHERE email = $1`,
      [email]
    );
    expect(after.email_verified).toBe(true);
    expect(after.email_verified_at).toBeTruthy();
    const again = await h.anon.post("/api/auth/verify-email", { token });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("VERIFICATION_TOKEN_INVALID");
  });

  it("[R01-11] after the grace period an unverified account cannot invite or issue, only when enforcement is possible", async () => {
    const t = await h.createTenant({ name: "Grace" });
    const invite = () =>
      t.as.post(`/api/companies/${t.company.id}/team/invite`, {
        email: `inv-${uniq()}@example.test`,
        role: "viewer",
      });

    // No email provider: never locked out, status reports enforcement off.
    restoreTime = freezeTime(Date.now() + 30 * 24 * 3600_000);
    const t2 = await h.createTenant({ name: "Grace2" });
    await h.sql(`UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1`, [
      t2.user.id,
    ]);
    const overview = await t2.as.get("/api/auth/security/overview");
    expect(overview.body.emailVerification).toMatchObject({ enforced: false, verified: false });
    const allowed = await t2.as.post(`/api/companies/${t2.company.id}/team/invite`, {
      email: `inv-${uniq()}@example.test`,
      role: "viewer",
    });
    expect(allowed.status, allowed.text).not.toBe(403);
    restoreTime();
    restoreTime = null;

    // Provider configured: inside the grace period the action works ...
    process.env.RESEND_API_KEY = "re_test_w5e";
    const inGrace = await invite();
    expect(inGrace.body.code).not.toBe("EMAIL_VERIFICATION_REQUIRED");

    // ... after it, it is refused until the address is verified.
    restoreTime = freezeTime(Date.now() + 30 * 24 * 3600_000);
    const late = await h.createTenant({ name: "Grace3" });
    await h.sql(`UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1`, [
      late.user.id,
    ]);
    const blocked = await late.as.post(`/api/companies/${late.company.id}/team/invite`, {
      email: `inv-${uniq()}@example.test`,
      role: "viewer",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");

    sent.length = 0;
    const resend = await late.as.post("/api/auth/verify-email/resend", {});
    expect(resend.status, resend.text).toBe(200);
    const ok = await h.anon.post("/api/auth/verify-email", {
      token: tokenFrom(sent.find((m) => m.to === late.email)),
    });
    expect(ok.status).toBe(200);
    const after = await late.as.post(`/api/companies/${late.company.id}/team/invite`, {
      email: `inv-${uniq()}@example.test`,
      role: "viewer",
    });
    expect(after.body.code).not.toBe("EMAIL_VERIFICATION_REQUIRED");

    // The flag switches enforcement off even with a provider.
    process.env.EMAIL_VERIFICATION_ENFORCE = "false";
    const late2 = await h.createTenant({ name: "Grace4" });
    await h.sql(`UPDATE users SET created_at = now() - interval '60 days' WHERE id = $1`, [
      late2.user.id,
    ]);
    const flagOff = await late2.as.post(`/api/companies/${late2.company.id}/team/invite`, {
      email: `inv-${uniq()}@example.test`,
      role: "viewer",
    });
    expect(flagOff.body.code).not.toBe("EMAIL_VERIFICATION_REQUIRED");
  });
});

describe("W5-E CAPTCHA adapter", () => {
  it("[R17-24] skipped when not configured; called and enforced when TURNSTILE_SECRET_KEY is set", async () => {
    const { __setCaptchaFetchForTests } = await import("../../server/services/security/captcha");
    const calls: string[] = [];
    __setCaptchaFetchForTests(async (_url, init) => {
      calls.push(String(init.body));
      const ok = String(init.body).includes("response=good-token");
      return new Response(JSON.stringify({ success: ok }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const cfgOff = await h.anon.get("/api/auth/security/config");
    expect(cfgOff.body.captcha.status).toBe("requires_external");
    const noCaptcha = await h.anon.post("/api/auth/forgot-password", {
      email: `nobody-${uniq()}@example.test`,
    });
    expect(noCaptcha.status).toBe(200);
    expect(calls).toHaveLength(0);

    process.env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
    const cfgOn = await h.anon.get("/api/auth/security/config");
    expect(cfgOn.body.captcha.status).toBe("live");
    const missing = await h.anon.post("/api/auth/register", {
      name: "Bot",
      email: `bot-${uniq()}@example.test`,
      password: STRONG,
    });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("CAPTCHA_FAILED");
    const rejected = await h.anon.post("/api/auth/forgot-password", {
      email: `bot-${uniq()}@example.test`,
      captchaToken: "bad-token",
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("CAPTCHA_FAILED");
    const passed = await h.anon.post("/api/auth/register", {
      name: "Human",
      email: `human-${uniq()}@example.test`,
      password: STRONG,
      captchaToken: "good-token",
    });
    expect(passed.status, passed.text).toBe(200);
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain("secret=turnstile-test-secret");
  });
});

describe("W5-E breached-password adapter", () => {
  it("[R17-24] range API (k-anonymity) refuses a breached password and sends only a 5-char prefix", async () => {
    const { createHash } = await import("node:crypto");
    const { __setBreachedPasswordFetchForTests } =
      await import("../../server/services/security/breached-password");
    const breached = "Breached9Password!";
    const sha = createHash("sha1").update(breached).digest("hex").toUpperCase();
    const urls: string[] = [];
    __setBreachedPasswordFetchForTests(async (url) => {
      urls.push(url);
      const body = url.endsWith(sha.slice(0, 5)) ? `${sha.slice(5)}:42\r\nABCDEF:1` : "ABCDEF:1";
      return new Response(body, { status: 200 });
    });
    process.env.BREACHED_PASSWORD_CHECK = "range";

    const bad = await h.anon.post("/api/auth/register", {
      name: "Breach",
      email: `breach-${uniq()}@example.test`,
      password: breached,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("PASSWORD_BREACHED");
    expect(urls[0]).toMatch(new RegExp(`/range/${sha.slice(0, 5)}$`));
    expect(urls[0]).not.toContain(sha.slice(5));

    const good = await h.anon.post("/api/auth/register", {
      name: "Fine",
      email: `fine-${uniq()}@example.test`,
      password: STRONG,
    });
    expect(good.status).toBe(200);

    // Range API down: the offline list answers instead (and never blocks a strong password).
    __setBreachedPasswordFetchForTests(async () => {
      throw new Error("network down");
    });
    const offline = await h.anon.post("/api/auth/register", {
      name: "Offline",
      email: `offline-${uniq()}@example.test`,
      password: STRONG,
    });
    expect(offline.status).toBe(200);
  });
});
