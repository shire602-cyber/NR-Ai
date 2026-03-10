/**
 * DB-first settings resolver.
 *
 * Reads integration keys from the `adminSettings` table first,
 * then falls back to environment variables if the DB value is empty.
 * Includes an in-memory cache (TTL-based) to avoid hitting the DB
 * on every API request.
 */

import { createLogger } from './logger';

const log = createLogger('settings');

// ── Cache ──────────────────────────────────────────────────────
interface CacheEntry {
  value: string | undefined;
  expiry: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute
const cache = new Map<string, CacheEntry>();

function getCached(key: string): string | undefined | null {
  const entry = cache.get(key);
  if (!entry) return null; // not in cache
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null; // expired
  }
  return entry.value;
}

function setCache(key: string, value: string | undefined) {
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS });
}

/** Clear the settings cache. Call this after admin updates a setting. */
export function clearSettingsCache() {
  cache.clear();
}

// ── Known setting keys ─────────────────────────────────────────
// Maps friendly names to DB keys & env fallbacks
const SETTING_MAP: Record<string, { dbKey: string; envKey: string }> = {
  OPENAI_API_KEY: { dbKey: 'integrations.openai_api_key', envKey: 'OPENAI_API_KEY' },
  AI_MODEL: { dbKey: 'integrations.ai_model', envKey: 'AI_MODEL' },
  STRIPE_PUBLIC_KEY: { dbKey: 'integrations.stripe_public_key', envKey: 'STRIPE_PUBLIC_KEY' },
  STRIPE_SECRET_KEY: { dbKey: 'integrations.stripe_secret_key', envKey: 'STRIPE_SECRET_KEY' },
  GOOGLE_SERVICE_ACCOUNT_EMAIL: { dbKey: 'integrations.google_sa_email', envKey: 'GOOGLE_SERVICE_ACCOUNT_EMAIL' },
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: { dbKey: 'integrations.google_sa_key', envKey: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY' },
  GOOGLE_CLIENT_ID: { dbKey: 'integrations.google_client_id', envKey: 'GOOGLE_CLIENT_ID' },
  GOOGLE_CLIENT_SECRET: { dbKey: 'integrations.google_client_secret', envKey: 'GOOGLE_CLIENT_SECRET' },
  GOOGLE_REFRESH_TOKEN: { dbKey: 'integrations.google_refresh_token', envKey: 'GOOGLE_REFRESH_TOKEN' },
};

// ── Core resolver ──────────────────────────────────────────────

/**
 * Get an integration setting value.
 * Priority: DB `adminSettings` table → environment variable → undefined.
 */
export async function getSetting(name: string): Promise<string | undefined> {
  const mapping = SETTING_MAP[name];
  if (!mapping) {
    // No mapping → just check env
    return process.env[name] || undefined;
  }

  // 1. Check cache
  const cached = getCached(mapping.dbKey);
  if (cached !== null) {
    return cached || process.env[mapping.envKey] || undefined;
  }

  // 2. Check database
  try {
    // Dynamic import to avoid circular dependency with storage → db → env
    const { storage } = await import('../storage');
    const setting = await storage.getAdminSettingByKey(mapping.dbKey);
    const dbValue = setting?.value?.trim() || undefined;
    setCache(mapping.dbKey, dbValue);

    if (dbValue) {
      return dbValue;
    }
  } catch (err: any) {
    // DB might not be ready yet (during startup) – fall through to env
    log.debug({ key: name, error: err.message }, 'Could not read setting from DB, falling back to env');
    setCache(mapping.dbKey, undefined);
  }

  // 3. Fall back to env
  return process.env[mapping.envKey] || undefined;
}

/**
 * Get the OpenAI API key (DB-first, env fallback).
 */
export async function getOpenAIKey(): Promise<string | undefined> {
  return getSetting('OPENAI_API_KEY');
}

/**
 * Get the AI model name (DB-first, env fallback, default gpt-3.5-turbo).
 */
export async function getAIModel(): Promise<string> {
  return (await getSetting('AI_MODEL')) || 'gpt-3.5-turbo';
}

/**
 * Get Google Sheets credentials from DB first, then env.
 */
export async function getGoogleSheetsCredentials() {
  return {
    serviceAccountEmail: await getSetting('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    serviceAccountKey: await getSetting('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'),
    clientId: await getSetting('GOOGLE_CLIENT_ID'),
    clientSecret: await getSetting('GOOGLE_CLIENT_SECRET'),
    refreshToken: await getSetting('GOOGLE_REFRESH_TOKEN'),
  };
}

/**
 * Get Stripe keys from DB first, then env.
 */
export async function getStripeKeys() {
  return {
    publicKey: await getSetting('STRIPE_PUBLIC_KEY'),
    secretKey: await getSetting('STRIPE_SECRET_KEY'),
  };
}
