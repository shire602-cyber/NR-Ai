import { and, eq, gt, sql } from "drizzle-orm";
import { customerPortalInvitations } from "@shared/schema";
import type { AppDatabase } from "../db";
import { DomainError } from "../errors";

// Issue, resend, accept and other account creation paths serialize on the same address.
export async function lockPortalInviteEmail(tx: AppDatabase, email: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('portal-invite-email'), hashtext(${email}))`
  );
}

export async function assertPortalInviteEmailAvailable(
  tx: AppDatabase,
  email: string
): Promise<void> {
  const [pending] = await tx
    .select({ id: customerPortalInvitations.id })
    .from(customerPortalInvitations)
    .where(
      and(
        sql`lower(${customerPortalInvitations.email}) = ${email}`,
        eq(customerPortalInvitations.status, "pending"),
        gt(customerPortalInvitations.expiresAt, new Date())
      )
    )
    .limit(1);
  if (pending) {
    throw new DomainError(
      "PORTAL_INVITE_EMAIL_RESERVED",
      409,
      undefined,
      "Use your customer portal invitation to set up this account"
    );
  }
}
