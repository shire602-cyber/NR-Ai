/**
 * W5-E client helpers for the security API: a fetch that keeps the server's error `code`
 * (MFA_STEP_UP_REQUIRED, EMAIL_VERIFICATION_REQUIRED, …), and the Turnstile loader.
 */
import { apiUrl } from "./api";
import { getAuthHeaders, setToken } from "./auth";
import { withCsrfHeader } from "./csrf";

export class SecurityApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly details: Record<string, unknown> | null
  ) {
    super(message);
    this.name = "SecurityApiError";
  }
}

export async function securityFetch<T = unknown>(
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  let headers: Record<string, string> = { ...getAuthHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!headers.Authorization) headers = await withCsrfHeader(method, headers);
  const res = await fetch(apiUrl(url), {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const j = (json ?? {}) as {
      message?: string;
      code?: string;
      details?: Record<string, unknown>;
    };
    throw new SecurityApiError(
      j.message || res.statusText,
      res.status,
      j.code ?? null,
      j.details ?? null
    );
  }
  // A step-up or enrolment re-issues the access token; Bearer clients keep it.
  const token = (json as { token?: unknown } | null)?.token;
  if (typeof token === "string" && getAuthHeaders().Authorization) setToken(token);
  return json as T;
}

export function isStepUpRequired(err: unknown): boolean {
  return err instanceof SecurityApiError && err.code === "MFA_STEP_UP_REQUIRED";
}

export interface SecurityConfig {
  captcha: { provider: "turnstile"; status: "live" | "requires_external"; siteKey: string | null };
  breachedPassword: { mode: "range" | "offline" | "off" };
}

export async function fetchSecurityConfig(): Promise<SecurityConfig | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/security/config"), { credentials: "include" });
    return res.ok ? ((await res.json()) as SecurityConfig) : null;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      remove?: (id: string) => void;
    };
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileLoading: Promise<void> | null = null;

/** Load the Turnstile script once (only when the server reports CAPTCHA as live). */
export function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoading) {
    turnstileLoading = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TURNSTILE_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Turnstile failed to load"));
      document.head.appendChild(s);
    });
  }
  return turnstileLoading;
}
