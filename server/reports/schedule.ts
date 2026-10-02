// Scheduled report email delivery (Phase 8 D4): slot maths and the run engine behind the hourly `20 * * * *` tick
// (scheduler.service.ts; no new cron, no recurring cost).
//
// One run per slot across instances: the tick claims due schedules in one transaction (SELECT ... FOR UPDATE SKIP
// LOCKED), inserts the run row ON CONFLICT (schedule_id, slot_key) DO NOTHING and advances next_run_at, then renders and
// emails outside the transaction. A run is running -> sent | skipped | failed:
//   skipped EMAIL_NOT_CONFIGURED  no email provider (plus an in-app notification to the recipients);
//   skipped NO_RECIPIENTS         every recipient has left the company;
//   failed  <error>               a render or send error;  failed STALE_RUN  still running after 30 minutes.
// Recipients are company members only this phase (CTO decision): emails are resolved from user ids at send time.

import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { hasEmailProvider, sendReportEmail } from "../services/email.service";
import { storage } from "../storage";
import { isSensitiveRole } from "./access";
import { resolveSchedulePreset } from "./params";
import { prepareReportRun, renderReportFile, runReport } from "./service";
import type { ReportFileFormat } from "../../shared/report-result";

const log = createLogger("report-schedules");

export type Cadence = "daily" | "weekly" | "monthly";
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const STALE_AFTER_MS = 30 * 60_000;
const CLAIM_LIMIT = 50;

export interface CadenceSpec {
  cadence: Cadence;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hourDubai: number;
}

/** The next slot strictly after `now`: Dubai wall-clock `hourDubai`:00 on the cadence's day, as a UTC instant. */
export function nextSlot(now: Date, spec: CadenceSpec): Date {
  const wall = new Date(now.getTime() + DUBAI_OFFSET_MS); // Dubai wall clock held in UTC fields
  const at = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d, spec.hourDubai, 0, 0, 0));
  let candidate: Date;
  if (spec.cadence === "daily") {
    candidate = at(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
    if (candidate <= wall) candidate = new Date(candidate.getTime() + 86_400_000);
  } else if (spec.cadence === "weekly") {
    const target = spec.dayOfWeek ?? 0;
    candidate = at(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
    const ahead = (target - wall.getUTCDay() + 7) % 7;
    candidate = new Date(candidate.getTime() + ahead * 86_400_000);
    if (candidate <= wall) candidate = new Date(candidate.getTime() + 7 * 86_400_000);
  } else {
    const day = Math.min(28, Math.max(1, spec.dayOfMonth ?? 1));
    candidate = at(wall.getUTCFullYear(), wall.getUTCMonth(), day);
    if (candidate <= wall) candidate = at(wall.getUTCFullYear(), wall.getUTCMonth() + 1, day);
  }
  return new Date(candidate.getTime() - DUBAI_OFFSET_MS);
}

/** '2026-10-05T07': the Dubai calendar hour of a slot instant. One run per schedule per slot. */
export function slotKey(slot: Date): string {
  return new Date(slot.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 13);
}

interface ScheduleRow {
  id: string;
  /** next_run_at as UTC text 'YYYY-MM-DDTHH:MM:SS.mmm' (a bare timestamp column must not be read as local time). */
  next_run_text?: string;
  company_id: string;
  report_id: string;
  params: Record<string, unknown>;
  format: ReportFileFormat;
  lang: "en" | "ar";
  recipient_user_ids: string[];
  created_by: string | null;
  next_run_at: Date;
}

export interface Claimed {
  schedule: ScheduleRow;
  runId: string;
  trigger: "schedule" | "manual";
}

/** Runs still "running" after 30 minutes belong to a crashed worker. */
export async function failStaleRuns(now: Date = new Date()): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE report_schedule_runs SET status = 'failed', reason = 'STALE_RUN', finished_at = $1::timestamp
      WHERE status = 'running' AND started_at < $2::timestamp`,
    [now.toISOString().slice(0, 23), new Date(now.getTime() - STALE_AFTER_MS).toISOString().slice(0, 23)]
  );
  return rowCount ?? 0;
}

/** Claim the due schedules and their run rows in one transaction; next_run_at moves on so another tick cannot repeat the slot. */
async function claimDue(now: Date): Promise<Claimed[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT *, to_char(next_run_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS next_run_text FROM report_schedules
        WHERE enabled AND next_run_at <= $1::timestamp ORDER BY next_run_at LIMIT ${CLAIM_LIMIT} FOR UPDATE SKIP LOCKED`,
      [now.toISOString().slice(0, 23)]
    );
    const claimed: Claimed[] = [];
    for (const r of rows) {
      const schedule = r as ScheduleRow;
      const key = slotKey(new Date(`${r.next_run_text}Z`));
      const ins = await client.query(
        `INSERT INTO report_schedule_runs (schedule_id, company_id, slot_key, "trigger", status, resolved_params, started_at)
         VALUES ($1, $2, $3, 'schedule', 'running', '{}'::jsonb, $4::timestamp) ON CONFLICT (schedule_id, slot_key) DO NOTHING RETURNING id`,
        [schedule.id, schedule.company_id, key, now.toISOString().slice(0, 23)]
      );
      const next = nextSlot(now, {
        cadence: r.cadence,
        dayOfWeek: r.day_of_week,
        dayOfMonth: r.day_of_month,
        hourDubai: r.hour_dubai,
      });
      await client.query(`UPDATE report_schedules SET next_run_at = $2::timestamp, last_run_at = $3::timestamp, updated_at = $3::timestamp WHERE id = $1`, [
        schedule.id,
        next.toISOString().slice(0, 23),
        now.toISOString().slice(0, 23),
      ]);
      if (ins.rows[0]) claimed.push({ schedule, runId: String(ins.rows[0].id), trigger: "schedule" });
    }
    await client.query("COMMIT");
    return claimed;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface Recipient {
  userId: string;
  email: string;
  name: string;
}

async function resolveRecipients(schedule: ScheduleRow, sensitive: boolean): Promise<{ sendTo: Recipient[]; dropped: string[] }> {
  const ids = Array.isArray(schedule.recipient_user_ids) ? schedule.recipient_user_ids : [];
  const { rows } = await pool.query(
    `SELECT u.id, u.email, COALESCE(u.name, u.email) AS name, cu.role, COALESCE(u.is_active, true) AS active
       FROM users u JOIN company_users cu ON cu.user_id = u.id AND cu.company_id = $1
      WHERE u.id = ANY($2::uuid[])`,
    [schedule.company_id, ids]
  );
  const byId = new Map<string, any>(rows.map((r: any) => [String(r.id), r]));
  const sendTo: Recipient[] = [];
  const dropped: string[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) dropped.push(`${id}: no longer a member`);
    else if (!r.active) dropped.push(`${id}: inactive user`);
    else if (sensitive && !isSensitiveRole(r.role)) dropped.push(`${id}: role cannot see this report`);
    else sendTo.push({ userId: String(r.id), email: String(r.email), name: String(r.name) });
  }
  return { sendTo, dropped };
}

async function finishRun(
  runId: string,
  fields: { status: "sent" | "skipped" | "failed"; reason?: string | null; params?: unknown; rowCount?: number | null; byteSize?: number | null; sha256?: string | null; sent?: number }
) {
  await pool.query(
    `UPDATE report_schedule_runs
        SET status = $2, reason = $3, resolved_params = COALESCE($4::jsonb, resolved_params), row_count = $5, byte_size = $6, sha256 = $7,
            recipients_sent = $8, finished_at = $9::timestamp
      WHERE id = $1`,
    [runId, fields.status, fields.reason ?? null, fields.params ? JSON.stringify(fields.params) : null, fields.rowCount ?? null, fields.byteSize ?? null, fields.sha256 ?? null, fields.sent ?? 0, new Date().toISOString().slice(0, 23)]
  );
}

/** Render one claimed run and email it. Every outcome is recorded on the run row; this never throws. */
export async function executeScheduleRun(claimed: Claimed, now: Date = new Date()): Promise<void> {
  const { schedule, runId } = claimed;
  try {
    const company = (await pool.query(`SELECT name, fiscal_year_start_month FROM companies WHERE id = $1 AND deleted_at IS NULL`, [schedule.company_id])).rows[0];
    if (!company) return finishRun(runId, { status: "failed", reason: "COMPANY_NOT_FOUND" });
    const query: Record<string, string> = {
      ...resolveSchedulePreset(schedule.params ?? {}, now, Number(company.fiscal_year_start_month) || 1),
      format: schedule.format,
      lang: schedule.lang,
    };
    const prepared = await prepareReportRun(schedule.company_id, schedule.report_id, query, now);
    if (!prepared.ok) return finishRun(runId, { status: "failed", reason: `${prepared.issue.code}: ${prepared.issue.message}`, params: query });
    const { report, company: reportCompany, params } = prepared;

    const { sendTo, dropped } = await resolveRecipients(schedule, report.sensitive === true);
    const creator = schedule.created_by;
    const result = await runReport({
      report,
      company: reportCompany,
      params,
      now,
      userId: creator ?? undefined,
      paginate: false,
      canAccessCompany: (id) => (id === schedule.company_id || !creator ? Promise.resolve(id === schedule.company_id) : storage.hasCompanyAccess(creator, id)),
    });
    const file = await renderReportFile(result, schedule.format, reportCompany.name, schedule.lang);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const evidence = { params: query, rowCount: result.rows.length, byteSize: file.buffer.length, sha256 };
    const droppedNote = dropped.length ? `Dropped recipients: ${dropped.join("; ")}` : null;

    if (sendTo.length === 0) {
      return finishRun(runId, { status: "skipped", reason: "NO_RECIPIENTS", ...evidence });
    }
    if (!hasEmailProvider()) {
      await Promise.all(
        sendTo.map((r) =>
          storage
            .createNotification({
              userId: r.userId,
              companyId: schedule.company_id,
              type: "system",
              title: `Scheduled report not emailed: ${report.title.en}`,
              message: "Email is not configured on this server, so the scheduled report was not sent. You can open it in Reports.",
              priority: "normal",
              actionUrl: `/reports/run/${report.id}`,
            } as any)
            .catch((err: unknown) => log.warn({ err: String((err as Error)?.message) }, "notification failed"))
        )
      );
      return finishRun(runId, { status: "skipped", reason: "EMAIL_NOT_CONFIGURED", ...evidence });
    }

    const title = schedule.lang === "ar" ? report.title.ar : report.title.en;
    const subject = `${title} - ${reportCompany.name}`;
    const message =
      schedule.lang === "ar"
        ? `مرفق تقرير "${title}" لشركة ${reportCompany.name}.\n\nأُنشئ تلقائيًا من Muhasib.ai.`
        : `Attached is the "${title}" report for ${reportCompany.name}.\n\nGenerated automatically by Muhasib.ai.`;
    let sent = 0;
    const failures: string[] = [];
    for (const r of sendTo) {
      const outcome = await sendReportEmail({ to: r.email, subject, message, fromName: reportCompany.name, file: file.buffer, filename: file.fileName, contentType: file.mime });
      if (outcome.sent) sent++;
      else failures.push(`${r.email}: ${outcome.error ?? outcome.code ?? "send failed"}`);
    }
    if (failures.length > 0 && sent === 0) {
      return finishRun(runId, { status: "failed", reason: `EMAIL_SEND_FAILED: ${failures.join("; ")}`, ...evidence, sent });
    }
    return finishRun(runId, {
      status: "sent",
      reason: [droppedNote, failures.length ? `Failed: ${failures.join("; ")}` : null].filter(Boolean).join(" | ") || null,
      ...evidence,
      sent,
    });
  } catch (err: any) {
    log.error({ err: err?.message, scheduleId: schedule.id }, "scheduled report run failed");
    await finishRun(runId, { status: "failed", reason: String(err?.code ?? err?.message ?? "RUN_FAILED").slice(0, 500) }).catch(() => undefined);
  }
}

/** The hourly tick: fail stale runs, claim what is due, and run it. Safe to call from several instances at once. */
export async function runDueReportSchedules(now: Date = new Date()): Promise<{ claimed: number }> {
  await failStaleRuns(now);
  const claimed = await claimDue(now);
  for (const c of claimed) await executeScheduleRun(c, now);
  return { claimed: claimed.length };
}

export const MANUAL_RUN_WINDOW_MS = 60_000;

/**
 * Start a manual run (run-now): its own slot key, next_run_at untouched. Returns the run id (the run proceeds in the background),
 * null for a schedule that is not the company's, or "IN_PROGRESS" when a manual run of this schedule started in the last 60 seconds
 * (a double click must not mail the recipients twice). The check and the insert share an advisory lock, so two requests at once
 * cannot both pass.
 */
export async function startManualRun(scheduleId: string, companyId: string, now: Date = new Date()): Promise<string | null | "IN_PROGRESS"> {
  const { rows } = await pool.query(`SELECT * FROM report_schedules WHERE id = $1 AND company_id = $2`, [scheduleId, companyId]);
  const schedule = rows[0] as ScheduleRow | undefined;
  if (!schedule) return null;
  const client = await pool.connect();
  let ins;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`manual-run:${schedule.id}`]);
    const recent = await client.query(
      `SELECT 1 FROM report_schedule_runs WHERE schedule_id = $1 AND "trigger" = 'manual' AND started_at > $2::timestamp LIMIT 1`,
      [schedule.id, new Date(now.getTime() - MANUAL_RUN_WINDOW_MS).toISOString().slice(0, 23)]
    );
    if (recent.rows.length > 0) {
      await client.query("ROLLBACK");
      return "IN_PROGRESS";
    }
    ins = await client.query(
      `INSERT INTO report_schedule_runs (schedule_id, company_id, slot_key, "trigger", status, resolved_params, started_at)
       VALUES ($1, $2, $3, 'manual', 'running', '{}'::jsonb, $4::timestamp) RETURNING id`,
      [schedule.id, schedule.company_id, `manual:${randomUUID()}`, now.toISOString().slice(0, 23)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const runId = String(ins.rows[0].id);
  void executeScheduleRun({ schedule, runId, trigger: "manual" }, now);
  return runId;
}

