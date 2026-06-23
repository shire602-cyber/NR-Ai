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

/**
 * Firm-internal email document intake (pilot). Every route is gated by
 * requireFirmRole — SaaS customers and portal users are rejected even by URL
 * guessing. The feature itself is additionally flagged by EMAIL_INTAKE_ENABLED.
 */
export function registerEmailIntakeRoutes(app: Express) {
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
