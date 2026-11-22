/**
 * Email verification (R01-11, R17-14 carry-over).
 *
 * Tokens: 32 random bytes, stored as SHA-256 in email_verification_tokens, valid 48 h,
 * one live token per user. The link is sent through the durable outbox; with no email
 * provider configured the message stays queued as blocked_no_provider and enforcement is
 * off (see config.ts), so nobody is locked out of a deployment that cannot send mail.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { emailVerificationTokens, users } from "@shared/schema";
import { db } from "../../db";
import { getEnv } from "../../config/env";
import { createLogger } from "../../config/logger";
import { normalizeEmail } from "../../storage/helpers";
import { buildEmailVerificationEmail, sendEmail } from "../email.service";

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
  const email = normalizeEmail(user.email);
  const issued = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.id))
      .for("update");
    if (!current || normalizeEmail(current.email) !== email) return false;
    await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));
    await tx.insert(emailVerificationTokens).values({
      userId: user.id,
      email,
      tokenHash: hashVerificationToken(raw),
      expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    });
    return true;
  });
  if (!issued) return { queued: false, status: "not_queued" };
  const link = `${appUrl()}/verify-email?token=${raw}`;
  const built = buildEmailVerificationEmail(link, user.name);
  try {
    const result = await sendEmail(email, built.subject, built.text, {
      html: built.html,
      category: "security",
      relatedEntityType: "user",
      relatedEntityId: user.id,
      sensitive: true,
    });
    return { queued: result.queued, status: result.status };
  } catch {
    log.warn({ userId: user.id }, "Failed to queue verification email");
    return { queued: false, status: "not_queued" };
  }
}

export type VerifyEmailResult =
  | { ok: true; userId: string; alreadyVerified: boolean }
  | { ok: false; code: "VERIFICATION_TOKEN_INVALID" };

export async function consumeVerificationToken(raw: string): Promise<VerifyEmailResult> {
  const invalid = { ok: false, code: "VERIFICATION_TOKEN_INVALID" } as const;
  if (!/^[0-9a-f]{64}$/i.test(raw)) return invalid;
  const tokenHash = hashVerificationToken(raw.toLowerCase());
  const [token] = await db
    .select({ userId: emailVerificationTokens.userId })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash));
  if (!token) return invalid;
  return db.transaction(async (tx) => {
    // Lock the user before consuming a token, matching issuance and email changes.
    const [user] = await tx
      .select({
        email: users.email,
        verified: users.emailVerified,
        verifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, token.userId))
      .for("update");
    if (!user) return invalid;
    const [consumed] = await tx
      .delete(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          eq(emailVerificationTokens.userId, token.userId),
          eq(emailVerificationTokens.email, normalizeEmail(user.email)),
          gt(emailVerificationTokens.expiresAt, new Date())
        )
      )
      .returning({ id: emailVerificationTokens.id });
    if (!consumed) return invalid;
    await tx
      .update(users)
      .set({ emailVerified: true, emailVerifiedAt: user.verifiedAt ?? new Date() })
      .where(eq(users.id, token.userId));
    return { ok: true, userId: token.userId, alreadyVerified: user.verified };
  });
}
