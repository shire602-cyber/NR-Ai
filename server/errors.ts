/**
 * Centralized error hierarchy.
 *
 * All thrown application errors should be a subclass of AppError so the
 * global error handler can render a consistent JSON shape and log with
 * the right severity. Raw `res.status(X).json({ error: 'string' })` calls
 * should be replaced with `throw new <Specific>Error(...)`.
 */

export interface AppErrorJSON {
  message: string;
  code: string;
  details?: unknown;
}

interface AppErrorOptions {
  message: string;
  statusCode: number;
  code: string;
  details?: unknown;
  isOperational?: boolean;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  // Modern signature: AppError({ message, statusCode, code, ... })
  constructor(opts: AppErrorOptions);
  // Legacy positional signature kept for existing callers and tests.
  // (message, statusCode, isOperational?) → code defaults to 'APP_ERROR'.
  constructor(message: string, statusCode: number, isOperational?: boolean);
  constructor(
    arg1: AppErrorOptions | string,
    statusCode?: number,
    isOperational?: boolean,
  ) {
    const opts: AppErrorOptions =
      typeof arg1 === 'string'
        ? {
            message: arg1,
            statusCode: statusCode ?? 500,
            code: 'APP_ERROR',
            isOperational,
          }
        : arg1;
    super(opts.message);
    this.name = this.constructor.name;
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
    this.isOperational = opts.isOperational ?? true;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): AppErrorJSON {
    return {
      message: this.message,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: unknown) {
    super({ message, statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', code = 'AUTH_REQUIRED') {
    super({ message, statusCode: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super({ message, statusCode: 403, code });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super({ message: `${resource} not found`, statusCode: 404, code });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    super({ message, statusCode: 409, code, details });
  }
}

export class RetentionError extends AppError {
  public readonly retentionExpiresAt: Date;

  constructor(retentionExpiresAt: Date, recordType: string) {
    const iso = retentionExpiresAt.toISOString().slice(0, 10);
    super({
      message: `${recordType} cannot be deleted before ${iso} (UAE FTA 5-year retention).`,
      statusCode: 409,
      code: 'RETENTION_NOT_EXPIRED',
      details: { retentionExpiresAt: retentionExpiresAt.toISOString() },
    });
    this.retentionExpiresAt = retentionExpiresAt;
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super({
      message,
      statusCode: 429,
      code: 'RATE_LIMITED',
      details: retryAfterSeconds !== undefined ? { retryAfterSeconds } : undefined,
    });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super({
      message: message ?? `${service} request failed`,
      statusCode: 502,
      code: 'EXTERNAL_SERVICE_ERROR',
      details: { service },
      isOperational: true,
    });
  }
}
