import { sql } from "drizzle-orm";
import type { AppDatabase } from "../db";

// Issue, resend, accept and account creation serialize on the same address. A pending
// invitation never blocks the invited address from creating its own account (R5-4): the
// invitation then follows the existing-account path (sign in, verified email, accept).
export async function lockPortalInviteEmail(tx: AppDatabase, email: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('portal-invite-email'), hashtext(${email}))`
  );
}
