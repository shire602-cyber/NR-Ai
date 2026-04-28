import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/**
 * Assigns a request ID to every request. Honors a client-supplied
 * `X-Request-Id` header when present (capped at 128 chars and
 * sanitized) so upstream traces can be correlated; otherwise mints
 * a UUID. The id is exposed back on the response and on `req.id` for
 * downstream loggers.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const safe =
    incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  req.id = safe;
  res.setHeader('X-Request-Id', safe);
  next();
}
