import type { CookieOptions } from 'express';
import { getEnv,isProduction } from './env';

type SameSiteMode = Exclude<CookieOptions['sameSite'], boolean | undefined>;

export function authCookieSameSite(): SameSiteMode {
  const configured = getEnv().AUTH_COOKIE_SAMESITE;
  if (configured) return configured;

  // Production frontend/backend run as separate deployments, so auth cookies
  // must be eligible for credentialed cross-origin API requests.
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
