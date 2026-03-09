import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../config/logger';
import { isProduction } from '../config/env';

const log = createLogger('error');

/**
 * Custom application error with status code.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// Common error factories
export const NotFoundError = (resource: string) =>
  new AppError(`${resource} not found`, 404);

export const BadRequestError = (message: string) =>
  new AppError(message, 400);

export const UnauthorizedError = (message = 'Unauthorized') =>
  new AppError(message, 401);

export const ForbiddenError = (message = 'Forbidden') =>
  new AppError(message, 403);

export const ConflictError = (message: string) =>
  new AppError(message, 409);

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.flatten().fieldErrors;
    res.status(400).json({
      message: 'Validation error',
      errors,
    });
    return;
  }

  // Handle AppError (our custom errors)
  if (err instanceof AppError) {
    if (!err.isOperational) {
      log.error({ err, method: req.method, url: req.url }, 'Non-operational error');
    }
    res.status(err.statusCode).json({
      message: err.message,
    });
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  // Handle all other errors
  log.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
      method: req.method,
      url: req.url,
    },
    'Unhandled error'
  );

  res.status(500).json({
    message: isProduction() ? 'Internal Server Error' : err.message,
  });
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    message: `Route ${req.method} ${req.path} not found`,
  });
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
