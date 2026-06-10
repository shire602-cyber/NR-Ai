import { apiUrl } from './api';
import { clearCsrfToken, withCsrfHeader } from './csrf';
import { clearAllCaches, clearPwaSessionMarker, rotatePwaSessionMarker } from './pwa';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const ACTIVE_COMPANY_KEY = 'muhasib_active_company_id';

export function getToken(): string | null {
  return null;
}

export function setToken(token: string): void {
  void token;
  rotatePwaSessionMarker();
  window.dispatchEvent(new Event('auth:login'));
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACTIVE_COMPANY_KEY);
  clearCsrfToken();
  clearPwaSessionMarker();
  void clearAllCaches();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth:logout'));
  }
}

export function getStoredUser(): any {
  return null;
}

export function setStoredUser(user: any): void {
  void user;
  rotatePwaSessionMarker();
  window.dispatchEvent(new Event('auth:user-updated'));
}

export function isAuthenticated(): boolean {
  return false;
}

export function getAuthHeaders(): Record<string, string> {
  return {};
}

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let headers = await withCsrfHeader('POST', {});
    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (res.status === 403) {
      clearCsrfToken();
      headers = await withCsrfHeader('POST', {});
      const retry = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
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
  const res = await fetch(apiUrl('/api/auth/me'), {
    credentials: 'include',
  });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) return null;
    const retry = await fetch(apiUrl('/api/auth/me'), {
      credentials: 'include',
    });
    if (retry.status === 401) return null;
    if (!retry.ok) throw new Error(`Failed to load user: ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Failed to load user: ${res.status}`);
  return res.json();
}
