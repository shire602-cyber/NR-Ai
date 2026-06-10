import type { CookieOptions, Request, Response } from 'express';
import { isProduction } from '../config/env';
import { authCookieBaseOptions } from '../config/cookies';

export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;

export function accessCookieName(): string {
  return isProduction() ? '__Host-muhasib-access' : 'muhasib-access';
}

export function refreshCookieName(): string {
  return isProduction() ? '__Host-muhasib-refresh' : 'muhasib-refresh';
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    result[rawName] = decodeURIComponent(rawValue.join('='));
  }
  return result;
}

function baseCookieOptions(): CookieOptions {
  return authCookieBaseOptions();
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(accessCookieName(), accessToken, {
    ...baseCookieOptions(),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });

  res.cookie(refreshCookieName(), refreshToken, {
    ...baseCookieOptions(),
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(accessCookieName(), baseCookieOptions());
  res.clearCookie(refreshCookieName(), baseCookieOptions());
}

export function getAccessTokenFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = cookies[accessCookieName()];
  return typeof token === 'string' && token ? token : null;
}

export function getRefreshTokenFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = cookies[refreshCookieName()];
  return typeof token === 'string' && token ? token : null;
}
