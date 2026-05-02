import type { Express, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireFirmAdmin } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import {
  buildClientAuditPack,
  buildClientCfoPack,
  buildFirmReviewQueue,
  buildFirmValueOps,
} from '../services/firm-value-ops.service';
import { resolveAccessibleClientIds } from '../services/firm-command-center.service';

const logger = createLogger('firm-value-ops-routes');

const companyIdParamSchema = z.object({ companyId: z.string().uuid() });

async function requireAccessibleClient(req: Request, res: Response): Promise<string | null> {
  const parsed = companyIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid companyId' });
    return null;
  }

  const { id: userId, firmRole } = (req as any).user;
  const accessible = await resolveAccessibleClientIds(userId, firmRole ?? null);
  if (!accessible.includes(parsed.data.companyId)) {
    res.status(403).json({ message: 'Access denied to this client' });
    return null;
  }

  return parsed.data.companyId;
}

export function registerFirmValueOpsRoutes(app: Express): void {
  const router = Router();

  router.use(authMiddleware as any);
  router.use(requireFirmAdmin());

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const companyIds = await resolveAccessibleClientIds(userId, firmRole ?? null);
      const dashboard = await buildFirmValueOps(companyIds);
      res.json(dashboard);
    }),
  );

  router.get(
    '/review-queue',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const companyIds = await resolveAccessibleClientIds(userId, firmRole ?? null);
      const queue = await buildFirmReviewQueue(companyIds);
      res.json(queue);
    }),
  );

  router.get(
    '/clients/:companyId/audit-pack',
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireAccessibleClient(req, res);
      if (!companyId) return;

      const pack = await buildClientAuditPack(companyId);
      if (!pack) return res.status(404).json({ message: 'Client not found' });
      res.json(pack);
    }),
  );

  router.get(
    '/clients/:companyId/cfo-pack',
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireAccessibleClient(req, res);
      if (!companyId) return;

      const pack = await buildClientCfoPack(companyId);
      if (!pack) return res.status(404).json({ message: 'Client not found' });
      res.json(pack);
    }),
  );

  app.use('/api/firm/value-ops', router);
  logger.info('Firm value ops routes registered at /api/firm/value-ops/*');
}
