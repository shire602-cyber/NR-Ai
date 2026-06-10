import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

const HEADER = 'x-request-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assigns a UUID correlation ID to every request.
 *
 * Honors an inbound `X-Request-Id` header when it looks like a UUID, so
 * upstream proxies / load balancers can propagate their trace ID. Otherwise
 * generates a fresh one. The ID is exposed on `req.id` and echoed back via
 * the `X-Request-Id` response header so clients can quote it in bug reports.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADER);
  const id = inbound && UUID_RE.test(inbound) ? inbound : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
