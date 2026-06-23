import type { Express, Request, Response } from "express";
import { z } from "zod";

import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import {
  buildEvidenceCenter,
  buildEvidenceRefundPackCoverPdf,
  buildEvidenceRefundPackWorkbook,
  buildEvidenceRefundPackZip,
} from "../services/evidence-center.service";

const issueActionSchema = z.object({
  action: z.enum(["resolve", "waive"]),
  reason: z.string().trim().min(5).max(500),
});

const reviewedRequestSchema = z.object({
  recipient: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  acknowledgedExactContent: z.literal(true),
});

async function authorizeEvidenceCenter(req: Request, res: Response) {
  const userId = req.user!.id;
  const { companyId } = req.params;
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);

  if (!hasAccess) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }

  return { userId, companyId };
}

async function writeEvidenceActivity(input: {
  userId: string;
  companyId: string;
  action: "resolve" | "waive" | "request_reviewed" | "refund_pack_exported";
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  await storage.createActivityLog({
    userId: input.userId,
    companyId: input.companyId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    description: input.description,
    metadata: JSON.stringify({
      source: "evidence-center",
      ...(input.metadata ?? {}),
    }),
  });
}

export function registerEvidenceCenterRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/evidence-center",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const center = await buildEvidenceCenter(authorized.companyId);
      res.json(center);
    })
  );

  app.get(
    "/api/companies/:companyId/evidence-center/refund-pack.xlsx",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const center = await buildEvidenceCenter(authorized.companyId);
      const buffer = await buildEvidenceRefundPackWorkbook(center);
      await writeEvidenceActivity({
        ...authorized,
        action: "refund_pack_exported",
        entityType: "evidence_refund_pack",
        entityId: `${center.period.vatStart}:${center.period.vatEnd}`,
        description: `Exported evidence refund pack for ${center.company.name}`,
        metadata: {
          format: "xlsx",
          refundExposure: center.totals.refundExposure,
          proofLineCount: center.proofDrilldowns.length,
        },
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${center.refundPack.workbookFilename}"`
      );
      res.send(buffer);
    })
  );

  app.get(
    "/api/companies/:companyId/evidence-center/refund-pack-cover.pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const center = await buildEvidenceCenter(authorized.companyId);
      const buffer = await buildEvidenceRefundPackCoverPdf(center);
      await writeEvidenceActivity({
        ...authorized,
        action: "refund_pack_exported",
        entityType: "evidence_refund_pack",
        entityId: `${center.period.vatStart}:${center.period.vatEnd}`,
        description: `Exported evidence refund pack cover for ${center.company.name}`,
        metadata: {
          format: "pdf",
          refundExposure: center.totals.refundExposure,
          proofLineCount: center.proofDrilldowns.length,
        },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${center.refundPack.coverFilename}"`
      );
      res.send(buffer);
    })
  );

  app.get(
    "/api/companies/:companyId/evidence-center/refund-pack.zip",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const center = await buildEvidenceCenter(authorized.companyId);
      const buffer = await buildEvidenceRefundPackZip(center);
      await writeEvidenceActivity({
        ...authorized,
        action: "refund_pack_exported",
        entityType: "evidence_refund_pack",
        entityId: `${center.period.vatStart}:${center.period.vatEnd}`,
        description: `Exported evidence refund pack bundle for ${center.company.name}`,
        metadata: {
          format: "zip",
          refundExposure: center.totals.refundExposure,
          proofLineCount: center.proofDrilldowns.length,
          linkedSourceFileCount: center.refundPack.readyAttachmentCount,
        },
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${center.refundPack.bundleFilename}"`
      );
      res.send(buffer);
    })
  );

  app.post(
    "/api/companies/:companyId/evidence-center/issues/:issueId/actions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const parsed = issueActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid evidence action", errors: parsed.error.flatten() });
      }

      const center = await buildEvidenceCenter(authorized.companyId);
      const issueId = decodeURIComponent(req.params.issueId);
      const issue = [...center.missingEvidence, ...center.filingRiskScan].find(
        (candidate) => candidate.id === issueId
      );

      if (!issue) {
        return res.status(404).json({ message: "Evidence issue not found" });
      }

      await writeEvidenceActivity({
        ...authorized,
        action: parsed.data.action,
        entityType: "evidence_issue",
        entityId: issue.id,
        description: `${parsed.data.action === "resolve" ? "Resolved" : "Waived"} evidence issue: ${issue.title}`,
        metadata: {
          reason: parsed.data.reason,
          workflowId: issue.workflowId,
          severity: issue.severity,
          issueTitle: issue.title,
        },
      });

      res.json(await buildEvidenceCenter(authorized.companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/evidence-center/client-request/review",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const authorized = await authorizeEvidenceCenter(req, res);
      if (!authorized) return;

      const parsed = reviewedRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid reviewed request", errors: parsed.error.flatten() });
      }

      const center = await buildEvidenceCenter(authorized.companyId);
      if (
        parsed.data.subject !== center.clientRequestDraft.subject ||
        parsed.data.body !== center.clientRequestDraft.body
      ) {
        return res.status(409).json({
          message:
            "Draft content changed. Refresh the Evidence Center and review the exact request again.",
        });
      }

      await writeEvidenceActivity({
        ...authorized,
        action: "request_reviewed",
        entityType: "evidence_request",
        entityId: `${center.period.vatStart}:${center.period.vatEnd}`,
        description: `Reviewed evidence request for ${parsed.data.recipient}`,
        metadata: {
          recipient: parsed.data.recipient,
          subject: parsed.data.subject,
          itemCount: center.clientRequestDraft.itemCount,
          deliveryMode: "manual_reviewed_no_external_send",
        },
      });

      res.json({
        status: "reviewed_for_manual_delivery",
        message: "Request reviewed and audit-logged. No external email or WhatsApp was sent.",
      });
    })
  );
}
