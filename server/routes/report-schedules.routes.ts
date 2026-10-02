import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { buildLimiter } from "../middleware/rateLimit";
import { pool } from "../db";
import { recordAudit } from "../services/audit.service";
import { canManageSchedules, canViewSensitive, isSensitiveRole } from "../reports/access";
import { AS_OF_PRESETS, RANGE_PRESETS, parseRunQuery, resolveSchedulePreset, type FilterKey } from "../reports/params";
import { nextSlot, startManualRun } from "../reports/schedule";
import { getReport } from "../reports/registry";
import "../reports/definitions";

const UUID = z.string().uuid();

// A run renders a report and emails it: five a minute per user is plenty for people, and a ceiling for a script.
const runNowLimiter = buildLimiter({ windowMs: 60_000, max: 5, message: "Too many manual report runs. Wait a minute and try again." });
const MAX_RECIPIENTS = 20;

const paramsSchema = z
  .object({
    rangePreset: z.enum(RANGE_PRESETS).optional(),
    asOfPreset: z.enum(AS_OF_PRESETS).optional(),
    compare: z.enum(["none", "priorPeriod", "priorYear"]).optional(),
    filters: z.record(z.string().max(200)).optional(),
  })
  .strict();

const scheduleBody = z
  .object({
    reportId: z.string().min(1).max(100),
    params: paramsSchema.default({}),
    format: z.enum(["pdf", "csv", "xlsx"]),
    lang: z.enum(["en", "ar"]).default("en"),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    dayOfWeek: z.number().int().min(0).max(6).nullish(),
    dayOfMonth: z.number().int().min(1).max(28).nullish(),
    hourDubai: z.number().int().min(0).max(23).default(7),
    recipientUserIds: z.array(UUID).min(1).max(MAX_RECIPIENTS),
  })
  .strict();

const patchBody = scheduleBody.partial().extend({ enabled: z.boolean().optional() }).strict();

type Problem = { status: number; code: string; message: string };
const problem = (status: number, code: string, message: string): Problem => ({ status, code, message });

/** Day-of-week for weekly, day-of-month for monthly; the other is ignored (stored null). */
function cadenceProblem(s: { cadence: string; dayOfWeek?: number | null; dayOfMonth?: number | null }): Problem | null {
  if (s.cadence === "weekly" && (s.dayOfWeek === undefined || s.dayOfWeek === null)) {
    return problem(422, "INVALID_CADENCE", "A weekly schedule needs dayOfWeek (0 = Sunday ... 6 = Saturday).");
  }
  if (s.cadence === "monthly" && (s.dayOfMonth === undefined || s.dayOfMonth === null)) {
    return problem(422, "INVALID_CADENCE", "A monthly schedule needs dayOfMonth (1 to 28).");
  }
  return null;
}

/** The report must exist and be schedulable; its stored presets, compare and filters must make a valid run query. */
function paramsProblem(reportId: string, stored: z.infer<typeof paramsSchema>): Problem | null {
  const report = getReport(reportId);
  if (!report) return problem(422, "REPORT_NOT_SCHEDULABLE", "This report cannot be scheduled.");
  const kinds = report.params;
  if (stored.rangePreset && !kinds.includes("range")) return problem(422, "INVALID_PARAMS", "This report has no date range.");
  if (stored.asOfPreset && !kinds.includes("asOf")) return problem(422, "INVALID_PARAMS", "This report has no as-of day.");
  const probe = parseRunQuery(
    resolveSchedulePreset(
      {
        ...(kinds.includes("range") ? { rangePreset: stored.rangePreset ?? "thisMonth" } : {}),
        ...(kinds.includes("asOf") ? { asOfPreset: stored.asOfPreset ?? "today" } : {}),
        compare: stored.compare,
        filters: stored.filters,
      },
      new Date(),
      1
    ),
    { kinds, filters: (report.filters ?? []) as readonly FilterKey[], noFutureAsOf: report.noFutureAsOf, budgetComparison: report.budgetComparison }
  );
  if (!probe.ok) return problem(probe.issue.status === 400 ? 422 : probe.issue.status, probe.issue.code, probe.issue.message);
  return null;
}

async function recipientProblem(companyId: string, ids: string[], sensitive: boolean): Promise<Problem | null> {
  const unique = [...new Set(ids)];
  const { rows } = await pool.query(`SELECT cu.user_id, cu.role FROM company_users cu WHERE cu.company_id = $1 AND cu.user_id = ANY($2::uuid[])`, [
    companyId,
    unique,
  ]);
  const byId = new Map<string, string>(rows.map((r: any) => [String(r.user_id), String(r.role)]));
  for (const id of unique) {
    const role = byId.get(id);
    if (!role) return problem(422, "RECIPIENT_NOT_MEMBER", "Scheduled reports can only be emailed to members of this company.");
    if (sensitive && !isSensitiveRole(role)) {
      return problem(422, "RECIPIENT_ROLE_FORBIDDEN", "This report is limited to owners, accountants and CFOs; a recipient has a different role.");
    }
  }
  return null;
}

const utcText = (v: unknown) => (v ? `${v}Z` : null);

const toDto = (r: any) => ({
  id: String(r.id),
  companyId: String(r.company_id),
  reportId: r.report_id,
  params: r.params ?? {},
  format: r.format,
  lang: r.lang,
  cadence: r.cadence,
  dayOfWeek: r.day_of_week ?? null,
  dayOfMonth: r.day_of_month ?? null,
  hourDubai: r.hour_dubai,
  recipientUserIds: r.recipient_user_ids ?? [],
  enabled: r.enabled,
  nextRunAt: utcText(r.next_run_text),
  lastRunAt: utcText(r.last_run_text),
  lastRunStatus: r.last_status ?? null,
  createdAt: utcText(r.created_text),
});

// Timestamps are read as UTC text: a bare `timestamp` column must not be parsed as server-local time.
const SELECT_SCHEDULE = `
  SELECT s.*, to_char(s.next_run_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS next_run_text,
         to_char(s.last_run_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS last_run_text,
         to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS created_text,
         (SELECT r.status FROM report_schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_status
    FROM report_schedules s`;

/**
 * Phase 8 D4: per-report scheduled email delivery. Lists are open to company members; writes need owner / accountant /
 * CFO (or firm staff). Every query filters company_id; another company's schedule id is a 404.
 */
export function registerReportScheduleRoutes(app: Express) {
  const base = "/api/companies/:companyId/report-schedules";

  const deny = (res: Response) =>
    res.status(403).json({ message: "Only owners, accountants and CFOs can change report schedules.", code: "ROLE_FORBIDDEN" });
  const send = (res: Response, p: Problem) => res.status(p.status).json({ message: p.message, code: p.code });
  const bodyError = (res: Response, err: z.ZodError) => res.status(400).json({ message: "Invalid schedule.", code: "INVALID_BODY", details: err.flatten() });
  const notFound = (res: Response) => res.status(404).json({ message: "Schedule not found", code: "NOT_FOUND" });

  app.get(
    base,
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pool.query(`${SELECT_SCHEDULE} WHERE s.company_id = $1 ORDER BY s.created_at DESC`, [req.params.companyId]);
      // A schedule of a sensitive report (payroll, audit trail ...) names who gets it: only people who may see the report see it.
      const mayList = await canViewSensitive((req as any).user, req.params.companyId);
      res.json(rows.filter((r: any) => mayList || !getReport(r.report_id)?.sensitive).map(toDto));
    })
  );

  app.post(
    base,
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const user = (req as any).user;
      if (!(await canManageSchedules(user, companyId))) return deny(res);
      const parsed = scheduleBody.safeParse(req.body);
      if (!parsed.success) return bodyError(res, parsed.error);
      const b = parsed.data;
      const report = getReport(b.reportId);
      if (!report) return send(res, problem(422, "REPORT_NOT_SCHEDULABLE", "This report cannot be scheduled."));
      const cp = cadenceProblem(b);
      if (cp) return send(res, cp);
      const pp = paramsProblem(b.reportId, b.params);
      if (pp) return send(res, pp);
      const rp = await recipientProblem(companyId, b.recipientUserIds, report.sensitive === true);
      if (rp) return send(res, rp);

      const next = nextSlot(new Date(), { cadence: b.cadence, dayOfWeek: b.dayOfWeek, dayOfMonth: b.dayOfMonth, hourDubai: b.hourDubai });
      const { rows } = await pool.query(
        `INSERT INTO report_schedules (company_id, report_id, params, format, lang, cadence, day_of_week, day_of_month, hour_dubai, recipient_user_ids, next_run_at, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamp, $12) RETURNING id`,
        [
          companyId,
          b.reportId,
          JSON.stringify(b.params),
          b.format,
          b.lang,
          b.cadence,
          b.cadence === "weekly" ? b.dayOfWeek : null,
          b.cadence === "monthly" ? b.dayOfMonth : null,
          b.hourDubai,
          JSON.stringify([...new Set(b.recipientUserIds)]),
          next.toISOString().slice(0, 23),
          user.id,
        ]
      );
      const created = (await pool.query(`${SELECT_SCHEDULE} WHERE s.id = $1 AND s.company_id = $2`, [rows[0].id, companyId])).rows[0];
      await recordAudit({
        userId: user.id,
        companyId,
        action: "report_schedule.create",
        entityType: "report_schedule",
        entityId: String(rows[0].id),
        before: null,
        after: { reportId: b.reportId, cadence: b.cadence, recipients: b.recipientUserIds.length },
        req,
      });
      res.status(201).json(toDto(created));
    })
  );

  app.patch(
    `${base}/:id`,
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const user = (req as any).user;
      if (!UUID.safeParse(id).success) return notFound(res);
      if (!(await canManageSchedules(user, companyId))) return deny(res);
      const existing = (await pool.query(`SELECT * FROM report_schedules WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
      if (!existing) return notFound(res);
      const parsed = patchBody.safeParse(req.body);
      if (!parsed.success) return bodyError(res, parsed.error);
      const p = parsed.data;
      const merged = {
        reportId: p.reportId ?? existing.report_id,
        params: p.params ?? existing.params ?? {},
        format: p.format ?? existing.format,
        lang: p.lang ?? existing.lang,
        cadence: p.cadence ?? existing.cadence,
        dayOfWeek: p.dayOfWeek !== undefined ? p.dayOfWeek : existing.day_of_week,
        dayOfMonth: p.dayOfMonth !== undefined ? p.dayOfMonth : existing.day_of_month,
        hourDubai: p.hourDubai ?? existing.hour_dubai,
        recipientUserIds: (p.recipientUserIds ?? existing.recipient_user_ids ?? []) as string[],
        enabled: p.enabled ?? existing.enabled,
      };
      const report = getReport(merged.reportId);
      if (!report) return send(res, problem(422, "REPORT_NOT_SCHEDULABLE", "This report cannot be scheduled."));
      const cp = cadenceProblem(merged);
      if (cp) return send(res, cp);
      const storedParams = paramsSchema.safeParse(merged.params);
      if (!storedParams.success) return bodyError(res, storedParams.error);
      const pp = paramsProblem(merged.reportId, storedParams.data);
      if (pp) return send(res, pp);
      const rp = await recipientProblem(companyId, merged.recipientUserIds, report.sensitive === true);
      if (rp) return send(res, rp);

      const cadenceChanged =
        p.cadence !== undefined || p.dayOfWeek !== undefined || p.dayOfMonth !== undefined || p.hourDubai !== undefined || (p.enabled === true && !existing.enabled);
      const next = cadenceChanged
        ? nextSlot(new Date(), { cadence: merged.cadence, dayOfWeek: merged.dayOfWeek, dayOfMonth: merged.dayOfMonth, hourDubai: merged.hourDubai })
            .toISOString()
            .slice(0, 23)
        : null;
      await pool.query(
        `UPDATE report_schedules
            SET report_id = $3, params = $4::jsonb, format = $5, lang = $6, cadence = $7, day_of_week = $8, day_of_month = $9, hour_dubai = $10,
                recipient_user_ids = $11::jsonb, enabled = $12, next_run_at = COALESCE($13::timestamp, next_run_at), updated_at = $14::timestamp
          WHERE id = $1 AND company_id = $2`,
        [
          id,
          companyId,
          merged.reportId,
          JSON.stringify(merged.params),
          merged.format,
          merged.lang,
          merged.cadence,
          merged.cadence === "weekly" ? merged.dayOfWeek : null,
          merged.cadence === "monthly" ? merged.dayOfMonth : null,
          merged.hourDubai,
          JSON.stringify([...new Set(merged.recipientUserIds)]),
          merged.enabled,
          next,
          new Date().toISOString().slice(0, 23),
        ]
      );
      const updated = (await pool.query(`${SELECT_SCHEDULE} WHERE s.id = $1 AND s.company_id = $2`, [id, companyId])).rows[0];
      await recordAudit({
        userId: user.id,
        companyId,
        action: "report_schedule.update",
        entityType: "report_schedule",
        entityId: id,
        before: { enabled: existing.enabled, cadence: existing.cadence },
        after: { enabled: merged.enabled, cadence: merged.cadence },
        req,
      });
      res.json(toDto(updated));
    })
  );

  app.delete(
    `${base}/:id`,
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const user = (req as any).user;
      if (!UUID.safeParse(id).success) return notFound(res);
      if (!(await canManageSchedules(user, companyId))) return deny(res);
      const { rowCount } = await pool.query(`DELETE FROM report_schedules WHERE id = $1 AND company_id = $2`, [id, companyId]);
      if (!rowCount) return notFound(res);
      await recordAudit({ userId: user.id, companyId, action: "report_schedule.delete", entityType: "report_schedule", entityId: id, before: null, after: null, req });
      res.status(204).end();
    })
  );

  app.post(
    `${base}/:id/run-now`,
    authMiddleware,
    requireCompanyAccess("params"),
    runNowLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const user = (req as any).user;
      if (!UUID.safeParse(id).success) return notFound(res);
      if (!(await canManageSchedules(user, companyId))) return deny(res);
      const runId = await startManualRun(id, companyId);
      if (!runId) return notFound(res);
      if (runId === "IN_PROGRESS") {
        return res.status(409).json({ message: "A manual run of this schedule started less than a minute ago.", code: "RUN_IN_PROGRESS" });
      }
      res.status(202).json({ runId });
    })
  );

  app.get(
    `${base}/:id/runs`,
    authMiddleware,
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      if (!UUID.safeParse(id).success) return notFound(res);
      const owned = await pool.query(`SELECT 1 FROM report_schedules WHERE id = $1 AND company_id = $2`, [id, companyId]);
      if (owned.rows.length === 0) return notFound(res);
      const { rows } = await pool.query(
        `SELECT id, slot_key, "trigger", status, reason, resolved_params, row_count, byte_size, sha256, recipients_sent,
                to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS started_text, to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS finished_text
           FROM report_schedule_runs WHERE schedule_id = $1 AND company_id = $2 ORDER BY started_at DESC LIMIT 100`,
        [id, companyId]
      );
      res.json(
        rows.map((r: any) => ({
          id: String(r.id),
          slotKey: r.slot_key,
          trigger: r.trigger,
          status: r.status,
          reason: r.reason,
          resolvedParams: r.resolved_params,
          rowCount: r.row_count,
          byteSize: r.byte_size,
          sha256: r.sha256,
          recipientsSent: r.recipients_sent,
          startedAt: utcText(r.started_text),
          finishedAt: utcText(r.finished_text),
        }))
      );
    })
  );
}
