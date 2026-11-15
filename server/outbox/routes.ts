/**
 * Outbox HTTP surface (W4-D): provider delivery webhooks and the staff delivery log.
 *
 *   POST /api/webhooks/email-events/resend    Svix-signed (RESEND_WEBHOOK_SECRET)
 *   POST /api/webhooks/email-events/smtp-dsn  RFC 3464 DSN, x-webhook-secret (EMAIL_DSN_WEBHOOK_SECRET)
 *   GET  /api/companies/:companyId/email-outbox[?relatedEntityId=]
 *   GET  /api/companies/:companyId/email-outbox/status
 *   POST /api/companies/:companyId/email-outbox/:id/retry
 *
 * The webhook paths receive the raw request bytes (server/index.ts mounts express.raw for
 * /api/webhooks/email-events) so signatures are checked over exactly what the provider sent.
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { getCapability } from "../../shared/capabilities";
import { activeProviderName } from "./providers";
import { applyProviderEvent, listOutboxForCompany, requeueOutboxMessage } from "./outbox";
import { parseResendEvent, parseSmtpDsn, verifySvixSignature } from "./webhooks";

function rawBodyText(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertAccess(req: Request): Promise<string> {
  const { companyId } = req.params;
  const userId = (req.user as { id: string } | undefined)?.id;
  if (!userId || !UUID_RE.test(companyId) || !(await storage.hasCompanyAccess(userId, companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
  return companyId;
}

export function registerOutboxRoutes(app: Express): void {
  app.post(
    "/api/webhooks/email-events/resend",
    asyncHandler(async (req: Request, res: Response) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        return res.status(503).json({
          code: "WEBHOOK_NOT_CONFIGURED",
          message: "RESEND_WEBHOOK_SECRET is not set",
        });
      }
      const body = rawBodyText(req);
      const ok = verifySvixSignature({
        secret,
        id: req.header("svix-id"),
        timestamp: req.header("svix-timestamp"),
        signatureHeader: req.header("svix-signature"),
        body,
      });
      if (!ok) {
        return res.status(400).json({ code: "INVALID_SIGNATURE", message: "Bad signature" });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return res.status(400).json({ code: "INVALID_JSON", message: "Body is not JSON" });
      }
      const evt = parseResendEvent(parsed);
      if (!evt) return res.json({ received: true, ignored: true });
      const outboxId = await applyProviderEvent({ provider: "resend", ...evt });
      res.json({ received: true, matched: !!outboxId });
    })
  );

  app.post(
    "/api/webhooks/email-events/smtp-dsn",
    asyncHandler(async (req: Request, res: Response) => {
      const secret = process.env.EMAIL_DSN_WEBHOOK_SECRET;
      if (!secret) {
        return res.status(503).json({
          code: "WEBHOOK_NOT_CONFIGURED",
          message: "EMAIL_DSN_WEBHOOK_SECRET is not set",
        });
      }
      const given = Buffer.from(req.header("x-webhook-secret") ?? "");
      const want = Buffer.from(secret);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
        return res.status(401).json({ code: "INVALID_SECRET", message: "Bad webhook secret" });
      }
      const evt = parseSmtpDsn(rawBodyText(req));
      if (!evt) {
        return res.status(400).json({ code: "INVALID_DSN", message: "Not a delivery report" });
      }
      const outboxId = await applyProviderEvent({ provider: "smtp", ...evt });
      res.json({ received: true, matched: !!outboxId });
    })
  );

  app.get(
    "/api/companies/:companyId/email-outbox/status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req);
      const capability = getCapability("email");
      const provider = activeProviderName();
      res.json({
        configured: !!provider,
        provider,
        status: provider ? capability.status : "disabled",
        label: capability.label,
        externalAction: capability.externalAction,
        message: provider
          ? null
          : {
              en: "Email not configured — messages are queued and not sent.",
              ar: "البريد الإلكتروني غير مُعد — تُحفظ الرسائل في قائمة الانتظار ولا تُرسل.",
            },
      });
    })
  );

  app.get(
    "/api/companies/:companyId/email-outbox",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assertAccess(req);
      const relatedEntityId =
        typeof req.query.relatedEntityId === "string" && UUID_RE.test(req.query.relatedEntityId)
          ? req.query.relatedEntityId
          : undefined;
      res.json(await listOutboxForCompany(companyId, { relatedEntityId }));
    })
  );

  app.post(
    "/api/companies/:companyId/email-outbox/:id/retry",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await assertAccess(req);
      if (!UUID_RE.test(req.params.id)) throw new DomainError("EMAIL_NOT_FOUND", 404);
      const result = await requeueOutboxMessage(req.params.id, companyId);
      if (!result) {
        throw new DomainError(
          "EMAIL_NOT_RETRYABLE",
          409,
          undefined,
          "Only dead, blocked or retrying messages can be retried"
        );
      }
      res.json(result);
    })
  );
}
