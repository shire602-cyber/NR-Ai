/**
 * A test mailbox for portal invitations. An invitation link is sent to the customer and, since R5-9,
 * is never kept in `email_outbox.html` for a message that has not gone out. Tests that need the
 * raw token therefore install this capturing transport (a "provider") and read the delivered mail,
 * exactly like the customer's inbox. A test of the no-provider behaviour calls
 * `setEmailTransportOverride(null)` instead.
 */
import type { OutgoingEmail } from "../../server/outbox";

const delivered = new Map<string, OutgoingEmail>();
const TOKEN_RE = /#t=([0-9a-f]{64})/;

type Sql = (query: string, params?: unknown[]) => Promise<Array<Record<string, any>>>;

export async function installInviteMailbox(): Promise<void> {
  delivered.clear();
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride({
    name: "test",
    send: async (message) => {
      delivered.set(message.outboxId, message);
      return { providerMessageId: `mock-${message.outboxId}` };
    },
  });
}

/** The latest email delivered for an invitation (what the customer's inbox holds). */
export async function inviteMail(sql: Sql, invitationId: string): Promise<OutgoingEmail> {
  const [row] = await sql(`SELECT last_outbox_id FROM customer_portal_invitations WHERE id = $1`, [
    invitationId,
  ]);
  const mail = row?.last_outbox_id ? delivered.get(row.last_outbox_id) : undefined;
  if (!mail) throw new Error("No delivered invitation email in the test mailbox");
  return mail;
}

export async function inviteToken(sql: Sql, invitationId: string): Promise<string> {
  const mail = await inviteMail(sql, invitationId);
  const token = TOKEN_RE.exec(mail.html ?? "")?.[1];
  if (!token) throw new Error("The delivered invitation has no link");
  return token;
}
