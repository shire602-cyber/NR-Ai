import type { Express, Request, Response } from "express";
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
import { isEmailIntakeEnabled, isEmailIntakeConfigured } from "../services/email-intake-provider";
import { pollEmailIntakeOnce } from "../services/email-intake-poller.service";
import { computeCompletenessGaps, type BankLine } from "../services/intake-completeness";
import { createChaseRequestsFromGaps } from "../services/intake-chasing";
import { verifyInboundSignature, parseInboundEmail } from "../services/email-intake-webhook";
import { ingestRawMessages } from "../services/email-intake-poller.service";
import { getEnv } from "../config/env";
import type { EmailSourceRef } from "../services/email-intake";

const log = createLogger("email-intake-routes");

const createSourceBody = z.object({
  companyId: z.string().uuid(),
  senderEmail: z.string().email(),
  label: z.string().max(120).optional(),
  requireDkimPass: z.boolean().optional(),
});

const updateSourceBody = z.object({
  status: z.enum(["active", "paused"]).optional(),
  label: z.string().max(120).optional(),
  requireDkimPass: z.boolean().optional(),
});

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
      log.info({ summary }, "inbound email webhook processed");
      res.json(summary);
    })
  );

  // List the firm's sender→company mappings.
  app.get(
    "/api/firm/email-intake/sources",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = (req as any).user.id as string;
      const sources = await storage.listClientEmailSourcesByFirm(firmId);
      res.json({ sources, featureEnabled: isEmailIntakeEnabled(), mailboxConfigured: isEmailIntakeConfigured() });
    })
  );

  // Link a sender address to a client company.
  app.post(
    "/api/firm/email-intake/sources",
    authMiddleware,
    requireFirmRole(),
    validate({ body: createSourceBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const user = (req as any).user;
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
      } as any);

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
    validate({ body: updateSourceBody }),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = (req as any).user.id as string;
      const updated = await storage.updateClientEmailSource(req.params.id, firmId, req.body);
      if (!updated) return res.status(404).json({ message: "Source not found" });
      res.json(updated);
    })
  );

  // Remove a mapping.
  app.delete(
    "/api/firm/email-intake/sources/:id",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const firmId = (req as any).user.id as string;
      const ok = await storage.deleteClientEmailSource(req.params.id, firmId);
      if (!ok) return res.status(404).json({ message: "Source not found" });
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
      const user = (req as any).user;
      const allowed = await storage.hasCompanyAccess(user.id, req.params.companyId, user.firmRole);
      if (!allowed) return res.status(403).json({ message: "Company not in your firm's client list" });
      const messages = await storage.listEmailIntakeMessagesByCompany(req.params.companyId);
      res.json({ messages });
    })
  );

  // Completeness check for a client/period: which bank lines moved money with no
  // supporting document yet (what to chase / verify before filing the return).
  app.get(
    "/api/firm/email-intake/completeness/:companyId",
    authMiddleware,
    requireFirmRole(),
    asyncHandler(async (req: Request, res: Response) => {
      const user = (req as any).user;
      const { companyId } = req.params;
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed) return res.status(403).json({ message: "Company not in your firm's client list" });

      const periodStart = new Date(String(req.query.periodStart ?? ""));
      const periodEnd = new Date(String(req.query.periodEnd ?? ""));
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res.status(400).json({ message: "periodStart and periodEnd (ISO dates) are required" });
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
    asyncHandler(async (req: Request, res: Response) => {
      const user = (req as any).user;
      const { companyId } = req.params;
      const allowed = await storage.hasCompanyAccess(user.id, companyId, user.firmRole);
      if (!allowed) return res.status(403).json({ message: "Company not in your firm's client list" });

      const periodStart = new Date(String(req.body?.periodStart ?? ""));
      const periodEnd = new Date(String(req.body?.periodEnd ?? ""));
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res.status(400).json({ message: "periodStart and periodEnd (ISO dates) are required" });
      }
      // Default the chase due date to two weeks after period end unless overridden.
      const dueDate = req.body?.dueDate ? new Date(String(req.body.dueDate)) : new Date(periodEnd.getTime() + 14 * 86400000);

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
      const user = (req as any).user;
      if (!isEmailIntakeEnabled()) {
        return res.json({ ran: false, reason: "feature_disabled" });
      }
      const companyIds = await resolveAccessibleClientIds(user.id, user.firmRole);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h window
      const summary = await pollEmailIntakeOnce({ accessibleCompanyIds: companyIds, since });
      log.info({ firmId: user.id, summary }, "manual intake poll");
      res.json(summary);
    })
  );
}
