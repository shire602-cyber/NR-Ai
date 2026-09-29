/**
 * Pure helpers behind the client-portal invite flow: token hashing, expiry,
 * response sanitising, and the reversible "deactivated" password marker.
 */
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import {
  PORTAL_INVITE_TTL_DAYS,
  PORTAL_USER_TYPE,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isPortalUserAllowedPath,
  isUserDeactivated,
  sanitizeInvitation,
} from "../../server/services/portal-invitations";

describe("invitation tokens", () => {
  it("generates unguessable, unique 256-bit tokens", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically with SHA-256 and never returns the raw token", () => {
    const raw = generateInvitationToken();
    const h = hashInvitationToken(raw);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashInvitationToken(raw));
    expect(h).not.toBe(raw);
  });

  it("expires exactly 7 days after issue", () => {
    expect(PORTAL_INVITE_TTL_DAYS).toBe(7);
    const now = new Date("2026-03-01T10:00:00Z");
    expect(invitationExpiry(now).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("uses the client_portal user type", () => {
    expect(PORTAL_USER_TYPE).toBe("client_portal");
  });
});

describe("sanitizeInvitation", () => {
  it("drops the token (hash) and keeps display fields", () => {
    const view = sanitizeInvitation({
      id: "i1",
      email: "a@b.co",
      companyId: "c1",
      role: "client_portal",
      userType: "client_portal",
      token: "abc",
      invitedBy: "u1",
      status: "pending",
      expiresAt: new Date("2026-03-08T00:00:00Z"),
      acceptedAt: null,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    } as any, new Date("2026-03-02T00:00:00Z"));
    expect(view).not.toHaveProperty("token");
    expect(view).toMatchObject({ id: "i1", email: "a@b.co", status: "pending" });
  });

  it("reports an elapsed pending invitation as expired", () => {
    const view = sanitizeInvitation(
      { id: "i1", email: "a@b.co", status: "pending", expiresAt: new Date("2020-01-01") } as any,
      new Date("2026-01-01")
    );
    expect(view.status).toBe("expired");
  });
});

describe("deactivated accounts", () => {
  it("treats only an explicit false flag as deactivated", () => {
    expect(isUserDeactivated({ isActive: false })).toBe(true);
    expect(isUserDeactivated({ isActive: true })).toBe(false);
    expect(isUserDeactivated({})).toBe(false);
    expect(isUserDeactivated({ isActive: null })).toBe(false);
    expect(isUserDeactivated(null)).toBe(false);
    expect(isUserDeactivated(undefined)).toBe(false);
  });
});

describe("isPortalUserAllowedPath", () => {
  it("allows the portal API and session endpoints only", () => {
    expect(isPortalUserAllowedPath("/api/client-portal/dashboard")).toBe(true);
    expect(isPortalUserAllowedPath("/api/client-portal/invoices/1/pdf?x=1")).toBe(true);
    expect(isPortalUserAllowedPath("/api/auth/me")).toBe(true);
    expect(isPortalUserAllowedPath("/api/auth/logout")).toBe(true);
  });

  it("refuses everything else, including look-alike prefixes", () => {
    for (const p of [
      "/api/companies/abc/invoices",
      "/api/companies/abc/team",
      "/api/firm/clients",
      "/api/admin/users",
      "/api/client-portalx/dashboard",
      "/api/authx/me",
      "/api/client-portal", // bare prefix without a resource
      "/api/../api/companies/abc",
      "/api/client-portal/../companies/abc/invoices",
      "/api/client-portal/%2e%2e/companies",
    ]) {
      expect(isPortalUserAllowedPath(p), p).toBe(false);
    }
  });
});
