import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { companyUsers, firmStaffAssignments } from '../../shared/schema';

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
 * Returns the list of company IDs a firm staff member may access.
 * - firm_owner: all companies (returns null → caller should not filter)
 * - firm_admin: only assigned companies
 */
export async function getAccessibleCompanyIds(
  userId: string,
  firmRole: string
): Promise<string[] | null> {
  if (firmRole === 'firm_owner') return null;

  const rows = await db
    .select({ companyId: firmStaffAssignments.companyId })
    .from(firmStaffAssignments)
    .where(eq(firmStaffAssignments.userId, userId));

  return rows.map((r: { companyId: string }) => r.companyId);
}
