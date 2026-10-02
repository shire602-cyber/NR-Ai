/**
 * Typed client for the account-security API (2FA, sessions, change password,
 * company "require 2FA"). Pure helpers live here so they can be unit tested;
 * pages only call these and render the result.
 */
import { apiRequest } from "./queryClient";
import { apiUrl } from "./api";

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
  requiredByCompanies: Array<{ id: string; name: string }>;
}

export interface TwoFactorEnrolment {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface TwoFactorEnrolResult {
  enabled: boolean;
  recoveryCodes: string[];
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export const twoFactorStatusKey = ["/api/auth/2fa/status"] as const;
export const sessionsKey = ["/api/auth/sessions"] as const;

export const startEnrolment = (): Promise<TwoFactorEnrolment> => apiRequest("POST", "/api/auth/2fa/enrol");
export const confirmEnrolment = (code: string): Promise<TwoFactorEnrolResult> =>
  apiRequest("POST", "/api/auth/2fa/enrol/verify", { code });
export const disableTwoFactor = (password: string, code: string) =>
  apiRequest("POST", "/api/auth/2fa/disable", { password, code });
export const regenerateRecoveryCodes = (password: string, code: string): Promise<{ recoveryCodes: string[] }> =>
  apiRequest("POST", "/api/auth/2fa/recovery-codes", { password, code });
export const revokeSession = (id: string) => apiRequest("DELETE", `/api/auth/sessions/${id}`);
export const revokeOtherSessions = (): Promise<{ revoked: number }> => apiRequest("DELETE", "/api/auth/sessions");
export const changePassword = (body: { currentPassword: string; newPassword: string; code?: string }) =>
  apiRequest("POST", "/api/auth/change-password", body);
export const setRequireTwoFactor = (companyId: string, requireTwoFactor: boolean) =>
  apiRequest("PATCH", `/api/companies/${companyId}/security`, { requireTwoFactor });

/** Second step of sign-in. Plain fetch (the user has no session yet, so no CSRF header); the cookie carries the challenge for the OAuth path. */
export async function verifyLoginChallenge(input: {
  challengeToken?: string;
  code?: string;
  recoveryCode?: string;
}): Promise<{ ok: true; user: any; twoFactorEnrolmentRequired: boolean } | { ok: false; status: number; code: string; message: string; retryAfterSeconds?: number }> {
  const res = await fetch(apiUrl("/api/auth/2fa/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) {
    return { ok: true, user: json?.user, twoFactorEnrolmentRequired: json?.twoFactorEnrolmentRequired === true };
  }
  const retryHeader = Number(res.headers.get("Retry-After"));
  return {
    ok: false,
    status: res.status,
    code: typeof json?.code === "string" ? json.code : res.status === 429 ? "RATE_LIMITED" : "UNKNOWN",
    message: typeof json?.message === "string" ? json.message : "",
    retryAfterSeconds: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined,
  };
}

// ───────────────────────── pure helpers ─────────────────────────

/** Keep digits only, at most six: what an authenticator code looks like after paste. */
export function normaliseTotpCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function isTotpCode(raw: string): boolean {
  return /^\d{6}$/.test(raw);
}

/** Recovery codes are 10 base32 characters; accept spaces and dashes the user may type. */
export function normaliseRecoveryCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isRecoveryCode(raw: string): boolean {
  return /^[A-Z2-7]{10}$/.test(normaliseRecoveryCode(raw));
}

/** "ABCDE23456" -> "ABCDE-23456" for display and print. */
export function formatRecoveryCode(code: string): string {
  const c = normaliseRecoveryCode(code);
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

export function recoveryCodesFileText(codes: readonly string[], title: string): string {
  return `${title}\n\n${codes.map(formatRecoveryCode).join("\n")}\n`;
}

/** Groups the secret in fours so it can be typed into an authenticator by hand. */
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

export type LoginStepError = "invalid" | "replayed" | "expired" | "rateLimited" | "recoveryInvalid" | "unknown";

/** Maps a verify-endpoint failure to the message the user should see. */
export function loginStepErrorKind(code: string, status: number): LoginStepError {
  if (status === 429 || code === "RATE_LIMITED") return "rateLimited";
  switch (code) {
    case "TOTP_INVALID":
      return "invalid";
    case "TOTP_REPLAYED":
      return "replayed";
    case "CHALLENGE_EXPIRED":
      return "expired";
    case "RECOVERY_CODE_INVALID":
      return "recoveryInvalid";
    default:
      return "unknown";
  }
}

export interface DeviceLabel {
  browser: string;
  os: string;
}

/** A short, human label for a user-agent string. Never trusted for anything but display. */
export function describeUserAgent(ua: string | null | undefined): DeviceLabel {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Chrome\//.test(s) || /CriOS\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : "";
  const os = /iPhone|iPad|iPod/.test(s)
    ? "iOS"
    : /Android/.test(s)
      ? "Android"
      : /Windows/.test(s)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(s)
          ? "macOS"
          : /Linux/.test(s)
            ? "Linux"
            : "";
  return { browser, os };
}

/** Current session first, then most recently used. Returns a new array. */
export function sortSessions(sessions: readonly SessionView[]): SessionView[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt);
  });
}

/** Password strength checklist matching the server rule (length, upper, lower, digit). */
export function passwordChecks(pw: string): Record<"length" | "upper" | "lower" | "digit", boolean> {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
  };
}
