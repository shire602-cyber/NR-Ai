/**
 * X6d: "Ask Najma Al Raeda" handoff. A customer asks the accounting firm for help from a VAT 201
 * preview, a corporate-tax return, a year-end close or a failed e-invoice, and the request carries
 * the period and key figures.
 *
 * With no email provider configured nothing is emailed: the request is STORED in-app (the
 * existing `user_feedback` table, category `najma_handoff`) and the response says so, together
 * with the human contact (Sara, support@muhasib.ai). The firm reads the queue at
 * GET /api/firm/value-ops/handoff-requests (NR staff only).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { companies, userFeedback } from "../../shared/schema";
import { authMiddleware } from "../middleware/auth";
import { requireNraAccess } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { recordAudit } from "../services/audit.service";
import { storage } from "../storage";
import { DomainError } from "../errors";

export const HANDOFF_CATEGORY = "najma_handoff";
export const HANDOFF_TOPICS = ["vat201", "corporate_tax", "year_end_close", "einvoice"] as const;
export type HandoffTopic = (typeof HANDOFF_TOPICS)[number];

export const FIRM_CONTACT = { name: "Sara", email: "support@muhasib.ai" } as const;

const TOPIC_TITLE: Record<HandoffTopic, string> = {
  vat201: "VAT 201",
  corporate_tax: "Corporate tax return",
  year_end_close: "Year-end close",
  einvoice: "E-invoice failure",
};

export const handoffBody = z.object({
  topic: z.enum(HANDOFF_TOPICS),
  period: z.string().trim().max(60).optional(),
  figures: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(80) }))
    .max(12)
    .default([]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  page: z.string().trim().max(200).optional(),
});
type HandoffBody = z.infer<typeof handoffBody>;

/** Plain-text request body the firm reads: topic, period, figures, then the customer's note. */
export function composeHandoffMessage(body: HandoffBody): string {
  const lines = [`Topic: ${TOPIC_TITLE[body.topic]}`];
  if (body.period) lines.push(`Period: ${body.period}`);
  if (body.reference) lines.push(`Reference: ${body.reference}`);
  for (const f of body.figures) lines.push(`${f.label}: ${f.value}`);
  if (body.note) lines.push("", body.note);
  return lines.join("\n");
}

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

export function registerNajmaHandoffRoutes(app: Express) {
  app.post(
    "/api/companies/:companyId/najma-handoff",
    authMiddleware,
    strictBody(handoffBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = parsedBody<HandoffBody>(req);
      const company = await storage.getCompany(companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const row = await storage.createUserFeedback({
        userId: userOf(req),
        companyId,
        feedbackType: "other",
        category: HANDOFF_CATEGORY,
        pageContext: body.page ?? null,
        title: `Ask Najma Al Raeda: ${TOPIC_TITLE[body.topic]}${body.period ? ` (${body.period})` : ""}`,
        message: composeHandoffMessage(body),
        status: "new",
        allowContact: true,
        contactEmail: null,
      });
      await recordAudit({
        userId: userOf(req),
        companyId,
        action: "firm.handoff_requested",
        entityType: "user_feedback",
        entityId: row.id,
        after: { topic: body.topic, period: body.period ?? null },
        req,
      });
      res.status(201).json({
        id: row.id,
        status: "received",
        // No email provider is wired for this: the request lives in Muhasib until the firm opens it.
        storedInApp: true,
        emailSent: false,
        contact: FIRM_CONTACT,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/najma-handoff",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const rows = await db
        .select()
        .from(userFeedback)
        .where(
          and(eq(userFeedback.companyId, companyId), eq(userFeedback.category, HANDOFF_CATEGORY))
        )
        .orderBy(desc(userFeedback.createdAt))
        .limit(20);
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt,
          responseMessage: r.responseMessage,
        })),
        contact: FIRM_CONTACT,
      });
    })
  );

  // NR staff queue (read-only listing; replying happens by email or in the firm console).
  app.get(
    "/api/firm/value-ops/handoff-requests",
    authMiddleware,
    requireNraAccess(),
    asyncHandler(async (_req: Request, res: Response) => {
      const rows = await db
        .select({
          id: userFeedback.id,
          companyId: userFeedback.companyId,
          companyName: companies.name,
          title: userFeedback.title,
          message: userFeedback.message,
          status: userFeedback.status,
          createdAt: userFeedback.createdAt,
        })
        .from(userFeedback)
        .leftJoin(companies, eq(companies.id, userFeedback.companyId))
        .where(eq(userFeedback.category, HANDOFF_CATEGORY))
        .orderBy(desc(userFeedback.createdAt))
        .limit(100);
      res.json({ items: rows });
    })
  );
}
