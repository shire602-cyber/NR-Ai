/**
 * W5-E security configuration. Everything is read from process.env at call time so
 * deployments (and tests) can change behaviour without a restart of this module.
 *
 *   MFA_STEP_UP_WINDOW_MINUTES      how long a TOTP verification counts as "recent" (10)
 *   EMAIL_VERIFICATION_ENFORCE      "false" turns gating off; default on, but only effective
 *                                   while an email provider is configured, so nobody is ever
 *                                   locked out of a deployment that cannot send the link
 *   EMAIL_VERIFICATION_GRACE_DAYS   days an unverified account may issue documents/invite (7)
 *   TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY   Cloudflare Turnstile CAPTCHA
 *   BREACHED_PASSWORD_CHECK         "range" (k-anonymity range API, offline fallback),
 *                                   "offline" (default: bundled common-password list), "off"
 *   BREACHED_PASSWORD_RANGE_URL     range API base (default https://api.pwnedpasswords.com/range/)
 */
import { hasEmailProvider } from "../email.service";

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function mfaStepUpWindowMs(): number {
  return num(process.env.MFA_STEP_UP_WINDOW_MINUTES, 10, 1, 24 * 60) * 60_000;
}

export interface EmailVerificationConfig {
  /** Flag value (default true). */
  flag: boolean;
  /** An email provider is configured (Resend or SMTP). */
  providerConfigured: boolean;
  /** Gating is active: flag on AND provider configured. */
  enforced: boolean;
  graceDays: number;
}

export function emailVerificationConfig(): EmailVerificationConfig {
  const raw = (process.env.EMAIL_VERIFICATION_ENFORCE ?? "").trim().toLowerCase();
  const flag = !["false", "0", "off", "no"].includes(raw);
  const providerConfigured = hasEmailProvider();
  return {
    flag,
    providerConfigured,
    enforced: flag && providerConfigured,
    graceDays: num(process.env.EMAIL_VERIFICATION_GRACE_DAYS, 7, 0, 365),
  };
}

export type BreachedPasswordMode = "range" | "offline" | "off";

export function breachedPasswordMode(): BreachedPasswordMode {
  const raw = (process.env.BREACHED_PASSWORD_CHECK ?? "").trim().toLowerCase();
  if (raw === "range" || raw === "api" || raw === "hibp") return "range";
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  return "offline";
}

export function breachedPasswordRangeUrl(): string {
  const raw = process.env.BREACHED_PASSWORD_RANGE_URL?.trim();
  const base = raw || "https://api.pwnedpasswords.com/range/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function turnstileKeys(): { secretKey: string | null; siteKey: string | null } {
  return {
    secretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || null,
    siteKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
  };
}
