import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, and, isNull } from 'drizzle-orm';
import { companyUsers, companies, firmStaffAssignments } from '../../shared/schema';

const FIRM_ROLES = ['firm_owner', 'firm_admin'] as const;
export type FirmRole = typeof FIRM_ROLES[number];

/**
 * Require the requesting user to have one of the given roles in the active
 * company (identified by req.params.companyId or req.body.companyId).
 *
 * Must be used AFTER authMiddleware.
 */
export function requireRole(...roles: string[]) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    // firm_owner bypasses all company-level role checks
    if ((req.user as any).firmRole === 'firm_owner') {
      next();
      return;
    }

    const companyId = req.params.companyId ?? req.body?.companyId;
    if (!companyId) {
      res.status(400).json({ message: 'Company context required' });
      return;
    }

    const [membership] = await db
      .select({ role: companyUsers.role })
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          eq(companyUsers.userId, req.user.id)
        )
      )
      .limit(1);

    if (!membership) {
      res.status(403).json({ message: 'Not a member of this company' });
      return;
    }

    if (!roles.includes(membership.role)) {
      res.status(403).json({
        message: `Role '${membership.role}' is not authorized. Required: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Require the requesting user to be firm_owner or firm_admin.
 * This gates access to the NRA Management Center.
 *
 * Must be used AFTER authMiddleware.
 */
export function requireFirmRole() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const firmRole = (req.user as any).firmRole as string | undefined;
    if (!firmRole || !FIRM_ROLES.includes(firmRole as FirmRole)) {
      res.status(403).json({ message: 'NRA firm staff access required' });
      return;
    }

    next();
  };
}

/**
 * Require firm_owner specifically (firm_admin is rejected).
 * Used to gate destructive / batch / firm-wide configuration endpoints.
 *
 * Must be used AFTER authMiddleware.
 */
export function requireFirmOwner() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    const firmRole = (req.user as any).firmRole as string | undefined;
    if (firmRole !== 'firm_owner') {
      res.status(403).json({ message: 'Firm owner access required' });
      return;
    }
    next();
  };
}

/**
 * Require firm_admin or firm_owner (read-only firm endpoints).
 * Alias for the broader requireFirmRole(); kept as a separate name so route
 * intent is obvious at the call site.
 *
 * Must be used AFTER authMiddleware.
 */
export function requireFirmAdmin() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    const firmRole = (req.user as any).firmRole as string | undefined;
    if (!firmRole || !FIRM_ROLES.includes(firmRole as FirmRole)) {
      res.status(403).json({ message: 'NRA firm staff access required' });
      return;
    }
    next();
  };
}

/**
 * Returns the list of company IDs a firm staff member may access.
 * - firm_owner: all companies (returns null → caller should not filter)
 * - firm_admin: client companies the user is linked to via either
 *     (a) firm_staff_assignments — explicit firm-staff assignment, or
 *     (b) company_users — direct membership added through /assign-staff or
 *         auto-assigned when the firm_admin creates/imports the client.
 *   Soft-deleted and non-client companies are excluded so firm-admin
 *   listings stay consistent with the firm_owner view (which always
 *   filters by companyType='client' AND deletedAt IS NULL).
 *
 * Why both tables? POST /firm/clients, POST /firm/clients/import and
 * POST /firm/clients/:id/assign-staff write to company_users; the
 * firm_staff_assignments table was added later for analytics joins.
 * Filtering on assignments alone would silently hide every client a
 * firm_admin has access to, so we union both sources.
 */
export async function getAccessibleCompanyIds(
  userId: string,
  firmRole: string
): Promise<string[] | null> {
  if (firmRole === 'firm_owner') return null;

  const [byAssignment, byMembership] = await Promise.all([
    db
      .select({ companyId: companies.id })
      .from(firmStaffAssignments)
      .innerJoin(companies, eq(companies.id, firmStaffAssignments.companyId))
      .where(
        and(
          eq(firmStaffAssignments.userId, userId),
          eq(companies.companyType, 'client'),
          isNull(companies.deletedAt),
        ),
      ),
    db
      .select({ companyId: companies.id })
      .from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(
        and(
          eq(companyUsers.userId, userId),
          eq(companies.companyType, 'client'),
          isNull(companies.deletedAt),
        ),
      ),
  ]);

  const ids = new Set<string>();
  for (const r of byAssignment as { companyId: string }[]) ids.add(r.companyId);
  for (const r of byMembership as { companyId: string }[]) ids.add(r.companyId);
  return Array.from(ids);
}
