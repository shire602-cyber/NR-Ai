// Non-secret hint that this browser has signed in. The real session lives in an
// httpOnly cookie we cannot read, so without a hint every anonymous page view
// probed /api/auth/me, /api/companies and /api/auth/refresh and logged 401/400s
// to the console (R18-04). The hint only gates *probing*; the server still
// authorises every request.
export const AUTH_HINT_KEY = "muhasib_auth_hint";

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
