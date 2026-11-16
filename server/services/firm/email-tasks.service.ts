/**
 * Email-to-task for firm practice (S4, R15-15 part).
 *
 * Every inbound client email that email intake stores (email_intake_messages)
 * becomes one review task in the practice task list (firm_tasks, source
 * `email`, source_key `email:<message id>` — idempotent on the existing
 * unique (firm_id, source_key) index). The task belongs to the firm of the
 * user who mapped the sender address (client_email_sources.firm_id).
 *
 * Boundary: messages only arrive once an external mailbox / inbound-email
 * provider is connected (EMAIL_INTAKE_* settings, see
 * services/email-intake-provider.ts). Without it nothing is received, and the
 * API/UI say so (`requires_configuration`); tasks can still be created by hand
 * from messages that were ingested.
 */
import { pool } from "../../db";
import { DomainError } from "../../errors";
import { createLogger } from "../../config/logger";
import { resolveFirmContext } from "./scope";

const log = createLogger("firm-email-tasks");

export const EMAIL_TASK_SOURCE = "email";
export const DEFAULT_EMAIL_TASK_DUE_DAYS = 3;

export function emailTaskSourceKey(messageId: string): string {
  return `email:${messageId}`;
}

export interface EmailTaskRow {
  id: string;
  firmId: string;
  companyId: string;
  title: string;
  dueDate: string;
  status: string;
  source: string;
  sourceKey: string;
  assigneeUserId: string | null;
}

interface MessageRow {
  id: string;
  company_id: string;
  from_email: string;
  subject: string | null;
  received_at: string;
  attachment_count: number;
  source_firm_user: string;
}

function uaeDate(d: Date): string {
  return new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function emailTaskTitle(m: {
  subject: string | null;
  fromEmail: string;
  attachmentCount: number;
}): string {
  const subject = (m.subject ?? "").trim() || "(no subject)";
  const files = m.attachmentCount === 1 ? "1 attachment" : `${m.attachmentCount} attachments`;
  return `Review client email: ${subject} — from ${m.fromEmail} (${files})`.slice(0, 300);
}

const SELECT_TASK = `SELECT id, firm_id AS "firmId", company_id AS "companyId", title,
         due_date::text AS "dueDate", status, source, source_key AS "sourceKey",
         assignee_user_id AS "assigneeUserId"
    FROM firm_tasks`;

async function loadMessage(messageId: string): Promise<MessageRow | null> {
  const r = await pool.query(
    `SELECT m.id, m.company_id, m.from_email, m.subject, m.received_at, m.attachment_count,
            s.firm_id AS source_firm_user
       FROM email_intake_messages m
       JOIN client_email_sources s ON s.id = m.source_id
      WHERE m.id = $1`,
    [messageId]
  );
  return (r.rows[0] as MessageRow | undefined) ?? null;
}

/** The company an intake message belongs to (route access checks), or null. */
export async function intakeMessageCompany(messageId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  const r = await pool.query(`SELECT company_id FROM email_intake_messages WHERE id = $1`, [
    messageId,
  ]);
  return (r.rows[0]?.company_id as string | undefined) ?? null;
}

/**
 * Create (or return) the review task for one ingested message. Idempotent:
 * a second call returns the existing task with `created: false`.
 */
export async function createTaskFromIntakeMessage(
  messageId: string,
  opts: {
    actorId?: string | null;
    dueDate?: string;
    title?: string;
    assigneeUserId?: string | null;
  } = {}
): Promise<{ task: EmailTaskRow; created: boolean }> {
  const message = await loadMessage(messageId);
  if (!message) throw new DomainError("INTAKE_MESSAGE_NOT_FOUND", 404);
  const ctx = await resolveFirmContext({ id: message.source_firm_user });
  if (!ctx) {
    throw new DomainError(
      "FIRM_NOT_RESOLVED",
      409,
      undefined,
      "The sender mapping does not belong to an active firm"
    );
  }
  const sourceKey = emailTaskSourceKey(message.id);
  const received = uaeDate(new Date(message.received_at));
  const dueDate = opts.dueDate ?? addDays(received, DEFAULT_EMAIL_TASK_DUE_DAYS);
  const title =
    opts.title?.trim() ||
    emailTaskTitle({
      subject: message.subject,
      fromEmail: message.from_email,
      attachmentCount: Number(message.attachment_count) || 0,
    });
  const inserted = await pool.query(
    `INSERT INTO firm_tasks
       (firm_id, company_id, title, period_start, period_end, due_date, status,
        assignee_user_id, source, source_key, created_by)
     VALUES ($1, $2, $3, $4::date, $4::date, $5::date, 'open', $6, $7, $8, $9)
     ON CONFLICT (firm_id, source_key) WHERE source_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      ctx.firmId,
      message.company_id,
      title,
      received,
      dueDate,
      opts.assigneeUserId ?? null,
      EMAIL_TASK_SOURCE,
      sourceKey,
      opts.actorId ?? null,
    ]
  );
  const created = (inserted.rowCount ?? 0) > 0;
  const row = await pool.query(`${SELECT_TASK} WHERE firm_id = $1 AND source_key = $2`, [
    ctx.firmId,
    sourceKey,
  ]);
  return { task: row.rows[0] as EmailTaskRow, created };
}

/**
 * Sweep: a review task for every recently stored message that has none yet
 * (run after the inbound webhook and after a poll). Never throws.
 */
export async function createTasksForUntriagedMessages(
  opts: { companyIds?: string[]; since?: Date } = {}
): Promise<{ created: number }> {
  const since = opts.since ?? new Date(Date.now() - 7 * 86_400_000);
  let created = 0;
  try {
    const r = await pool.query(
      `SELECT m.id FROM email_intake_messages m
        WHERE m.created_at >= $1
          AND m.status <> 'ignored'
          AND ($2::uuid[] IS NULL OR m.company_id = ANY($2::uuid[]))
          AND NOT EXISTS (
            SELECT 1 FROM firm_tasks t WHERE t.source_key = 'email:' || m.id::text
          )
        ORDER BY m.created_at`,
      [since, opts.companyIds?.length ? opts.companyIds : null]
    );
    for (const { id } of r.rows as Array<{ id: string }>) {
      try {
        if ((await createTaskFromIntakeMessage(id)).created) created += 1;
      } catch (err) {
        log.warn({ messageId: id, err: (err as Error).message }, "email task not created");
      }
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, "email task sweep failed");
  }
  return { created };
}

/** Task ids for a set of messages (message id → task id). */
export async function tasksForMessages(messageIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (messageIds.length === 0) return out;
  const r = await pool.query(
    `SELECT id, source_key FROM firm_tasks WHERE source_key = ANY($1::text[])`,
    [messageIds.map(emailTaskSourceKey)]
  );
  for (const row of r.rows as Array<{ id: string; source_key: string }>) {
    out.set(row.source_key.slice("email:".length), row.id);
  }
  return out;
}
