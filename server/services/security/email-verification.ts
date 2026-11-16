/**
 * Email verification (R01-11, R17-14 carry-over).
 *
 * Tokens: 32 random bytes, stored as SHA-256 in email_verification_tokens, valid 48 h,
 * one live token per user. The link is sent through the durable outbox; with no email
 * provider configured the message stays queued as blocked_no_provider and enforcement is
 * off (see config.ts), so nobody is locked out of a deployment that cannot send mail.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./sql";
import { getEnv } from "../../config/env";
import { createLogger } from "../../config/logger";
import { escapeHtml, sendEmail } from "../email.service";

const log = createLogger("email-verification");

export const VERIFICATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appUrl(): string {
  const env = getEnv();
  return (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || "").replace(/\/+$/, "");
}

/** Create a fresh token (replacing older ones) and email the link. */
export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<{ queued: boolean; status: string }> {
  const raw = randomBytes(32).toString("hex");
  await sql(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [user.id]);
  await sql(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hashVerificationToken(raw), new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)]
  );
  const link = `${appUrl()}/verify-email?token=${raw}`;
  const greeting = user.name ? `Hello ${user.name},` : "Hello,";
  const text = `${greeting}\n\nConfirm your email address for Muhasib.ai by opening this link (valid for 48 hours):\n${link}\n\nIf you did not create an account, you can ignore this message.`;
  const html = `<p>${escapeHtml(greeting)}</p><p>Confirm your email address for Muhasib.ai (the link is valid for 48 hours):</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>If you did not create an account, you can ignore this message.</p>`;
  try {
    const result = await sendEmail(user.email, "Confirm your email address", text, {
      html,
      category: "security",
      relatedEntityType: "user",
      relatedEntityId: user.id,
      sensitive: true,
    });
    return { queued: result.queued, status: result.status };
  } catch (err) {
    log.warn({ err, userId: user.id }, "Failed to queue verification email");
    return { queued: false, status: "not_queued" };
  }
}

export type VerifyEmailResult =
  | { ok: true; userId: string; alreadyVerified: boolean }
  | { ok: false; code: "VERIFICATION_TOKEN_INVALID" };

export async function consumeVerificationToken(raw: string): Promise<VerifyEmailResult> {
  if (!/^[0-9a-f]{64}$/i.test(raw)) return { ok: false, code: "VERIFICATION_TOKEN_INVALID" };
  const { rows } = await sql<{ user_id: string }>(
    `DELETE FROM email_verification_tokens
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [hashVerificationToken(raw.toLowerCase())]
  );
  const userId = rows[0]?.user_id;
  if (!userId) return { ok: false, code: "VERIFICATION_TOKEN_INVALID" };
  const upd = await sql<{ was: boolean }>(
    `UPDATE users u SET email_verified = true, email_verified_at = COALESCE(u.email_verified_at, now())
       FROM (SELECT id, email_verified AS was FROM users WHERE id = $1) prev
      WHERE u.id = prev.id
      RETURNING prev.was`,
    [userId]
  );
  await sql(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
  return { ok: true, userId, alreadyVerified: upd.rows[0]?.was === true };
}
