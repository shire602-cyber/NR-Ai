import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { companyUsers } from "../../shared/schema";
import {
  canAccessNraCenter,
  firmRoleCanWrite,
  firmRoleHasPermission,
  hasFullNraScope,
  isFirmRole,
  type FirmPermission,
} from "../../shared/access";
import {
  NR_FIRM_ID,
  canAccessFirmClient,
  listAccessibleClientIds,
  resolveFirmContext,
  type FirmContext,
} from "../services/firm/scope";

export type { NraFirmRole as FirmRole } from "../../shared/access";
export type { FirmContext } from "../services/firm/scope";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Require the requesting user to have one of the given roles in the active
 * company (identified by req.params.companyId or req.body.companyId).
 *
 * Platform admins pass; firm staff pass only for a client of their own firm
 * that they may access. Must be used AFTER authMiddleware.
 */
export function requireRole(...roles: string[]) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    const companyId = req.params.companyId ?? req.body?.companyId;
    if (req.user.isAdmin === true) {
      next();
      return;
    }
    if (!companyId) {
      res.status(400).json({ message: "Company context required" });
      return;
    }

    if (hasFullNraScope(req.user)) {
      const ctx = await resolveFirmContext(req.user);
      if (ctx && (await canAccessFirmClient(ctx, companyId))) {
        next();
        return;
      }
    }

    const [membership] = await db
      .select({ role: companyUsers.role })
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, req.user.id)))
      .limit(1);

    if (!membership) {
      res.status(403).json({ message: "Not a member of this company" });
      return;
    }

    if (!roles.includes(membership.role)) {
      res.status(403).json({
        message: `Role '${membership.role}' is not authorized. Required: ${roles.join(", ")}`,
      });
      return;
    }

    next();
  };
}

/**
 * NR-only gate: platform admins and NR firm staff (users.firm_role, any firm
 * role). Mounted by the NR-only surfaces — WhatsApp, document chasing, email
 * intake, SaaS prospects, growth ops — so staff of other accounting firms,
 * SaaS customers and client-portal users are always rejected, even when they
 * guess URLs. NR viewers are read-only here too. Mirrors canAccessNraCenter().
 *
 * Must be used AFTER authMiddleware.
 */
export function requireNraAccess() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (!canAccessNraCenter(req.user)) {
      res.status(403).json({ message: "NRA firm staff access required" });
      return;
    }
    if (
      req.user.isAdmin !== true &&
      !READ_METHODS.has(req.method) &&
      !firmRoleCanWrite(req.user.firmRole)
    ) {
      res.status(403).json({ message: "Your firm role is read-only", code: "FIRM_READ_ONLY" });
      return;
    }
    next();
  };
}

/** The firm context requireFirmAccess() resolved for this request. */
export function firmContextOf(res: Response): FirmContext {
  const ctx = res.locals.firmContext as FirmContext | undefined;
  if (!ctx) throw new Error("firmContextOf() called without requireFirmAccess()");
  return ctx;
}

function attachFirmContext(
  req: Request,
  res: Response,
  next: NextFunction,
  ctx: FirmContext | null
): void {
  if (!ctx) {
    res.status(403).json({ message: "Firm staff access required", code: "FIRM_ACCESS_REQUIRED" });
    return;
  }
  if (!ctx.platformAdmin && !READ_METHODS.has(req.method) && !firmRoleCanWrite(ctx.role)) {
    res.status(403).json({ message: "Your firm role is read-only", code: "FIRM_READ_ONLY" });
    return;
  }
  res.locals.firmContext = ctx;
  next();
}

/**
 * Practice-tool gate (multi-firm): platform admins, NR staff and members of
 * any *approved* accounting firm. Resolves the caller's firm onto
 * res.locals.firmContext (read it with firmContextOf). Viewers are read-only.
 * NR staff and admins resolve synchronously (no DB hit).
 *
 * Must be used AFTER authMiddleware.
 */
export function requireFirmAccess(): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction): void {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (isFirmRole(user.firmRole)) {
      attachFirmContext(req, res, next, {
        firmId: NR_FIRM_ID,
        isNr: true,
        role: user.firmRole,
        userId: user.id,
        platformAdmin: false,
      });
      return;
    }
    if (user.isAdmin === true) {
      attachFirmContext(req, res, next, {
        firmId: NR_FIRM_ID,
        isNr: true,
        role: "firm_owner",
        userId: user.id,
        platformAdmin: true,
      });
      return;
    }
    if (!user.id) {
      attachFirmContext(req, res, next, null);
      return;
    }
    resolveFirmContext({ id: user.id, isAdmin: false, firmRole: null })
      .then((ctx) => attachFirmContext(req, res, next, ctx))
      .catch(next);
  };
}

/**
 * Require a firm permission (shared/access.ts FIRM_ROLE_PERMISSIONS). Mount
 * after requireFirmAccess(). Platform admins pass.
 */
export function requireFirmPermission(permission: FirmPermission): RequestHandler {
  return function (_req: Request, res: Response, next: NextFunction): void {
    const ctx = res.locals.firmContext as FirmContext | undefined;
    if (!ctx) {
      res.status(403).json({ message: "Firm staff access required", code: "FIRM_ACCESS_REQUIRED" });
      return;
    }
    if (ctx.platformAdmin || firmRoleHasPermission(ctx.role, permission)) {
      next();
      return;
    }
    res.status(403).json({
      message: "Your firm role does not allow this action",
      code: "FIRM_PERMISSION_DENIED",
      details: { permission, role: ctx.role },
    });
  };
}

/** NR-only routes (keyed on firms.is_nr) mounted after requireFirmAccess(). */
export function requireNrFirm(): RequestHandler {
  return function (_req: Request, res: Response, next: NextFunction): void {
    const ctx = res.locals.firmContext as FirmContext | undefined;
    if (!ctx?.isNr) {
      res.status(403).json({ message: "NRA firm staff access required", code: "NR_FIRM_ONLY" });
      return;
    }
    next();
  };
}

/**
 * @deprecated Alias of requireNraAccess() kept for the NR-only surfaces
 * (WhatsApp, document chasing, email intake, NRA routes). Practice tools use
 * requireFirmAccess().
 */
export function requireFirmRole() {
  return requireNraAccess();
}

/**
 * @deprecated Alias of requireFirmAccess() (command centre, VAT workspace).
 */
export function requireFirmAdmin() {
  return requireFirmAccess();
}

/**
 * Require NR firm_owner (or a platform admin acting in support). Kept for
 * NR-only destructive endpoints; multi-firm routes use
 * requireFirmPermission("firm.bulk.run" | "firm.staff.manage" | ...).
 *
 * Must be used AFTER authMiddleware.
 */
export function requireFirmOwner() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    if (!hasFullNraScope(req.user)) {
      res.status(403).json({ message: "Firm owner access required" });
      return;
    }
    next();
  };
}

/**
 * Returns the client company IDs a user may access through the firm
 * workspace, or null for "all client companies" (platform admins only).
 *
 * - firm_owner: every client of the caller's firm (firm_client_links; for NR
 *   also legacy unlinked company_type='client' companies).
 * - firm_admin / preparer / reviewer / viewer: the firm's clients they are
 *   assigned to via firm_staff_assignments or company_users.
 * - not firm staff: [].
 *
 * Never returns another firm's clients (R15-12).
 */
export async function getAccessibleCompanyIds(
  userId: string,
  firmRole: string,
  isAdmin = false
): Promise<string[] | null> {
  if (isAdmin && !isFirmRole(firmRole)) return null;
  const ctx = await resolveFirmContext({ id: userId, isAdmin, firmRole: firmRole || null });
  if (!ctx) return [];
  return listAccessibleClientIds(ctx);
}
