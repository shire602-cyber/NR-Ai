import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { eq, lte } from "drizzle-orm";
import { oauthMailboxChallenges } from "@shared/schema";
import { zEmail } from "@shared/validators/primitives";
import { db } from "../db";
import { activeProviderName, OAUTH_MAILBOX_CHALLENGE_ENTITY } from "../outbox";
import { sendEmail } from "./email.service";
import {
  getAuthIdentity,
  getUserByNormalizedOAuthEmail,
  hashOAuthSecret,
  normalizeOAuthEmail,
  OAuthIdentityError,
  type OAuthIdentityProfile,
} from "./oauth.service";
import { storage } from "../storage";

export const OAUTH_MAILBOX_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(browserSecret: string, code: string): string {
  return createHmac("sha256", browserSecret).update(code).digest("hex");
}

/** Store a challenge for the exact identity and account mapped by this Entra callback. */
export async function startMicrosoftMailboxChallenge(
  profile: OAuthIdentityProfile,
  nextPath: string
): Promise<string> {
  const address = zEmail.safeParse(profile.email);
  if (!address.success) throw new OAuthIdentityError("Microsoft did not provide a usable mailbox");
  const email = address.data;
  const identity = await getAuthIdentity(profile);
  const user = identity
    ? await storage.getUser(identity.userId)
    : await getUserByNormalizedOAuthEmail(email);
  if (identity && (!user || normalizeOAuthEmail(user.email) !== email)) {
    throw new OAuthIdentityError("Microsoft email must match the current account email");
  }
  if (!activeProviderName())
    throw new OAuthIdentityError("Mailbox verification delivery is unavailable");

  const browserSecret = randomBytes(32).toString("hex");
  const challengeHash = hashOAuthSecret(browserSecret);
  const code = randomInt(100_000_000).toString().padStart(8, "0");
  await db.delete(oauthMailboxChallenges).where(lte(oauthMailboxChallenges.expiresAt, new Date()));
  const [challenge] = await db
    .insert(oauthMailboxChallenges)
    .values({
      challengeHash,
      codeHash: hashCode(browserSecret, code),
      issuer: profile.issuer,
      providerSubject: profile.subject,
      email,
      displayName: profile.name,
      avatarUrl: profile.picture,
      nextPath,
      expectedUserId: user?.id ?? null,
      expiresAt: new Date(Date.now() + OAUTH_MAILBOX_TTL_MS),
    })
    .returning({ id: oauthMailboxChallenges.id });
  try {
    const result = await sendEmail(
      email,
      "Microsoft sign-in verification | التحقق من تسجيل الدخول عبر Microsoft",
      [
        "Enter this Microsoft sign-in code in the browser where you started. It expires in 10 minutes.",
        "أدخل رمز تسجيل الدخول عبر Microsoft في المتصفح الذي بدأت منه. تنتهي صلاحيته خلال 10 دقائق.",
        code,
        "If you didn't start this sign-in, ignore this email. Never share this code.",
        "إذا لم تبدأ تسجيل الدخول، فتجاهل هذه الرسالة ولا تشارك الرمز مع أي شخص.",
      ].join("\n\n"),
      {
        category: "security",
        relatedEntityType: OAUTH_MAILBOX_CHALLENGE_ENTITY,
        relatedEntityId: challenge.id,
        sensitive: true,
      }
    );
    // The worker can claim the message before the immediate delivery attempt.
    if (
      result.sent ||
      result.status === "retrying" ||
      result.status === "queued" ||
      result.status === "sending"
    )
      return browserSecret;
  } catch {
    // Delivery errors can contain email content. Report only the fixed error below.
  }
  await db
    .delete(oauthMailboxChallenges)
    .where(eq(oauthMailboxChallenges.challengeHash, challengeHash));
  throw new OAuthIdentityError("Could not send the Microsoft verification code");
}

/** The browser cookie and code are both needed. Row locking makes redemption single-use. */
export async function consumeMicrosoftMailboxChallenge(browserSecret: string | null, code: string) {
  if (!browserSecret || !/^[0-9a-f]{64}$/.test(browserSecret)) return null;
  const challengeHash = hashOAuthSecret(browserSecret);
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(oauthMailboxChallenges)
      .where(eq(oauthMailboxChallenges.challengeHash, challengeHash))
      .for("update");
    if (!pending || pending.expiresAt.getTime() <= Date.now()) return null;
    const matches = timingSafeEqual(
      Buffer.from(pending.codeHash, "hex"),
      Buffer.from(hashCode(browserSecret, code), "hex")
    );
    if (matches || pending.attempts + 1 >= MAX_ATTEMPTS) {
      await tx
        .delete(oauthMailboxChallenges)
        .where(eq(oauthMailboxChallenges.challengeHash, challengeHash));
    } else {
      await tx
        .update(oauthMailboxChallenges)
        .set({ attempts: pending.attempts + 1 })
        .where(eq(oauthMailboxChallenges.challengeHash, challengeHash));
    }
    if (!matches) return null;

    const profile: OAuthIdentityProfile = {
      provider: "microsoft",
      issuer: pending.issuer,
      subject: pending.providerSubject,
      email: pending.email,
      emailVerified: false,
      mailboxVerified: true,
      name: pending.displayName,
      picture: pending.avatarUrl ?? undefined,
      claims: {},
    };
    return { profile, nextPath: pending.nextPath, expectedUserId: pending.expectedUserId };
  });
}
