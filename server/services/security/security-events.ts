/**
 * Security event audit + suspicious-login alerts (R01-16, R17-23).
 *
 * Every security event is an audit_logs row (resource_type "security", or the affected
 * resource) and therefore part of the tamper-evident chain. Events tied to a company carry
 * company_id; account-level events (sign-in, MFA, password) sit on the user's chain
 * "global" and are listed per user in the login history.
 */
import type { Request } from "express";
import { createLogger } from "../../config/logger";
import { storage } from "../../storage";
import { clientIp } from "../../middleware/rateLimit";
import { emitDomainEvent } from "../../platform/domain-events";
import { hasEmailProvider, sendEmail } from "../email.service";

const log = createLogger("security-events");

/** Actions shown in the security-events filter. */
export const SECURITY_EVENT_ACTIONS = [
  "auth.login_success",
  "auth.login_failure",
  "auth.lockout",
  "auth.mfa_challenge_failed",
  "auth.suspicious_login",
  "auth.password_change",
  "auth.password_reset",
  "auth.password_reset_requested",
  "auth.session_revoked",
  "auth.logout_all",
  "auth.token_reuse_detected",
  "auth.register",
  "auth.register_existing",
  "auth.email_verification_sent",
  "auth.email_verified",
  "mfa.enrolled",
  "mfa.disabled",
  "mfa.recovery_codes_regenerated",
  "mfa.recovery_code_used",
  "mfa.step_up",
  "security.policy_changed",
  "team.role_change",
  "team.invite",
  "team.invite_resend",
  "team.invite_revoke",
  "team.invite_accept",
  "team.remove",
  "api_key.create",
  "api_key.revoke",
  "backup.restore",
  "admin_action",
] as const;

export type SecurityEventAction = (typeof SECURITY_EVENT_ACTIONS)[number] | (string & {});

export interface SecurityEventInput {
  action: SecurityEventAction;
  userId: string | null;
  companyId?: string | null;
  resourceType?: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}

export async function recordSecurityEvent(
  req: Request | null,
  input: SecurityEventInput
): Promise<void> {
  try {
    await storage.createAuditLog({
      userId: input.userId,
      companyId: input.companyId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? "security",
      resourceId: input.resourceId ?? input.userId,
      details: JSON.stringify({ companyId: input.companyId ?? null, ...(input.details ?? {}) }),
      ipAddress: req ? clientIp(req) : null,
      userAgent: req?.get("user-agent") ?? null,
    });
  } catch (err) {
    log.warn({ err, action: input.action }, "Failed to write security audit event");
  }
}

// ─── Suspicious login heuristic ────────────────────────────────────────────

/** Coarse device family from a user agent: browser + OS, versions ignored. */
export function deviceFamily(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  const os = /windows/.test(ua)
    ? "windows"
    : /iphone|ipad|ios/.test(ua)
      ? "ios"
      : /android/.test(ua)
        ? "android"
        : /mac os|macintosh/.test(ua)
          ? "macos"
          : /linux/.test(ua)
            ? "linux"
            : "other";
  const browser = /edg\//.test(ua)
    ? "edge"
    : /chrome|crios/.test(ua)
      ? "chrome"
      : /firefox|fxios/.test(ua)
        ? "firefox"
        : /safari/.test(ua)
          ? "safari"
          : ua.split(/[\s/]/)[0] || "other";
  return `${browser}/${os}`;
}

/** Network prefix: /24 for IPv4, /48 for IPv6 (a stand-in for "country/ISP"). */
export function ipPrefix(ip: string | null | undefined): string {
  const raw = (ip ?? "").replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return raw.split(".").slice(0, 3).join(".") + ".0/24";
  if (raw.includes(":")) return raw.split(":").slice(0, 3).join(":") + "::/48";
  return raw || "unknown";
}

export interface LoginFingerprint {
  device: string;
  network: string;
}

export function loginFingerprint(req: Request): LoginFingerprint {
  return { device: deviceFamily(req.get("user-agent")), network: ipPrefix(clientIp(req)) };
}

/**
 * Suspicious when the account has signed in before and neither the device family nor
 * the network prefix of this sign-in has been seen in the last 50 successful sign-ins.
 */
export function isSuspicious(current: LoginFingerprint, history: LoginFingerprint[]): boolean {
  if (history.length === 0) return false;
  const seenDevice = history.some((h) => h.device === current.device);
  const seenNetwork = history.some((h) => h.network === current.network);
  return !seenDevice && !seenNetwork;
}

async function priorFingerprints(userId: string): Promise<LoginFingerprint[]> {
  const rows = await storage.getUserSecurityEvents(userId, {
    actions: ["auth.login_success"],
    limit: 50,
  });
  return rows.map((r) => ({ device: deviceFamily(r.userAgent), network: ipPrefix(r.ipAddress) }));
}

/** Record a successful sign-in and raise a suspicious-login alert when warranted. */
export async function recordLoginSuccess(
  req: Request,
  user: { id: string; email: string },
  details: Record<string, unknown>
): Promise<{ suspicious: boolean }> {
  const current = loginFingerprint(req);
  let suspicious = false;
  try {
    suspicious = isSuspicious(current, await priorFingerprints(user.id));
  } catch (err) {
    log.warn({ err }, "Could not evaluate login history");
  }
  await recordSecurityEvent(req, {
    action: "auth.login_success",
    userId: user.id,
    details: { ...details, device: current.device, network: current.network },
  });
  if (suspicious) await raiseSuspiciousLogin(req, user, current);
  return { suspicious };
}

async function raiseSuspiciousLogin(
  req: Request,
  user: { id: string; email: string },
  fp: LoginFingerprint
): Promise<void> {
  await recordSecurityEvent(req, {
    action: "auth.suspicious_login",
    userId: user.id,
    details: { device: fp.device, network: fp.network },
  });
  const companies = await storage.getCompaniesByUserId(user.id).catch(() => []);
  const companyId = (companies[0] as { id?: string } | undefined)?.id ?? user.id;
  emitDomainEvent("security.suspicious_login", {
    companyId,
    entityId: user.id,
    actorUserId: user.id,
    device: fp.device,
    network: fp.network,
  });
  try {
    await storage.createNotification({
      userId: user.id,
      companyId: null,
      type: "system",
      title: "New sign-in to your account",
      message: `A sign-in from a new device (${fp.device}) and network (${fp.network}) was recorded. If this was not you, change your password and sign out every session.`,
      priority: "high",
      actionUrl: "/settings/security",
    } as Parameters<typeof storage.createNotification>[0]);
  } catch (err) {
    log.warn({ err }, "Failed to create suspicious-login notification");
  }
  if (hasEmailProvider()) {
    void sendEmail(
      user.email,
      "New sign-in to your Muhasib account",
      `We noticed a sign-in from a device (${fp.device}) and network (${fp.network}) we have not seen on your account before. If this was you, no action is needed. If not, change your password and use "Sign out everywhere" in Security settings.`,
      { category: "security", sensitive: true }
    ).catch(() => undefined);
  }
}
