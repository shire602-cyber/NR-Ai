import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { getCompanyRole, requirePermission } from "../middleware/companyRolePolicy";
import { roleHasAnyPermission, type Permission } from "../../shared/permissions";
import { isNraFirmRole } from "../../shared/access";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import {
  addVatWorkpaperRow,
  addVatWorkpaperRowsBulk,
  bulkUpdateVatWorkpaperRowStatus,
  createVatWorkpaper,
  deleteVatWorkpaperRow,
  generateVatReturnFromWorkpaper,
  getVatWorkpaperDetail,
  listVatWorkpapers,
  postVatWorkpaperRowToLedger,
  pullVatWorkpaperRowsFromBooks,
  recalculateVatWorkpaper,
  updateVatWorkpaperRow,
  updateVatWorkpaperStatus,
} from "../services/firm-vat-workspace.service";
import {
  buildVatWorkpaperWorkbook,
  vatWorkpaperExportFilename,
} from "../services/vat-workpaper-export.service";
import {
  amendVatReturnBody,
  badDebtReliefClaimBody,
  badDebtReliefReverseBody,
  createCompanyVatWorkpaperBody,
  generateVatReturnBody,
  markVatReturnReadyBody,
  patchVatReturnBody,
  reverseVatReturnSettlementBody,
  settleVatReturnBody,
  submitVatReturnBody,
  vatGroupBody,
  vatRecoveryRuleBody,
  vatReturnAdjustmentBody,
  vatWorkpaperBulkRowsBody,
  vatWorkpaperBulkStatusBody,
  vatWorkpaperRowBody,
  vatWorkpaperRowPatchBody,
  vatWorkpaperStatusBody,
} from "../../shared/validators/vat";
import { computeVat201 } from "../tax/vat-engine";
import {
  getVatReturnSettlement,
  reverseVatReturnSettlement,
  settleVatReturn,
} from "../tax/vat-settlement.service";
import {
  amendVatReturn,
  assertReconciledOrOverridden,
  generateVatReturn,
  markVatReturnReady,
  postReturnApportionment,
  vatReturnMachine,
} from "../tax/vat-returns.service";
import {
  addReturnAdjustment,
  createBadDebtReliefClaim,
  deleteReturnAdjustment,
  installBadDebtPaymentHook,
  listBadDebtReliefClaims,
  listReturnAdjustments,
  reverseBadDebtReliefClaim,
  upsertVatGroup,
} from "../tax/vat-adjustments.service";
import {
  DEFAULT_RECOVERY_RULES,
  deleteRecoveryRule,
  loadRecoveryRules,
  upsertRecoveryRule,
} from "../tax/vat-recovery";
import { parseIsoDate } from "../tax/vat-periods";
import { todayIso } from "../ledger/normalize";
import { sendTabular } from "../reporting/http";
import {
  prepareVat201ForExport,
  prepareVat201PortalSheet,
  vat201ExportFilename,
  vat201PortalCsv,
  type Vat201ExportReturn,
} from "../../client/src/lib/vat201-export";

type Body<T extends z.ZodTypeAny> = z.output<T>;

const companyScopedWorkpaperParams = z.object({
  companyId: z.string().guid(),
  workpaperId: z.string().guid(),
});

const companyScopedWorkpaperRowParams = companyScopedWorkpaperParams.extend({
  rowId: z.string().guid(),
});

const uuid = z.string().guid();

function userIdOf(req: Request): string | undefined {
  return (req as Request & { user?: { id: string } }).user?.id;
}

async function requireCompanyAccess(req: Request, res: Response, companyId: string) {
  const userId = userIdOf(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return null;
  }
  if (!uuid.safeParse(companyId).success) {
    res.status(400).json({ message: "Invalid company id", code: "INVALID_ID" });
    return null;
  }
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  return userId;
}

async function requireCompanyWorkpaperAccess(
  req: Request,
  res: Response,
  companyId: string,
  workpaperId: string
) {
  const userId = await requireCompanyAccess(req, res, companyId);
  if (!userId) return null;
  const detail = await getVatWorkpaperDetail(workpaperId);
  if (detail.workpaper.companyId !== companyId) {
    res.status(404).json({ message: "VAT workpaper not found" });
    return null;
  }
  return { userId, detail };
}

/** Load a VAT return by id and authorise the caller (404 for another tenant's row). */
async function requireReturnAccess(req: Request, res: Response) {
  const userId = userIdOf(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return null;
  }
  if (!uuid.safeParse(req.params.id).success) {
    res.status(400).json({ message: "Invalid VAT return id", code: "INVALID_ID" });
    return null;
  }
  const existing = await storage.getVatReturn(req.params.id);
  if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) {
    res.status(404).json({ message: "VAT return not found", code: "VAT_RETURN_NOT_FOUND" });
    return null;
  }
  return { userId, existing };
}

/** Belt-and-braces permission check for row-id routes (no :companyId in the URL). */
async function assertCompanyPermission(req: Request, companyId: string, permission: Permission) {
  const user = (
    req as Request & { user?: { id: string; isAdmin?: boolean; firmRole?: string | null } }
  ).user;
  if (!user) throw new DomainError("AUTH_REQUIRED", 401);
  if (user.isAdmin === true || isNraFirmRole(user.firmRole ?? null)) return;
  const role = await getCompanyRole(user.id, companyId);
  if (!role || !roleHasAnyPermission(role, [permission])) {
    throw new DomainError("PERMISSION_DENIED", 403, { permission });
  }
}

function readPeriod(q: Record<string, unknown>): { from: string; to: string } {
  const from = q.from ?? q.startDate ?? q.periodStart;
  const to = q.to ?? q.endDate ?? q.periodEnd;
  return { from: parseIsoDate(from, "from"), to: parseIsoDate(to, "to") };
}

function iso(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

function exportShape(r: Record<string, unknown>): Vat201ExportReturn {
  return {
    ...(r as unknown as Vat201ExportReturn),
    periodStart: iso(r.periodStart as string),
    periodEnd: iso(r.periodEnd as string),
    dueDate: iso(r.dueDate as string),
  };
}

export function registerVATRoutes(app: Express) {
  installBadDebtPaymentHook();

  // =====================================
  // VAT WORKPAPERS (company-scoped)
  // =====================================

  app.get(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const workpapers = await listVatWorkpapers([companyId], companyId, { clientOnly: false });
      res.json({ workpapers });
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    strictBody(createCompanyVatWorkpaperBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const parsed = parsedBody<Body<typeof createCompanyVatWorkpaperBody>>(req);
      const workpaper = await createVatWorkpaper({
        companyId,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        dueDate: parsed.dueDate ?? null,
        notes: parsed.notes ?? null,
        createdBy: userId,
      });
      res.status(201).json(workpaper);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;
      res.json(result.detail);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows",
    authMiddleware,
    strictBody(vatWorkpaperRowBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = parsedBody<Body<typeof vatWorkpaperRowBody>>(req);
      const created = await addVatWorkpaperRow(parsedParams.data.workpaperId, result.userId, row);
      res.status(201).json(created);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk",
    authMiddleware,
    strictBody(vatWorkpaperBulkRowsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const parsed = parsedBody<Body<typeof vatWorkpaperBulkRowsBody>>(req);
      const created = await addVatWorkpaperRowsBulk(
        parsedParams.data.workpaperId,
        result.userId,
        parsed.rows
      );
      res.status(201).json({ created: created.length });
    })
  );

  app.patch(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    strictBody(vatWorkpaperRowPatchBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = parsedBody<Body<typeof vatWorkpaperRowPatchBody>>(req);
      const updated = await updateVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId,
        row
      );
      res.json(updated);
    })
  );

  app.delete(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const deleted = await deleteVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId
      );
      res.json(deleted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId/post",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const posted = await postVatWorkpaperRowToLedger(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId
      );
      res.json(posted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk-status",
    authMiddleware,
    strictBody(vatWorkpaperBulkStatusBody),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const body = parsedBody<Body<typeof vatWorkpaperBulkStatusBody>>(req);
      const updated = await bulkUpdateVatWorkpaperRowStatus(
        parsedParams.data.workpaperId,
        result.userId,
        body
      );
      res.json(updated);
    })
  );

  // R15-02: maker-checker status machine (draft -> prepared -> reviewed -> filed -> locked).
  app.patch(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/status",
    authMiddleware,
    strictBody(vatWorkpaperStatusBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });
      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;
      const body = parsedBody<Body<typeof vatWorkpaperStatusBody>>(req);
      const workpaper = await updateVatWorkpaperStatus(
        parsedParams.data.workpaperId,
        body.status,
        result.userId,
        { notes: body.notes, reason: body.reason },
        req
      );
      res.json(workpaper);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/pull-from-books",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const pulled = await pullVatWorkpaperRowsFromBooks(parsed.data.workpaperId, result.userId);
      res.json(pulled);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/recalculate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const recalculated = await recalculateVatWorkpaper(parsed.data.workpaperId);
      res.json(recalculated);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const buffer = await buildVatWorkpaperWorkbook(result.detail);
      const filename = vatWorkpaperExportFilename(result.detail);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/generate-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const company = await storage.getCompany(parsed.data.companyId);
      if (!company?.trnVatNumber) {
        return res.status(400).json({
          message:
            "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.",
          code: "NO_TRN",
        });
      }

      const generated = await generateVatReturnFromWorkpaper(
        parsed.data.workpaperId,
        result.userId
      );
      res.json({
        ...generated,
        message: "VAT return generated from approved workpaper rows. No FTA submission was made.",
      });
    })
  );

  // =====================================
  // VAT ENGINE (R07-03): preview, reconciliation
  // =====================================

  // Preview of the VAT 201 for any range (reports-grade: blocking issues are returned, not
  // thrown). Generation is stricter (aligned period, TRN, emirate per supply).
  app.get(
    "/api/companies/:companyId/vat/compute",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      const { from, to } = readPeriod(req.query as Record<string, unknown>);
      const c = await computeVat201({ companyId, from, to, allowIncomplete: true });
      res.json({
        engineVersion: c.engineVersion,
        period: c.period,
        boxes: c.boxes,
        issues: c.issues,
        complete: c.complete,
        excluded: c.excluded,
        counts: c.counts,
        partialExemption: c.partialExemption,
        reconciliation: c.reconciliation,
        group: c.group,
        contributions: req.query.detail === "true" ? c.contributions : undefined,
      });
    })
  );

  // R12-08b: VAT return vs GL VAT control accounts, by source.
  app.get(
    "/api/companies/:companyId/vat/reconciliation",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      const { from, to } = readPeriod(req.query as Record<string, unknown>);
      const c = await computeVat201({ companyId, from, to, allowIncomplete: true });
      res.json({ period: c.period, issues: c.issues, ...c.reconciliation });
    })
  );

  // =====================================
  // VAT RETURNS
  // =====================================

  app.get(
    "/api/companies/:companyId/vat-returns",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      res.json(vatReturns);
    })
  );

  // Generate VAT return (FTA VAT 201) from the engine for one aligned tax period (R07-07).
  app.post(
    "/api/companies/:companyId/vat-returns/generate",
    authMiddleware,
    strictBody(generateVatReturnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const body = parsedBody<Body<typeof generateVatReturnBody>>(req);
      const { vatReturn, computation: c } = await generateVatReturn({
        companyId,
        userId,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
      });
      res.status(201).json({
        ...vatReturn,
        _metadata: {
          engineVersion: c.engineVersion,
          companyEmirate: c.company.emirate,
          trnNumber: c.company.trn,
          counts: c.counts,
          invoicesProcessed: c.counts.invoices + c.counts.creditNotes + c.counts.debitNotes,
          receiptsProcessed: c.counts.receipts,
          billsProcessed: c.counts.bills,
          excluded: {
            outOfScopeAmount: c.excluded.outOfScopeFils / 100,
            outOfScopeDocuments: c.excluded.outOfScope.length,
            intraGroupDocuments: c.excluded.intraGroup.length,
          },
          netVatPayable: c.boxes.box14PayableTax,
          partialExemption: {
            exemptSupplyRatio: c.partialExemption.exemptSupplyRatio,
            recoverableRatio: c.partialExemption.recoverableRatio,
            grossInputVat: c.partialExemption.grossInputVatFils / 100,
            irrecoverableInputVat: c.partialExemption.apportionedFils / 100,
          },
          reconciliation: c.reconciliation,
          group: c.group,
        },
      });
    })
  );

  app.get(
    "/api/vat-returns/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      res.json(access.existing);
    })
  );

  // FTA portal-order export (xlsx / csv). A preparation file — nothing is sent to the FTA.
  app.get(
    "/api/vat-returns/:id/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      const company = await storage.getCompany(access.existing.companyId);
      const shaped = exportShape(access.existing as unknown as Record<string, unknown>);
      const info = { name: company?.name, trnVatNumber: company?.trnVatNumber };
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const name = vat201ExportFilename(shaped, info);
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${name}-fta.csv"`);
        return res.send("﻿" + vat201PortalCsv(shaped, info));
      }
      await sendTabular(res, "xlsx", name, [
        prepareVat201PortalSheet(shaped),
        ...prepareVat201ForExport(shaped, info),
      ]);
    })
  );

  // Readiness gate (R12-03): unexplained VAT-to-GL differences block "ready" without a reason.
  app.post(
    "/api/vat-returns/:id/ready",
    authMiddleware,
    strictBody(markVatReturnReadyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      await assertCompanyPermission(req, access.existing.companyId, "tax.submit");
      const body = parsedBody<Body<typeof markVatReturnReadyBody>>(req);
      const updated = await markVatReturnReady({
        id: access.existing.id,
        userId: access.userId,
        overrideReason: body.overrideReason ?? null,
        req,
      });
      res.json(updated);
    })
  );

  /** A stored period boundary (UTC end-of-day timestamp) as YYYY-MM-DD. */
  const isoDateOf = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

  // Submit VAT return. Never transmits anything to the FTA.
  app.post(
    "/api/vat-returns/:id/submit",
    authMiddleware,
    strictBody(submitVatReturnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      const { existing, userId } = access;
      const body = parsedBody<Body<typeof submitVatReturnBody>>(req);
      const reference = body.ftaReferenceNumber?.trim() ? body.ftaReferenceNumber.trim() : null;
      const target = reference ? "filed" : "submitted";
      if (!vatReturnMachine.can(existing.status, target) && existing.status !== target) {
        throw new DomainError("INVALID_TRANSITION", 409, { from: existing.status, to: target });
      }
      // E2 (J3-r2): the EmaraTax filing date. Only with a reference; never in the future and
      // never before the tax period has ended (EmaraTax opens the return after the period).
      const filedOn = body.filedOn ?? null;
      if (filedOn) {
        const periodEndIso = isoDateOf(existing.periodEnd);
        if (!reference) {
          throw new DomainError(
            "VALIDATION_ERROR",
            400,
            { fields: { ftaReferenceNumber: ["Enter the EmaraTax reference number"] } },
            "A filing date needs the EmaraTax reference number"
          );
        }
        if (filedOn > todayIso()) {
          throw new DomainError(
            "VAT_FILED_ON_FUTURE",
            422,
            { fields: { filedOn: ["The filing date cannot be in the future"] } },
            "The filing date cannot be in the future"
          );
        }
        if (filedOn <= periodEndIso) {
          throw new DomainError(
            "VAT_FILED_ON_IN_PERIOD",
            422,
            { periodEnd: periodEndIso, fields: { filedOn: ["File after the tax period ends"] } },
            "A VAT return is filed after its tax period ends"
          );
        }
      }
      // Submitting the return finalises the VAT settlement against periodEnd.
      await assertPeriodNotLocked(existing.companyId, existing.periodEnd);
      // A1 (C6): irrecoverable input VAT (partial exemption) is in the GL before the return is final.
      if (existing.status !== "submitted") await postReturnApportionment(existing, userId);
      // The same reconciliation gate as "ready" applies when a draft is submitted directly.
      if (existing.status !== "ready" && existing.status !== "submitted") {
        await assertReconciledOrOverridden({
          vatReturn: existing,
          userId,
          overrideReason: body.reconciliationOverrideReason ?? null,
          req,
        });
      }

      const vatReturn = await storage.updateVatReturn(existing.id, {
        status: target,
        notes: body.notes ?? existing.notes ?? null,
        ftaReferenceNumber: reference,
        submittedBy: userId,
        submittedAt: filedOn ? new Date(`${filedOn}T08:00:00Z`) : new Date(),
        // D2 (N13): the filing date the user stated (the VAT 201 declaration date); the
        // settlement of the filed return cannot predate it.
        ...(filedOn ? { declarationDate: new Date(`${filedOn}T08:00:00Z`) } : {}),
        declarantName: body.declarantName ?? existing.declarantName ?? null,
        declarantPosition: body.declarantPosition ?? existing.declarantPosition ?? null,
      });
      await recordAudit({
        userId,
        companyId: existing.companyId,
        action: `vat_return.${target}`,
        entityType: "vat_return",
        entityId: existing.id,
        before: { status: existing.status },
        after: { status: target, ftaReferenceNumber: reference },
        req,
      });

      res.json({
        ...vatReturn,
        filing: {
          transmittedByMuhasib: false,
          channel: reference ? "manual-emaratax" : "none",
          message: reference
            ? `Recorded as filed with FTA reference ${reference}. Muhasib did not transmit this return; this is your record of a filing you made through the official channel.`
            : "Finalised for review. Muhasib does NOT file with the FTA — you must still submit this return through EmaraTax, then record the FTA reference number here.",
        },
      });
    })
  );

  // Amended return (R07-15): new draft referencing the original, with a box-by-box diff.
  app.post(
    "/api/vat-returns/:id/amend",
    authMiddleware,
    strictBody(amendVatReturnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      await assertCompanyPermission(req, access.existing.companyId, "tax.submit");
      const body = parsedBody<Body<typeof amendVatReturnBody>>(req);
      const result = await amendVatReturn({
        id: access.existing.id,
        userId: access.userId,
        reason: body.reason,
        req,
      });
      res.status(201).json({ ...result.vatReturn, diff: result.diff });
    })
  );

  // VAT paid to / refunded by the FTA for a submitted return (Dr 2020 / Cr 1050 / Cr bank).
  // The proper seam for clearing the VAT control accounts (A2 H8): no manual adjustment needed.
  app.get(
    "/api/vat-returns/:id/settlement",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      res.json({
        settlement: await getVatReturnSettlement(access.existing.companyId, access.existing.id),
      });
    })
  );

  app.post(
    "/api/vat-returns/:id/settlement",
    authMiddleware,
    strictBody(settleVatReturnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      await assertCompanyPermission(req, access.existing.companyId, "tax.submit");
      const body = parsedBody<Body<typeof settleVatReturnBody>>(req);
      res.status(201).json(
        await settleVatReturn({
          companyId: access.existing.companyId,
          vatReturnId: access.existing.id,
          date: body.date,
          paymentAccountId: body.paymentAccountId,
          reference: body.reference ?? null,
          actorId: access.userId,
          req,
        })
      );
    })
  );

  app.post(
    "/api/vat-returns/:id/settlement/reverse",
    authMiddleware,
    strictBody(reverseVatReturnSettlementBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      await assertCompanyPermission(req, access.existing.companyId, "tax.submit");
      const body = parsedBody<Body<typeof reverseVatReturnSettlementBody>>(req);
      res.json(
        await reverseVatReturnSettlement({
          companyId: access.existing.companyId,
          vatReturnId: access.existing.id,
          date: body.date,
          reason: body.reason,
          actorId: access.userId,
          req,
        })
      );
    })
  );

  // Descriptive fields only: boxes come from the engine and change through adjustments.
  app.patch(
    "/api/vat-returns/:id",
    authMiddleware,
    strictBody(patchVatReturnBody),
    asyncHandler(async (req: Request, res: Response) => {
      const access = await requireReturnAccess(req, res);
      if (!access) return;
      const body = parsedBody<Body<typeof patchVatReturnBody>>(req);
      const vatReturn = await storage.updateVatReturn(access.existing.id, {
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.declarantName !== undefined ? { declarantName: body.declarantName } : {}),
        ...(body.declarantPosition !== undefined
          ? { declarantPosition: body.declarantPosition }
          : {}),
      });
      res.json(vatReturn);
    })
  );

  // =====================================
  // ADJUSTMENTS (R07-08, R07-15)
  // =====================================

  app.get(
    "/api/companies/:companyId/vat/adjustments",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      const { from, to } = readPeriod(req.query as Record<string, unknown>);
      res.json(await listReturnAdjustments(companyId, from, to));
    })
  );

  app.post(
    "/api/companies/:companyId/vat/adjustments",
    authMiddleware,
    strictBody(vatReturnAdjustmentBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const b = parsedBody<Body<typeof vatReturnAdjustmentBody>>(req);
      res.status(201).json(await addReturnAdjustment({ ...b, companyId, userId, req }));
    })
  );

  app.delete(
    "/api/companies/:companyId/vat/adjustments/:adjustmentId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, adjustmentId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      if (!uuid.safeParse(adjustmentId).success)
        return res.status(400).json({ message: "Invalid id", code: "INVALID_ID" });
      res.json(await deleteReturnAdjustment(companyId, adjustmentId, userId, req));
    })
  );

  app.get(
    "/api/companies/:companyId/vat/bad-debt-relief",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      res.json(await listBadDebtReliefClaims(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/vat/bad-debt-relief",
    authMiddleware,
    requirePermission("ledger.post"),
    strictBody(badDebtReliefClaimBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const b = parsedBody<Body<typeof badDebtReliefClaimBody>>(req);
      res.status(201).json(await createBadDebtReliefClaim({ ...b, companyId, userId, req }));
    })
  );

  app.post(
    "/api/companies/:companyId/vat/bad-debt-relief/:claimId/reverse",
    authMiddleware,
    requirePermission("ledger.post"),
    strictBody(badDebtReliefReverseBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, claimId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      if (!uuid.safeParse(claimId).success)
        return res.status(400).json({ message: "Invalid id", code: "INVALID_ID" });
      const b = parsedBody<Body<typeof badDebtReliefReverseBody>>(req);
      res.json(
        await reverseBadDebtReliefClaim({
          companyId,
          claimId,
          userId,
          date: b.date,
          reason: b.reason,
          req,
        })
      );
    })
  );

  // Input-VAT recovery rules (R05-28): blocked / partly recoverable categories.
  app.get(
    "/api/companies/:companyId/vat/recovery-rules",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await requireCompanyAccess(req, res, companyId))) return;
      res.json({ builtIn: DEFAULT_RECOVERY_RULES, rules: await loadRecoveryRules(companyId) });
    })
  );

  app.post(
    "/api/companies/:companyId/vat/recovery-rules",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(vatRecoveryRuleBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const b = parsedBody<Body<typeof vatRecoveryRuleBody>>(req);
      const rule = await upsertRecoveryRule(companyId, userId, b);
      await recordAudit({
        userId,
        companyId,
        action: "vat.recovery_rule.upsert",
        entityType: "vat_recovery_rule",
        entityId: rule.id,
        after: rule,
        req,
      });
      res.status(201).json(rule);
    })
  );

  app.delete(
    "/api/companies/:companyId/vat/recovery-rules/:ruleId",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, ruleId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      if (!uuid.safeParse(ruleId).success)
        return res.status(400).json({ message: "Invalid id", code: "INVALID_ID" });
      res.json(await deleteRecoveryRule(companyId, ruleId));
    })
  );

  // VAT group (Art. 14): this company is the representative member.
  app.put(
    "/api/companies/:companyId/vat/group",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(vatGroupBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;
      const b = parsedBody<Body<typeof vatGroupBody>>(req);
      res.json(
        await upsertVatGroup({
          representativeCompanyId: companyId,
          userId,
          name: b.name,
          groupTrn: b.groupTrn,
          memberCompanyIds: b.memberCompanyIds,
          req,
        })
      );
    })
  );
}
