import { createLogger } from "../config/logger";
import { storage } from "../storage";
import { createAndEmitNotification } from "./socket.service";
import {
  buildReportDeliveryHandoffReview,
  buildReportDeliveryNotificationForPlan,
  buildReportDeliveryRunInput,
  estimateReportDeliveryNextRun,
  getReportDeliveryPlans,
  type ReportDeliveryHandoffReview,
  type ReportDeliveryPlan,
} from "./report-delivery.service";
import type { CompanyReportDeliveryRun } from "../../shared/schema";
import { executeReportDeliveryRun, setRunNotification } from "./report-render/delivery";

const log = createLogger("report-delivery-scheduler");

export type ReportDeliveryScheduleSkipReason = "paused" | "setup" | "not_due";

export interface ReportDeliveryScheduleDecision {
  shouldQueue: boolean;
  reason: "due" | ReportDeliveryScheduleSkipReason;
  scheduledFor: Date;
}

export interface ReportDeliverySchedulerResult {
  scannedCompanies: number;
  scannedSubscriptions: number;
  queuedRuns: number;
  skippedPaused: number;
  skippedSetup: number;
  skippedNotDue: number;
  skippedHandoff: number;
  skippedNoActor: number;
  errors: number;
}

interface CompanyReportDeliverySchedulerScanResult {
  status: "success" | "error";
  startedAt: Date;
  finishedAt: Date;
  scannedSubscriptions: number;
  queuedRuns: number;
  skippedPaused: number;
  skippedSetup: number;
  skippedNotDue: number;
  skippedHandoff: number;
  skippedNoActor: number;
  errors: number;
  message: string | null;
  queuedSubscriptionIds: string[];
  dueSubscriptionIds: string[];
  skippedSubscriptionIds: Record<
    ReportDeliveryScheduleSkipReason | "handoff" | "no_actor",
    string[]
  >;
  handoffReviews: Array<ReportDeliveryHandoffReview & { subscriptionId: string }>;
}

function emptyResult(): ReportDeliverySchedulerResult {
  return {
    scannedCompanies: 0,
    scannedSubscriptions: 0,
    queuedRuns: 0,
    skippedPaused: 0,
    skippedSetup: 0,
    skippedNotDue: 0,
    skippedHandoff: 0,
    skippedNoActor: 0,
    errors: 0,
  };
}

function emptyCompanyScanResult(startedAt = new Date()): CompanyReportDeliverySchedulerScanResult {
  return {
    status: "success",
    startedAt,
    finishedAt: startedAt,
    scannedSubscriptions: 0,
    queuedRuns: 0,
    skippedPaused: 0,
    skippedSetup: 0,
    skippedNotDue: 0,
    skippedHandoff: 0,
    skippedNoActor: 0,
    errors: 0,
    message: null,
    queuedSubscriptionIds: [],
    dueSubscriptionIds: [],
    skippedSubscriptionIds: {
      paused: [],
      setup: [],
      not_due: [],
      handoff: [],
      no_actor: [],
    },
    handoffReviews: [],
  };
}

function addCompanyScanResult(
  result: ReportDeliverySchedulerResult,
  companyResult: CompanyReportDeliverySchedulerScanResult
) {
  result.scannedSubscriptions += companyResult.scannedSubscriptions;
  result.queuedRuns += companyResult.queuedRuns;
  result.skippedPaused += companyResult.skippedPaused;
  result.skippedSetup += companyResult.skippedSetup;
  result.skippedNotDue += companyResult.skippedNotDue;
  result.skippedHandoff += companyResult.skippedHandoff;
  result.skippedNoActor += companyResult.skippedNoActor;
  result.errors += companyResult.errors;
}

function isUtcWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function isUtcMonthEnd(date: Date): boolean {
  const tomorrow = new Date(date);
  tomorrow.setUTCDate(date.getUTCDate() + 1);
  return tomorrow.getUTCDate() === 1;
}

function cadenceWindowIsDue(cadence: string, now: Date): boolean {
  const normalized = cadence.toLowerCase();
  const hour = now.getUTCHours();

  if (normalized.includes("weekday")) return isUtcWeekday(now) && hour >= 8;
  if (normalized.includes("monday")) return now.getUTCDay() === 1 && hour >= 8;
  if (normalized.includes("daily")) return isUtcWeekday(now) && hour >= 8;
  if (normalized.includes("month-end")) return isUtcMonthEnd(now) && hour >= 17;
  if (normalized.includes("monthly")) return now.getUTCDate() === 1 && hour >= 8;
  if (normalized.includes("tax") || normalized.includes("deadline")) {
    return now.getUTCDate() === 15 && hour >= 8;
  }

  return false;
}

export function getReportDeliveryScheduleDecision(
  plan: ReportDeliveryPlan,
  latestRun: Pick<CompanyReportDeliveryRun, "scheduledFor"> | null | undefined,
  now = new Date()
): ReportDeliveryScheduleDecision {
  if (!plan.enabled || plan.status === "paused") {
    return {
      shouldQueue: false,
      reason: "paused",
      scheduledFor: new Date(plan.nextRunAt),
    };
  }

  if (plan.status !== "ready") {
    return {
      shouldQueue: false,
      reason: "setup",
      scheduledFor: new Date(plan.nextRunAt),
    };
  }

  if (!latestRun) {
    return cadenceWindowIsDue(plan.cadence, now)
      ? { shouldQueue: true, reason: "due", scheduledFor: now }
      : {
          shouldQueue: false,
          reason: "not_due",
          scheduledFor: new Date(plan.nextRunAt),
        };
  }

  const latestScheduledFor = new Date(latestRun.scheduledFor);
  const nextScheduledFor = estimateReportDeliveryNextRun(
    { cadence: plan.cadence },
    latestScheduledFor
  );

  return nextScheduledFor <= now
    ? { shouldQueue: true, reason: "due", scheduledFor: nextScheduledFor }
    : { shouldQueue: false, reason: "not_due", scheduledFor: nextScheduledFor };
}

function countSkip(
  result: Pick<ReportDeliverySchedulerResult, "skippedPaused" | "skippedSetup" | "skippedNotDue">,
  reason: ReportDeliveryScheduleSkipReason
) {
  if (reason === "paused") result.skippedPaused += 1;
  if (reason === "setup") result.skippedSetup += 1;
  if (reason === "not_due") result.skippedNotDue += 1;
}

function latestRunForSubscription(
  runs: CompanyReportDeliveryRun[],
  subscriptionId: string
): CompanyReportDeliveryRun | null {
  return runs.find((run) => run.subscriptionId === subscriptionId) ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown scheduler error";
}

async function recordCompanySchedulerScan(
  companyId: string,
  companyResult: CompanyReportDeliverySchedulerScanResult
) {
  try {
    await storage.createReportDeliverySchedulerScan({
      companyId,
      status: companyResult.status,
      startedAt: companyResult.startedAt,
      finishedAt: companyResult.finishedAt,
      scannedSubscriptions: companyResult.scannedSubscriptions,
      queuedRuns: companyResult.queuedRuns,
      skippedPaused: companyResult.skippedPaused,
      skippedSetup: companyResult.skippedSetup,
      skippedNotDue: companyResult.skippedNotDue,
      skippedNoActor: companyResult.skippedNoActor,
      errors: companyResult.errors,
      message: companyResult.message,
      snapshot: {
        dueSubscriptionIds: companyResult.dueSubscriptionIds,
        queuedSubscriptionIds: companyResult.queuedSubscriptionIds,
        skippedSubscriptionIds: companyResult.skippedSubscriptionIds,
        handoffReviews: companyResult.handoffReviews,
        skippedHandoff: companyResult.skippedHandoff,
      },
    });
  } catch (err) {
    log.error({ err, companyId }, "Failed to persist report delivery scheduler scan telemetry");
  }
}

export async function scanDueReportDeliveries(
  now = new Date()
): Promise<ReportDeliverySchedulerResult> {
  const result = emptyResult();
  const companies = await storage.getAllCompanies();
  result.scannedCompanies = companies.length;

  const automations = await import("../platform/company-automations");
  const switchedOff = await automations.companiesWithAutomationOff("reportDeliveries");
  for (const company of companies) {
    // WQ7: a company that switched "Report deliveries" off in Automations is not scanned.
    if (switchedOff.has(String(company.id))) continue;
    const companyResult = emptyCompanyScanResult(now);
    try {
      const settings = await storage.getReportDeliverySubscriptionSettings(company.id);
      const plans = getReportDeliveryPlans({ now, settings });
      const recentRuns = await storage.getReportDeliveryRuns(company.id, { limit: 200 });
      let actorUserId: string | null | undefined;

      for (const plan of plans) {
        companyResult.scannedSubscriptions += 1;
        const latestRun = latestRunForSubscription(recentRuns, plan.id);
        const decision = getReportDeliveryScheduleDecision(plan, latestRun, now);

        if (!decision.shouldQueue) {
          if (decision.reason !== "due") {
            countSkip(companyResult, decision.reason);
            companyResult.skippedSubscriptionIds[decision.reason].push(plan.id);
          }
          continue;
        }

        companyResult.dueSubscriptionIds.push(plan.id);
        const handoffReview = buildReportDeliveryHandoffReview({
          plan,
          latestRun,
        });
        if (handoffReview) {
          companyResult.skippedHandoff += 1;
          companyResult.skippedSubscriptionIds.handoff.push(plan.id);
          companyResult.handoffReviews.push({
            subscriptionId: plan.id,
            ...handoffReview,
          });
          continue;
        }

        if (actorUserId === undefined) {
          actorUserId = await storage.resolveCompanyActorUserId(company.id);
        }

        if (!actorUserId) {
          companyResult.skippedNoActor += 1;
          companyResult.skippedSubscriptionIds.no_actor.push(plan.id);
          continue;
        }

        let createdRunId: string | null = null;
        try {
          const queuedRun = await storage.createReportDeliveryRun(
            buildReportDeliveryRunInput({
              companyId: company.id,
              queuedBy: actorUserId,
              plan,
              scheduledFor: decision.scheduledFor,
            })
          );
          createdRunId = queuedRun.id;

          // W5-A (R12-01): render the pack and email it; the run records what happened.
          const executed = await executeReportDeliveryRun({
            companyId: company.id,
            runId: queuedRun.id,
            plan,
            now,
          });
          companyResult.queuedRuns += 1;
          companyResult.queuedSubscriptionIds.push(plan.id);
          try {
            const notification = await createAndEmitNotification(
              buildReportDeliveryNotificationForPlan({
                userId: actorUserId,
                companyId: company.id,
                plan,
                scheduledFor: decision.scheduledFor,
                run: executed,
              })
            );
            if (notification?.id) {
              await setRunNotification(company.id, executed.id, notification.id);
            }
          } catch (notifyErr) {
            log.warn(
              { err: notifyErr, companyId: company.id, subscriptionId: plan.id },
              "Scheduled report delivery notification failed"
            );
          }
        } catch (err) {
          const message = errorMessage(err);
          companyResult.status = "error";
          companyResult.errors += 1;
          companyResult.message = companyResult.message ?? message;
          log.error(
            { err, companyId: company.id, subscriptionId: plan.id },
            "Failed to queue scheduled report delivery"
          );

          try {
            // The executor records its own failures on the run it was given; only a run
            // that was never created needs a failed row here.
            if (!createdRunId)
              await storage.createReportDeliveryRun(
                buildReportDeliveryRunInput({
                  companyId: company.id,
                  queuedBy: actorUserId,
                  plan,
                  status: "failed",
                  errorMessage: message,
                  scheduledFor: decision.scheduledFor,
                })
              );
          } catch (recordErr) {
            log.error(
              { err: recordErr, companyId: company.id, subscriptionId: plan.id },
              "Failed to persist scheduled report delivery failure"
            );
          }
        }
      }
    } catch (err) {
      companyResult.status = "error";
      companyResult.errors += 1;
      companyResult.message = errorMessage(err);
      log.error({ err, companyId: company.id }, "Failed to scan report delivery subscriptions");
    } finally {
      companyResult.finishedAt = new Date();
      addCompanyScanResult(result, companyResult);
      await recordCompanySchedulerScan(company.id, companyResult);
      if (companyResult.scannedSubscriptions > 0) {
        await automations.recordAutomationRun(
          "reportDeliveries",
          company.id,
          companyResult.status === "error" ? "failed" : "ok",
          { sent: companyResult.queuedRuns, scanned: companyResult.scannedSubscriptions },
          companyResult.status === "error" ? (companyResult.message ?? null) : null
        );
      }
    }
  }

  if (result.queuedRuns > 0 || result.errors > 0) {
    log.info(result, "Report delivery scheduler scan complete");
  }

  return result;
}
