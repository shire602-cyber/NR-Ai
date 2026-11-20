/**
 * W2-C SSO (R01-15): mocked-provider tests for the existing OAuth callback
 * flow, plus the SSO status surfaces (OAuth configuration, SAML as
 * requires_external).
 */
import { describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

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

function profile(subject: string, email: string) {
  return {
    provider: "google",
    issuer: "https://accounts.google.com",
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

  it("keeps an unverified Microsoft signup unverified and refuses to link by an unverified address", async () => {
    const microsoft = (subject: string, email: string) => ({
      ...profile(subject, email),
      provider: "microsoft",
      issuer: "https://login.microsoftonline.com/test-tenant/v2.0",
      emailVerified: false,
    });
    const email = "microsoft-unverified@example.test";
    profiles.push(microsoft("ms-unverified", email));
    expect((await callback("microsoft")).access).toBeTruthy();
    expect(await h.sql("SELECT email_verified FROM users WHERE email = $1", [email])).toEqual([
      { email_verified: false },
    ]);

    const existing = await h.createTenant();
    profiles.push(microsoft("ms-unverified-collision", existing.email));
    const rejected = await callback("microsoft");
    expect(rejected.access).toBeFalsy();
    expect(rejected.r.headers.get("location")).toContain("oauth_error=1");
    expect(
      await h.sql(
        "SELECT id FROM auth_identities WHERE provider_subject = 'ms-unverified-collision'"
      )
    ).toHaveLength(0);
  });
});
