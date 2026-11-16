/**
 * Company groups and management consolidation (W5-C: R14-18, R12-12).
 *
 *   GET    /api/company-groups                                   groups the caller can view
 *   POST   /api/companies/:companyId/company-groups              create (parent = companyId)
 *   GET    /api/company-groups/:groupId                          detail (members, maps, journals)
 *   PATCH  /api/company-groups/:groupId                          rename / reporting currency
 *   DELETE /api/company-groups/:groupId
 *   POST   /api/company-groups/:groupId/members                  add a member company
 *   PATCH  /api/company-groups/:groupId/members/:memberId        ownership / method / dates
 *   DELETE /api/company-groups/:groupId/members/:memberId
 *   POST   /api/company-groups/:groupId/intercompany-maps        pair intercompany accounts
 *   DELETE /api/company-groups/:groupId/intercompany-maps/:mapId
 *   POST   /api/company-groups/:groupId/eliminations             manual elimination journal
 *   POST   /api/company-groups/:groupId/eliminations/:journalId/void
 *   GET    /api/company-groups/:groupId/consolidated-statements?from=&to=   (fixed contract)
 *   GET    /api/company-groups/:groupId/consolidated-statements/export?from=&to=&format=xlsx|csv
 *   POST   /api/company-groups/:groupId/consolidation-runs       record an audited run
 *   GET    /api/company-groups/:groupId/consolidation-runs
 *
 * Access rules live in server/services/consolidation/groups.ts. Every output is labelled a
 * management consolidation; corporate tax stays per entity.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { requirePermission } from "../middleware/companyRolePolicy";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import { parseReportDate, uaeToday, addDays } from "../reporting";
import { sendTabular } from "../reporting/http";
import { registerFxServices } from "../services/fx";
import { CONSOLIDATION_METHODS, INTERCOMPANY_MAP_KINDS } from "../../shared/schema";
import { zCurrency, zDate, zMoneyFils, zText, zUuid } from "../../shared/validators/primitives";
import {
  addIntercompanyMap,
  addMember,
  assertCanManageGroup,
  assertCanViewGroup,
  consolidatedStatements,
  consolidationSheets,
  createGroup,
  createManualElimination,
  deleteGroup,
  groupDetail,
  listGroupsForUser,
  listRuns,
  recordConsolidationRun,
  removeIntercompanyMap,
  removeMember,
  updateGroup,
  updateMember,
  voidElimination,
} from "../services/consolidation";

const zOwnership = z.coerce
  .number({
    error: (iss) =>
      iss.code === "invalid_type" && iss.input !== undefined
        ? "ownershipPercent must be a number"
        : undefined,
  })
  .gt(0, "Ownership must be above 0%")
  .max(100, "Ownership cannot exceed 100%");

const createGroupBody = z.object({
  name: zText(120, { min: 1 }),
  reportingCurrency: zCurrency.optional(),
});
const updateGroupBody = z.object({
  name: zText(120, { min: 1 }).optional(),
  reportingCurrency: zCurrency.optional(),
});
const addMemberBody = z.object({
  memberCompanyId: zUuid,
  ownershipPercent: zOwnership.default(100),
  method: z.enum(CONSOLIDATION_METHODS).default("full"),
  effectiveFrom: zDate.optional().nullable(),
  effectiveTo: zDate.optional().nullable(),
});
const updateMemberBody = z.object({
  ownershipPercent: zOwnership.optional(),
  method: z.enum(CONSOLIDATION_METHODS).optional(),
  effectiveFrom: zDate.optional().nullable(),
  effectiveTo: zDate.optional().nullable(),
});
const mapBody = z.object({
  kind: z.enum(INTERCOMPANY_MAP_KINDS),
  label: zText(120).optional().nullable(),
  companyAId: zUuid,
  accountAId: zUuid,
  companyBId: zUuid,
  accountBId: zUuid,
});
const eliminationBody = z.object({
  date: zDate,
  memo: zText(255).optional().nullable(),
  lines: z
    .array(
      z
        .object({
          memberCompanyId: zUuid,
          accountId: zUuid,
          debit: zMoneyFils.optional(),
          credit: zMoneyFils.optional(),
          description: zText(255).optional().nullable(),
        })
        .strict()
    )
    .min(2)
    .max(200),
});
const runBody = z.object({ from: zDate, to: zDate });

const userIdOf = (req: Request): string => {
  const id = req.user?.id;
  if (!id) throw new DomainError("UNAUTHENTICATED", 401);
  return id;
};

/** from/to query (to defaults to today, from to the start of to's calendar year). */
function readPeriod(req: Request): { from: string; to: string } {
  const to = parseReportDate(req.query.to ?? req.query.endDate, "to") ?? uaeToday();
  const from =
    parseReportDate(req.query.from ?? req.query.startDate, "from") ?? `${to.slice(0, 4)}-01-01`;
  if (from > to) {
    throw new DomainError(
      "INVALID_REPORT_RANGE",
      400,
      { from, to },
      "from must be on or before to"
    );
  }
  if (addDays(from, 3660) < to) {
    throw new DomainError("REPORT_RANGE_TOO_LONG", 400, { from, to });
  }
  return { from, to };
}

export function registerConsolidationRoutes(app: Express): void {
  registerFxServices();

  app.get(
    "/api/company-groups",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listGroupsForUser(userIdOf(req)));
    })
  );

  app.post(
    "/api/companies/:companyId/company-groups",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(createGroupBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof createGroupBody>>(req);
      const userId = userIdOf(req);
      const group = await createGroup({
        parentCompanyId: req.params.companyId,
        userId,
        name: body.name,
        reportingCurrency: body.reportingCurrency,
      });
      await recordAudit({
        userId,
        companyId: req.params.companyId,
        action: "company_group.create",
        entityType: "company_group",
        entityId: group.id,
        after: group,
        req,
      });
      res.status(201).json(group);
    })
  );

  app.get(
    "/api/company-groups/:groupId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await assertCanViewGroup(userIdOf(req), req.params.groupId);
      res.json(await groupDetail(req.params.groupId));
    })
  );

  app.patch(
    "/api/company-groups/:groupId",
    authMiddleware,
    strictBody(updateGroupBody),
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanManageGroup(userIdOf(req), req.params.groupId);
      res.json(await updateGroup(group.id, parsedBody<z.output<typeof updateGroupBody>>(req)));
    })
  );

  app.delete(
    "/api/company-groups/:groupId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const group = await assertCanManageGroup(userId, req.params.groupId);
      await deleteGroup(group.id);
      await recordAudit({
        userId,
        companyId: group.parentCompanyId,
        action: "company_group.delete",
        entityType: "company_group",
        entityId: group.id,
        before: group,
        req,
      });
      res.json({ deleted: true });
    })
  );

  app.post(
    "/api/company-groups/:groupId/members",
    authMiddleware,
    strictBody(addMemberBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const group = await assertCanManageGroup(userId, req.params.groupId);
      const body = parsedBody<z.output<typeof addMemberBody>>(req);
      const row = await addMember({
        group,
        userId,
        companyId: body.memberCompanyId,
        ownershipPercent: body.ownershipPercent,
        method: body.method,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
      });
      await recordAudit({
        userId,
        companyId: group.parentCompanyId,
        action: "company_group.member_add",
        entityType: "company_group",
        entityId: group.id,
        after: row,
        req,
      });
      res.status(201).json(row);
    })
  );

  app.patch(
    "/api/company-groups/:groupId/members/:memberId",
    authMiddleware,
    strictBody(updateMemberBody),
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanManageGroup(userIdOf(req), req.params.groupId);
      res.json(
        await updateMember({
          group,
          memberId: req.params.memberId,
          patch: parsedBody<z.output<typeof updateMemberBody>>(req),
        })
      );
    })
  );

  app.delete(
    "/api/company-groups/:groupId/members/:memberId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanManageGroup(userIdOf(req), req.params.groupId);
      await removeMember(group, req.params.memberId);
      res.json({ deleted: true });
    })
  );

  app.post(
    "/api/company-groups/:groupId/intercompany-maps",
    authMiddleware,
    strictBody(mapBody),
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanManageGroup(userIdOf(req), req.params.groupId);
      const body = parsedBody<z.output<typeof mapBody>>(req);
      res.status(201).json(await addIntercompanyMap({ group, ...body }));
    })
  );

  app.delete(
    "/api/company-groups/:groupId/intercompany-maps/:mapId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanManageGroup(userIdOf(req), req.params.groupId);
      await removeIntercompanyMap(group, req.params.mapId);
      res.json({ deleted: true });
    })
  );

  app.post(
    "/api/company-groups/:groupId/eliminations",
    authMiddleware,
    strictBody(eliminationBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const group = await assertCanManageGroup(userId, req.params.groupId);
      const body = parsedBody<z.output<typeof eliminationBody>>(req);
      const j = await createManualElimination({
        group,
        userId,
        date: body.date,
        memo: body.memo ?? null,
        lines: body.lines.map((l) => ({
          companyId: l.memberCompanyId,
          accountId: l.accountId,
          debitMinor: l.debit ?? 0,
          creditMinor: l.credit ?? 0,
          description: l.description ?? null,
        })),
      });
      await recordAudit({
        userId,
        companyId: group.parentCompanyId,
        action: "company_group.elimination_create",
        entityType: "elimination_journal",
        entityId: j.id,
        after: { ...j, lines: body.lines },
        req,
      });
      res.status(201).json(j);
    })
  );

  app.post(
    "/api/company-groups/:groupId/eliminations/:journalId/void",
    authMiddleware,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const group = await assertCanManageGroup(userId, req.params.groupId);
      const j = await voidElimination(group, req.params.journalId, userId);
      await recordAudit({
        userId,
        companyId: group.parentCompanyId,
        action: "company_group.elimination_void",
        entityType: "elimination_journal",
        entityId: j.id,
        after: j,
        req,
      });
      res.json(j);
    })
  );

  app.get(
    "/api/company-groups/:groupId/consolidated-statements",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanViewGroup(userIdOf(req), req.params.groupId);
      res.json(await consolidatedStatements(group.id, readPeriod(req)));
    })
  );

  app.get(
    "/api/company-groups/:groupId/consolidated-statements/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanViewGroup(userIdOf(req), req.params.groupId);
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const period = readPeriod(req);
      const s = await consolidatedStatements(group.id, period);
      await sendTabular(
        res,
        format,
        `management-consolidation-${group.name}-${period.from}-${period.to}`,
        consolidationSheets(s)
      );
    })
  );

  app.post(
    "/api/company-groups/:groupId/consolidation-runs",
    authMiddleware,
    strictBody(runBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = userIdOf(req);
      const group = await assertCanManageGroup(userId, req.params.groupId);
      const { from, to } = parsedBody<z.output<typeof runBody>>(req);
      if (from > to) throw new DomainError("INVALID_REPORT_RANGE", 400, { from, to });
      const { run, statements } = await recordConsolidationRun({ group, userId, from, to });
      await recordAudit({
        userId,
        companyId: group.parentCompanyId,
        action: "company_group.consolidation_run",
        entityType: "consolidation_run",
        entityId: run.id,
        after: { from, to, netProfit: statements.consolidated.profitAndLoss.netProfit },
        req,
      });
      res.status(201).json({ id: run.id, createdAt: run.createdAt, statements });
    })
  );

  app.get(
    "/api/company-groups/:groupId/consolidation-runs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const group = await assertCanViewGroup(userIdOf(req), req.params.groupId);
      res.json(await listRuns(group.id));
    })
  );
}
