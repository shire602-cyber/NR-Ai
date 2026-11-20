/**
 * CAPTCHA adapter (R17-24): Cloudflare Turnstile server-side verification.
 *
 * Configured (TURNSTILE_SECRET_KEY set): register and forgot-password require a
 * `captchaToken` that Turnstile accepts; a missing/rejected token or an unreachable
 * verifier is refused (fail closed). Not configured: the check is skipped and the
 * capability reports requires_external (a Turnstile site must be created). This module
 * never claims bot protection that is not switched on.
 */
import { createLogger } from "../../config/logger";
import { turnstileKeys } from "./config";

const log = createLogger("captcha");

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | null = null;

/** Tests only: replace the HTTP client used to reach the verifier (null restores fetch). */
export function __setCaptchaFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl;
}

export interface CaptchaStatus {
  provider: "turnstile";
  status: "live" | "requires_external";
  /** Public site key for the widget (safe to expose). */
  siteKey: string | null;
}

export function captchaStatus(): CaptchaStatus {
  const { secretKey, siteKey } = turnstileKeys();
  return {
    provider: "turnstile",
    status: secretKey ? "live" : "requires_external",
    siteKey: secretKey ? siteKey : null,
  };
}

export type CaptchaVerdict =
  | { ok: true; skipped: boolean }
  | { ok: false; skipped: false; reason: "missing_token" | "rejected" | "unavailable" };

export async function verifyCaptcha(
  token: string | undefined | null,
  remoteIp: string | null
): Promise<CaptchaVerdict> {
  const { secretKey } = turnstileKeys();
  if (!secretKey) return { ok: true, skipped: true };
  if (!token || typeof token !== "string" || token.length > 4096) {
    return { ok: false, skipped: false, reason: "missing_token" };
  }
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  try {
    const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
    const res = await doFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "Turnstile verify returned non-2xx");
      return { ok: false, skipped: false, reason: "unavailable" };
    }
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (json.success === true) return { ok: true, skipped: false };
    log.info({ errorCodes: json["error-codes"] }, "Turnstile rejected token");
    return { ok: false, skipped: false, reason: "rejected" };
  } catch (err) {
    log.warn({ err }, "Turnstile verify failed");
    return { ok: false, skipped: false, reason: "unavailable" };
  }
}
