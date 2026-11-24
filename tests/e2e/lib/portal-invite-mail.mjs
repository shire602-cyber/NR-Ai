import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Stand in for the customer's mailbox on a disposable app with no outbound email provider.
 *
 * An invitation that was not sent keeps no link anywhere (R5-9): the raw token exists only in a
 * delivered email. So the mailbox hands the test a token of its own: it mints one and stores
 * its hash on the invitation (exactly what a real delivery would have given the customer), then
 * returns it with the subject of the queued message. Only use this against a disposable database.
 */
export async function readPortalInviteMail(invitationId) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required to read the test outbox");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const raw = randomBytes(32).toString("hex");
    // Mirrors server/services/portal-invitations.service.ts inviteTokenHash (v2 namespace).
    const tokenHash = createHash("sha256")
      .update(`customer-portal-invite:v2:${raw}`, "utf8")
      .digest("hex");
    const {
      rows: [mail],
    } = await db.query(
      `SELECT o.subject FROM customer_portal_invitations i
         JOIN email_outbox o ON o.id = i.last_outbox_id
        WHERE i.id = $1 AND i.status = 'pending'`,
      [invitationId]
    );
    if (!mail) throw new Error("Missing invitation in the test outbox.");
    await db.query(`UPDATE customer_portal_invitations SET token_hash = $2 WHERE id = $1`, [
      invitationId,
      tokenHash,
    ]);
    return { subject: mail.subject, token: raw, hash: `#t=${raw}` };
  } finally {
    await db.end();
  }
}
