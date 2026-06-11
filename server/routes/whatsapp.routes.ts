import { type Express, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { whatsappBridgeJobs, whatsappBridgeSessions, whatsappMessages } from "../../shared/schema";
import {
  WHATSAPP_BRIDGE_PROVIDER,
  bridgeStatusUpdateSchema,
  cleanBridgeJobMetadata,
  createBridgeJobSchema,
  createBridgeSessionSchema,
  normalizeWhatsAppBridgePhone,
} from "../services/whatsapp-bridge.service";

const log = createLogger("whatsapp");

const sessionIdSchema = z.object({ sessionId: z.string().uuid() });
const jobIdSchema = z.object({ jobId: z.string().uuid() });
const messageIdSchema = z.object({ messageId: z.string().uuid() });
const messageStatusUpdateSchema = z.object({
  status: z.enum(["sent_unverified", "failed"]),
  errorMessage: z.string().max(1000).optional(),
});

async function resolveCompanyId(req: Request, requestedCompanyId?: string): Promise<string | null> {
  const userId = (req as any).user?.id as string | undefined;
  const firmRole = ((req as any).user?.firmRole ?? null) as string | null;
  if (!userId) return null;

  if (requestedCompanyId) {
    const hasAccess = await storage.hasCompanyAccess(userId, requestedCompanyId, firmRole);
    if (!hasAccess) return null;
    return requestedCompanyId;
  }

  const companies = await storage.getCompaniesByUserId(userId);
  return companies[0]?.id ?? null;
}

function sessionExpiry(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function personalWhatsAppStatusPayload() {
  return {
    connected: true,
    configured: true,
    mode: "personal",
    deliveryMode: "personal_link",
    deliveryStatus: "logged_only",
  };
}

/**
 * WhatsApp Routes (Personal WhatsApp via WhatsApp Web links)
 *
 * Messages are prepared by opening WhatsApp Web draft links on the client side.
 * The backend only logs prepared messages for history/tracking; it cannot
 * confirm delivery unless a real WhatsApp provider is connected.
 */
export function registerWhatsAppRoutes(app: Express) {
  // Log a prepared personal WhatsApp deep-link message.
  app.post(
    "/api/integrations/whatsapp/log-message",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { to, message } = req.body;
      if (!to || !message) {
        return res.status(400).json({ message: "Phone number and message are required" });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: "No company found" });
      }

      const companyId = companies[0].id;

      const waMessageId = `personal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const logged = await storage.createWhatsappMessage({
        companyId,
        waMessageId,
        from: "personal",
        to: String(to).trim(),
        messageType: "text",
        content: String(message).slice(0, 5000),
        direction: "outbound",
        status: "logged",
      });

      log.info(`WhatsApp personal-link message logged for company ${companyId} to ${to}`);
      res.json({ success: true, id: logged.id, deliveryStatus: "logged_only" });
    })
  );

  // Get WhatsApp message history
  app.get(
    "/api/integrations/whatsapp/messages",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: "No company found" });
      }

      const companyId = companies[0].id;
      const messages = await storage.getWhatsappMessagesByCompanyId(companyId);
      res.json(messages);
    })
  );

  app.patch(
    "/api/integrations/whatsapp/messages/:messageId/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { messageId } = messageIdSchema.parse(req.params);
      const validated = messageStatusUpdateSchema.parse(req.body);
      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: "No company found" });
      }

      const now = new Date();
      const [message] = await db
        .update(whatsappMessages)
        .set({
          status: validated.status,
          errorMessage: validated.errorMessage || null,
          processedAt: now,
        })
        .where(
          and(
            eq(whatsappMessages.id, messageId),
            eq(whatsappMessages.companyId, companies[0].id),
            eq(whatsappMessages.direction, "outbound")
          )
        )
        .returning();

      if (!message) {
        return res.status(404).json({ message: "WhatsApp message not found" });
      }

      await db
        .update(whatsappBridgeJobs)
        .set({
          status: validated.status,
          deliveryStatus: validated.status,
          errorMessage: validated.errorMessage || null,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(whatsappBridgeJobs.whatsappMessageId, messageId),
            eq(whatsappBridgeJobs.createdBy, userId)
          )
        );

      log.info(
        { messageId, status: validated.status },
        "WhatsApp message status confirmed by user"
      );
      res.json({ message });
    })
  );

  // Personal WhatsApp links need no provider setup, but delivery is confirmed inside WhatsApp.
  app.get(
    "/api/integrations/whatsapp/config",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        configured: true,
        isActive: true,
        mode: "personal",
        deliveryMode: "personal_link",
        deliveryStatus: "logged_only",
      });
    })
  );

  // Get WhatsApp integration status (for dashboard/integrations page)
  app.get(
    "/api/integrations/whatsapp/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(personalWhatsAppStatusPayload());
    })
  );

  // Backwards-compatible status URL for old bookmarks/manual checks.
  app.get(
    "/api/whatsapp/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(personalWhatsAppStatusPayload());
    })
  );

  // WhatsApp Web Bridge status. The bridge is extension-assisted and still
  // human-confirmed inside WhatsApp Web; no provider delivery receipts exist.
  app.get(
    "/api/integrations/whatsapp/bridge/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const companyId = await resolveCompanyId(req, req.query.companyId as string | undefined);
      if (!companyId) return res.status(404).json({ message: "No accessible company found" });

      const now = new Date();
      const activeSessions = await db
        .select()
        .from(whatsappBridgeSessions)
        .where(
          and(
            eq(whatsappBridgeSessions.companyId, companyId),
            eq(whatsappBridgeSessions.userId, userId),
            eq(whatsappBridgeSessions.status, "active"),
            gt(whatsappBridgeSessions.expiresAt, now)
          )
        )
        .orderBy(desc(whatsappBridgeSessions.lastSeenAt))
        .limit(3);

      const recentJobs = await db
        .select()
        .from(whatsappBridgeJobs)
        .where(
          and(eq(whatsappBridgeJobs.companyId, companyId), eq(whatsappBridgeJobs.createdBy, userId))
        )
        .orderBy(desc(whatsappBridgeJobs.createdAt))
        .limit(10);

      res.json({
        provider: WHATSAPP_BRIDGE_PROVIDER,
        connected: activeSessions.length > 0,
        configured: true,
        canAutoSend: false,
        deliveryMode: "whatsapp_web_human_confirmed",
        deliveryStatus: "draft_or_logged_only",
        activeSession: activeSessions[0] ?? null,
        recentJobs,
        note: "The Chrome extension can draft messages in WhatsApp Web. Staff must review and press send in WhatsApp.",
      });
    })
  );

  app.post(
    "/api/integrations/whatsapp/bridge/sessions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const validated = createBridgeSessionSchema.parse(req.body);
      const companyId = await resolveCompanyId(req, validated.companyId);
      if (!companyId) return res.status(404).json({ message: "No accessible company found" });

      const [session] = await db
        .insert(whatsappBridgeSessions)
        .values({
          companyId,
          userId,
          extensionId: validated.extensionId,
          extensionVersion: validated.extensionVersion || null,
          status: "active",
          userAgent: validated.userAgent || req.headers["user-agent"] || null,
          lastSeenAt: new Date(),
          expiresAt: sessionExpiry(),
        })
        .returning();

      res.status(201).json({ session });
    })
  );

  app.patch(
    "/api/integrations/whatsapp/bridge/sessions/:sessionId/heartbeat",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { sessionId } = sessionIdSchema.parse(req.params);
      const [session] = await db
        .update(whatsappBridgeSessions)
        .set({
          lastSeenAt: new Date(),
          expiresAt: sessionExpiry(),
          updatedAt: new Date(),
          status: "active",
        })
        .where(
          and(eq(whatsappBridgeSessions.id, sessionId), eq(whatsappBridgeSessions.userId, userId))
        )
        .returning();

      if (!session) return res.status(404).json({ message: "Bridge session not found" });
      res.json({ session });
    })
  );

  app.post(
    "/api/integrations/whatsapp/bridge/jobs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const validated = createBridgeJobSchema.parse(req.body);
      const companyId = await resolveCompanyId(req, validated.companyId);
      if (!companyId) return res.status(404).json({ message: "No accessible company found" });

      const normalizedPhone = normalizeWhatsAppBridgePhone(validated.to);
      if (!normalizedPhone)
        return res.status(400).json({ message: "Invalid WhatsApp phone number" });

      const correlationId = randomUUID();
      const [loggedMessage] = await db
        .insert(whatsappMessages)
        .values({
          companyId,
          waMessageId: `bridge_${correlationId}`,
          from: "whatsapp_web_bridge",
          to: normalizedPhone,
          messageType: validated.attachmentUrl ? "document" : "text",
          content: validated.message,
          mediaUrl: validated.attachmentUrl || null,
          direction: "outbound",
          status: "queued",
        })
        .returning();

      const [job] = await db
        .insert(whatsappBridgeJobs)
        .values({
          companyId,
          createdBy: userId,
          whatsappMessageId: loggedMessage.id,
          provider: WHATSAPP_BRIDGE_PROVIDER,
          kind: validated.kind,
          recipientPhone: validated.to.trim(),
          normalizedRecipientPhone: normalizedPhone,
          recipientName: validated.recipientName || null,
          messageBody: validated.message,
          attachmentUrl: validated.attachmentUrl || null,
          attachmentLabel: validated.attachmentLabel || null,
          sourceType: validated.sourceType || null,
          sourceId: validated.sourceId || null,
          status: "queued",
          deliveryStatus: "logged",
          metadata: cleanBridgeJobMetadata(validated),
        })
        .returning();

      log.info({ jobId: job.id, companyId, userId, kind: job.kind }, "WhatsApp bridge job queued");
      res.status(201).json({ job, message: loggedMessage });
    })
  );

  app.get(
    "/api/integrations/whatsapp/bridge/jobs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const companyId = await resolveCompanyId(req, req.query.companyId as string | undefined);
      if (!companyId) return res.status(404).json({ message: "No accessible company found" });

      const jobs = await db
        .select()
        .from(whatsappBridgeJobs)
        .where(
          and(eq(whatsappBridgeJobs.companyId, companyId), eq(whatsappBridgeJobs.createdBy, userId))
        )
        .orderBy(desc(whatsappBridgeJobs.createdAt))
        .limit(50);

      res.json({ jobs });
    })
  );

  app.patch(
    "/api/integrations/whatsapp/bridge/jobs/:jobId/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const { jobId } = jobIdSchema.parse(req.params);
      const validated = bridgeStatusUpdateSchema.parse(req.body);
      const now = new Date();
      const nextDeliveryStatus =
        validated.deliveryStatus ||
        (validated.status === "failed"
          ? "failed"
          : validated.status === "drafted"
            ? "drafted"
            : "logged");
      const jobUpdate: any = {
        status: validated.status,
        deliveryStatus: nextDeliveryStatus,
        errorMessage: validated.errorMessage || null,
        updatedAt: now,
      };
      if (validated.status === "drafted") jobUpdate.draftedAt = now;
      if (validated.status === "sent_unverified" || validated.status === "failed")
        jobUpdate.completedAt = now;

      const [job] = await db
        .update(whatsappBridgeJobs)
        .set(jobUpdate)
        .where(and(eq(whatsappBridgeJobs.id, jobId), eq(whatsappBridgeJobs.createdBy, userId)))
        .returning();

      if (!job) return res.status(404).json({ message: "WhatsApp bridge job not found" });

      if (job.whatsappMessageId) {
        await db
          .update(whatsappMessages)
          .set({
            status: job.deliveryStatus,
            errorMessage: job.errorMessage,
            processedAt:
              job.status === "drafted" ||
              job.status === "sent_unverified" ||
              job.status === "failed"
                ? now
                : null,
          })
          .where(eq(whatsappMessages.id, job.whatsappMessageId));
      }

      log.info(
        { jobId: job.id, status: job.status, deliveryStatus: job.deliveryStatus },
        "WhatsApp bridge job updated"
      );
      res.json({ job });
    })
  );

  // Save WhatsApp reminder rules (stored per company via admin settings)
  app.post(
    "/api/integrations/whatsapp/save-rules",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { rules } = req.body;
      if (!Array.isArray(rules)) {
        return res.status(400).json({ message: "Rules must be an array" });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: "No company found" });
      }

      const companyId = companies[0].id;

      // Store rules as a JSON setting (upsert)
      const key = `whatsapp.rules.${companyId}`;
      const existing = await storage.getAdminSettingByKey(key);
      if (existing) {
        await storage.updateAdminSetting(key, JSON.stringify(rules));
      } else {
        await storage.createAdminSetting({
          key,
          value: JSON.stringify(rules),
          category: "whatsapp",
        });
      }

      log.info(`WhatsApp rules saved for company ${companyId}`);
      res.json({ success: true });
    })
  );

  // Get WhatsApp reminder rules
  app.get(
    "/api/integrations/whatsapp/rules",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const companies = await storage.getCompaniesByUserId(userId);
      if (companies.length === 0) {
        return res.status(404).json({ message: "No company found" });
      }

      const companyId = companies[0].id;
      const setting = await storage.getAdminSettingByKey(`whatsapp.rules.${companyId}`);

      if (setting) {
        try {
          const rules = JSON.parse(setting.value);
          return res.json({ rules });
        } catch {
          return res.json({ rules: [] });
        }
      }

      res.json({ rules: [] });
    })
  );
}
