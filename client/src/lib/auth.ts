import { apiUrl } from "./api";
import { clearAuthHint, hasAuthHint, setAuthHint } from "./authHint";
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
  /** E2: the signed-in user, and whether they are the company's only member (maker-checker). */
  userId?: string;
  soleMember?: boolean;
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
// The sign-in hint lives in ./authHint (dependency-free, so the startup bundle can
// read it without pulling in the permission model).
export { AUTH_HINT_KEY, clearAuthHint, hasAuthHint, setAuthHint } from "./authHint";

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

export function setStoredUser(user: any): void {
  void user;
  setAuthHint();
  rotatePwaSessionMarker();
  window.dispatchEvent(new Event("auth:user-updated"));
}

export function isAuthenticated(): boolean {
  return false;
}

const PORTAL_ACCOUNT_KEY = "muhasib.portalAccount";

/** The supplier portal the signed-in customer chose (one of their own bindings), if any. */
export function getSelectedPortalAccount(): string | null {
  try {
    return window.localStorage.getItem(PORTAL_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function setSelectedPortalAccount(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PORTAL_ACCOUNT_KEY, id);
    else window.localStorage.removeItem(PORTAL_ACCOUNT_KEY);
  } catch {
    /* storage blocked: the newest supplier is used */
  }
}

export function getAuthHeaders(): Record<string, string> {
  // Auth is cookie-based. Customer-portal calls also say WHICH supplier they act for; the server
  // checks it against the user's own bindings and ignores anything else.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/client-portal")) {
    const id = getSelectedPortalAccount();
    if (id) return { "X-Portal-Account": id };
  }
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
