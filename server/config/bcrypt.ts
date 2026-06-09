import { getEnv } from './env';

/**
 * bcrypt work factor (cost) — the single source of truth for password hashing.
 *
 * Validated at startup with a hard floor of 12 (OWASP guidance) via the
 * BCRYPT_COST env var. bcrypt encodes the cost inside each hash, so raising
 * this value never invalidates existing lower-cost hashes — `bcrypt.compare`
 * keeps working against them, and they are transparently upgraded the next
 * time the user sets a new password.
 */
export const BCRYPT_COST: number = getEnv().BCRYPT_COST;
