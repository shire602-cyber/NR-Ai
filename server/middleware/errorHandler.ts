import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../config/logger';
import { isProduction } from '../config/env';
import { RetentionViolationError } from '../services/retention.service';
import { AppError, RetentionError, ValidationError, AuthError } from '../errors';

const log = createLogger('error');

// Re-export AppError so existing imports of AppError from this module keep working.
export { AppError };

function withRequestId<T extends object>(body: T, req: Request): T & { requestId?: string } {
  return req.id ? { ...body, requestId: req.id } : body;
}

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes.
 *
 * Returns a consistent error shape:
 *   { message, code, requestId, details? }
 * In production, stack traces are never returned to the client. They are
 * always logged via pino with method/url/requestId for traceability.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // FTA 5-year retention: cannot delete records still inside the window.
  // Translate the legacy service-thrown error into the new RetentionError.
  if (err instanceof RetentionViolationError) {
    const re = new RetentionError(err.retentionExpiresAt, 'Record');
    res.status(re.statusCode).json(withRequestId(re.toJSON(), req));
    return;
  }

  if (err instanceof RetentionError) {
    res.status(err.statusCode).json(withRequestId(err.toJSON(), req));
    return;
  }

  // Zod errors thrown directly from handlers — render the same shape that
  // the validate() middleware produces so the client sees one schema.
  if (err instanceof ZodError) {
    const ve = new ValidationError('Validation error', {
      errors: err.flatten().fieldErrors,
      formErrors: err.flatten().formErrors,
    });
    res.status(ve.statusCode).json(withRequestId(ve.toJSON(), req));
    return;
  }

  // JWT errors — keep behaviour but emit a typed AuthError.
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    const ae = new AuthError('Invalid or expired token', 'AUTH_INVALID_TOKEN');
    res.status(ae.statusCode).json(withRequestId(ae.toJSON(), req));
    return;
  }

  // Any AppError (or subclass).
  if (err instanceof AppError) {
    if (!err.isOperational) {
      log.error({ err, requestId: req.id, method: req.method, url: req.url }, 'Non-operational AppError');
    } else if (err.statusCode >= 500) {
      log.error(
        { err: { message: err.message, code: err.code, stack: err.stack }, requestId: req.id, method: req.method, url: req.url },
        'AppError 5xx',
      );
    }
    res.status(err.statusCode).json(withRequestId(err.toJSON(), req));
    return;
  }

  // Anything else — unhandled. Always log full detail; never leak stack
  // to the client in production.
  log.error(
    {
      err: { message: err.message, stack: err.stack, name: err.name },
      requestId: req.id,
      method: req.method,
      url: req.url,
    },
    'Unhandled error',
  );

  res.status(500).json(
    withRequestId(
      {
        message: isProduction() ? 'Internal Server Error' : err.message,
        code: 'INTERNAL_ERROR',
      },
      req,
    ),
  );
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    withRequestId(
      {
        message: `Route ${req.method} ${req.path} not found`,
        code: 'ROUTE_NOT_FOUND',
      },
      req,
    ),
  );
}

/**
 * Wrap async route handlers to catch errors automatically.
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
