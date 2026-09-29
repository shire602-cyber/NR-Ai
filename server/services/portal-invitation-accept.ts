import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { companyUsers, invitations, users, type Invitation, type User } from "../../shared/schema";
import { PORTAL_COMPANY_ROLE, PORTAL_USER_TYPE } from "./portal-invitations";

export type AcceptPortalInvitationResult =
  | { kind: "ok"; user: User }
  /** Already used, revoked, expired or replaced — someone else got there first. */
  | { kind: "unavailable" }
  /** An account already exists for this email; it is never converted. */
  | { kind: "email_taken" };

class EmailTakenError extends Error {}

/**
 * Consumes a portal invitation and creates the portal user in ONE transaction.
 *
 * The invitation is claimed with a conditional UPDATE (status = 'pending' and
 * not expired), so two concurrent accepts cannot both succeed and a token is
 * strictly single-use. If the email is already registered the claim is rolled
 * back and nothing is created.
 */
export async function acceptPortalInvitation(params: {
  invitation: Invitation;
  name: string;
  passwordHash: string;
}): Promise<AcceptPortalInvitationResult> {
  const { invitation, name, passwordHash } = params;
  if (!invitation.companyId) return { kind: "unavailable" };
  const email = invitation.email.toLowerCase();

  try {
    return await db.transaction(async (tx: typeof db) => {
      const claimed = await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.id, invitation.id),
            eq(invitations.status, "pending"),
            gt(invitations.expiresAt, new Date())
          )
        )
        .returning({ id: invitations.id });
      if (claimed.length === 0) return { kind: "unavailable" as const };

      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (existing) throw new EmailTakenError();

      const [user] = await tx
        .insert(users)
        .values({
          email,
          name,
          passwordHash,
          isAdmin: false,
          userType: PORTAL_USER_TYPE,
          firmRole: null,
          emailVerified: true,
        })
        .returning();

      await tx.insert(companyUsers).values({
        companyId: invitation.companyId as string,
        userId: user.id,
        role: PORTAL_COMPANY_ROLE,
      });

      return { kind: "ok" as const, user };
    });
  } catch (err: any) {
    if (err instanceof EmailTakenError || err?.code === "23505") {
      return { kind: "email_taken" };
    }
    throw err;
  }
}
