import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';

const log = createLogger('client-error');

const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(8000).optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  boundary: z.string().max(120).optional(),
  releaseTag: z.string().max(120).optional(),
});

export function registerClientErrorRoutes(app: Express) {
  app.post(
    '/api/client-errors',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = clientErrorSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const userId = (req as any).user?.id ?? null;
      log.error(
        {
          ...parsed.data,
          userId,
          ip: req.ip,
          requestId: req.id,
        },
        'Client-side error reported',
      );

      // Always 204 — never let logging failures cascade back to the UI.
      res.status(204).end();
    }),
  );
}
