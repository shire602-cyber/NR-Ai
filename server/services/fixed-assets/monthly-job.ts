/**
 * WQ3 (9.11): the scheduled monthly depreciation job `fixedAssets.monthlyDepreciation`.
 *
 * Runs daily (cheap and idempotent) and, for every company with active assets, depreciates the
 * last month that has fully ended through the SAME service as the manual run
 * (`runDepreciation` -> `depreciateInTx` -> the ledger kernel), so every E2 / D2 / C2 rule
 * holds unchanged:
 *   - never a future-dated entry (a month is depreciated only after it ends);
 *   - never after disposal (only `active` assets are charged; a disposed asset is skipped);
 *   - one charge per asset and month (depreciation_schedules unique key + the kernel
 *     idempotency key), so a second run posts nothing;
 *   - a locked period is skipped for that company (logged, retried on a later day if unlocked).
 *
 * Automations: the job is registered in the platform job registry under its name, so the
 * Automations page lists it with its last run. A per-company on/off switch, when one is
 * provided as the service `automations.isEnabled(companyId, jobName)`, is respected; without it
 * the job runs for every company.
 */
import { pool } from "../../db";
import { createLogger } from "../../config/logger";
import { todayIso } from "../../ledger/normalize";
import { has, resolve } from "../../platform/service-registry";
import { listJobs, registerJob } from "../../platform/job-registry";
import { isPeriodLocked } from "../period-lock.service";
import { depreciationPeriodEnd, lastEndedMonth, runDepreciation } from "./index";

const log = createLogger("fixed-assets-job");

export const MONTHLY_DEPRECIATION_JOB = "fixedAssets.monthlyDepreciation";

export type AutomationEnabledFn = (companyId: string, jobName: string) => Promise<boolean>;

export interface CompanyDepreciationRun {
  companyId: string;
  period: { year: number; month: number };
  status: "posted" | "nothing_due" | "period_locked" | "disabled" | "no_actor" | "failed";
  posted: number;
  skipped: number;
  error?: string;
}

async function automationEnabled(companyId: string): Promise<boolean> {
  if (!has("automations.isEnabled")) return true;
  try {
    return await resolve<AutomationEnabledFn>("automations.isEnabled")(
      companyId,
      MONTHLY_DEPRECIATION_JOB
    );
  } catch (err) {
    log.warn({ companyId, err: (err as Error).message }, "automation switch lookup failed");
    return false;
  }
}

/** The user the job posts as: the company owner, else its earliest member. */
async function jobActor(companyId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT user_id FROM company_users WHERE company_id = $1
      ORDER BY (role = 'owner') DESC, created_at ASC LIMIT 1`,
    [companyId]
  );
  return (rows[0] as { user_id?: string } | undefined)?.user_id ?? null;
}

/** Depreciate the last ended month for every company with active assets (or the given ones). */
export async function runMonthlyDepreciation(
  opts: { today?: string; companyIds?: string[] } = {}
): Promise<CompanyDepreciationRun[]> {
  const today = opts.today ?? todayIso();
  const period = lastEndedMonth(today);
  const periodEnd = depreciationPeriodEnd(period.year, period.month);
  const { rows } = await pool.query(
    `SELECT DISTINCT company_id FROM fixed_assets
      WHERE status = 'active' AND ($1::uuid[] IS NULL OR company_id = ANY($1::uuid[]))`,
    [opts.companyIds ?? null]
  );
  const out: CompanyDepreciationRun[] = [];
  for (const { company_id: companyId } of rows as Array<{ company_id: string }>) {
    const base = { companyId, period, posted: 0, skipped: 0 };
    if (!(await automationEnabled(companyId))) {
      out.push({ ...base, status: "disabled" });
      continue;
    }
    if (await isPeriodLocked(companyId, periodEnd)) {
      log.info({ companyId, periodEnd }, "depreciation period locked; skipped");
      out.push({ ...base, status: "period_locked" });
      continue;
    }
    const actor = await jobActor(companyId);
    if (!actor) {
      out.push({ ...base, status: "no_actor" });
      continue;
    }
    try {
      const results = await runDepreciation(companyId, period.year, period.month, actor);
      const posted = results.filter((r) => !r.skipped).length;
      out.push({
        ...base,
        status: posted ? "posted" : "nothing_due",
        posted,
        skipped: results.length - posted,
      });
    } catch (err) {
      // One company's failure (a lock taken mid-run, a missing account) never stops the others.
      log.error({ companyId, err: (err as Error).message }, "monthly depreciation failed");
      out.push({ ...base, status: "failed", error: (err as Error).message });
    }
  }
  return out;
}

/** Register the job once (safe to call on every app build). */
export function registerFixedAssetJobs(): void {
  if (listJobs().some((j) => j.name === MONTHLY_DEPRECIATION_JOB)) return;
  registerJob({
    name: MONTHLY_DEPRECIATION_JOB,
    cron: "43 2 * * *",
    description: "Post last month's depreciation for active fixed assets once the month has ended",
    run: async () => {
      const runs = await runMonthlyDepreciation();
      const posted = runs.reduce((s, r) => s + r.posted, 0);
      if (runs.length) log.info({ companies: runs.length, posted }, "monthly depreciation run");
    },
  });
}
