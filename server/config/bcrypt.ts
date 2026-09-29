import { getEnv } from "./env";

/**
 * bcrypt work factor for new password hashes (validated env, 12..15, default 12).
 * Verification is unaffected: bcrypt embeds the cost in each stored hash.
 */
export const BCRYPT_COST: number = getEnv().BCRYPT_COST;
