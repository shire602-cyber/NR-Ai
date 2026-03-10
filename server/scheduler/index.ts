/**
 * Background Job Scheduler
 * ─────────────────────────
 * Central job registry using node-cron.
 * Manages scheduled jobs with execution tracking,
 * atomic job claiming, timeout protection, and error recovery.
 *
 * All times are in UAE timezone (Asia/Dubai, UTC+4).
 *
 * Concurrency Safety:
 * - Uses atomic UPDATE ... WHERE status != 'running' to claim jobs
 * - Only one instance can run a job at a time
 * - Stale "running" jobs are auto-recovered after timeout
 */

import cron from 'node-cron';
import { createLogger } from '../config/logger';
import { storage } from '../storage';

const log = createLogger('scheduler');

/** Default timeout for job execution (10 minutes) */
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60 * 1000;

/** Time after which a "running" job is considered stale and can be reclaimed (15 minutes) */
const STALE_JOB_THRESHOLD_MS = 15 * 60 * 1000;

// ── Job Definition ──────────────────────────────────────────────

export interface JobDefinition {
  name: string;
  description: string;
  cronExpression: string; // node-cron expression
  handler: () => Promise<void>;
  enabled?: boolean;
  timeoutMs?: number; // Override default timeout
}

// ── Registered Jobs ─────────────────────────────────────────────

const registeredJobs = new Map<string, {
  definition: JobDefinition;
  task: ReturnType<typeof cron.schedule> | null;
}>();

// ── Core Functions ──────────────────────────────────────────────

/**
 * Register a job definition. Does NOT start it yet.
 */
export function registerJob(definition: JobDefinition): void {
  if (registeredJobs.has(definition.name)) {
    log.warn({ job: definition.name }, 'Job already registered, skipping');
    return;
  }

  registeredJobs.set(definition.name, {
    definition,
    task: null,
  });

  log.info(
    { job: definition.name, cron: definition.cronExpression },
    'Job registered'
  );
}

/**
 * Start all registered jobs.
 * Call this ONCE during server bootstrap (after DB migrations).
 */
export async function startScheduler(): Promise<void> {
  log.info(`Starting scheduler with ${registeredJobs.size} registered jobs`);

  // Recover any stale "running" jobs from previous crash
  await recoverStaleJobs();

  for (const [name, entry] of registeredJobs) {
    if (entry.definition.enabled === false) {
      log.info({ job: name }, 'Job is disabled, skipping');
      continue;
    }

    // Validate cron expression
    if (!cron.validate(entry.definition.cronExpression)) {
      log.error(
        { job: name, cron: entry.definition.cronExpression },
        'Invalid cron expression'
      );
      continue;
    }

    // Ensure job exists in DB for tracking
    await ensureJobRecord(entry.definition);

    // Schedule the job
    const task = cron.schedule(
      entry.definition.cronExpression,
      async () => {
        await executeJob(name);
      },
      {
        timezone: 'Asia/Dubai', // UAE timezone (UTC+4)
      }
    );

    entry.task = task;
    log.info(
      { job: name, cron: entry.definition.cronExpression },
      'Job scheduled'
    );
  }

  log.info('Scheduler started successfully');
}

/**
 * Stop all scheduled jobs gracefully.
 */
export function stopScheduler(): void {
  log.info('Stopping scheduler...');
  for (const [name, entry] of registeredJobs) {
    if (entry.task) {
      entry.task.stop();
      log.info({ job: name }, 'Job stopped');
    }
  }
  log.info('Scheduler stopped');
}

/**
 * Manually trigger a job by name (admin API).
 * Returns success/failure with details.
 */
export async function triggerJob(jobName: string): Promise<{ success: boolean; error?: string }> {
  const entry = registeredJobs.get(jobName);
  if (!entry) {
    return { success: false, error: `Job '${jobName}' not found` };
  }

  log.info({ job: jobName }, 'Manual job trigger requested');

  try {
    await executeJob(jobName);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get status of all registered jobs.
 */
export async function getJobStatuses(): Promise<Array<{
  name: string;
  description: string;
  cronExpression: string;
  enabled: boolean;
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  runCount: number;
  failCount: number;
  lastError: string | null;
  lastDurationMs: number | null;
}>> {
  const statuses = [];

  for (const [name, entry] of registeredJobs) {
    let dbRecord;
    try {
      dbRecord = await storage.getScheduledJobByName(name);
    } catch {
      // DB might not have the record yet
    }

    statuses.push({
      name,
      description: entry.definition.description,
      cronExpression: entry.definition.cronExpression,
      enabled: entry.definition.enabled !== false,
      isRunning: dbRecord?.status === 'running',
      lastRunAt: dbRecord?.lastRunAt ?? null,
      nextRunAt: dbRecord?.nextRunAt ?? null,
      runCount: dbRecord?.runCount ?? 0,
      failCount: dbRecord?.failCount ?? 0,
      lastError: dbRecord?.lastError ?? null,
      lastDurationMs: dbRecord?.lastDurationMs ?? null,
    });
  }

  return statuses;
}

/**
 * Get list of registered job names.
 */
export function getRegisteredJobNames(): string[] {
  return Array.from(registeredJobs.keys());
}

// ── Internal Helpers ────────────────────────────────────────────

/**
 * Execute a job with atomic claiming, timeout, and error handling.
 *
 * Uses an atomic UPDATE ... WHERE status != 'running' pattern so that
 * only one instance can claim and run a job at a time.
 */
async function executeJob(jobName: string): Promise<void> {
  const entry = registeredJobs.get(jobName);
  if (!entry) {
    log.error({ job: jobName }, 'Attempted to execute unregistered job');
    return;
  }

  // ── Atomic claim: UPDATE WHERE status != 'running' ──────────
  let claimed = false;
  try {
    claimed = await storage.claimScheduledJob(jobName);
  } catch (err: any) {
    log.warn({ job: jobName, error: err.message }, 'Could not claim job via DB');
    // If DB is down, still try to run (single-instance assumption)
    claimed = true;
  }

  if (!claimed) {
    log.warn({ job: jobName }, 'Job is already running (claimed by another instance), skipping');
    return;
  }

  const startTime = Date.now();
  const timeoutMs = entry.definition.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  log.info({ job: jobName, timeoutMs }, 'Job execution started');

  try {
    // ── Execute with timeout ───────────────────────────────────
    await Promise.race([
      entry.definition.handler(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Job '${jobName}' timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    const durationMs = Date.now() - startTime;
    log.info({ job: jobName, durationMs }, 'Job execution completed');

    // Mark as completed
    try {
      await storage.updateScheduledJobStatus(jobName, {
        status: 'completed',
        lastDurationMs: durationMs,
        lastError: null,
      });
      await storage.incrementJobRunCount(jobName);
    } catch (err: any) {
      log.warn({ job: jobName, error: err.message }, 'Could not update job status to completed');
    }
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    log.error(
      { job: jobName, error: error.message, durationMs },
      'Job execution failed'
    );

    // Mark as failed (release the lock)
    try {
      await storage.updateScheduledJobStatus(jobName, {
        status: 'failed',
        lastDurationMs: durationMs,
        lastError: error.message || 'Unknown error',
      });
      await storage.incrementJobFailCount(jobName);
    } catch (err: any) {
      log.warn({ job: jobName, error: err.message }, 'Could not update job status to failed');
    }
  }
}

/**
 * Recover stale jobs that were left in "running" state after a crash.
 * Any job that has been "running" for longer than STALE_JOB_THRESHOLD_MS
 * is reset to "failed" so it can be re-executed.
 */
async function recoverStaleJobs(): Promise<void> {
  try {
    const allJobs = await storage.getAllScheduledJobs();
    const now = Date.now();

    for (const job of allJobs) {
      if (job.status === 'running' && job.lastRunAt) {
        const runningFor = now - new Date(job.lastRunAt).getTime();
        if (runningFor > STALE_JOB_THRESHOLD_MS) {
          log.warn(
            { job: job.jobName, runningForMs: runningFor },
            'Recovering stale job — was left in running state after crash'
          );
          await storage.updateScheduledJobStatus(job.jobName, {
            status: 'failed',
            lastError: `Recovered from stale running state (was running for ${Math.round(runningFor / 1000)}s)`,
          });
        }
      }
    }
  } catch (err: any) {
    log.warn({ error: err.message }, 'Could not recover stale jobs');
  }
}

/**
 * Ensure a job record exists in the database for tracking.
 */
async function ensureJobRecord(definition: JobDefinition): Promise<void> {
  try {
    const existing = await storage.getScheduledJobByName(definition.name);
    if (!existing) {
      await storage.createScheduledJob({
        jobName: definition.name,
        jobType: 'cron',
        cronExpression: definition.cronExpression,
        status: 'pending',
        isEnabled: definition.enabled !== false,
      });
      log.info({ job: definition.name }, 'Created DB record for job');
    }
  } catch (err: any) {
    log.warn(
      { job: definition.name, error: err.message },
      'Could not ensure job record in DB'
    );
  }
}
