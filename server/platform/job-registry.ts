/**
 * Background job registry. Modules declare jobs; the scheduler
 * (server/services/scheduler.service.ts → initScheduler) is the only place
 * that turns them into cron timers.
 *
 *   registerJob({ name: "fx.refreshRates", cron: "5 * * * *", run: refreshRates });
 *
 * Guarantees for every registered job:
 *   - per-job try/catch: a throwing job is logged, never crashes the process
 *     or affects other jobs;
 *   - overlap protection: if the previous run of the same job is still in
 *     flight when the cron fires again, the new tick is skipped and logged.
 */
import cron from "node-cron";
import { createLogger } from "../config/logger";

const log = createLogger("job-registry");

export interface JobContext {
  /** The job's registered name. */
  name: string;
  /** When this run started. */
  startedAt: Date;
}

export interface JobDefinition {
  /** Unique name, "<module>.<job>" (e.g. "reports.deliveryScan"). */
  name: string;
  /** 5-field cron expression, evaluated in UTC by node-cron. */
  cron: string;
  run: (ctx: JobContext) => Promise<void> | void;
  /** Human description for logs. */
  description?: string;
}

export type JobRunOutcome = "ok" | "failed" | "skipped_overlap";

interface JobState {
  def: JobDefinition;
  running: boolean;
  lastOutcome?: JobRunOutcome;
  lastStartedAt?: Date;
  lastFinishedAt?: Date;
}

const jobs = new Map<string, JobState>();

/** Register a job. Duplicate names and invalid cron expressions throw. */
export function registerJob(def: JobDefinition): void {
  if (!def.name || !/^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/.test(def.name)) {
    throw new Error(`Invalid job name "${def.name}"`);
  }
  if (jobs.has(def.name)) throw new Error(`Job "${def.name}" is already registered`);
  if (!cron.validate(def.cron)) throw new Error(`Job "${def.name}" has invalid cron "${def.cron}"`);
  if (typeof def.run !== "function") throw new Error(`Job "${def.name}" needs a run function`);
  jobs.set(def.name, { def, running: false });
}

export function listJobs(): JobDefinition[] {
  return [...jobs.values()].map((s) => s.def);
}

export function getJobStatus(
  name: string
):
  | { running: boolean; lastOutcome?: JobRunOutcome; lastStartedAt?: Date; lastFinishedAt?: Date }
  | undefined {
  const s = jobs.get(name);
  if (!s) return undefined;
  const { running, lastOutcome, lastStartedAt, lastFinishedAt } = s;
  return { running, lastOutcome, lastStartedAt, lastFinishedAt };
}

/**
 * Run a registered job once with the try/catch + overlap guarantees.
 * Never throws for job failures; returns the outcome.
 */
export async function runJob(name: string): Promise<JobRunOutcome> {
  const state = jobs.get(name);
  if (!state) throw new Error(`Job "${name}" is not registered`);
  if (state.running) {
    log.warn({ job: name }, "Previous run still in progress — skipping this tick");
    state.lastOutcome = "skipped_overlap";
    return "skipped_overlap";
  }
  state.running = true;
  const startedAt = new Date();
  state.lastStartedAt = startedAt;
  try {
    await state.def.run({ name, startedAt });
    state.lastOutcome = "ok";
  } catch (err) {
    log.error({ err, job: name }, "Scheduled job failed");
    state.lastOutcome = "failed";
  } finally {
    state.running = false;
    state.lastFinishedAt = new Date();
  }
  return state.lastOutcome;
}

export type CronScheduleFn = (expression: string, task: () => void) => unknown;

/**
 * Attach every registered job to a cron timer. `schedule` defaults to
 * node-cron and is injectable for tests. Returns the scheduled job names.
 */
export function startRegisteredJobs(schedule: CronScheduleFn = cron.schedule): string[] {
  const started: string[] = [];
  for (const { def } of jobs.values()) {
    schedule(def.cron, () => {
      void runJob(def.name);
    });
    started.push(def.name);
  }
  return started;
}

/** Remove all jobs. Tests only. */
export function resetJobs(): void {
  jobs.clear();
}
