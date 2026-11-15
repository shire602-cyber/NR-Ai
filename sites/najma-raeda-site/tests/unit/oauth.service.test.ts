import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
  process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-bytes";
  process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-bytes";
  process.env.FRONTEND_URL = "https://app.muhasib.test";
  process.env.OAUTH_GOOGLE_CLIENT_ID = "google-client-id";
  process.env.OAUTH_GOOGLE_CLIENT_SECRET = "google-client-secret";
  delete process.env.OAUTH_MICROSOFT_CLIENT_ID;
  delete process.env.OAUTH_MICROSOFT_CLIENT_SECRET;
});

vi.mock("../../server/db", () => ({ db: {} }));

import {
  decryptOAuthSecret,
  encryptOAuthSecret,
  getOAuthProviderInfo,
  hashOAuthSecret,
  isOAuthProviderId,
  normalizeOAuthEmail,
  oauthCallbackSuccessUrl,
  sanitizeOAuthNextPath,
} from "../../server/services/oauth.service";

describe("oauth service helpers", () => {
  it("recognizes only supported providers", () => {
    expect(isOAuthProviderId("google")).toBe(true);
    expect(isOAuthProviderId("microsoft")).toBe(true);
    expect(isOAuthProviderId("github")).toBe(false);
  });

  it("reports provider configuration without exposing secrets", () => {
    expect(getOAuthProviderInfo()).toEqual([
      expect.objectContaining({ id: "google", configured: true }),
      expect.objectContaining({ id: "microsoft", configured: false }),
    ]);
  });

  it("normalizes email addresses for exact-match linking", () => {
    expect(normalizeOAuthEmail(" Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("keeps OAuth next redirects relative to the app", () => {
    expect(sanitizeOAuthNextPath("/dashboard?tab=firm#today")).toBe("/dashboard?tab=firm#today");
    expect(sanitizeOAuthNextPath("https://evil.example/dashboard")).toBe("/dashboard");
    expect(sanitizeOAuthNextPath("//evil.example/dashboard")).toBe("/dashboard");
    expect(sanitizeOAuthNextPath("/\\evil")).toBe("/dashboard");
    expect(sanitizeOAuthNextPath("/dashboard\nSet-Cookie:bad")).toBe("/dashboard");
  });

  it("builds callback success redirects without leaking OAuth tokens", () => {
    const url = new URL(oauthCallbackSuccessUrl("/firm/clients?view=portfolio"));
    expect(url.origin).toBe("https://app.muhasib.test");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/firm/clients?view=portfolio");
    expect(url.search).not.toContain("code=");
    expect(url.search).not.toContain("id_token=");
  });

  it("encrypts stored state secrets and detects tampering", () => {
    const encrypted = encryptOAuthSecret("plain-pkce-verifier");
    expect(encrypted).not.toContain("plain-pkce-verifier");
    expect(decryptOAuthSecret(encrypted)).toBe("plain-pkce-verifier");

    const tampered = encrypted.replace(/\.[^.]+$/, ".tampered");
    expect(() => decryptOAuthSecret(tampered)).toThrow();
  });

  it("hashes OAuth state deterministically", () => {
    expect(hashOAuthSecret("state-a")).toBe(hashOAuthSecret("state-a"));
    expect(hashOAuthSecret("state-a")).not.toBe(hashOAuthSecret("state-b"));
  });
});
