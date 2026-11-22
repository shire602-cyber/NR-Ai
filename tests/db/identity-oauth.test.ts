/**
 * W2-C SSO (R01-15): mocked-provider tests for the existing OAuth callback
 * flow, plus the SSO status surfaces (OAuth configuration, SAML as
 * requires_external).
 */
import { describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";
import { useHarness } from "./harness";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../shared/bank-authorization-paths";

const profiles: Array<Record<string, unknown>> = [];
const request = vi.hoisted(() => ({ nextPath: "/dashboard" }));

vi.mock("../../server/services/oauth.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/oauth.service")>();
  return {
    ...actual,
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

async function callback(provider = "google") {
  const r = await h.anon.get(`/api/auth/oauth/${provider}/callback?state=s&code=c`);
  const cookies = r.headers.getSetCookie().map((c) => c.split(";")[0]);
  const access = cookies.find((c) => c.startsWith("muhasib-access="))?.split("=")[1];
  return { r, access };
}

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
});
