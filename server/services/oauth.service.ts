import { and,eq,sql } from 'drizzle-orm';
import type { Request } from 'express';
import crypto from 'node:crypto';
import * as oidc from 'openid-client';

import { authIdentities,oauthLoginStates,users } from '../../shared/schema';
import { getEnv,isProduction } from '../config/env';
import { db } from '../db';

export type OAuthProviderId = 'google' | 'microsoft';

export interface OAuthProviderInfo {
  id: OAuthProviderId;
  label: string;
  issuer: string;
  configured: boolean;
}

export interface ConsumedOAuthState {
  state: string;
  provider: OAuthProviderId;
  codeVerifier: string;
  nonce: string;
  nextPath: string;
}

export interface OAuthIdentityProfile {
  provider: OAuthProviderId;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
  claims: Record<string, unknown>;
}

class OAuthPublicError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'OAuthPublicError';
  }
}

export class OAuthConfigError extends OAuthPublicError {
  constructor(message: string) {
    super(message, 'OAUTH_CONFIG_ERROR');
    this.name = 'OAuthConfigError';
  }
}

export class OAuthStateError extends OAuthPublicError {
  constructor(message: string) {
    super(message, 'OAUTH_STATE_ERROR');
    this.name = 'OAuthStateError';
  }
}

export class OAuthIdentityError extends OAuthPublicError {
  constructor(message: string) {
    super(message, 'OAUTH_IDENTITY_ERROR');
    this.name = 'OAuthIdentityError';
  }
}

const PROVIDERS: Record<OAuthProviderId, { label: string; issuer: string }> = {
  google: {
    label: 'Google',
    issuer: 'https://accounts.google.com',
  },
  microsoft: {
    label: 'Microsoft',
    issuer: 'https://login.microsoftonline.com/common/v2.0',
  },
};

const OAUTH_SCOPE = 'openid email profile';
const STATE_TTL_MS = 10 * 60 * 1000;
const encryptionPrefix = 'v1';

const configCache = new Map<OAuthProviderId, Promise<oidc.Configuration>>();

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return value === 'google' || value === 'microsoft';
}

export function normalizeOAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertOAuthEmailVerifiedForAccountLink(profile: Pick<OAuthIdentityProfile, 'emailVerified'>): void {
  if (!profile.emailVerified) {
    throw new OAuthIdentityError('OAuth provider email is not verified; refusing to link existing account');
  }
}

function providerCredentials(provider: OAuthProviderId): { clientId?: string; clientSecret?: string } {
  const env = getEnv();
  if (provider === 'google') {
    return {
      clientId: env.OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
    };
  }
  return {
    clientId: env.OAUTH_MICROSOFT_CLIENT_ID,
    clientSecret: env.OAUTH_MICROSOFT_CLIENT_SECRET,
  };
}

function requireProviderCredentials(provider: OAuthProviderId): { clientId: string; clientSecret: string } {
  const credentials = providerCredentials(provider);
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new OAuthConfigError(`${PROVIDERS[provider].label} login is not configured`);
  }
  return credentials as { clientId: string; clientSecret: string };
}

export function getOAuthProviderInfo(): OAuthProviderInfo[] {
  return (Object.keys(PROVIDERS) as OAuthProviderId[]).map((id) => {
    const credentials = providerCredentials(id);
    return {
      id,
      label: PROVIDERS[id].label,
      issuer: PROVIDERS[id].issuer,
      configured: Boolean(credentials.clientId && credentials.clientSecret),
    };
  });
}

async function getOpenIdConfiguration(provider: OAuthProviderId): Promise<oidc.Configuration> {
  if (!configCache.has(provider)) {
    const { clientId, clientSecret } = requireProviderCredentials(provider);
    const issuer = new URL(PROVIDERS[provider].issuer);
    configCache.set(provider, oidc.discovery(issuer, clientId, clientSecret));
  }
  return configCache.get(provider)!;
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function hashOAuthSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getEnv().SESSION_SECRET).digest();
}

export function encryptOAuthSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    encryptionPrefix,
    base64Url(iv),
    base64Url(tag),
    base64Url(encrypted),
  ].join('.');
}

function decodeBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='), 'base64');
}

export function decryptOAuthSecret(value: string): string {
  const [version, rawIv, rawTag, rawEncrypted] = value.split('.');
  if (version !== encryptionPrefix || !rawIv || !rawTag || !rawEncrypted) {
    throw new OAuthStateError('Invalid OAuth state secret');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), decodeBase64Url(rawIv));
  decipher.setAuthTag(decodeBase64Url(rawTag));
  return Buffer.concat([
    decipher.update(decodeBase64Url(rawEncrypted)),
    decipher.final(),
  ]).toString('utf8');
}

export function sanitizeOAuthNextPath(input: unknown): string {
  if (typeof input !== 'string') return '/dashboard';
  const trimmed = input.trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/dashboard';
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 31 || code === 127) return '/dashboard';
  }

  try {
    const parsed = new URL(trimmed, 'https://muhasib.local');
    if (parsed.origin !== 'https://muhasib.local') return '/dashboard';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard';
  }
}

function requestBaseUrl(req: Request): string {
  const env = getEnv();
  if (env.AUTH_PUBLIC_URL) return env.AUTH_PUBLIC_URL.replace(/\/+$/, '');
  if (isProduction()) {
    throw new OAuthConfigError('AUTH_PUBLIC_URL is required for production OAuth callbacks');
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host');
  if (!host) throw new OAuthConfigError('Cannot infer OAuth callback host');
  return `${proto}://${host}`;
}

export function frontendBaseUrl(): string {
  const env = getEnv();
  const url = env.FRONTEND_URL || env.AUTH_PUBLIC_URL || (!isProduction() ? 'http://127.0.0.1:5173' : undefined);
  if (!url) throw new OAuthConfigError('FRONTEND_URL is required for OAuth redirects');
  return url.replace(/\/+$/, '');
}

export function oauthRedirectUri(req: Request, provider: OAuthProviderId): string {
  return `${requestBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

export function oauthCallbackSuccessUrl(nextPath: string): string {
  const safeNext = sanitizeOAuthNextPath(nextPath);
  return `${frontendBaseUrl()}/auth/callback?next=${encodeURIComponent(safeNext)}`;
}

export function oauthCallbackFailureUrl(): string {
  return `${frontendBaseUrl()}/login?oauth_error=1`;
}

export async function createOAuthAuthorizationUrl(
  provider: OAuthProviderId,
  req: Request,
  nextPathInput: unknown,
): Promise<URL> {
  const config = await getOpenIdConfiguration(provider);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const nextPath = sanitizeOAuthNextPath(nextPathInput);

  await db.insert(oauthLoginStates).values({
    stateHash: hashOAuthSecret(state),
    provider,
    encryptedCodeVerifier: encryptOAuthSecret(codeVerifier),
    encryptedNonce: encryptOAuthSecret(nonce),
    nonceHash: hashOAuthSecret(nonce),
    nextPath,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: oauthRedirectUri(req, provider),
    response_type: 'code',
    scope: OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
}

export async function consumeOAuthState(
  provider: OAuthProviderId,
  rawState: unknown,
): Promise<ConsumedOAuthState> {
  if (typeof rawState !== 'string' || !rawState) {
    throw new OAuthStateError('Missing OAuth state');
  }

  const stateHash = hashOAuthSecret(rawState);
  const now = new Date();

  return db.transaction(async (tx: any) => {
    const result: any = await tx.execute(sql`
      SELECT
        state_hash AS "stateHash",
        provider,
        encrypted_code_verifier AS "encryptedCodeVerifier",
        encrypted_nonce AS "encryptedNonce",
        nonce_hash AS "nonceHash",
        next_path AS "nextPath",
        expires_at AS "expiresAt",
        consumed_at AS "consumedAt"
      FROM oauth_login_states
      WHERE state_hash = ${stateHash}
      FOR UPDATE
    `);
    const rows = (result?.rows ?? result) as any[];
    const row = rows[0];

    if (!row) throw new OAuthStateError('OAuth state not found');
    if (row.provider !== provider) throw new OAuthStateError('OAuth provider mismatch');
    if (row.consumedAt) throw new OAuthStateError('OAuth state already consumed');
    if (new Date(row.expiresAt).getTime() <= now.getTime()) {
      throw new OAuthStateError('OAuth state expired');
    }

    await tx
      .update(oauthLoginStates)
      .set({ consumedAt: now })
      .where(eq(oauthLoginStates.stateHash, stateHash));

    return {
      state: rawState,
      provider,
      codeVerifier: decryptOAuthSecret(row.encryptedCodeVerifier),
      nonce: decryptOAuthSecret(row.encryptedNonce),
      nextPath: sanitizeOAuthNextPath(row.nextPath),
    };
  });
}

function claimString(claims: Record<string, unknown>, key: string): string | undefined {
  const value = claims[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function claimBoolean(claims: Record<string, unknown>, key: string): boolean {
  return claims[key] === true || claims[key] === 'true';
}

function validateProviderIssuer(provider: OAuthProviderId, issuer: string): void {
  if (provider === 'google') {
    if (issuer !== PROVIDERS.google.issuer) {
      throw new OAuthIdentityError('Unexpected Google issuer');
    }
    return;
  }

  if (!issuer.startsWith('https://login.microsoftonline.com/') || !issuer.endsWith('/v2.0')) {
    throw new OAuthIdentityError('Unexpected Microsoft issuer');
  }
}

function validateAudience(provider: OAuthProviderId, claims: Record<string, unknown>): void {
  const { clientId } = requireProviderCredentials(provider);
  const aud = claims.aud;
  const matches = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
  if (!matches) throw new OAuthIdentityError('Unexpected OAuth audience');
}

export function oauthProfileFromClaims(
  provider: OAuthProviderId,
  claims: Record<string, unknown>,
): OAuthIdentityProfile {
  validateAudience(provider, claims);

  const issuer = claimString(claims, 'iss');
  const subject = claimString(claims, 'sub');
  if (!issuer || !subject) throw new OAuthIdentityError('Missing issuer or subject');
  validateProviderIssuer(provider, issuer);

  const emailClaim = claimString(claims, 'email');
  const rawEmail = provider === 'microsoft'
    ? emailClaim || claimString(claims, 'preferred_username') || claimString(claims, 'upn')
    : emailClaim;
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new OAuthIdentityError('OAuth provider did not return a usable email');
  }

  const googleEmailVerified = claimBoolean(claims, 'email_verified');
  if (provider === 'google' && !googleEmailVerified) {
    throw new OAuthIdentityError('Google email is not verified');
  }
  const microsoftEmailVerified = Boolean(emailClaim && claimBoolean(claims, 'email_verified'));

  const email = normalizeOAuthEmail(rawEmail);
  const name = claimString(claims, 'name') || email.split('@')[0] || 'Muhasib user';
  const picture = claimString(claims, 'picture');

  return {
    provider,
    issuer,
    subject,
    email,
    emailVerified: provider === 'google' ? true : microsoftEmailVerified,
    name,
    picture,
    claims,
  };
}

export async function exchangeOAuthCallback(
  provider: OAuthProviderId,
  currentUrl: URL,
  state: ConsumedOAuthState,
): Promise<OAuthIdentityProfile> {
  const config = await getOpenIdConfiguration(provider);
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: state.codeVerifier,
    expectedState: state.state,
    expectedNonce: state.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims() as Record<string, unknown> | undefined;
  if (!claims) throw new OAuthIdentityError('Missing ID token claims');

  return oauthProfileFromClaims(provider, claims);
}

export async function getAuthIdentity(profile: OAuthIdentityProfile) {
  const [identity] = await db
    .select()
    .from(authIdentities)
    .where(and(
      eq(authIdentities.provider, profile.provider),
      eq(authIdentities.issuer, profile.issuer),
      eq(authIdentities.providerSubject, profile.subject),
    ));
  return identity;
}

export async function linkAuthIdentity(userId: string, profile: OAuthIdentityProfile): Promise<void> {
  await db
    .insert(authIdentities)
    .values({
      userId,
      provider: profile.provider,
      issuer: profile.issuer,
      providerSubject: profile.subject,
      providerEmail: profile.email,
      providerEmailVerified: profile.emailVerified,
      profile: profile.claims as any,
      lastLoginAt: new Date(),
    })
    .onConflictDoNothing();

  const linked = await getAuthIdentity(profile);
  if (!linked || linked.userId !== userId) {
    throw new OAuthIdentityError('OAuth identity is already linked to another user');
  }
}

export async function markOAuthLogin(userId: string, profile?: OAuthIdentityProfile): Promise<void> {
  const now = new Date();
  await db
    .update(users)
    .set({
      lastLoginAt: now,
      ...(profile?.emailVerified ? { emailVerified: true } : {}),
    } as any)
    .where(eq(users.id, userId));

  if (profile) {
    await db
      .update(authIdentities)
      .set({
        providerEmail: profile.email,
        providerEmailVerified: profile.emailVerified,
        profile: profile.claims as any,
        lastLoginAt: now,
      })
      .where(and(
        eq(authIdentities.provider, profile.provider),
        eq(authIdentities.issuer, profile.issuer),
        eq(authIdentities.providerSubject, profile.subject),
      ));
  }
}

export async function getUserByNormalizedOAuthEmail(email: string) {
  const normalized = normalizeOAuthEmail(email);
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  return user;
}
