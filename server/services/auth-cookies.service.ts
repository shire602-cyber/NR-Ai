import type { CookieOptions,Request,Response } from 'express';
import { authCookieBaseOptions } from '../config/cookies';
import { isProduction } from '../config/env';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;

export function accessCookieName(): string {
  return isProduction() ? '__Host-muhasib-access' : 'muhasib-access';
}

export function refreshCookieName(): string {
  return isProduction() ? '__Host-muhasib-refresh' : 'muhasib-refresh';
}

function baseCookieOptions(): CookieOptions {
  return authCookieBaseOptions();
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: Date,
): void {
  res.cookie(accessCookieName(), accessToken, {
    ...baseCookieOptions(),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });

  res.cookie(refreshCookieName(), refreshToken, {
    ...baseCookieOptions(),
    maxAge: Math.max(0, refreshExpiresAt.getTime() - Date.now()),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(accessCookieName(), baseCookieOptions());
  res.clearCookie(refreshCookieName(), baseCookieOptions());
}

export function getAccessTokenFromRequest(req: Request): string | null {
  const name = accessCookieName();
  const token = req.cookies?.[name] ?? req.signedCookies?.[name];
  return typeof token === 'string' && token ? token : null;
}

export function getRefreshTokenFromRequest(req: Request): string | null {
  const name = refreshCookieName();
  const token = req.cookies?.[name] ?? req.signedCookies?.[name];
  return typeof token === 'string' && token ? token : null;
}

export function sessionMetaFromRequest(req: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  return {
    userAgent: req.get('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  };
}
