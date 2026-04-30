// Authentication utilities
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
// Same key as activeCompany.ts — kept inline to avoid an import cycle
// (activeCompany imports queryClient → which is loaded for unauth pages too).
// Cleared on logout so the next user in this browser does not silently inherit
// the previous user's switched workspace.
const ACTIVE_COMPANY_KEY = 'muhasib_active_company_id';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Drop tenant context too — the next user signing in on this device
  // should not inherit the previous user's selected company.
  localStorage.removeItem(ACTIVE_COMPANY_KEY);
  // Same-tab listeners (e.g. ActiveCompanyProvider) won't see the removal
  // above via the native 'storage' event, which only fires across tabs.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('auth:logout'));
  }
}

export function getStoredUser(): any {
  const userStr = localStorage.getItem(USER_KEY);
  return userStr ? JSON.parse(userStr) : null;
}

export function setStoredUser(user: any): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
