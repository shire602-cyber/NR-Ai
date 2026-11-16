import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../config/logger";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { createAndEmitNotification } from "../services/socket.service";
import { strictBody } from "../http/strict-body";
import { requirePermission } from "../middleware/companyRolePolicy";
import { isCapabilityLive } from "../../shared/capabilities";
import { activeProviderName } from "../outbox";
import {
  buildReportDeliveryHandoffReview,
  buildReportDeliveryNotificationForPlan,
  buildReportDeliveryNotificationInput,
  buildReportDeliveryRunInput,
  getReportDeliveryPlan,
  getReportDeliveryPlans,
  isReportDeliveryPersona,
  mentionsGoogleSheets,
  type ReportDeliveryPlan,
} from "../services/report-delivery.service";
import {
  cancelPendingRunEmails,
  executeReportDeliveryRun,
  getRunArtifact,
  listRunArtifacts,
  parseRecipientEmails,
  refreshReportDeliveryRuns,
  setRunNotification,
} from "../services/report-render/delivery";
import type { CompanyReportDeliveryRun } from "../../shared/schema";

const log = createLogger("report-delivery-routes");

const reportDeliveryQuerySchema = z.object({
  persona: z
    .string()
    .optional()
    .refine((value) => value === undefined || isReportDeliveryPersona(value), {
      message: "persona must be owner, freelancer, or accountant",
    }),
});

const optionalOverride = z.string().trim().min(1).max(500).nullable().optional();

const reportDeliverySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    cadence: optionalOverride,
    channel: optionalOverride,
    format: optionalOverride,
    recipients: optionalOverride,
    deliveryGuardrail: optionalOverride,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one setting must be provided",
  });

const reportDeliveryRunsQuerySchema = z.object({
  subscriptionId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const reportDeliverySchedulerHealthQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const reportDeliveryAutomationPreferenceSchema = z.object({
  preferredDeliveryAutomationCommand: z.enum(["retry", "review", "queue", "comparison"]).nullable(),
});

const reportDeliveryQueueSchema = z.object({
  acknowledgeHandoffGaps: z.boolean().optional(),
});

/**
 * Execute a just-created run (render -> store -> email) and add the outcome notification.
 * The notification is an extra signal; the run row is the delivery record.
 */
async function executeAndNotify(input: {
  userId: string;
  companyId: string;
  plan: ReportDeliveryPlan;
  run: CompanyReportDeliveryRun;
  scheduledFor?: Date;
}): Promise<{ run: CompanyReportDeliveryRun; notification: unknown }> {
  const executed = await executeReportDeliveryRun({
    companyId: input.companyId,
    runId: input.run.id,
    plan: input.plan,
  });
  let notification: { id?: string } | null = null;
  try {
    notification = (await createAndEmitNotification(
      buildReportDeliveryNotificationForPlan({
        userId: input.userId,
        companyId: input.companyId,
        plan: input.plan,
        scheduledFor: input.scheduledFor,
        run: executed,
      })
    )) as { id?: string };
  } catch (error) {
    log.warn({ err: error, runId: executed.id }, "Report delivery notification failed");
  }
  const run = notification?.id
    ? await setRunNotification(input.companyId, executed.id, notification.id)
    : executed;
  return { run: run ?? executed, notification };
}

function optionalReportDeliveryStorageErrorCode(error: unknown): string | null {
  let current = error as { code?: unknown; cause?: unknown } | null | undefined;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = current.cause as { code?: unknown; cause?: unknown } | null | undefined;
  }
  return null;
}

function isOptionalReportDeliveryStorageError(error: unknown): boolean {
  const code = optionalReportDeliveryStorageErrorCode(error);
  return code === "42P01" || code === "42703";
}

async function readOptionalReportDeliveryStorage<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isOptionalReportDeliveryStorageError(error)) throw error;
    log.warn(
      { err: error, label },
      "Report delivery optional storage is unavailable; using catalog fallback"
    );
    return fallback;
  }
}

export function registerReportDeliveryRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/report-delivery/subscriptions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliveryQuerySchema.parse(req.query);
      const settings = await readOptionalReportDeliveryStorage(
        "subscription settings",
        () => storage.getReportDeliverySubscriptionSettings(companyId),
        []
      );
      const subscriptions = getReportDeliveryPlans({
        persona: isReportDeliveryPersona(query.persona) ? query.persona : null,
        settings,
      });

      res.json({ subscriptions });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/runs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliveryRunsQuerySchema.parse(req.query);
      if (query.subscriptionId && !getReportDeliveryPlan(query.subscriptionId)) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      const runs = await readOptionalReportDeliveryStorage(
        "delivery runs",
        async () =>
          refreshReportDeliveryRuns(
            await storage.getReportDeliveryRuns(companyId, {
              subscriptionId: query.subscriptionId,
              limit: query.limit,
            })
          ),
        []
      );

      res.json({ runs });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/scheduler-health",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliverySchedulerHealthQuerySchema.parse(req.query);
      const [latestScan, recentScans] = await Promise.all([
        readOptionalReportDeliveryStorage(
          "latest scheduler scan",
          () => storage.getLatestReportDeliverySchedulerScan(companyId),
          null
        ),
        readOptionalReportDeliveryStorage(
          "scheduler scans",
          () => storage.getReportDeliverySchedulerScans(companyId, { limit: query.limit ?? 5 }),
          []
        ),
      ]);

      res.json({ latestScan: latestScan ?? null, recentScans });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/preferences",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const preferences = await readOptionalReportDeliveryStorage(
        "automation preferences",
        () => storage.getReportAutomationPreferences(companyId, userId),
        []
      );

      res.json({ preferences });
    })
  );

  app.patch(
    "/api/companies/:companyId/report-delivery/preferences/:persona",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, persona } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
      if (!isReportDeliveryPersona(persona)) {
        return res
          .status(400)
          .json({ message: "persona must be owner, freelancer, or accountant" });
      }

      const body = reportDeliveryAutomationPreferenceSchema.parse(req.body);
      const preference = await storage.upsertReportAutomationPreference({
        companyId,
        userId,
        persona,
        preferredDeliveryAutomationCommand: body.preferredDeliveryAutomationCommand,
      });

      res.json({ preference });
    })
  );

  app.patch(
    "/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/settings",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, subscriptionId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      if (!getReportDeliveryPlan(subscriptionId)) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      const body = reportDeliverySettingsSchema.parse(req.body);
      if (
        body.channel &&
        mentionsGoogleSheets(body.channel) &&
        !isCapabilityLive("google_sheets")
      ) {
        return res.status(422).json({
          code: "GOOGLE_SHEETS_NOT_CONFIGURED",
          message:
            "Google Sheets delivery is not available: the Google Sheets integration is not configured. Reports are delivered by email with PDF and Excel attachments.",
        });
      }
      if (
        body.recipients &&
        body.recipients.includes("@") &&
        !parseRecipientEmails(body.recipients).length
      ) {
        return res.status(422).json({
          code: "INVALID_RECIPIENTS",
          message: "Recipients must be valid email addresses separated by commas.",
        });
      }
      const setting = await storage.upsertReportDeliverySubscriptionSetting({
        companyId,
        subscriptionId,
        enabled: body.enabled,
        cadenceOverride: body.cadence,
        channelOverride: body.channel,
        formatOverride: body.format,
        recipientsOverride: body.recipients,
        deliveryGuardrailOverride: body.deliveryGuardrail,
        createdBy: userId,
        updatedBy: userId,
      });

      const subscription = getReportDeliveryPlan(subscriptionId, new Date(), [setting]);

      res.json({ setting, subscription });
    })
  );

  app.post(
    "/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/queue",
    authMiddleware,
    strictBody(reportDeliveryQueueSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, subscriptionId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const body = reportDeliveryQueueSchema.parse(req.body ?? {});
      const settings = await storage.getReportDeliverySubscriptionSettings(companyId);
      const delivery = buildReportDeliveryNotificationInput({
        userId,
        companyId,
        subscriptionId,
        settings,
      });

      if (!delivery) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      if (!delivery.plan.enabled) {
        return res.status(409).json({ message: "Report delivery subscription is paused" });
      }

      const latestRuns = await storage.getReportDeliveryRuns(companyId, {
        subscriptionId,
        limit: 1,
      });
      const handoffReview = buildReportDeliveryHandoffReview({
        plan: delivery.plan,
        latestRun: latestRuns[0] ?? null,
      });

      if (handoffReview && !body.acknowledgeHandoffGaps) {
        return res.status(409).json({
          message: handoffReview.message,
          handoffReview,
        });
      }

      const queuedRun = await storage.createReportDeliveryRun(
        buildReportDeliveryRunInput({
          companyId,
          queuedBy: userId,
          plan: delivery.plan,
          scheduledFor: new Date(),
        })
      );
      const { run, notification } = await executeAndNotify({
        userId,
        companyId,
        plan: delivery.plan,
        run: queuedRun,
        scheduledFor: new Date(),
      });

      res.status(201).json({
        subscription: delivery.plan,
        notification,
        run,
      });
    })
  );

  app.post(
    "/api/companies/:companyId/report-delivery/runs/:runId/retry",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { companyId, runId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const failedRun = await storage.getReportDeliveryRun(companyId, runId);
      if (!failedRun) return res.status(404).json({ message: "Report delivery run not found" });
      if (failedRun.status !== "failed" && failedRun.status !== "blocked") {
        return res
          .status(409)
          .json({ message: "Only failed or blocked report delivery runs can be retried" });
      }

      const settings = await storage.getReportDeliverySubscriptionSettings(companyId);
      const delivery = buildReportDeliveryNotificationInput({
        userId,
        companyId,
        subscriptionId: failedRun.subscriptionId,
        settings,
        scheduledFor: new Date(),
      });

      if (!delivery) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      if (!delivery.plan.enabled) {
        return res.status(409).json({ message: "Report delivery subscription is paused" });
      }

      if (delivery.plan.status !== "ready") {
        return res.status(409).json({ message: "Report delivery subscription needs setup" });
      }

      // A manual retry supersedes the outbox's own retries of the old run (no double send).
      await cancelPendingRunEmails(failedRun);
      const queuedRun = await storage.createReportDeliveryRun(
        buildReportDeliveryRunInput({
          companyId,
          queuedBy: userId,
          plan: delivery.plan,
          retriedFromRunId: failedRun.id,
          scheduledFor: new Date(),
        })
      );
      const { run, notification } = await executeAndNotify({
        userId,
        companyId,
        plan: delivery.plan,
        run: queuedRun,
        scheduledFor: new Date(),
      });

      res.status(201).json({
        subscription: delivery.plan,
        notification,
        run,
        retriedFromRun: failedRun,
      });
    })
  );

  // Delivery channels the server can really use right now (R12-01).
  app.get(
    "/api/companies/:companyId/report-delivery/channels",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (_req: Request, res: Response) => {
      const provider = activeProviderName();
      res.json({
        email: { available: !!provider, provider: provider ?? null },
        googleSheets: { available: isCapabilityLive("google_sheets") },
      });
    })
  );

  // Rendered files of a run (delivery log): list and download.
  app.get(
    "/api/companies/:companyId/report-delivery/runs/:runId/artifacts",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, runId } = req.params;
      const run = await storage.getReportDeliveryRun(companyId, runId);
      if (!run) return res.status(404).json({ code: "NOT_FOUND", message: "Not found" });
      const artifacts = await listRunArtifacts(companyId, runId);
      res.json({
        artifacts: artifacts.map((a) => ({
          ...a,
          href: `/api/companies/${companyId}/report-delivery/runs/${runId}/artifacts/${a.id}`,
        })),
      });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/runs/:runId/artifacts/:artifactId",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, runId, artifactId } = req.params;
      const artifact = await getRunArtifact(companyId, runId, artifactId);
      if (!artifact) return res.status(404).json({ code: "NOT_FOUND", message: "Not found" });
      res.setHeader("Content-Type", artifact.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${artifact.filename.replace(/[^A-Za-z0-9._-]+/g, "-")}"`
      );
      res.send(
        Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(artifact.content)
      );
    })
  );
}
