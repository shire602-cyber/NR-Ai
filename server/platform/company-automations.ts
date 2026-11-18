/**
 * Per-company automation switches (WQ7). The background jobs in the job registry run for every
 * company; the ones a customer would think of as "automations" are listed here, each tied to the
 * registered job that runs it. A company can switch each one off; the job then skips that company,
 * and every run it does make for a company is recorded (last run, last result, a short summary).
 *
 *   for (const companyId of ids) {
 *     await runForCompany("paymentReminders", companyId, () => dunCompany(companyId, now, s));
 *   }
 *
 * A missing settings row means the automation is on (its default). Switching one off never
 * deletes or changes data the automation produced earlier.
 */
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { getJobStatus, listJobs } from "./job-registry";

const log = createLogger("company-automations");

export const COMPANY_AUTOMATIONS = [
  { key: "categorise", job: "gl.autonomousClassificationScan" },
  { key: "paymentReminders", job: "engagement.paymentReminderScan" },
  { key: "recurringInvoices", job: "invoices.recurringGeneration" },
  { key: "recurringBills", job: "bills.recurring" },
  { key: "recurringJournals", job: "ledger.recurringJournals" },
  { key: "reportDeliveries", job: "reports.deliveryScan" },
  { key: "anomalyChecks", job: "anomalies.scan" },
] as const;

export type CompanyAutomationKey = (typeof COMPANY_AUTOMATIONS)[number]["key"];

export const COMPANY_AUTOMATION_KEYS = COMPANY_AUTOMATIONS.map((a) => a.key) as readonly string[];

export function isCompanyAutomationKey(key: unknown): key is CompanyAutomationKey {
  return typeof key === "string" && COMPANY_AUTOMATION_KEYS.includes(key);
}

export type AutomationRunStatus = "ok" | "failed";

/** Is the automation on for this company? (no row = on) */
export async function automationEnabled(
  key: CompanyAutomationKey,
  companyId: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT enabled FROM company_automation_settings WHERE company_id = $1 AND automation_key = $2`,
    [companyId, key]
  );
  return r.rows.length === 0 ? true : r.rows[0].enabled === true;
}

/** Companies that switched the automation off (one query for a whole scan). */
export async function companiesWithAutomationOff(key: CompanyAutomationKey): Promise<Set<string>> {
  const r = await pool.query(
    `SELECT company_id FROM company_automation_settings
      WHERE automation_key = $1 AND enabled = false`,
    [key]
  );
  return new Set(r.rows.map((row: { company_id: string }) => String(row.company_id)));
}

/** Record one run of an automation for a company (never throws: a scan must not stop on it). */
export async function recordAutomationRun(
  key: CompanyAutomationKey,
  companyId: string,
  status: AutomationRunStatus,
  summary: Record<string, unknown> | null = null,
  error: string | null = null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO company_automation_settings
              (company_id, automation_key, enabled, last_run_at, last_status, last_summary, last_error, updated_at)
       VALUES ($1, $2, true, now(), $3, $4::jsonb, $5, now())
       ON CONFLICT (company_id, automation_key)
       DO UPDATE SET last_run_at = now(), last_status = $3, last_summary = $4::jsonb, last_error = $5`,
      [
        companyId,
        key,
        status,
        summary ? JSON.stringify(summary) : null,
        error?.slice(0, 500) ?? null,
      ]
    );
  } catch (err) {
    log.warn({ err, key, companyId }, "Could not record automation run");
  }
}

/**
 * Run one company's share of an automation if the company has it on, recording the outcome.
 * Returns undefined (without running) when the company switched it off. A failure is recorded
 * and rethrown, so the scan's own per-company error handling still applies.
 */
export async function runForCompany<T>(
  key: CompanyAutomationKey,
  companyId: string,
  fn: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown> | null
): Promise<T | undefined> {
  if (!(await automationEnabled(key, companyId))) return undefined;
  try {
    const result = await fn();
    await recordAutomationRun(key, companyId, "ok", summarize ? summarize(result) : null);
    return result;
  } catch (err) {
    await recordAutomationRun(
      key,
      companyId,
      "failed",
      null,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}

export async function setAutomationEnabled(
  companyId: string,
  key: CompanyAutomationKey,
  enabled: boolean,
  userId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO company_automation_settings (company_id, automation_key, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id, automation_key)
     DO UPDATE SET enabled = $3, updated_by = $4, updated_at = now()`,
    [companyId, key, enabled, userId]
  );
}

export interface CompanyAutomationView {
  key: CompanyAutomationKey;
  job: string;
  enabled: boolean;
  /** Is the job registered (and so scheduled) in this server? */
  scheduled: boolean;
  cron: string | null;
  lastRunAt: string | null;
  lastStatus: AutomationRunStatus | null;
  lastSummary: Record<string, unknown> | null;
  lastError: string | null;
  /** Next scheduled run of the job (UTC), or null when switched off or not scheduled. */
  nextRunAt: string | null;
  /** Job currently running on this server. */
  running: boolean;
}

export async function listCompanyAutomations(
  companyId: string,
  now: Date = new Date()
): Promise<CompanyAutomationView[]> {
  const r = await pool.query(
    `SELECT automation_key, enabled, last_run_at, last_status, last_summary, last_error
       FROM company_automation_settings WHERE company_id = $1`,
    [companyId]
  );
  const rows = new Map<string, Record<string, unknown>>(
    r.rows.map((row: Record<string, unknown>) => [String(row.automation_key), row])
  );
  const jobs = new Map(listJobs().map((j) => [j.name, j]));
  return COMPANY_AUTOMATIONS.map(({ key, job }) => {
    const row = rows.get(key);
    const def = jobs.get(job);
    const enabled = row ? row.enabled === true : true;
    const lastRunAt = row?.last_run_at ? new Date(row.last_run_at as string).toISOString() : null;
    const next = enabled && def ? nextCronRun(def.cron, now) : null;
    return {
      key,
      job,
      enabled,
      scheduled: !!def,
      cron: def?.cron ?? null,
      lastRunAt,
      lastStatus: (row?.last_status as AutomationRunStatus | undefined) ?? null,
      lastSummary: (row?.last_summary as Record<string, unknown> | undefined) ?? null,
      lastError: (row?.last_error as string | undefined) ?? null,
      nextRunAt: next ? next.toISOString() : null,
      running: getJobStatus(job)?.running === true,
    };
  });
}

// ── Next run of a 5-field cron (UTC, as node-cron evaluates the registered jobs) ─────────────

function fieldSet(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : stepText ? max : lo;
    }
    if (![lo, hi, step].every(Number.isFinite) || step <= 0) continue;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** The first minute after `from` that matches `expr`, within 32 days; null if none. */
export function nextCronRun(expr: string, from: Date): Date | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minutes = fieldSet(f[0], 0, 59);
  const hours = fieldSet(f[1], 0, 23);
  const doms = fieldSet(f[2], 1, 31);
  const months = fieldSet(f[3], 1, 12);
  const dows = new Set([...fieldSet(f[4], 0, 7)].map((d) => d % 7));
  const domAny = f[2] === "*";
  const dowAny = f[4] === "*";
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = from.getTime() + 32 * 24 * 3600_000;
  while (t.getTime() <= limit) {
    const dayOk =
      domAny && dowAny
        ? true
        : domAny
          ? dows.has(t.getUTCDay())
          : dowAny
            ? doms.has(t.getUTCDate())
            : doms.has(t.getUTCDate()) || dows.has(t.getUTCDay());
    if (!months.has(t.getUTCMonth() + 1) || !dayOk) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (minutes.has(t.getUTCMinutes())) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}
