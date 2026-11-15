import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { pool } from "../db";
import { DomainError } from "../errors";
import { strictBody } from "../http/strict-body";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
  buildCtReturnWorkbook,
  buildCtTemplateWorkbook,
  ctReturnExportFilename,
  parseCtWorkbookRows,
} from "../services/ct-workpaper-export.service";
import {
  CT_ADJUSTMENT_CATEGORIES,
  CT_INTEREST_EBITDA_SHARE,
  CT_INTEREST_SAFE_HARBOUR,
  CT_LOSS_OFFSET_LIMIT,
  CT_QFZP_DE_MINIMIS_CAP,
  CT_QFZP_DE_MINIMIS_SHARE,
  CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  CT_STANDARD_RATE,
  CT_TP_DISCLOSURE_THRESHOLD,
  CT_TP_LOCAL_FILE_REVENUE_THRESHOLD,
  CT_TP_MNE_GROUP_REVENUE_THRESHOLD,
  CT_ZERO_RATE_BAND,
  computeCtLiability,
  computeCtTotals,
  sbrAvailableForPeriodEnd,
  type CtWorkpaperRow,
} from "../../shared/ct-workpaper";
import {
  amendCtReturnSchema,
  computeCtReturnSchema,
  createCtReturnSchema,
  ctAccountTagSchema,
  ctAdviserConfirmationSchema,
  ctProfileSchema,
  ctRelatedPartySchema,
  patchCtReturnSchema,
  transitionCtReturnSchema,
  type ComputeCtReturnBody,
  type CreateCtReturnBody,
  type PatchCtReturnBody,
} from "../../shared/validators/corporate-tax";
import { zUuid } from "../../shared/validators/primitives";
import { isNraFirmRole } from "../../shared/access";
import { normalizeCompanyRole, roleHasPermission, type Permission } from "../../shared/permissions";
import { ENTRY_LOCAL_DATE_SQL, NOT_CLOSING_SQL, profitAndLoss, readRange } from "../reporting";
import type { CorporateTaxReturn } from "../../shared/schema";
import {
  amendCtReturn,
  assertEditable,
  auditCtReturn,
  booksOverrides,
  confirmCtAdviserReview,
  createRelatedParty,
  ctFilingDeadline,
  deleteRelatedParty,
  ensureCtTagAccounts,
  findOverlappingReturn,
  getCtProfile,
  listRelatedParties,
  listTaggedAccounts,
  parseAdjustments,
  readCtBooks,
  recomputeAndSave,
  setAccountTaxTag,
  transitionCtReturn,
  uaeIsoDate,
  upsertCtProfile,
} from "../services/corporate-tax";

/** Posted, non-closing journal entries in [from, to] (UAE dates). */
async function countPeriodEntries(companyId: string, from: string, to: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries je
      WHERE je.company_id = $1 AND je.status = 'posted' AND ${NOT_CLOSING_SQL}
        AND ${ENTRY_LOCAL_DATE_SQL} BETWEEN $2::date AND $3::date`,
    [companyId, from, to]
  );
  return Number(r.rows[0]?.n) || 0;
}

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
}

const CT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const CT_IMPORT_MAX_ROWS = 2000;

const importFileSchema = z
  .object({ fileName: z.string().max(255), fileDataBase64: z.string().max(15_000_000) })
  .strict();
const emptyBodySchema = z.object({}).strict();

async function requireAccess(req: Request, companyId: string): Promise<void> {
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!ok) throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
}

/** Load a return and check the caller's access to its company (404 for strangers). */
async function loadReturn(req: Request, id: string): Promise<CorporateTaxReturn> {
  if (!zUuid.safeParse(id).success) throw new DomainError("CT_RETURN_NOT_FOUND", 404);
  const ctReturn = await storage.getCorporateTaxReturn(id);
  if (!ctReturn)
    throw new DomainError("CT_RETURN_NOT_FOUND", 404, undefined, "Corporate tax return not found");
  const ok = await storage.hasCompanyAccess(req.user!.id, ctReturn.companyId);
  // Another tenant's row answers like a missing row (no existence oracle).
  if (!ok)
    throw new DomainError("CT_RETURN_NOT_FOUND", 404, undefined, "Corporate tax return not found");
  return ctReturn;
}

/** Belt-and-braces role check for routes without :companyId in the URL. */
async function assertPermission(
  req: Request,
  companyId: string,
  permission: Permission
): Promise<void> {
  const user = req.user!;
  if (user.isAdmin || isNraFirmRole(user.firmRole)) return;
  const membership = await storage.getUserRole(companyId, user.id);
  const role = membership ? normalizeCompanyRole(membership.role) : null;
  if (!role || !roleHasPermission(role, permission)) {
    throw new DomainError(
      "PERMISSION_DENIED",
      403,
      { permission, role },
      "Your role in this company does not allow this action"
    );
  }
}

function withDeadline(r: CorporateTaxReturn) {
  return { ...r, filingDeadline: ctFilingDeadline(uaeIsoDate(r.taxPeriodEnd)) };
}

export function registerCorporateTaxRoutes(app: Express) {
  // =====================================
  // CORPORATE TAX RETURNS (UAE 9% CT)
  // =====================================

  app.get(
    "/api/companies/:companyId/corporate-tax/returns",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      const returns = await storage.getCorporateTaxReturnsByCompanyId(companyId);
      res.json(returns.map(withDeadline));
    })
  );

  // Blank workpaper template whose headers round-trip the shared parser.
  app.get(
    "/api/corporate-tax/returns/template",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      const buffer = await buildCtTemplateWorkbook();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="muhasib-ct-workpaper-template.xlsx"'
      );
      res.send(buffer);
    })
  );

  app.get(
    "/api/corporate-tax/returns/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      res.json(withDeadline(ctReturn));
    })
  );

  // Audit trail of one return (every lifecycle transition writes a row).
  app.get(
    "/api/corporate-tax/returns/:id/audit",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      const r = await pool.query(
        `SELECT id, user_id, action, details, created_at FROM audit_logs
          WHERE resource_type = 'corporate_tax_return' AND resource_id = $1
          ORDER BY created_at, id`,
        [ctReturn.id]
      );
      res.json(
        r.rows.map((row: AuditRow) => ({
          id: row.id,
          userId: row.user_id,
          action: row.action,
          createdAt: row.created_at,
          details: (() => {
            try {
              return JSON.parse(row.details ?? "null");
            } catch {
              return null;
            }
          })(),
        }))
      );
    })
  );

  // Create a return (R08-09): strict body, sane period, rate fixed by law,
  // liability computed on creation (from the supplied figures or the books).
  app.post(
    "/api/companies/:companyId/corporate-tax/returns",
    authMiddleware,
    requireCustomer,
    strictBody(createCtReturnSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      await requireAccess(req, companyId);
      const body: CreateCtReturnBody = createCtReturnSchema.parse(req.body);

      // The CT provision posts on period end; block creation in a locked period.
      await assertPeriodNotLocked(companyId, body.taxPeriodEnd);
      const overlap = await findOverlappingReturn(
        companyId,
        body.taxPeriodStart,
        body.taxPeriodEnd
      );
      if (overlap) {
        throw new DomainError(
          "CT_RETURN_PERIOD_OVERLAP",
          409,
          { existingReturnId: overlap },
          "A corporate tax return already covers part of this period. Amend or void it first."
        );
      }
      const adjustments = parseAdjustments(body.adjustments);

      const inserted = await pool.query(
        `INSERT INTO corporate_tax_returns
           (company_id, tax_period_start, tax_period_end, status, prepared_by, notes,
            related_party_notes, tax_rate, exemption_threshold)
         VALUES ($1, $2::date, $3::date, 'draft', $4, $5, $6, $7, $8) RETURNING id`,
        [
          companyId,
          body.taxPeriodStart,
          body.taxPeriodEnd,
          userId,
          body.notes ?? null,
          body.relatedPartyNotes ?? null,
          CT_STANDARD_RATE,
          CT_ZERO_RATE_BAND,
        ]
      );
      const created = (await storage.getCorporateTaxReturn(inserted.rows[0].id))!;
      await auditCtReturn("created", userId, null, created, req);

      const rows = body.workpaper?.rows as CtWorkpaperRow[] | undefined;
      let figures: Parameters<typeof recomputeAndSave>[2];
      if (rows && rows.length > 0) {
        const t = computeCtTotals(rows);
        figures = {
          rows,
          totals: { totalRevenue: t.totalRevenue, totalExpenses: t.totalExpenses },
          source: "manual_workpaper",
        };
      } else if (body.totalRevenue !== undefined || body.totalExpenses !== undefined) {
        figures = {
          totals: {
            totalRevenue: body.totalRevenue ?? 0,
            totalExpenses: body.totalExpenses ?? 0,
          },
        };
      } else {
        figures = await booksOverrides(companyId, body.taxPeriodStart, body.taxPeriodEnd);
      }
      const result = await recomputeAndSave(
        created,
        userId,
        {
          ...figures,
          adjustments,
          totalDeductions: body.totalDeductions ?? 0,
          smallBusinessReliefElected: body.smallBusinessReliefElected ?? false,
        },
        req,
        "initial_compute"
      );
      res.status(201).json({ ...withDeadline(result.return), computation: result.computation });
    })
  );

  // Recompute the full taxable-profit bridge and mark the return computed.
  app.post(
    "/api/corporate-tax/returns/:id/compute",
    authMiddleware,
    requireCustomer,
    strictBody(computeCtReturnSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      const body: ComputeCtReturnBody = computeCtReturnSchema.parse(req.body);
      const result = await recomputeAndSave(
        ctReturn,
        req.user!.id,
        {
          adjustments: body.adjustments ? parseAdjustments(body.adjustments) : undefined,
          smallBusinessReliefElected: body.smallBusinessReliefElected,
          interest: body.interest,
          qfzp: body.qfzp,
          markComputed: true,
          extra:
            body.relatedPartyNotes !== undefined
              ? { relatedPartyNotes: body.relatedPartyNotes }
              : undefined,
        },
        req,
        "computed"
      );
      res.json({ return: withDeadline(result.return), computation: result.computation });
    })
  );

  // PATCH (R08-04, R08-09): editable fields only, draft/computed only.
  // Status changes go through /transition; filed returns answer 409.
  app.patch(
    "/api/corporate-tax/returns/:id",
    authMiddleware,
    requireCustomer,
    strictBody(patchCtReturnSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      assertEditable(ctReturn);
      const body: PatchCtReturnBody = patchCtReturnSchema.parse(req.body);
      const start = body.taxPeriodStart ?? uaeIsoDate(ctReturn.taxPeriodStart);
      const end = body.taxPeriodEnd ?? uaeIsoDate(ctReturn.taxPeriodEnd);
      if (body.taxPeriodStart || body.taxPeriodEnd) {
        const check = createCtReturnSchema.safeParse({ taxPeriodStart: start, taxPeriodEnd: end });
        if (!check.success) {
          throw new DomainError("CT_PERIOD_INVALID", 400, { issues: check.error.issues });
        }
        await assertPeriodNotLocked(ctReturn.companyId, end);
        const overlap = await findOverlappingReturn(ctReturn.companyId, start, end, ctReturn.id);
        if (overlap)
          throw new DomainError("CT_RETURN_PERIOD_OVERLAP", 409, { existingReturnId: overlap });
      }
      const totalsChanged = body.totalRevenue !== undefined || body.totalExpenses !== undefined;
      const result = await recomputeAndSave(
        ctReturn,
        req.user!.id,
        {
          adjustments: body.adjustments ? parseAdjustments(body.adjustments) : undefined,
          smallBusinessReliefElected: body.smallBusinessReliefElected,
          totalDeductions: body.totalDeductions,
          totals: totalsChanged
            ? {
                totalRevenue: body.totalRevenue ?? (Number(ctReturn.totalRevenue) || 0),
                totalExpenses: body.totalExpenses ?? (Number(ctReturn.totalExpenses) || 0),
              }
            : undefined,
          periodStart: start,
          periodEnd: end,
          extra: {
            ...(body.taxPeriodStart ? { taxPeriodStart: new Date(`${start}T00:00:00.000Z`) } : {}),
            ...(body.taxPeriodEnd ? { taxPeriodEnd: new Date(`${end}T00:00:00.000Z`) } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.relatedPartyNotes !== undefined
              ? { relatedPartyNotes: body.relatedPartyNotes }
              : {}),
          },
        },
        req,
        "updated"
      );
      res.json({ ...withDeadline(result.return), computation: result.computation });
    })
  );

  // Lifecycle transitions (R08-04): computed | reviewed | filed | paid | void.
  app.post(
    "/api/corporate-tax/returns/:id/transition",
    authMiddleware,
    requireCustomer,
    strictBody(transitionCtReturnSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      const body = transitionCtReturnSchema.parse(req.body);
      if (body.to === "reviewed" || body.to === "filed" || body.to === "paid") {
        await assertPermission(req, ctReturn.companyId, "tax.submit");
      }
      if (body.postProvision) await assertPermission(req, ctReturn.companyId, "ledger.post");
      const updated = await transitionCtReturn(ctReturn, body, req.user!.id, req);
      res.json(withDeadline(updated));
    })
  );

  // Amend by copy (R08-04): the filed original stays immutable.
  app.post(
    "/api/corporate-tax/returns/:id/amend",
    authMiddleware,
    requireCustomer,
    strictBody(amendCtReturnSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      await assertPermission(req, ctReturn.companyId, "tax.submit");
      const result = await amendCtReturn(ctReturn, req.user!.id, req.body.reason, req);
      res.status(201).json({
        original: withDeadline(result.original),
        amendment: withDeadline(result.amendment),
      });
    })
  );

  // Downloadable Excel copy: workpaper, computation, EmaraTax-ordered return
  // sheet (en + ar, upload manually) and the deferred-tax note.
  app.get(
    "/api/corporate-tax/returns/:id/export",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      const company = await storage.getCompany(ctReturn.companyId);
      const buffer = await buildCtReturnWorkbook(ctReturn, company ?? null);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${ctReturnExportFilename(ctReturn, company ?? null)}"`
      );
      res.setHeader("X-Filing-Mode", "manual-upload-no-fta-api");
      res.send(buffer);
    })
  );

  // Import a filled .xlsx workpaper; replaces the rows, keeps adjustments,
  // losses and elections, and recomputes the full liability (R08-08).
  app.post(
    "/api/corporate-tax/returns/:id/import-file",
    authMiddleware,
    requireCustomer,
    strictBody(importFileSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      assertEditable(ctReturn);
      const { fileName, fileDataBase64 } = req.body as z.output<typeof importFileSchema>;
      if (!/\.xlsx$/i.test(fileName)) {
        return res
          .status(400)
          .json({ message: "Only .xlsx workbooks are supported", code: "CT_IMPORT_TYPE" });
      }
      if (fileDataBase64.length === 0) {
        return res
          .status(400)
          .json({ message: "Workbook payload is required", code: "CT_IMPORT_EMPTY" });
      }
      const buffer = Buffer.from(fileDataBase64, "base64");
      if (buffer.length === 0 || buffer.length > CT_IMPORT_MAX_BYTES) {
        return res
          .status(400)
          .json({ message: "Workbook must be between 1 byte and 10 MB", code: "CT_IMPORT_SIZE" });
      }
      let rows: CtWorkpaperRow[];
      try {
        rows = await parseCtWorkbookRows(buffer);
      } catch {
        return res.status(400).json({
          message: "Could not read the workbook — is it a valid .xlsx file?",
          code: "CT_IMPORT_UNREADABLE",
        });
      }
      if (rows.length === 0) {
        return res.status(400).json({
          message: "No workpaper rows recognised in the workbook",
          code: "CT_IMPORT_NO_ROWS",
        });
      }
      if (rows.length > CT_IMPORT_MAX_ROWS) {
        return res.status(400).json({
          message: `Workbook has too many rows (max ${CT_IMPORT_MAX_ROWS})`,
          code: "CT_IMPORT_TOO_MANY_ROWS",
        });
      }
      const totals = computeCtTotals(rows);
      const result = await recomputeAndSave(
        ctReturn,
        req.user!.id,
        {
          rows,
          totals: { totalRevenue: totals.totalRevenue, totalExpenses: totals.totalExpenses },
          source: "manual_workpaper",
        },
        req,
        "imported"
      );
      res.json({
        ...withDeadline(result.return),
        computation: result.computation,
        imported: rows.length,
      });
    })
  );

  // Populate the workpaper from the books (posted, non-closing activity via the
  // reporting kernel) and recompute; adjustments/losses/elections preserved.
  app.post(
    "/api/corporate-tax/returns/:id/pull-from-books",
    authMiddleware,
    requireCustomer,
    strictBody(emptyBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctReturn = await loadReturn(req, req.params.id);
      assertEditable(ctReturn);
      const startIso = uaeIsoDate(ctReturn.taxPeriodStart);
      const endIso = uaeIsoDate(ctReturn.taxPeriodEnd);
      const figures = await booksOverrides(ctReturn.companyId, startIso, endIso);
      const result = await recomputeAndSave(
        ctReturn,
        req.user!.id,
        figures,
        req,
        "pulled_from_books"
      );
      res.json({
        ...withDeadline(result.return),
        computation: result.computation,
        rows: figures.rows?.length ?? 0,
        entriesProcessed: await countPeriodEntries(ctReturn.companyId, startIso, endIso),
      });
    })
  );

  // Preview corporate tax for a period from the ledger (nothing stored).
  app.get(
    "/api/companies/:companyId/corporate-tax/calculate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      // R12-05: accept periodStart/periodEnd, from/to or startDate/endDate.
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      if (!(req.query.periodEnd ?? req.query.to ?? req.query.endDate)) {
        return res.status(400).json({
          message: "periodStart and periodEnd query parameters are required",
          code: "REPORT_RANGE_REQUIRED",
        });
      }
      await requireAccess(req, companyId);

      // R08-02: reporting-kernel P&L — posted entries only, closing excluded.
      // Corporate tax expense itself is not deductible (Art. 33(9)).
      const [pl, books] = await Promise.all([
        profitAndLoss({ companyId, from: range.from, to: range.to }),
        readCtBooks(companyId, range.from!, range.to),
      ]);
      const totalRevenue = Math.max(0, pl.totalIncome);
      const totalExpenses = Math.max(
        0,
        Math.round((pl.totalExpenses - books.tags.corporateTaxExpenseExcluded) * 100) / 100
      );
      const entries = await countPeriodEntries(companyId, range.from!, range.to);

      const totalDeductions = 0;
      const liability = computeCtLiability({
        totalRevenue,
        totalExpenses,
        totalDeductions,
        exemptionThreshold: CT_ZERO_RATE_BAND,
        taxRate: CT_STANDARD_RATE,
      });

      // Small Business Relief (MD 73/2023): an election, revenue ≤ AED 3M, and
      // only for tax periods ending on or before 31 Dec 2026 (R08-14).
      const withinSunset = sbrAvailableForPeriodEnd(range.to);
      const sbrEligible = totalRevenue <= CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP && withinSunset;
      const sbrElected = String(req.query.sbrElected ?? "").toLowerCase() === "true";
      const sbrApplied = sbrEligible && sbrElected;

      res.json({
        periodStart: `${range.from}T00:00:00.000Z`,
        periodEnd: `${range.to}T00:00:00.000Z`,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses,
        grossProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        totalDeductions,
        taxableIncome: liability.taxableIncome,
        exemptionThreshold: liability.exemptionThreshold,
        taxableAmount: sbrApplied ? 0 : liability.taxableAmount,
        taxRate: sbrApplied ? 0 : liability.taxRate,
        taxPayable: sbrApplied ? 0 : liability.taxPayable,
        filingDeadline: ctFilingDeadline(range.to),
        smallBusinessRelief: {
          eligible: sbrEligible,
          elected: sbrElected,
          applied: sbrApplied,
          revenueCap: CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
          lastPeriodEnd: CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
          taxPayableWithRelief: 0,
          taxPayableWithoutRelief: liability.taxPayable,
          note: !withinSunset
            ? "Small Business Relief is only available for tax periods ending on or before 31 December 2026 (Ministerial Decision 73 of 2023)."
            : sbrEligible
              ? "Revenue is at or below AED 3,000,000, so Small Business Relief may be elected (Ministerial Decision 73 of 2023). Electing treats taxable income as nil, but forfeits the use of tax losses for the period. Eligibility also requires revenue to have stayed below the cap in every prior period — confirm your history before electing."
              : "Revenue exceeds AED 3,000,000, so Small Business Relief is not available for this period.",
        },
        journalEntriesProcessed: entries,
      });
    })
  );

  // ─── CT rules reference (thresholds + legal sources for the UI) ─────────
  app.get(
    "/api/companies/:companyId/corporate-tax/rules",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      const profile = await getCtProfile(companyId);
      res.json({
        adviserReviewPending: profile.adviserReviewPending,
        standardRate: CT_STANDARD_RATE,
        zeroRateBand: CT_ZERO_RATE_BAND,
        lossOffsetLimit: CT_LOSS_OFFSET_LIMIT,
        smallBusinessRelief: {
          revenueCap: CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
          lastPeriodEnd: CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END,
        },
        interestLimitation: {
          ebitdaShare: CT_INTEREST_EBITDA_SHARE,
          safeHarbour: CT_INTEREST_SAFE_HARBOUR,
        },
        qfzpDeMinimis: { share: CT_QFZP_DE_MINIMIS_SHARE, cap: CT_QFZP_DE_MINIMIS_CAP },
        transferPricing: {
          disclosureThreshold: CT_TP_DISCLOSURE_THRESHOLD,
          localFileRevenueThreshold: CT_TP_LOCAL_FILE_REVENUE_THRESHOLD,
          mneGroupRevenueThreshold: CT_TP_MNE_GROUP_REVENUE_THRESHOLD,
        },
        adjustmentCategories: Object.entries(CT_ADJUSTMENT_CATEGORIES).map(([key, def]) => ({
          key,
          ...def,
        })),
        documentation: "docs/corporate-tax-rules.md",
      });
    })
  );

  // ─── CT / compliance profile (QFZP, adviser confirmation, settings) ─────
  app.get(
    "/api/companies/:companyId/corporate-tax/profile",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await getCtProfile(companyId));
    })
  );

  app.put(
    "/api/companies/:companyId/corporate-tax/profile",
    authMiddleware,
    requireCustomer,
    strictBody(ctProfileSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      await assertPermission(req, companyId, "tax.submit");
      const before = await getCtProfile(companyId);
      const profile = await upsertCtProfile(companyId, req.body, req.user!.id);
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "corporate_tax_profile.update",
        entityType: "ct_company_profile",
        entityId: companyId,
        before,
        after: profile,
        req,
      });
      res.json(profile);
    })
  );

  app.post(
    "/api/companies/:companyId/corporate-tax/profile/adviser-confirmation",
    authMiddleware,
    requireCustomer,
    strictBody(ctAdviserConfirmationSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      await assertPermission(req, companyId, "tax.submit");
      const profile = await confirmCtAdviserReview(
        companyId,
        req.user!.id,
        req.body.adviserName,
        req.body.note ?? null
      );
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "corporate_tax_profile.adviser_confirmed",
        entityType: "ct_company_profile",
        entityId: companyId,
        after: { adviserName: req.body.adviserName, note: req.body.note ?? null },
        req,
      });
      res.json(profile);
    })
  );

  // ─── Related-party / connected-person register (R08-17) ─────────────────
  app.get(
    "/api/companies/:companyId/corporate-tax/related-parties",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await listRelatedParties(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/corporate-tax/related-parties",
    authMiddleware,
    requireCustomer,
    strictBody(ctRelatedPartySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.status(201).json(await createRelatedParty(companyId, req.body, req.user!.id));
    })
  );

  app.delete(
    "/api/companies/:companyId/corporate-tax/related-parties/:partyId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, partyId } = req.params;
      await requireAccess(req, companyId);
      if (!zUuid.safeParse(partyId).success) throw new DomainError("NOT_FOUND", 404);
      const ok = await deleteRelatedParty(companyId, partyId);
      if (!ok) throw new DomainError("NOT_FOUND", 404);
      res.status(204).end();
    })
  );

  // ─── Account tax tags (R08-18) ───────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/corporate-tax/account-tags",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      res.json(await listTaggedAccounts(companyId));
    })
  );

  app.put(
    "/api/companies/:companyId/corporate-tax/account-tags",
    authMiddleware,
    requireCustomer,
    strictBody(ctAccountTagSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      await assertPermission(req, companyId, "ledger.post");
      res.json(await setAccountTaxTag(companyId, req.body.accountId, req.body.taxTag));
    })
  );

  app.post(
    "/api/companies/:companyId/corporate-tax/account-tags/ensure",
    authMiddleware,
    requireCustomer,
    strictBody(emptyBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireAccess(req, companyId);
      await assertPermission(req, companyId, "ledger.post");
      const map = await ensureCtTagAccounts(companyId);
      res.json([...map.values()]);
    })
  );
}
