import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../config/logger';

const log = createLogger('http');

/**
 * HTTP request/response logger middleware.
 * Logs method, path, status code, and duration for all /api routes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const path = req.originalUrl || req.url;

    // Only log API requests (skip static files)
    if (!path.startsWith('/api') && path !== '/health') return;

    const logData = {
      method: req.method,
      path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: (req as any).user?.id,
    };

    if (res.statusCode >= 500) {
      log.error(logData, `${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    } else if (res.statusCode >= 400) {
      log.warn(logData, `${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    } else {
      log.info(logData, `${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
}
