import type { CookieOptions } from 'express';
import { getEnv, isProduction } from './env';

type SameSiteMode = Exclude<CookieOptions['sameSite'], boolean | undefined>;

export function authCookieSameSite(): SameSiteMode {
  const configured = getEnv().AUTH_COOKIE_SAMESITE;
  if (configured) return configured;

  // The frontend and backend are deployed separately in production, so the
  // API must allow credentialed cross-origin requests to carry auth cookies.
  return isProduction() ? 'none' : 'lax';
}

export function authCookieSecure(): boolean {
  return isProduction();
}

export function authCookieBaseOptions(): Pick<CookieOptions, 'httpOnly' | 'secure' | 'sameSite' | 'path'> {
  return {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
  };
}
