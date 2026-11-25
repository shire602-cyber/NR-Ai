/**
 * Vendor master, vendor statements / aging and approval rules (W3-B: R04-16, R04-19, R04-22).
 * Every route is company-scoped in the URL; a vendor or rule id from another tenant is a 404.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requirePermission } from "../middleware/companyRolePolicy";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import {
  backfillVendorLinks,
  createVendor,
  getVendor,
  listVendors,
  payablesAging,
  updateVendor,
  vendorStatement,
} from "../services/vendor.service";
import {
  createRule,
  deleteRule,
  listRules,
  setSelfApprovalSetting,
  allowsSingleMemberSelfApproval,
} from "../services/approval-rules.service";
import {
  approvalRuleCreateSchema,
  approvalSettingsSchema,
  vendorCreateSchema,
  vendorUpdateSchema,
  type ApprovalRuleCreateInput,
  type VendorCreateInput,
  type VendorUpdateInput,
} from "../../shared/validators/vendors";
import { zUuid } from "../../shared/validators/primitives";
import { parseReportDate, uaeToday } from "../reporting";

async function assertCompanyAccess(req: Request, companyId: string) {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
}

function vendorIdOf(req: Request): string {
  const id = req.params.vendorId;
  if (!zUuid.safeParse(id).success)
    throw new DomainError("VENDOR_NOT_FOUND", 404, undefined, "Vendor not found");
  return id;
}

export function registerVendorRoutes(app: Express) {
  // ── Vendors ─────────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/vendors",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      res.json(
        await listVendors(companyId, { includeInactive: req.query.include_inactive === "true" })
      );
    })
  );

  app.post(
    "/api/companies/:companyId/vendors",
    authMiddleware,
    requireCustomer,
    strictBody(vendorCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const vendor = await createVendor(companyId, req.body as VendorCreateInput);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "vendor.create",
        entityType: "vendor",
        entityId: vendor.id,
        after: vendor,
        req,
      });
      res.status(201).json(vendor);
    })
  );

  app.post(
    "/api/companies/:companyId/vendors/backfill",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({ create_missing: z.boolean().optional() })),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const out = await backfillVendorLinks(companyId, {
        createMissing: (req.body as { create_missing?: boolean }).create_missing === true,
      });
      res.json(out);
    })
  );

  app.get(
    "/api/companies/:companyId/vendors/aging",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const asOf = parseReportDate(req.query.as_of ?? req.query.asOf, "as_of") ?? uaeToday();
      res.json(await payablesAging(companyId, asOf));
    })
  );

  app.get(
    "/api/companies/:companyId/vendors/:vendorId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      res.json(await getVendor(companyId, vendorIdOf(req)));
    })
  );

  app.patch(
    "/api/companies/:companyId/vendors/:vendorId",
    authMiddleware,
    requireCustomer,
    strictBody(vendorUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const id = vendorIdOf(req);
      const before = await getVendor(companyId, id);
      const vendor = await updateVendor(companyId, id, req.body as VendorUpdateInput);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "vendor.update",
        entityType: "vendor",
        entityId: id,
        before,
        after: vendor,
        req,
      });
      res.json(vendor);
    })
  );

  /** Deactivate (vendors referenced by bills are never hard-deleted). */
  app.delete(
    "/api/companies/:companyId/vendors/:vendorId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const vendor = await updateVendor(companyId, vendorIdOf(req), { is_active: false });
      res.json(vendor);
    })
  );

  app.get(
    "/api/companies/:companyId/vendors/:vendorId/statement",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const to = parseReportDate(req.query.to, "to") ?? uaeToday();
      const from = parseReportDate(req.query.from, "from");
      res.json(await vendorStatement(companyId, vendorIdOf(req), { from, to }));
    })
  );

  // ── Approval rules ──────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/approval-rules",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const docType =
        typeof req.query.document_type === "string" ? req.query.document_type : undefined;
      res.json({
        rules: await listRules(companyId, docType),
        allowSingleMemberSelfApproval: await allowsSingleMemberSelfApproval(companyId),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/approval-rules",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(approvalRuleCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const rule = await createRule(
        companyId,
        req.user!.id,
        req.body as ApprovalRuleCreateInput,
        req
      );
      res.status(201).json(rule);
    })
  );

  app.delete(
    "/api/companies/:companyId/approval-rules/:ruleId",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, ruleId } = req.params;
      if (!zUuid.safeParse(ruleId).success || !(await deleteRule(companyId, ruleId))) {
        throw new DomainError("APPROVAL_RULE_NOT_FOUND", 404);
      }
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "approval_rule.delete",
        entityType: "approval_rule",
        entityId: ruleId,
        req,
      });
      res.json({ deleted: true });
    })
  );

  app.put(
    "/api/companies/:companyId/approval-settings",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(approvalSettingsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const allow = (req.body as { allow_single_member_self_approval: boolean })
        .allow_single_member_self_approval;
      await setSelfApprovalSetting(companyId, allow);
      res.json({ allowSingleMemberSelfApproval: allow });
    })
  );
}
