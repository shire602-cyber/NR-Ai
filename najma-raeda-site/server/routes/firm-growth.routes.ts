import type { Express, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { authMiddleware } from "../middleware/auth";
import { requireFirmAdmin } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { createLogger } from "../config/logger";
import { db } from "../db";
import { firmGrowthOpportunities } from "../../shared/schema";
import { recordAudit } from "../services/audit.service";
import { resolveAccessibleClientIds } from "../services/firm-command-center.service";
import {
  listGrowthOpportunities,
  refreshGrowthOpportunities,
  updateGrowthOpportunity,
} from "../services/firm-growth.service";

const logger = createLogger("firm-growth-routes");

const opportunityIdParamSchema = z.object({ id: z.string().uuid() });

const updateOpportunitySchema = z.object({
  status: z.enum(["open", "accepted", "snoozed", "dismissed", "completed"]).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  actionType: z
    .enum(["accept", "assign", "snooze", "dismiss", "complete", "note", "script", "reopen"])
    .optional(),
});

async function accessibleClientIdsFor(req: Request): Promise<string[]> {
  const { id: userId, firmRole } = (req as any).user;
  return resolveAccessibleClientIds(userId, firmRole ?? null);
}

async function requireOpportunityAccess(req: Request, res: Response): Promise<string | null> {
  const parsed = opportunityIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid opportunity id" });
    return null;
  }

  const [opportunity] = await db
    .select({ companyId: firmGrowthOpportunities.companyId })
    .from(firmGrowthOpportunities)
    .where(eq(firmGrowthOpportunities.id, parsed.data.id))
    .limit(1);
  if (!opportunity) {
    res.status(404).json({ message: "Growth opportunity not found" });
    return null;
  }

  const accessible = await accessibleClientIdsFor(req);
  if (!opportunity.companyId || !accessible.includes(opportunity.companyId)) {
    res.status(403).json({ message: "Access denied to this client opportunity" });
    return null;
  }

  return parsed.data.id;
}

export function registerFirmGrowthRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware as any);
  router.use(requireFirmAdmin());

  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const companyIds = await accessibleClientIdsFor(req);
      const dashboard = await listGrowthOpportunities(companyIds);
      res.json(dashboard);
    })
  );

  router.post(
    "/refresh",
    asyncHandler(async (req: Request, res: Response) => {
      const companyIds = await accessibleClientIdsFor(req);
      const refresh = await refreshGrowthOpportunities(companyIds);
      const dashboard = await listGrowthOpportunities(companyIds);
      await recordAudit({
        userId: (req as any).user?.id,
        action: "firm_growth_opportunities_refresh",
        entityType: "firm_growth_opportunity",
        req,
        extra: { refresh },
      });
      res.json({ refresh, ...dashboard });
    })
  );

  router.patch(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const opportunityId = await requireOpportunityAccess(req, res);
      if (!opportunityId) return;

      const parsed = updateOpportunitySchema.parse(req.body);
      const actionType =
        parsed.actionType ??
        (parsed.status === "accepted"
          ? "accept"
          : parsed.status === "dismissed"
            ? "dismiss"
            : parsed.status === "completed"
              ? "complete"
              : parsed.status === "snoozed"
                ? "snooze"
                : parsed.ownerUserId !== undefined
                  ? "assign"
                  : "note");

      const updatePayload: Parameters<typeof updateGrowthOpportunity>[2] = { actionType };
      if (parsed.status !== undefined) updatePayload.status = parsed.status;
      if (parsed.ownerUserId !== undefined) updatePayload.ownerUserId = parsed.ownerUserId;
      if (parsed.snoozedUntil !== undefined) {
        updatePayload.snoozedUntil = parsed.snoozedUntil ? new Date(parsed.snoozedUntil) : null;
      }
      if (parsed.resolutionNote !== undefined) updatePayload.resolutionNote = parsed.resolutionNote;
      if (parsed.note !== undefined) updatePayload.note = parsed.note;

      const updated = await updateGrowthOpportunity(
        opportunityId,
        (req as any).user.id,
        updatePayload
      );
      if (!updated) return res.status(404).json({ message: "Growth opportunity not found" });

      await recordAudit({
        userId: (req as any).user?.id,
        companyId: updated.companyId,
        action: `firm_growth_opportunity_${actionType}`,
        entityType: "firm_growth_opportunity",
        entityId: updated.id,
        after: updated,
        req,
      });

      res.json(updated);
    })
  );

  app.use("/api/firm/growth-opportunities", router);
  logger.info("Firm growth opportunity routes registered at /api/firm/growth-opportunities/*");
}
