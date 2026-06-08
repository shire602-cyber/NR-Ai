import { inArray } from 'drizzle-orm';
import type { Express } from 'express';
import { Router } from 'express';
import { companies } from '../../shared/schema';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getAccessibleCompanyIds,requireFirmRole } from '../middleware/rbac';

const router = Router();

// All NRA routes require authentication + firm staff role
router.use(authMiddleware);
router.use(requireFirmRole());

/**
 * GET /nra/clients
 * Returns the list of client companies accessible to the requesting firm staff member.
 * - firm_owner: all companies
 * - firm_admin: only assigned companies
 */
router.get('/clients', asyncHandler(async (req, res) => {
  const { id: userId, firmRole } = req.user as Express.User;

  const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

  let rows;
  if (accessibleIds === null) {
    // firm_owner — all companies
    rows = await db.select().from(companies);
  } else if (accessibleIds.length === 0) {
    rows = [];
  } else {
    rows = await db
      .select()
      .from(companies)
      .where(inArray(companies.id, accessibleIds));
  }

  res.json(rows);
}));

/**
 * GET /nra/health
 * Placeholder for the client health dashboard.
 */
router.get('/health', asyncHandler(async (_req, res) => {
  res.json({ message: 'Health dashboard — coming in Phase 1' });
}));

/**
 * GET /nra/communications
 * Placeholder for the communications center.
 */
router.get('/communications', asyncHandler(async (_req, res) => {
  res.json({ message: 'Communications — coming in Phase 1' });
}));

/**
 * GET /nra/bulk
 * Placeholder for bulk operations.
 */
router.get('/bulk', asyncHandler(async (_req, res) => {
  res.json({ message: 'Bulk operations — coming in Phase 1' });
}));

export function registerNRARoutes(app: Express) {
  app.use('/nra', router);
}
