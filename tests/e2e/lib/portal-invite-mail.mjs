import pg from "pg";

/** Stand in for the customer's mailbox on a disposable app with no outbound email provider. */
export async function readPortalInviteMail(invitationId) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required to read the test outbox");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const {
      rows: [mail],
    } = await db.query(
      `SELECT subject, html FROM email_outbox
        WHERE category = 'portal_invite' AND related_entity_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [invitationId]
    );
    const token = /\/portal\/join#t=([0-9a-f]{64})/.exec(mail?.html ?? "")?.[1];
    if (!token)
      throw new Error(
        "Missing invitation in the test outbox. Use an app without an outbound email provider."
      );
    return { subject: mail.subject, token, hash: `#t=${token}` };
  } finally {
    await db.end();
  }
}
