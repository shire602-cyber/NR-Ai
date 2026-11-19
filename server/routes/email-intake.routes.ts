import type { Express, Request, Response } from "express";
import { chaseRequestsBody } from "../../shared/validators/route-bodies";
import { z } from "zod";

import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { requireFirmRole } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { resolveAccessibleClientIds } from "../services/firm-command-center.service";
import { normalizeEmail } from "../services/email-intake";
import {
  isEmailIntakeEnabled,
  isEmailIntakeConfigured,
  getEmailIntakeStatus,
} from "../services/email-intake-provider";
import { pollEmailIntakeOnce } from "../services/email-intake-poller.service";
import { computeCompletenessGaps, type BankLine } from "../services/intake-completeness";
import { createChaseRequestsFromGaps } from "../services/intake-chasing";
import { verifyInboundSignature, parseInboundEmail } from "../services/email-intake-webhook";
import { ingestRawMessages } from "../services/email-intake-poller.service";
import { getEnv } from "../config/env";
import type { EmailSourceRef } from "../services/email-intake";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { zDate } from "../../shared/validators/primitives";
import {
  createTaskFromIntakeMessage,
  createTasksForUntriagedMessages,
  intakeMessageCompany,
  tasksForMessages,
} from "../services/firm/email-tasks.service";

const log = createLogger("email-intake-routes");

const createSourceBody = z.object({
  companyId: z.string().guid(),
  senderEmail: z.string().email(),
  label: z.string().max(120).optional(),
  requireDkimPass: z.boolean().optional(),
});

/** Email-to-task (S4): turn an ingested client email into a practice task. */
const emailTaskBody = z
  .object({
    dueDate: zDate.optional(),
    title: z.string().trim().min(3).max(300).optional(),
    assigneeUserId: z.string().guid().nullable().optional(),
  })
  .strict();

/**
 * Honest boundary for email-to-task: tasks are created automatically for
 * every stored message, but messages only arrive through an external mailbox
 * or inbound-email provider that the deployment must connect.
 */
function emailToTaskStatus() {
  const configured = isEmailIntakeConfigured();
  const enabled = isEmailIntakeEnabled();
  return {
    automatic: true,
    mailbox: !enabled ? "disabled" : configured ? "connected" : "requires_external",
    note: {
      en: "Each stored client email becomes a review task in Practice → Tasks. Emails only arrive once an external mailbox or inbound-email provider is connected (EMAIL_INTAKE_* settings); nothing is fetched otherwise.",
      ar: "تتحول كل رسالة بريد من العميل يتم حفظها إلى مهمة مراجعة في الممارسة ← المهام. لا تصل الرسائل إلا بعد ربط صندوق بريد خارجي أو مزوّد بريد وارد (إعدادات EMAIL_INTAKE_*)؛ وإلا فلا يتم جلب أي شيء.",
    },
  };
}

const updateSourceBody = z
  .object({
    status: z.enum(["active", "paused"]).optional(),
    label: z.string().max(120).optional(),
    requireDkimPass: z.boolean().optional(),
  })
  .strict();

/** Load a company's bank transactions as the BankLine shape the completeness math expects. */
async function loadBankLines(companyId: string): Promise<BankLine[]> {
  const txns = await storage.getBankTransactionsByCompanyId(companyId);
  return txns.map((t) => ({
    id: t.id,
    transactionDate: t.transactionDate,
    amount: Number(t.amount),
    description: t.description,
    matchStatus: (t.matchStatus as BankLine["matchStatus"]) ?? "unmatched",
    matchedReceiptId: t.matchedReceiptId,
    matchedInvoiceId: t.matchedInvoiceId,
  }));
}

/**
 * Firm-internal email document intake (pilot). Every route is gated by
 * requireFirmRole — SaaS customers and portal users are rejected even by URL
 * guessing. The feature itself is additionally flagged by EMAIL_INTAKE_ENABLED.
 */
export function registerEmailIntakeRoutes(app: Express) {
  // ── Public inbound-email webhook (no auth — verified by HMAC signature) ─────
  // The email provider POSTs parsed emails + attachments here. The raw body is
  // provided by a dedicated express.raw mount (see index.ts) so we can verify
  // the signature over the exact bytes.
  app.post(
    "/api/webhooks/email-intake",
    asyncHandler(async (req: Request, res: Response) => {
      if (!isEmailIntakeEnabled()) {
        return res.status(503).json({ message: "Email intake is not enabled" });
      }
      const secret = getEnv().EMAIL_INTAKE_WEBHOOK_SECRET;
      const signature =
        (req.headers["x-email-intake-signature"] as string | undefined) ??
        (req.headers["x-webhook-signature"] as string | undefined);
      const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!verifyInboundSignature(rawBody, signature, secret)) {
        return res.status(401).json({ message: "Invalid signature" });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ message: "Invalid JSON body" });
      }

      const messages = parseInboundEmail(payload);
      if (messages.length === 0) {
        return res.status(202).json({ ingested: false, reason: "no_parseable_message" });
      }

      const sources = await storage.listAllActiveEmailSources();
      const refs: EmailSourceRef[] = sources.map((s) => ({
        id: s.id,
        companyId: s.companyId,
        senderEmail: s.senderEmail,
        status: s.status as EmailSourceRef["status"],
        requireDkimPass: s.requireDkimPass,
      }));

      const summary = await ingestRawMessages({ raw: messages, refs });
      // Email-to-task (S4): one review task per newly stored message.
      const tasks = await createTasksForUntriagedMessages({
        companyIds: [...new Set(refs.map((r) => r.companyId))],
        since: new Date(Date.now() - 60 * 60 * 1000),
      });
      log.info({ summary, tasksCreated: tasks.created }, "inbound email webhook processed");
      res.json({ ...summary, tasksCreated: tasks.created });
    })
  );

  // Honest capture status for the UI.
  app.get(
    "/api/firm/email-intake/status",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ ...getEmailIntakeStatus(), emailToTask: emailToTaskStatus() });
    })
  );

  // List the firm's sender→company mappings.
  app.get(
    "/api/firm/email-intake/sources",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = req.user!.id as string;
      const sources = await storage.listClientEmailSourcesByFirm(firmId);
      res.json({
        sources,
        featureEnabled: isEmailIntakeEnabled(),
        mailboxConfigured: isEmailIntakeConfigured(),
        // Honest capture status: disabled | requires_configuration | enabled (R05-19a).
        intake: getEmailIntakeStatus(),
        emailToTask: emailToTaskStatus(),
      });
    })
  );

  // Link a sender address to a client company.
  app.post(
    "/api/firm/email-intake/sources",
    authMiddleware,
    requireFirmRole(),
    validate({ body: createSourceBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const { companyId, senderEmail, label, requireDkimPass } = req.body;

      // Ownership: the company must be one the firm can access.
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed) {
        return res.status(403).json({ message: "Company not in your firm's client list" });
      }

      const created = await storage.createClientEmailSource({
        companyId,
        firmId: user.id,
        senderEmail: normalizeEmail(senderEmail),
        label: label ?? null,
        status: "active",
        requireDkimPass: requireDkimPass ?? true,
        createdBy: user.id,
      });

      await recordAudit({
        userId: user.id,
        companyId,
        action: "email_intake_source.create",
        entityType: "client_email_source",
        entityId: created.id,
        after: { senderEmail: created.senderEmail },
        req,
      });
      res.status(201).json(created);
    })
  );

  // Pause / relabel / toggle DKIM requirement.
  app.patch(
    "/api/firm/email-intake/sources/:id",
    authMiddleware,
    requireFirmRole(),
    strictBody(updateSourceBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = req.user!.id as string;
      const patch = parsedBody<z.output<typeof updateSourceBody>>(req);
      const updated = await storage.updateClientEmailSource(req.params.id, firmId, patch);
      if (!updated)
        return res.status(404).json({ message: "Source not found", code: "SOURCE_NOT_FOUND" });
      res.json(updated);
    })
  );

  // Remove a mapping.
  app.delete(
    "/api/firm/email-intake/sources/:id",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = req.user!.id as string;
      const ok = await storage.deleteClientEmailSource(req.params.id, firmId);
      if (!ok)
        return res.status(404).json({ message: "Source not found", code: "SOURCE_NOT_FOUND" });
      await recordAudit({
        userId: firmId,
        action: "email_intake_source.delete",
        entityType: "client_email_source",
        entityId: req.params.id,
        req,
      });
      res.status(204).end();
    })
  );

  // Recently ingested messages for a client company (review surface seed).
  app.get(
    "/api/firm/email-intake/messages/:companyId",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const allowed = await storage.hasCompanyAccess(user.id, req.params.companyId, user.firmRole);
      if (!allowed)
        return res.status(403).json({ message: "Company not in your firm's client list" });
      const messages = await storage.listEmailIntakeMessagesByCompany(req.params.companyId);
      const taskIds = await tasksForMessages(messages.map((m: { id: string }) => m.id));
      res.json({
        messages: messages.map((m: { id: string }) => ({
          ...m,
          taskId: taskIds.get(m.id) ?? null,
        })),
        emailToTask: emailToTaskStatus(),
      });
    })
  );

  // Email-to-task (S4, R15-15): create (or return) the review task for a message.
  app.post(
    "/api/firm/email-intake/messages/:messageId/task",
    authMiddleware,
    requireFirmRole(),
    strictBody(emailTaskBody),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const companyId = await intakeMessageCompany(req.params.messageId);
      if (!companyId)
        return res.status(404).json({ message: "Message not found", code: "MESSAGE_NOT_FOUND" });
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed)
        return res.status(404).json({ message: "Message not found", code: "MESSAGE_NOT_FOUND" });
      const body = parsedBody<z.output<typeof emailTaskBody>>(req);
      const { task, created } = await createTaskFromIntakeMessage(req.params.messageId, {
        actorId: user.id,
        dueDate: body.dueDate,
        title: body.title,
        assigneeUserId: body.assigneeUserId ?? null,
      });
      if (created) {
        await recordAudit({
          userId: user.id,
          companyId,
          action: "email_intake.task_create",
          entityType: "firm_task",
          entityId: task.id,
          after: { sourceKey: task.sourceKey, dueDate: task.dueDate },
          req,
        });
      }
      res.status(created ? 201 : 200).json({ task, created });
    })
  );

  // Completeness check for a client/period: which bank lines moved money with no
  // supporting document yet (what to chase / verify before filing the return).
  app.get(
    "/api/firm/email-intake/completeness/:companyId",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const { companyId } = req.params;
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed)
        return res.status(403).json({ message: "Company not in your firm's client list" });

      const periodStart = new Date(String(req.query.periodStart ?? ""));
      const periodEnd = new Date(String(req.query.periodEnd ?? ""));
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res
          .status(400)
          .json({ message: "periodStart and periodEnd (ISO dates) are required" });
      }

      const lines = await loadBankLines(companyId);
      res.json(computeCompletenessGaps({ lines, periodStart, periodEnd }));
    })
  );

  // Raise document-chasing requests for the period's completeness gaps (idempotent
  // — bank lines already being chased are skipped).
  app.post(
    "/api/firm/email-intake/completeness/:companyId/chase",
    authMiddleware,
    requireFirmRole(),
    strictBody(chaseRequestsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      const { companyId } = req.params;
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed)
        return res.status(403).json({ message: "Company not in your firm's client list" });

      const chaseBody = parsedBody<{
        periodStart?: string;
        periodEnd?: string;
        dueDate?: string | null;
      }>(req);
      const periodStart = new Date(String(chaseBody.periodStart ?? ""));
      const periodEnd = new Date(String(chaseBody.periodEnd ?? ""));
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res
          .status(400)
          .json({ message: "periodStart and periodEnd (ISO dates) are required" });
      }
      // Default the chase due date to two weeks after period end unless overridden.
      const dueDate = chaseBody.dueDate
        ? new Date(String(chaseBody.dueDate))
        : new Date(periodEnd.getTime() + 14 * 86400000);

      const lines = await loadBankLines(companyId);
      const { gaps } = computeCompletenessGaps({ lines, periodStart, periodEnd });
      const result = await createChaseRequestsFromGaps(companyId, gaps, { dueDate });

      await recordAudit({
        userId: user.id,
        companyId,
        action: "email_intake.chase_gaps",
        entityType: "company",
        entityId: companyId,
        extra: { created: result.created, skipped: result.skipped },
        req,
      });
      res.json(result);
    })
  );

  // Manual poll trigger (also driven by the scheduler later). No-op + clear
  // reason when the feature is off or no mailbox is connected.
  app.post(
    "/api/firm/email-intake/poll",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const user = req.user!;
      if (!isEmailIntakeEnabled()) {
        return res.json({ ran: false, reason: "feature_disabled" });
      }
      const companyIds = await resolveAccessibleClientIds(user.id, user.firmRole);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h window
      const summary = await pollEmailIntakeOnce({ accessibleCompanyIds: companyIds, since });
      const tasks = await createTasksForUntriagedMessages({ companyIds, since });
      log.info({ firmId: user.id, summary, tasksCreated: tasks.created }, "manual intake poll");
      res.json({ ...summary, tasksCreated: tasks.created });
    })
  );
}
