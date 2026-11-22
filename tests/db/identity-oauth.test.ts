/**
 * W2-C SSO (R01-15): mocked-provider tests for the existing OAuth callback
 * flow, plus the SSO status surfaces (OAuth configuration, SAML as
 * requires_external).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import type { OutgoingEmail } from "../../server/outbox";
import { useHarness } from "./harness";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../shared/bank-authorization-paths";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";

const profiles: Array<Record<string, unknown>> = [];
const sent: OutgoingEmail[] = [];
const request = vi.hoisted(() => ({ nextPath: "/dashboard" }));

vi.mock("../../server/services/oauth.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/oauth.service")>();
  return {
    ...actual,
    createOAuthAuthorizationUrl: vi.fn(
      async () => new URL("https://login.microsoftonline.com/authorize?state=s")
    ),
    consumeOAuthState: vi.fn(async (provider: string) => ({
      state: "s",
      provider,
      codeVerifier: "v",
      nonce: "n",
      nextPath: request.nextPath,
    })),
    exchangeOAuthCallback: vi.fn(async () => {
      const next = profiles.shift();
      if (!next) throw new Error("no mocked profile queued");
      return next;
    }),
  };
});

const h = useHarness();

beforeEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  sent.length = 0;
  setEmailTransportOverride({
    name: "test",
    send: async (message) => {
      sent.push(message);
      return { providerMessageId: `test-mail-${sent.length}` };
    },
  });
});

afterEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
  profiles.length = 0;
});

function profile(subject: string, email: string, provider = "google") {
  return {
    provider,
    issuer:
      provider === "google"
        ? "https://accounts.google.com"
        : "https://login.microsoftonline.com/common/v2.0",
    subject,
    email,
    emailVerified: true,
    name: "OAuth Person",
    claims: { sub: subject },
  };
}

function microsoft(subject: string, email: string, emailVerified = false) {
  return {
    ...profile(subject, email),
    provider: "microsoft",
    issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
    emailVerified,
  };
}

function cookie(headers: Headers, name: string) {
  return headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith(`${name}=`));
}

function accessFrom(headers: Headers) {
  return cookie(headers, "muhasib-access")?.split("=")[1];
}

async function callback(provider = "google") {
  const options =
    provider === "microsoft" ? { headers: { cookie: await startMicrosoft() } } : undefined;
  const r = await h.anon.get(`/api/auth/oauth/${provider}/callback?state=s&code=c`, options);
  return {
    r,
    access: accessFrom(r.headers),
    mailboxCookie: cookie(r.headers, "muhasib-microsoft-mailbox"),
  };
}

async function startMicrosoft() {
  const start = await h.anon.get("/api/auth/oauth/microsoft/start");
  expect(start.status).toBe(302);
  const state = cookie(start.headers, "muhasib-microsoft-state");
  expect(state).toBeTruthy();
  return state!;
}

async function verifyMailbox(code: string, mailboxCookie?: string) {
  const csrf = await h.anon.get("/api/csrf-token");
  const csrfCookies = csrf.headers.getSetCookie().map((value) => value.split(";")[0]);
  return h.anon.post(
    "/api/auth/oauth/microsoft/verify-mailbox",
    { code },
    {
      headers: {
        cookie: [...csrfCookies, mailboxCookie].filter(Boolean).join("; "),
        "x-csrf-token": csrf.body.csrfToken,
      },
    }
  );
}

function codeFor(email: string) {
  const message = sent.findLast(
    (mail) => mail.to === email && mail.subject.startsWith("Microsoft sign-in verification")
  );
  const code = /^(\d{8})$/m.exec(message?.text ?? "")?.[1];
  expect(code).toBeDefined();
  return code!;
}

const wrongCode = (code: string) => `${code.startsWith("0") ? "1" : "0"}${code.slice(1)}`;

describe("R01-15 OAuth flow with a mocked provider", () => {
  it("R01-15: first login creates a customer with a lower-cased email and a session; repeat logins reuse it", async () => {
    profiles.push(profile("sub-new-1", "OAuth.New@Example.TEST"));
    const first = await callback();
    expect(first.r.status).toBe(302);
    expect(first.r.headers.get("location")).not.toMatch(/error|failed/i);
    expect(first.access).toBeTruthy();
    const me = await h.client(decodeURIComponent(first.access!)).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("oauth.new@example.test");

    const users = await h.sql(`SELECT id FROM users WHERE lower(email) = 'oauth.new@example.test'`);
    expect(users).toHaveLength(1);
    const owner = await h.sql(`SELECT role FROM company_users WHERE user_id = $1`, [users[0].id]);
    expect(owner).toEqual([{ role: "owner" }]);
    const sessions = await h.sql(`SELECT 1 FROM refresh_sessions WHERE user_id = $1`, [
      users[0].id,
    ]);
    expect(sessions.length).toBe(1);

    profiles.push(profile("sub-new-1", "oauth.new@example.test"));
    const again = await callback();
    expect(again.r.status).toBe(302);
    expect(
      await h.sql(`SELECT id FROM users WHERE lower(email) = 'oauth.new@example.test'`)
    ).toHaveLength(1);
  });

  it("R01-15: an existing password account is linked, not duplicated", async () => {
    const t = await h.createTenant({ name: "OauthLink" });
    profiles.push(profile("sub-link-1", t.email.toUpperCase()));
    const { r, access } = await callback();
    expect(r.status).toBe(302);
    const me = await h.client(decodeURIComponent(access!)).get("/api/auth/me");
    expect(me.body.id).toBe(t.user.id);
    const links = await h.sql(`SELECT user_id FROM auth_identities WHERE provider_subject = $1`, [
      "sub-link-1",
    ]);
    expect(links).toEqual([{ user_id: t.user.id }]);
  });

  it.each(["google", "microsoft"])(
    "keeps the clean authorization continuation through %s sign-in and MFA",
    async (provider) => {
      const tenant = await h.createTenant({ name: "OAuth Return" });
      request.nextPath = `${LEGACY_BANK_AUTHORIZATION_RETURN_PATH}?code=fixture&state=fixture`;
      try {
        const account = profile(`return-${provider}`, tenant.email, provider);
        profiles.push(account);
        const signedIn = await callback(provider);
        expect(signedIn.r.status).toBe(302);
        expect(signedIn.access).toBeTruthy();
        const success = new URL(signedIn.r.headers.get("location")!);
        expect(success.pathname).toBe("/auth/callback");
        expect(success.searchParams.get("next")).toBe(BANK_AUTHORIZATION_RETURN_PATH);

        const enrollment = await tenant.as.post("/api/auth/mfa/enroll", {});
        expect(enrollment.status, enrollment.text).toBe(200);
        const confirmed = await tenant.as.post("/api/auth/mfa/enroll/confirm", {
          code: generateSync({ secret: enrollment.body.secret }),
        });
        expect(confirmed.status, confirmed.text).toBe(200);
        profiles.push(account);
        const challenged = await callback(provider);
        expect(challenged.r.status).toBe(302);
        const mfa = new URL(challenged.r.headers.get("location")!);
        expect(mfa.pathname).toBe("/login");
        expect(mfa.searchParams.get("mfa")).toBe("1");
        expect(mfa.searchParams.get("next")).toBe(BANK_AUTHORIZATION_RETURN_PATH);
      } finally {
        request.nextPath = "/dashboard";
      }
    }
  );

  it("resumes the clean authorization path after Microsoft mailbox proof", async () => {
    const tenant = await h.createTenant();
    request.nextPath = `${LEGACY_BANK_AUTHORIZATION_RETURN_PATH}?code=fixture&state=fixture`;
    try {
      profiles.push(microsoft("statement-return-mailbox", tenant.email));
      const pending = await callback("microsoft");
      expect(pending.r.headers.get("location")).toContain("microsoft_mailbox=1");
      expect(pending.access).toBeFalsy();
      const verified = await verifyMailbox(codeFor(tenant.email), pending.mailboxCookie);
      expect(verified.status, verified.text).toBe(200);
      const destination = new URL(verified.body.redirectTo);
      expect(destination.pathname).toBe("/auth/callback");
      expect(destination.searchParams.get("next")).toBe(BANK_AUTHORIZATION_RETURN_PATH);
    } finally {
      request.nextPath = "/dashboard";
    }
  });

  it("R01-15: SSO status reports OAuth configuration and SAML as requires_external", async () => {
    const pub = await h.anon.get("/api/auth/sso/status");
    expect(pub.status).toBe(200);
    expect(pub.body.providers.map((p: { id: string }) => p.id).sort()).toEqual([
      "google",
      "microsoft",
    ]);
    expect(pub.body.providers.every((p: { configured: boolean }) => p.configured === false)).toBe(
      true
    );
    expect(pub.body.saml).toMatchObject({ status: "requires_external", implemented: false });

    const admin = await h.createTenant({ name: "SsoAdmin", isAdmin: true });
    const user = await h.createTenant({ name: "SsoUser" });
    expect((await user.as.get("/api/admin/auth/sso-status")).status).toBe(403);
    const adm = await admin.as.get("/api/admin/auth/sso-status");
    expect(adm.status).toBe(200);
    expect(adm.body.saml.status).toBe("requires_external");
  });

  it("requires mailbox proof before a Microsoft signup or account link", async () => {
    const email = "microsoft-unverified@example.test";
    profiles.push(microsoft("ms-unverified", email));
    const pending = await callback("microsoft");
    expect(pending.access).toBeFalsy();
    expect(pending.r.headers.get("location")).toContain("microsoft_mailbox=1");
    expect(await h.sql("SELECT id FROM users WHERE email = $1", [email])).toHaveLength(0);
    expect(
      await h.sql("SELECT id FROM auth_identities WHERE provider_email = $1", [email])
    ).toHaveLength(0);

    const existing = await h.createTenant();
    profiles.push(microsoft("ms-unverified-collision", existing.email));
    const rejected = await callback("microsoft");
    expect(rejected.access).toBeFalsy();
    expect(rejected.r.headers.get("location")).toContain("microsoft_mailbox=1");
    expect(
      await h.sql(
        "SELECT id FROM auth_identities WHERE provider_subject = 'ms-unverified-collision'"
      )
    ).toHaveLength(0);
    const linked = await verifyMailbox(codeFor(existing.email), rejected.mailboxCookie);
    expect(linked.status, linked.text).toBe(200);
    expect(
      (await h.client(decodeURIComponent(accessFrom(linked.headers)!)).get("/api/auth/me")).body.id
    ).toBe(existing.user.id);
    const signedUp = await verifyMailbox(codeFor(email), pending.mailboxCookie);
    expect(signedUp.status, signedUp.text).toBe(200);
    expect(await h.sql("SELECT email_verified FROM users WHERE email = $1", [email])).toEqual([
      { email_verified: true },
    ]);

    const verified = "microsoft-verified@example.test";
    profiles.push(microsoft("ms-verified", verified, true));
    expect((await callback("microsoft")).access).toBeTruthy();
    expect(
      await h.sql("SELECT provider_email_verified FROM auth_identities WHERE provider_email = $1", [
        verified,
      ])
    ).toEqual([{ provider_email_verified: true }]);
  });

  it("revalidates a legacy Microsoft link against the account's current mailbox", async () => {
    const t = await h.createTenant();
    const oldEmail = `former-${t.email}`;
    const legacy = microsoft("ms-legacy", oldEmail);
    await h.sql(
      `INSERT INTO auth_identities
        (user_id, provider, issuer, provider_subject, provider_email, provider_email_verified, profile)
       VALUES ($1, $2, $3, $4, $5, true, '{}'::jsonb)`,
      [t.user.id, legacy.provider, legacy.issuer, legacy.subject, oldEmail]
    );
    const forgot = await h.anon.post("/api/auth/forgot-password", { email: t.email });
    const token = new URL(forgot.body.devResetUrl).searchParams.get("token");
    const recovered = await h.anon.post("/api/auth/reset-password", {
      token,
      password: FAKE_PASSWORD,
    });
    expect(recovered.status, recovered.text).toBe(200);
    expect((await h.client(t.token).get("/api/auth/me")).status).toBe(401);

    const sessions = () => h.sql("SELECT id FROM refresh_sessions WHERE user_id = $1", [t.user.id]);
    const before = await sessions();
    profiles.push(microsoft(legacy.subject, oldEmail, true));
    expect((await callback("microsoft")).access).toBeFalsy();
    profiles.push(microsoft(legacy.subject, t.email));
    const pending = await callback("microsoft");
    expect(pending.access).toBeFalsy();
    expect(pending.r.headers.get("location")).toContain("microsoft_mailbox=1");
    const code = codeFor(t.email);
    expect((await verifyMailbox(code)).status).toBe(400);
    expect((await verifyMailbox(wrongCode(code), pending.mailboxCookie)).status).toBe(400);
    expect(await sessions()).toEqual(before);

    const complete = await verifyMailbox(code, pending.mailboxCookie);
    expect(complete.status, complete.text).toBe(200);
    expect(complete.body.redirectTo).toMatch(/\/auth\/callback\?next=/);
    const access = accessFrom(complete.headers);
    expect(access).toBeTruthy();
    expect((await h.client(decodeURIComponent(access!)).get("/api/auth/me")).body.id).toBe(
      t.user.id
    );
    expect(
      await h.sql("SELECT provider_email FROM auth_identities WHERE provider_subject = $1", [
        legacy.subject,
      ])
    ).toEqual([{ provider_email: t.email }]);
    const replay = await verifyMailbox(code, pending.mailboxCookie);
    expect(replay.status).toBe(400);
    expect(accessFrom(replay.headers)).toBeFalsy();
  });

  it("requires a matching browser state and rejects a code after the account mailbox changes", async () => {
    const t = await h.createTenant();
    const subject = "ms-changed-mailbox";
    await startMicrosoft();
    const foreignBrowser = await h.anon.get("/api/auth/oauth/microsoft/callback?state=s&code=c");
    expect(foreignBrowser.headers.get("location")).toContain("oauth_error=1");
    expect(sent.some((mail) => mail.subject.startsWith("Microsoft sign-in verification"))).toBe(
      false
    );

    profiles.push(microsoft(subject, t.email));
    const pending = await callback("microsoft");
    await h.sql("UPDATE users SET email = $2 WHERE id = $1", [t.user.id, `changed-${t.email}`]);
    const rejected = await verifyMailbox(codeFor(t.email), pending.mailboxCookie);
    expect(rejected.body.code).toBe("OAUTH_MAILBOX_ACCOUNT_CHANGED");
    expect(accessFrom(rejected.headers)).toBeFalsy();
    expect(
      await h.sql("SELECT id FROM auth_identities WHERE provider_subject = $1", [subject])
    ).toHaveLength(0);
  });

  it("expires Microsoft mailbox proof and stops accepting codes after five wrong attempts", async () => {
    const email = "mailbox-attempts@example.test";
    profiles.push(microsoft("ms-attempts", email));
    const pending = await callback("microsoft");
    const code = codeFor(email);
    for (let i = 0; i < 5; i += 1) {
      expect((await verifyMailbox(wrongCode(code), pending.mailboxCookie)).body.code).toBe(
        "OAUTH_MAILBOX_CODE_INVALID"
      );
    }
    expect((await verifyMailbox(code, pending.mailboxCookie)).body.code).toBe(
      "OAUTH_MAILBOX_CODE_INVALID"
    );

    profiles.push(microsoft("ms-attempts", email));
    const expired = await callback("microsoft");
    await h.sql(
      "UPDATE oauth_mailbox_challenges SET expires_at = now() - interval '1 minute' WHERE email = $1",
      [email]
    );
    expect((await verifyMailbox(codeFor(email), expired.mailboxCookie)).body.code).toBe(
      "OAUTH_MAILBOX_CODE_INVALID"
    );
    expect(await h.sql("SELECT id FROM users WHERE email = $1", [email])).toHaveLength(0);
  });

  it("keeps an MFA-enabled account in the second-factor step after mailbox proof", async () => {
    const t = await h.createTenant();
    const enrol = await t.as.post("/api/auth/mfa/enroll", {});
    expect(enrol.status, enrol.text).toBe(200);
    const confirm = await t.as.post("/api/auth/mfa/enroll/confirm", {
      code: generateSync({ secret: enrol.body.secret }),
    });
    expect(confirm.status, confirm.text).toBe(200);
    profiles.push(microsoft("ms-mfa", t.email));
    const pending = await callback("microsoft");
    const verified = await verifyMailbox(codeFor(t.email), pending.mailboxCookie);
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body.redirectTo).toContain("/login?mfa=1");
    expect(cookie(verified.headers, "muhasib-mfa")).toBeTruthy();
    expect(accessFrom(verified.headers)).toBeFalsy();
  });

  it.each(["active", "expired", "consumed"] as const)(
    "rechecks a %s Microsoft mailbox challenge when the worker retries delivery",
    async (state) => {
      const { processOutbox, setEmailTransportOverride } = await import("../../server/outbox");
      const email = `mailbox-retry-${state}@example.test`;
      const sendChallenge = vi.fn(async (message: OutgoingEmail) => {
        sent.push(message);
        if (sendChallenge.mock.calls.length === 1) throw new Error("Temporary email failure");
        return { providerMessageId: "test-mailbox-retry" };
      });
      setEmailTransportOverride({ name: "test", send: sendChallenge });

      profiles.push(microsoft(`ms-retry-${state}`, email));
      const pending = await callback("microsoft");
      expect(pending.mailboxCookie).toBeTruthy();
      const [mail] = await h.sql(
        "SELECT id, status FROM email_outbox WHERE to_address = $1 AND related_entity_type = 'oauth_mailbox_challenge'",
        [email]
      );
      expect(mail.status).toBe("retrying");

      if (state === "expired") {
        await h.sql(
          "UPDATE oauth_mailbox_challenges SET expires_at = now() AT TIME ZONE 'UTC' - interval '1 minute' WHERE email = $1",
          [email]
        );
      } else if (state === "consumed") {
        // Model a provider accepting the message before its response was lost.
        const verified = await verifyMailbox(codeFor(email), pending.mailboxCookie);
        expect(verified.status, verified.text).toBe(200);
      }

      await h.sql(
        "UPDATE email_outbox SET next_attempt_at = now() AT TIME ZONE 'UTC' WHERE id = $1",
        [mail.id]
      );
      await processOutbox();
      const [updated] = await h.sql(
        "SELECT status, attempts, locked_until, html, text_body FROM email_outbox WHERE id = $1",
        [mail.id]
      );
      expect(sendChallenge).toHaveBeenCalledTimes(state === "active" ? 2 : 1);
      expect(updated).toEqual({
        status: state === "active" ? "sent" : "cancelled",
        attempts: state === "active" ? 2 : 1,
        locked_until: null,
        html: null,
        text_body: null,
      });
    }
  );

  it("keeps Microsoft mailbox proof usable when the worker already claimed its email", async () => {
    const { processOutbox } = await import("../../server/outbox");
    const email = "mailbox-worker-claim@example.test";
    // Reproduce a worker claim between enqueue and the callback's delivery attempt.
    await h.sql(`
      CREATE FUNCTION test_claim_mailbox_email() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE email_outbox
        SET status = 'sending', locked_until = (now() AT TIME ZONE 'UTC') + interval '1 minute'
        WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_claim_mailbox_email AFTER INSERT ON email_outbox
      FOR EACH ROW WHEN (NEW.to_address = '${email}' AND NEW.related_entity_type = 'oauth_mailbox_challenge')
      EXECUTE FUNCTION test_claim_mailbox_email();
    `);
    try {
      profiles.push(microsoft("ms-worker-claim", email));
      const pending = await callback("microsoft");
      expect(pending.access).toBeFalsy();
      expect(pending.r.headers.get("location")).toContain("microsoft_mailbox=1");
      expect(pending.mailboxCookie).toBeTruthy();
      const [message] = await h.sql("SELECT status FROM email_outbox WHERE to_address = $1", [
        email,
      ]);
      expect(message?.status).toBe("sending");
      expect(sent.some((mail) => mail.to === email)).toBe(false);

      await h.sql(
        "UPDATE email_outbox SET locked_until = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE to_address = $1",
        [email]
      );
      await processOutbox();
      const verified = await verifyMailbox(codeFor(email), pending.mailboxCookie);
      expect(verified.status, verified.text).toBe(200);
      expect(accessFrom(verified.headers)).toBeTruthy();
    } finally {
      await h.sql(`
        DROP TRIGGER test_claim_mailbox_email ON email_outbox;
        DROP FUNCTION test_claim_mailbox_email();
      `);
    }
  });
});
