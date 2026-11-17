import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { strictBody } from "../http/strict-body";
import { zText, zUuid } from "../../shared/validators/primitives";
import {
  CLOSE_STEP_KEYS,
  aiValidation,
  assertFiscalYearEnd,
  closeFiscalYear,
  createReopenRequest,
  decideReopenRequest,
  getChecklistWithSignOffs,
  getReopenRequest,
  listReopenRequests,
  signOffStep,
  withdrawStepSignOff,
  type CloseStepKey,
  generateClosingEntries,
  getCloseHistory,
  getCloseSettings,
  listFiscalYearCloses,
  listLockedPeriods,
  lockPeriod,
  reopenFiscalYear,
  unlockPeriod,
  updateCloseSettings,
  type ChecklistItem,
} from "../services/month-end.service";
import {
  assertNotInHardClosedYear,
  canManageClose,
  getLockThroughDate,
  isFirmOrAdmin,
  resolveCloseActor,
  type CloseActor,
} from "../services/period-lock.service";
import { fiscalYearStart, loadCompany, monthEnd, monthStart, parseReportDate } from "../reporting";
import { assertDifferentActor, companyHasSingleMember } from "../middleware/companyRolePolicy";

function parseStepKey(raw: unknown): CloseStepKey {
  if (typeof raw === "string" && (CLOSE_STEP_KEYS as readonly string[]).includes(raw)) {
    return raw as CloseStepKey;
  }
  throw new DomainError("UNKNOWN_CLOSE_STEP", 404, undefined, "Unknown close step");
}

const signOffBody = z.object({ period: z.string().max(20), note: zText(500).optional() });
const reopenRequestBody = z.object({
  periodEnd: z.unknown().optional(),
  reason: zText(500, { min: 3 }),
});
const reopenDecisionBody = z.object({ note: zText(500).optional() });

/** Derive periodStart and periodEnd from a YYYY-MM value; 400 on garbage (R08-11). */
function parsePeriod(period: unknown): { periodStart: string; periodEnd: string } {
  const raw = typeof period === "string" ? period.trim() : "";
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) {
    throw new DomainError(
      "INVALID_PERIOD",
      400,
      { period: raw.slice(0, 20) },
      "period must be YYYY-MM"
    );
  }
  const periodStart = `${m[1]}-${m[2]}-01`;
  return { periodStart, periodEnd: monthEnd(periodStart) };
}

async function requireAccess(req: Request, companyId: string): Promise<void> {
  const hasAccess = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!hasAccess) throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
}

async function requireCloseRole(req: Request, companyId: string): Promise<CloseActor> {
  await requireAccess(req, companyId);
  const actor = await resolveCloseActor(companyId, req.user!);
  if (!canManageClose(actor)) {
    throw new DomainError(
      "CLOSE_ROLE_REQUIRED",
      403,
      undefined,
      "Only an owner, admin or accountant can lock or close periods"
    );
  }
  return actor;
}

/**
 * R08-05: locking requires the close checklist to pass, or an explicit
 * override with a reason (recorded on the lock and in the audit log).
 */
async function enforceChecklist(
  companyId: string,
  periodEnd: string,
  override: { overrideChecklist?: boolean; reason?: string | null }
): Promise<{ checklist: ChecklistItem[]; overridden: boolean }> {
  const settings = await getCloseSettings(companyId);
  // W4-A: a judgment step signed off by a preparer counts as complete.
  const checklist = await getChecklistWithSignOffs(companyId, monthStart(periodEnd), periodEnd);
  const incomplete = checklist.filter((c) => (c.effectiveStatus ?? c.status) !== "complete");
  if (!settings.requireChecklistToLock || incomplete.length === 0) {
    return { checklist, overridden: false };
  }
  if (!override.overrideChecklist) {
    throw new DomainError(
      "CLOSE_CHECKLIST_INCOMPLETE",
      422,
      { incomplete: incomplete.map((c) => ({ id: c.id, title: c.title, details: c.details })) },
      `Close checklist incomplete: ${incomplete.length} item(s) outstanding. Complete them or override with a reason.`
    );
  }
  if (!override.reason || override.reason.trim().length < 3) {
    throw new DomainError(
      "OVERRIDE_REASON_REQUIRED",
      400,
      undefined,
      "A reason is required to override the close checklist"
    );
  }
  return { checklist, overridden: true };
}

const zReason = zText(500, { min: 3 });

const closingEntriesBody = z.object({
  periodStart: z.unknown().optional(),
  periodEnd: z.unknown().optional(),
});

const lockBody = z.object({
  periodEnd: z.unknown().optional(),
  lockType: z.enum(["soft", "hard"]).optional(),
  lockScope: z.enum(["month", "through"]).optional(),
  reason: zReason.optional(),
  overrideChecklist: z.boolean().optional(),
});

const unlockBody = z.object({
  period: z.string().max(20).optional(),
  periodEnd: z.unknown().optional(),
  reason: zReason.optional(),
});

const legacyUnlockBody = unlockBody.extend({ companyId: zUuid });

const settingsBody = z.object({
  postYearEndClosingEntry: z.boolean().optional(),
  requireChecklistToLock: z.boolean().optional(),
});

const yearEndBody = z.object({
  fiscalYearEnd: z.unknown().optional(),
  hardClose: z.boolean().optional(),
  reason: zReason.optional(),
  overrideChecklist: z.boolean().optional(),
});

const reopenBody = z.object({ fiscalYearEnd: z.unknown().optional(), reason: zReason });

function resolveUnlockPeriodEnd(body: { period?: string; periodEnd?: unknown }): string {
  if (body.period !== undefined) return parsePeriod(body.period).periodEnd;
  const end = parseReportDate(body.periodEnd, "periodEnd");
  if (!end)
    throw new DomainError(
      "PERIOD_REQUIRED",
      400,
      undefined,
      "period (YYYY-MM) or periodEnd is required"
    );
  return end;
}

/**
 * Unlock policy (R02-11): firm staff / platform admins may unlock anything.
 * A company owner (or admin) may unlock with a reason unless the period sits
 * in a hard-closed fiscal year. Everyone else gets 403.
 */
async function authorizeUnlock(
  req: Request,
  companyId: string,
  periodEnd: string,
  reason: string | undefined
): Promise<CloseActor> {
  await requireAccess(req, companyId);
  const actor = await resolveCloseActor(companyId, req.user!);
  if (isFirmOrAdmin(actor)) return actor;
  if (actor.companyRole !== "owner" && actor.companyRole !== "admin") {
    throw new DomainError(
      "UNLOCK_FORBIDDEN",
      403,
      undefined,
      "Only the company owner or firm staff can unlock periods"
    );
  }
  if (!reason) {
    throw new DomainError(
      "UNLOCK_REASON_REQUIRED",
      400,
      undefined,
      "A reason is required to unlock a period"
    );
  }
  await assertNotInHardClosedYear(companyId, periodEnd);
  return actor;
}

async function doUnlock(
  req: Request,
  res: Response,
  companyId: string,
  periodEnd: string,
  reason?: string
) {
  const actor = await authorizeUnlock(req, companyId, periodEnd, reason);
  const userId = req.user!.id;
  const record = await unlockPeriod(companyId, periodEnd, { userId, reason: reason ?? null });
  if (!record) {
    throw new DomainError(
      "PERIOD_NOT_LOCKED",
      404,
      undefined,
      "No locked period found for that date"
    );
  }
  const { recordAudit } = await import("../services/audit.service");
  await recordAudit({
    userId,
    companyId,
    action: "period.unlock",
    entityType: "period",
    entityId: periodEnd,
    before: { periodEnd, status: "locked", lockType: record.lockType },
    after: {
      periodEnd,
      status: "open",
      unlockedBy: userId,
      reason: reason ?? null,
      actor: actor.kind,
    },
    req,
  });
  res.json(record);
}

export function registerMonthEndRoutes(app: Express) {
  // GET /api/companies/:companyId/month-end/checklist?period=YYYY-MM
  app.get(
    "/api/companies/:companyId/month-end/checklist",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { periodStart, periodEnd } = parsePeriod(req.query.period);
      await requireAccess(req, companyId);
      const checklist = await getChecklistWithSignOffs(companyId, periodStart, periodEnd);
      res.json({ period: req.query.period, periodStart, periodEnd, checklist });
    })
  );

  /**
   * POST /api/companies/:companyId/month-end/generate-closing-entries
   * Returns the computed close summary for the period. Posts NOTHING
   * (R08-01/R08-02): statements roll earnings forward by computation.
   */
  app.post(
    "/api/companies/:companyId/month-end/generate-closing-entries",
    authMiddleware,
    requireCustomer,
    strictBody(closingEntriesBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      const summary = await generateClosingEntries(
        companyId,
        req.body.periodStart,
        req.body.periodEnd
      );
      res.json(summary);
    })
  );

  // POST /api/companies/:companyId/month-end/lock-period
  app.post(
    "/api/companies/:companyId/month-end/lock-period",
    authMiddleware,
    requireCustomer,
    strictBody(lockBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      const body = lockBody.parse(req.body);
      const periodEnd = parseReportDate(body.periodEnd, "periodEnd");
      if (!periodEnd)
        throw new DomainError(
          "PERIOD_REQUIRED",
          400,
          undefined,
          "periodEnd is required (YYYY-MM-DD)"
        );
      await requireCloseRole(req, companyId);
      const { checklist, overridden } = await enforceChecklist(companyId, periodEnd, body);
      const snapshot = checklist.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        details: c.details,
        signOff: c.signOff ?? null,
      }));
      const record = await lockPeriod(companyId, periodEnd, userId, {
        lockType: body.lockType ?? "hard",
        lockScope: body.lockScope ?? "through",
        reason: body.reason ?? null,
        checklistOverride: overridden,
        checklistSnapshot: snapshot,
      });

      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId,
        companyId,
        action: overridden ? "period.lock_override" : "period.lock",
        entityType: "period",
        entityId: periodEnd,
        before: null,
        after: {
          periodEnd,
          lockedBy: userId,
          lockType: record.lockType,
          lockScope: record.lockScope,
          checklistOverride: overridden,
          reason: body.reason ?? null,
          checklist: snapshot,
        },
        req,
      });

      res.json(record);
    })
  );

  // ── W4-A (R08-23): per-step sign-off ────────────────────────────────────
  app.post(
    "/api/companies/:companyId/month-end/steps/:stepKey/sign-off",
    authMiddleware,
    requireCustomer,
    strictBody(signOffBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const stepKey = parseStepKey(req.params.stepKey);
      const { periodEnd } = parsePeriod(req.body.period);
      await requireCloseRole(req, companyId);
      const signOff = await signOffStep(
        companyId,
        periodEnd,
        stepKey,
        req.user!.id,
        req.body.note ?? null
      );
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "close.step_sign_off",
        entityType: "period",
        entityId: periodEnd,
        after: signOff,
        req,
      });
      res.status(201).json(signOff);
    })
  );

  app.delete(
    "/api/companies/:companyId/month-end/steps/:stepKey/sign-off",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const stepKey = parseStepKey(req.params.stepKey);
      const { periodEnd } = parsePeriod(req.query.period);
      await requireCloseRole(req, companyId);
      const removed = await withdrawStepSignOff(companyId, periodEnd, stepKey);
      if (!removed) throw new DomainError("SIGN_OFF_NOT_FOUND", 404);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "close.step_sign_off_withdrawn",
        entityType: "period",
        entityId: periodEnd,
        before: { stepKey },
        req,
      });
      res.status(204).end();
    })
  );

  // ── W4-A (R08-23): reopen workflow (request with reason → approval) ─────
  app.get(
    "/api/companies/:companyId/month-end/reopen-requests",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await listReopenRequests(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/month-end/reopen-requests",
    authMiddleware,
    requireCustomer,
    strictBody(reopenRequestBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCloseRole(req, companyId);
      const periodEnd = parseReportDate(req.body.periodEnd, "periodEnd");
      if (!periodEnd) throw new DomainError("PERIOD_REQUIRED", 400);
      const request = await createReopenRequest(
        companyId,
        periodEnd,
        req.body.reason,
        req.user!.id
      );
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "period.reopen_requested",
        entityType: "period",
        entityId: periodEnd,
        after: request,
        req,
      });
      res.status(201).json(request);
    })
  );

  app.post(
    "/api/companies/:companyId/month-end/reopen-requests/:requestId/:decision",
    authMiddleware,
    requireCustomer,
    strictBody(reopenDecisionBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, requestId, decision } = req.params;
      if (decision !== "approve" && decision !== "reject") {
        throw new DomainError("NOT_FOUND", 404);
      }
      if (!zUuid.safeParse(requestId).success) throw new DomainError("NOT_FOUND", 404);
      await requireAccess(req, companyId);
      const request = await getReopenRequest(companyId, requestId);
      if (!request) throw new DomainError("NOT_FOUND", 404);
      // Approver: owner/admin or firm staff (same policy as unlock), and not the requester.
      const actor = await authorizeUnlock(req, companyId, request.periodEnd, request.reason);
      const single = await companyHasSingleMember(companyId);
      assertDifferentActor(request.requestedBy, req.user!.id, {
        allowSingleOwner: single || isFirmOrAdmin(actor),
      });
      const note = (req.body.note as string | undefined) ?? null;
      const decided = await decideReopenRequest(
        companyId,
        requestId,
        decision === "approve" ? "approved" : "rejected",
        req.user!.id,
        note
      );
      const { recordAudit } = await import("../services/audit.service");
      let unlocked = null;
      if (decided.status === "approved") {
        unlocked = await unlockPeriod(companyId, decided.periodEnd, {
          userId: req.user!.id,
          reason: `Reopen approved: ${decided.reason}`,
        });
        await recordAudit({
          userId: req.user!.id,
          companyId,
          action: "period.unlock",
          entityType: "period",
          entityId: decided.periodEnd,
          before: { periodEnd: decided.periodEnd, status: "locked" },
          after: {
            periodEnd: decided.periodEnd,
            status: "open",
            reopenRequestId: decided.id,
            requestedBy: decided.requestedBy,
            approvedBy: req.user!.id,
            reason: decided.reason,
          },
          req,
        });
      }
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: `period.reopen_${decided.status}`,
        entityType: "period",
        entityId: decided.periodEnd,
        before: { status: "pending" },
        after: decided,
        req,
      });
      res.json({ request: decided, period: unlocked });
    })
  );

  // GET /api/companies/:companyId/month-end/ai-validation?period=YYYY-MM
  app.get(
    "/api/companies/:companyId/month-end/ai-validation",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { periodStart, periodEnd } = parsePeriod(req.query.period);
      await requireAccess(req, companyId);
      const validation = await aiValidation(companyId, periodStart, periodEnd);
      res.json({ period: req.query.period, ...validation });
    })
  );

  // GET /api/companies/:companyId/month-end/history
  app.get(
    "/api/companies/:companyId/month-end/history",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await getCloseHistory(companyId));
    })
  );

  // GET / PUT /api/companies/:companyId/month-end/settings
  app.get(
    "/api/companies/:companyId/month-end/settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      const [settings, lockThroughDate, actor] = await Promise.all([
        getCloseSettings(companyId),
        getLockThroughDate(companyId),
        resolveCloseActor(companyId, req.user!),
      ]);
      res.json({
        ...settings,
        lockThroughDate,
        permissions: {
          canLock: canManageClose(actor),
          canUnlock:
            isFirmOrAdmin(actor) || actor.companyRole === "owner" || actor.companyRole === "admin",
          canReopenHardClose: isFirmOrAdmin(actor),
        },
      });
    })
  );

  app.put(
    "/api/companies/:companyId/month-end/settings",
    authMiddleware,
    requireCustomer,
    strictBody(settingsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const actor = await requireCloseRole(req, companyId);
      if (!isFirmOrAdmin(actor) && actor.companyRole !== "owner" && actor.companyRole !== "admin") {
        throw new DomainError(
          "CLOSE_SETTINGS_FORBIDDEN",
          403,
          undefined,
          "Only the owner can change close settings"
        );
      }
      const next = await updateCloseSettings(companyId, req.body, req.user!.id);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "close.settings_update",
        entityType: "company",
        entityId: companyId,
        before: null,
        after: next,
        req,
      });
      res.json(next);
    })
  );

  // Year-end close (R11-14)
  app.get(
    "/api/companies/:companyId/month-end/year-end-close",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await listFiscalYearCloses(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/month-end/year-end-close",
    authMiddleware,
    requireCustomer,
    strictBody(yearEndBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = yearEndBody.parse(req.body);
      const fye = parseReportDate(body.fiscalYearEnd, "fiscalYearEnd");
      if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
      await requireCloseRole(req, companyId);
      await assertFiscalYearEnd(companyId, fye);
      const { checklist, overridden } = await enforceChecklist(companyId, fye, body);
      const snapshot = checklist.map((c) => ({ id: c.id, title: c.title, status: c.status }));
      const result = await closeFiscalYear(companyId, fye, req.user!.id, {
        hardClose: body.hardClose === true,
        reason: body.reason ?? null,
        checklistOverride: overridden,
        checklistSnapshot: snapshot,
      });
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "fiscal_year.close",
        entityType: "fiscal_year",
        entityId: fye,
        before: null,
        after: {
          fiscalYearEnd: fye,
          hardClose: body.hardClose === true,
          posted: result.posted,
          closingEntryId: result.closingEntryId,
          netIncome: result.summary.netIncome,
          checklistOverride: overridden,
          reason: body.reason ?? null,
        },
        req,
      });
      res.status(201).json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/month-end/year-end-close/reopen",
    authMiddleware,
    requireCustomer,
    strictBody(reopenBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = reopenBody.parse(req.body);
      const fye = parseReportDate(body.fiscalYearEnd, "fiscalYearEnd");
      if (!fye) throw new DomainError("FISCAL_YEAR_END_REQUIRED", 400);
      const actor = await authorizeUnlock(req, companyId, fye, body.reason);
      const record = await reopenFiscalYear(companyId, fye, req.user!.id, body.reason);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "fiscal_year.reopen",
        entityType: "fiscal_year",
        entityId: fye,
        before: { status: "closed" },
        after: { status: "reopened", reason: body.reason, actor: actor.kind },
        req,
      });
      res.json(record);
    })
  );

  // =====================================
  // Period Lock Routes
  // =====================================

  // Canonical: POST /api/companies/:companyId/period-lock/unlock { period | periodEnd, reason }
  app.post(
    "/api/companies/:companyId/period-lock/unlock",
    authMiddleware,
    strictBody(unlockBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const periodEnd = resolveUnlockPeriodEnd(req.body);
      await doUnlock(req, res, companyId, periodEnd, req.body.reason);
    })
  );

  // GET /api/companies/:companyId/period-lock -> lock-through date + locked rows + fiscal-year closes
  app.get(
    "/api/companies/:companyId/period-lock",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      const company = await loadCompany(companyId);
      const [lockThroughDate, locks, fiscalYears] = await Promise.all([
        getLockThroughDate(companyId),
        listLockedPeriods(companyId),
        listFiscalYearCloses(companyId),
      ]);
      res.json({
        lockThroughDate,
        fiscalYearStartMonth: company.fiscalYearStartMonth,
        currentFiscalYearStart: fiscalYearStart(
          new Date().toISOString().slice(0, 10),
          company.fiscalYearStartMonth
        ),
        locks,
        fiscalYears,
      });
    })
  );

  /**
   * Legacy alias: POST /api/period-lock/unlock { companyId, period (YYYY-MM), reason }
   * Same policy as the canonical route (owners can now unlock with a reason).
   */
  app.post(
    "/api/period-lock/unlock",
    authMiddleware,
    strictBody(legacyUnlockBody, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      res.setHeader("Deprecation", "true");
      res.setHeader(
        "Link",
        `</api/companies/${req.body.companyId}/period-lock/unlock>; rel="successor-version"`
      );
      const periodEnd = resolveUnlockPeriodEnd(req.body);
      await doUnlock(req, res, req.body.companyId, periodEnd, req.body.reason);
    })
  );

  // GET /api/period-lock/list?companyId=...
  app.get(
    "/api/period-lock/list",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = req.query.companyId;
      if (typeof companyId !== "string" || !/^[0-9a-f-]{36}$/i.test(companyId)) {
        throw new DomainError(
          "COMPANY_ID_REQUIRED",
          400,
          undefined,
          "companyId query parameter is required"
        );
      }
      await requireAccess(req, companyId);
      res.json(await listLockedPeriods(companyId));
    })
  );
}
