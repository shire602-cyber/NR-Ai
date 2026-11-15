import { apiUrl } from "./api";
import { clearCsrfToken, withCsrfHeader } from "./csrf";
import { clearAllCaches, clearPwaSessionMarker, rotatePwaSessionMarker } from "./pwa";
import type { CompanyRole, Permission } from "@shared/permissions";

export {
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  COMPANY_ROLE_DESCRIPTIONS,
  roleHasPermission,
} from "@shared/permissions";
export type { CompanyRole, Permission } from "@shared/permissions";

/**
 * The signed-in user's access in one company, from
 * GET /api/companies/:companyId/team/me. The server enforces every
 * permission (server/middleware/companyRolePolicy.ts); the UI uses this only
 * to hide or disable actions the user cannot take.
 */
export interface CompanyAccess {
  role: CompanyRole | null;
  permissions: Permission[];
  grantableRoles: CompanyRole[];
  viaFirmAccess: boolean;
}

/** UI gating helper: true when `access` includes `permission`. */
export function canPerform(
  access: CompanyAccess | null | undefined,
  permission: Permission
): boolean {
  return !!access && access.permissions.includes(permission);
}

export function companyAccessQueryKey(companyId: string | null | undefined) {
  return ["/api/companies", companyId, "team", "me"] as const;
}

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";
const ACTIVE_COMPANY_KEY = "muhasib_active_company_id";
// Non-secret hint that this browser has signed in. The real session lives in an
// httpOnly cookie we cannot read, so without a hint every anonymous page view
// probed /api/auth/me, /api/companies and /api/auth/refresh and logged 401/400s
// to the console (R18-04). The hint only gates *probing*; the server still
// authorises every request.
const AUTH_HINT_KEY = "muhasib_auth_hint";

export function hasAuthHint(): boolean {
  try {
    return localStorage.getItem(AUTH_HINT_KEY) === "1";
  } catch {
    // Storage blocked: fall back to probing so sign-in is never broken.
    return true;
  }
}

export function setAuthHint(): void {
  try {
    localStorage.setItem(AUTH_HINT_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function clearAuthHint(): void {
  try {
    localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  return null;
}

export function setToken(token: string): void {
  void token;
  rotatePwaSessionMarker();
  window.dispatchEvent(new Event("auth:login"));
}

export function removeToken(): void {
  clearAuthHint();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACTIVE_COMPANY_KEY);
  clearCsrfToken();
  clearPwaSessionMarker();
  void clearAllCaches();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth:logout"));
  }
}

export function getStoredUser(): any {
  return null;
}

export function setStoredUser(user: any): void {
  void user;
  setAuthHint();
  rotatePwaSessionMarker();
  window.dispatchEvent(new Event("auth:user-updated"));
}

export function isAuthenticated(): boolean {
  return false;
}

export function getAuthHeaders(): Record<string, string> {
  return {};
}

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!hasAuthHint()) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let headers = await withCsrfHeader("POST", {});
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers,
    });
    if (res.status === 403) {
      clearCsrfToken();
      headers = await withCsrfHeader("POST", {});
      const retry = await fetch(apiUrl("/api/auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers,
      });
      return retry.ok;
    }
    return res.ok;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function fetchCurrentUser(): Promise<any | null> {
  // No sign-in hint: this is an anonymous visitor, so do not hit the API.
  if (!hasAuthHint()) return null;
  return loadCurrentUser();
}

/** Unconditional session probe, used by the OAuth callback where the cookie
 * was just set but no hint exists yet. */
export async function probeCurrentUser(): Promise<any | null> {
  return loadCurrentUser();
}

async function loadCurrentUser(): Promise<any | null> {
  const user = await requestCurrentUser();
  if (user) setAuthHint();
  else clearAuthHint();
  return user;
}

async function requestCurrentUser(): Promise<any | null> {
  const res = await fetch(apiUrl("/api/auth/me"), {
    credentials: "include",
  });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) return null;
    const retry = await fetch(apiUrl("/api/auth/me"), {
      credentials: "include",
    });
    if (retry.status === 401) return null;
    if (!retry.ok) throw new Error(`Failed to load user: ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Failed to load user: ${res.status}`);
  return res.json();
}
