import crypto from "crypto";
import type { Invitation } from "../../shared/schema";

/**
 * Client-portal invitations reuse the `invitations` table: a row with
 * userType/role "client_portal" bound to exactly one client company.
 *
 * Differences from admin-created invitations (which store the raw token):
 * the token column holds a SHA-256 digest of the emailed token, so a database
 * read never yields a usable accept link.
 */
export const PORTAL_USER_TYPE = "client_portal" as const;
export const PORTAL_INVITE_TTL_DAYS = 7;
/** company_users.role for portal users; matches no role-gated route. */
export const PORTAL_COMPANY_ROLE = "client_portal";

export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function invitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PORTAL_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationView = Omit<Invitation, "token">;

/** Never ship the token column to a client; surface elapsed invites as expired. */
export function sanitizeInvitation(
  invitation: Invitation,
  now: Date = new Date()
): InvitationView {
  const { token: _token, ...rest } = invitation;
  const elapsed =
    rest.status === "pending" && rest.expiresAt && new Date(rest.expiresAt).getTime() < now.getTime();
  return elapsed ? { ...rest, status: "expired" } : rest;
}

/** A deactivated account cannot log in, refresh, reset a password or use a token. */
export function isUserDeactivated(user: { isActive?: boolean | null } | null | undefined): boolean {
  return !!user && user.isActive === false;
}

/**
 * A client-portal user is a read-mostly guest of one client company. Beyond
 * the portal API itself they may only use the session endpoints (who am I,
 * refresh, logout). Everything else — the accounting API, team, settings,
 * firm and admin routes — is refused centrally in authMiddleware, so a route
 * that only checks company membership can never serve a portal user.
 */
const PORTAL_USER_ALLOWED_PREFIXES = ["/api/client-portal/", "/api/auth/"];

export function isPortalUserAllowedPath(urlPath: string): boolean {
  const pathOnly = urlPath.split("?")[0].split("#")[0];
  if (pathOnly.includes("..") || /%2e/i.test(pathOnly)) return false; // no traversal tricks
  return PORTAL_USER_ALLOWED_PREFIXES.some((prefix) => pathOnly.startsWith(prefix));
}
