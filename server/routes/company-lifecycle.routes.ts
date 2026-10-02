/**
 * D5 data lifecycle: company export (ZIP) and the owner-confirmed, 30-day
 * soft deletion with restore. Money and ledgers are never touched here.
 */
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { pool } from "../db";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requireFirmOwner } from "../middleware/rbac";
import { hasFullNraScope } from "../../shared/access";
import { asyncHandler } from "../middleware/errorHandler";
import { buildLimiter } from "../middleware/rateLimit";
import { recordAudit } from "../services/audit.service";
import {
  ExportInProgressError,
  getExport,
  listExports,
  readExportZip,
  requestExport,
} from "../services/company-export";
import {
  DeletionError,
  canActOnRequest,
  confirmByFirm,
  getRequest,
  listDeletionsForUser,
  requestDeletion,
  restoreCompany,
} from "../services/company-deletion";
import { isTwoFactorEnabled, verifyTotpCode } from "../services/two-factor";

const reauthLimiter = buildLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Too many confirmation attempts. Please wait a minute.",
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `reauth:${req.user?.id ?? req.ip}`,
});

const deleteBodySchema = z.object({
  password: z.string().max(200).optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
  confirmName: z.string().max(300).optional(),
  reason: z.string().max(500).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The company's OWNER only. A full-company export holds everything, payroll and owners' details
 * included, so accountants are refused (403) however the route is reached. An owner may still export
 * during the 30-day deletion window (that is when people want their books out); nobody else may, and
 * a deleted company is never reachable through platform-wide scopes. After the purge the memberships
 * are gone and so is this access.
 */
const exportAccess = asyncHandler(async (req: Request, res: Response, next: any) => {
  if (!req.user) return res.status(401).json({ message: "Authentication required" });
  const { rows } = await pool.query(
    `SELECT cu.role, c.deleted_at,
            EXISTS (SELECT 1 FROM company_deletion_requests r WHERE r.company_id = c.id AND r.status = 'pending') AS deletion_pending
       FROM companies c LEFT JOIN company_users cu ON cu.company_id = c.id AND cu.user_id = $2
      WHERE c.id = $1`,
    [req.params.companyId, req.user.id]
  );
  const m = rows[0];
  if (!m) return res.status(404).json({ message: "Company not found", code: "NOT_FOUND" });
  const owner = m.role === "owner";
  const platformScope = hasFullNraScope(req.user as any) && !m.deleted_at;
  if (!owner && !platformScope) {
    return res.status(403).json({
      message: m.role ? "Only the company owner can export the company's data" : "Not a member of this company",
      code: m.role ? "OWNER_REQUIRED" : "FORBIDDEN",
    });
  }
  if (m.deleted_at && !m.deletion_pending) return res.status(403).json({ message: "Not a member of this company", code: "FORBIDDEN" });
  next();
});

function present(row: any, withManifest = false) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    error: row.error,
    ...(withManifest ? { manifest: row.manifest } : {}),
  };
}

function handleDeletionError(res: Response, err: unknown): boolean {
  if (err instanceof DeletionError) {
    res.status(err.status).json({ message: err.message, code: err.code });
    return true;
  }
  return false;
}

export function registerCompanyLifecycleRoutes(app: Express): void {
  // ── Export ──────────────────────────────────────────────────────────
  app.post(
    "/api/companies/:companyId/exports",
    authMiddleware,
    requireCustomer,
    exportAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      try {
        const job = await requestExport(companyId, req.user!.id);
        await recordAudit({ userId: req.user!.id, companyId, action: "company.export_requested", entityType: "company", entityId: companyId, req });
        res.status(202).json(present(job));
      } catch (err) {
        if (err instanceof ExportInProgressError) {
          return res.status(409).json({ message: err.message, code: "EXPORT_IN_PROGRESS" });
        }
        throw err;
      }
    })
  );

  app.get(
    "/api/companies/:companyId/exports",
    authMiddleware,
    requireCustomer,
    exportAccess,
    asyncHandler(async (req: Request, res: Response) => {
      res.json((await listExports(req.params.companyId)).map((r: unknown) => present(r)));
    })
  );

  app.get(
    "/api/companies/:companyId/exports/:id",
    authMiddleware,
    requireCustomer,
    exportAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const row = UUID.test(req.params.id) ? await getExport(req.params.companyId, req.params.id) : undefined;
      if (!row) return res.status(404).json({ message: "Export not found", code: "NOT_FOUND" });
      res.json(present(row, true));
    })
  );

  app.get(
    "/api/companies/:companyId/exports/:id/download",
    authMiddleware,
    requireCustomer,
    exportAccess,
    asyncHandler(async (req: Request, res: Response) => {
      const row = UUID.test(req.params.id) ? await getExport(req.params.companyId, req.params.id) : undefined;
      if (!row) return res.status(404).json({ message: "Export not found", code: "NOT_FOUND" });
      const expired = row.status === "expired" || (row.status === "ready" && !!row.expiresAt && row.expiresAt.getTime() <= Date.now());
      if (expired) return res.status(410).json({ message: "This export link has expired. Request a new export.", code: "EXPORT_EXPIRED" });
      if (row.status !== "ready") return res.status(409).json({ message: "The export is not ready yet", code: "EXPORT_NOT_READY" });
      const zip = await readExportZip(row);
      if (!zip) return res.status(410).json({ message: "The export file is no longer available", code: "EXPORT_EXPIRED" });
      await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "company.export_downloaded", entityType: "company", entityId: row.id, req });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="muhasib-export-${row.id.slice(0, 8)}.zip"`);
      res.setHeader("X-Export-SHA256", row.sha256 ?? "");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(zip);
    })
  );

  // ── Deletion ────────────────────────────────────────────────────────
  app.delete(
    "/api/companies/:companyId",
    authMiddleware,
    requireCustomer,
    reauthLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = deleteBodySchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Invalid request", code: "VALIDATION_ERROR" });
      const userId = req.user!.id;

      // Owner only, by real membership (a platform admin or firm owner does not delete a customer's company).
      const { rows } = await pool.query(
        `SELECT cu.role, c.name, c.deleted_at FROM company_users cu JOIN companies c ON c.id = cu.company_id WHERE cu.company_id = $1 AND cu.user_id = $2`,
        [companyId, userId]
      );
      if (!rows[0] || rows[0].deleted_at) return res.status(403).json({ message: "Access denied" });
      if (rows[0].role !== "owner") return res.status(403).json({ message: "Only a company owner can delete the company", code: "OWNER_REQUIRED" });

      // Fresh re-authentication: password, and the authenticator code when 2FA is on.
      if (!body.data.password) return res.status(401).json({ message: "Confirm your password to delete the company", code: "REAUTH_REQUIRED" });
      const user = await storage.getUser(userId);
      if (!user || !(await bcrypt.compare(body.data.password, user.passwordHash))) {
        return res.status(401).json({ message: "Password is incorrect", code: "PASSWORD_INVALID" });
      }
      if (await isTwoFactorEnabled(userId)) {
        if (!body.data.code) return res.status(401).json({ message: "Enter your authenticator code", code: "TOTP_INVALID" });
        const totp = await verifyTotpCode(userId, body.data.code);
        if (!totp.ok) return res.status(401).json({ message: "The code is not valid", code: totp.code });
      }
      if ((body.data.confirmName ?? "").trim() !== String(rows[0].name).trim()) {
        return res.status(422).json({ message: "Type the company name exactly to confirm", code: "CONFIRM_NAME_MISMATCH" });
      }

      try {
        const request = await requestDeletion({ companyId, userId, reason: body.data.reason ?? null });
        await recordAudit({
          userId,
          companyId,
          action: "company.deletion_requested",
          entityType: "company",
          entityId: companyId,
          after: { requestId: request.id, status: request.status, purgeAfter: request.purgeAfter },
          req,
        });
        res.status(202).json({ requestId: request.id, status: request.status, purgeAfter: request.purgeAfter });
      } catch (err) {
        if (handleDeletionError(res, err)) return;
        throw err;
      }
    })
  );

  app.get(
    "/api/me/company-deletions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listDeletionsForUser(req.user!.id));
    })
  );

  app.post(
    "/api/company-deletions/:id/restore",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const row = UUID.test(req.params.id) ? await getRequest(req.params.id) : undefined;
      if (!row || !(await canActOnRequest(req.user!.id, row))) {
        return res.status(404).json({ message: "Deletion request not found", code: "NOT_FOUND" });
      }
      try {
        const restored = await restoreCompany(row.id);
        await recordAudit({ userId: req.user!.id, companyId: row.companyId, action: "company.restored", entityType: "company", entityId: row.companyId, req });
        res.json({ requestId: restored.id, status: restored.status });
      } catch (err) {
        if (handleDeletionError(res, err)) return;
        throw err;
      }
    })
  );

  app.post(
    "/api/firm/company-deletions/:id/confirm",
    authMiddleware,
    requireFirmOwner(),
    asyncHandler(async (req: Request, res: Response) => {
      if (!UUID.test(req.params.id)) return res.status(404).json({ message: "Deletion request not found", code: "NOT_FOUND" });
      try {
        const confirmed = await confirmByFirm(req.params.id, req.user!.id);
        await recordAudit({ userId: req.user!.id, companyId: confirmed.companyId, action: "company.deletion_confirmed_by_firm", entityType: "company", entityId: confirmed.companyId, req });
        res.json({ requestId: confirmed.id, status: confirmed.status, purgeAfter: confirmed.purgeAfter });
      } catch (err) {
        if (handleDeletionError(res, err)) return;
        throw err;
      }
    })
  );
}
