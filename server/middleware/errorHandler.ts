import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { isProduction } from "../config/env";
import { RetentionViolationError } from "../services/retention.service";
import { AppError, RetentionError, ValidationError, AuthError } from "../errors";
import { captureException } from "../services/monitoring";
import { MoneyError } from "../../shared/money";
import { zodFieldErrors } from "../http/strict-body";

// Re-export AppError so existing imports of AppError from this module keep working.
export { AppError };

function withRequestId<T extends object>(body: T, req: Request): T & { requestId?: string } {
  return req.id ? { ...body, requestId: req.id } : body;
}

/**
 * Walk an error's `cause` chain (max 5 hops) looking for a Postgres
 * SQLSTATE code in class 22 (data exception) or 23 (integrity constraint).
 * Drizzle wraps the underlying pg error in DrizzleQueryError, so the code
 * usually lives one level down.
 */
function findPgClientErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^2[23][0-9A-Z]{3}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Postgres SQLSTATEs caused by client input. The response never carries SQL
 * text, constraint names or column values — only a stable code.
 */
const PG_CLIENT_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  "22P02": { status: 400, code: "INVALID_IDENTIFIER", message: "Invalid identifier format" },
  "22007": { status: 400, code: "INVALID_DATE", message: "Invalid date or time value" },
  "22008": { status: 400, code: "INVALID_DATE", message: "Date or time value out of range" },
  "22003": { status: 400, code: "NUMERIC_OUT_OF_RANGE", message: "Numeric value out of range" },
  "22001": { status: 400, code: "VALUE_TOO_LONG", message: "Value too long for field" },
  "23502": { status: 400, code: "REQUIRED_FIELD_MISSING", message: "A required field is missing" },
  "23514": { status: 400, code: "CONSTRAINT_VIOLATION", message: "A value failed a data rule" },
  "23505": {
    status: 409,
    code: "DUPLICATE_VALUE",
    message: "A record with this value already exists",
  },
  "23503": {
    status: 409,
    code: "REFERENCE_CONFLICT",
    message: "The record references, or is referenced by, another record",
  },
};

/** Message the CORS origin callback (middleware/security.ts) rejects with. */
export const CORS_REJECTION_MESSAGE = "Not allowed by CORS";

interface HttpLikeError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
}

export interface MappedTransportError {
  status: number;
  body: { message: string; code: string };
}

/**
 * Map transport-level request errors (body-parser, CORS) to a 4xx response,
 * or return null when the error is not one of them.
 */
export function mapRequestTransportError(err: unknown): MappedTransportError | null {
  if (!err || typeof err !== "object") return null;
  if (err instanceof Error && err.message === CORS_REJECTION_MESSAGE) {
    return { status: 403, body: { message: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" } };
  }
  const e = err as HttpLikeError;
  if (typeof e.type !== "string") return null;
  if (e.type === "entity.parse.failed") {
    return {
      status: 400,
      body: { message: "Request body is not valid JSON", code: "INVALID_JSON" },
    };
  }
  if (e.type === "entity.too.large") {
    return {
      status: 413,
      body: { message: "Request body is too large", code: "PAYLOAD_TOO_LARGE" },
    };
  }
  if (e.type === "encoding.unsupported" || e.type === "charset.unsupported") {
    return {
      status: 415,
      body: { message: "Unsupported request encoding", code: "UNSUPPORTED_ENCODING" },
    };
  }
  // Other http-errors from body-parser (request.aborted, parameters.too.many, …).
  const status =
    typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 0;
  if (e.expose === true && status >= 400 && status < 500) {
    return { status, body: { message: "Malformed request", code: "BAD_REQUEST" } };
  }
  return null;
}

/**
 * Mounted right after the body parsers (server/index.ts) so malformed JSON
 * and CORS rejections (including preflight) answer 400/403 immediately
 * instead of travelling on and surfacing as a 500.
 */
export function requestTransportErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const mapped = mapRequestTransportError(err);
  if (!mapped) return next(err);
  res.status(mapped.status).json(withRequestId(mapped.body, req));
}

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes.
 *
 * Returns a consistent error shape:
 *   { message, code, requestId, details? }
 * In production, stack traces are never returned to the client. They are
 * always logged via pino with method/url/requestId for traceability.
 * Client-input failures never answer 500.
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
    const re = new RetentionError(err.retentionExpiresAt, "Record");
    res.status(re.statusCode).json(withRequestId(re.toJSON(), req));
    return;
  }

  if (err instanceof RetentionError) {
    res.status(err.statusCode).json(withRequestId(err.toJSON(), req));
    return;
  }

  // Zod errors thrown directly from handlers — render the same shape that
  // the validate()/strictBody() middleware produces so the client sees one schema.
  if (err instanceof ZodError) {
    const ve = new ValidationError("Validation error", {
      errors: err.flatten().fieldErrors,
      formErrors: err.flatten().formErrors,
    });
    res
      .status(ve.statusCode)
      .json(withRequestId({ ...ve.toJSON(), fields: zodFieldErrors(err) }, req));
    return;
  }

  // Exact-money parse failures (shared/money.ts) are always bad client input.
  if (err instanceof MoneyError) {
    res.status(400).json(withRequestId({ message: err.message, code: err.code }, req));
    return;
  }

  // Malformed JSON, oversize bodies, rejected CORS origins (incl. preflight).
  const transport = mapRequestTransportError(err);
  if (transport) {
    res.status(transport.status).json(withRequestId(transport.body, req));
    return;
  }

  // JWT errors — keep behaviour but emit a typed AuthError.
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    const ae = new AuthError("Invalid or expired token", "AUTH_INVALID_TOKEN");
    res.status(ae.statusCode).json(withRequestId(ae.toJSON(), req));
    return;
  }

  // Postgres data/integrity errors caused by client input (bad uuid/date,
  // numeric overflow, duplicates, FK) — 400/409 with a stable code, never the
  // SQL text. Drizzle wraps the pg error, so walk the cause chain.
  const pgCode = err instanceof AppError ? null : findPgClientErrorCode(err);
  const pgMapped = pgCode ? PG_CLIENT_ERRORS[pgCode] : undefined;
  if (pgMapped) {
    res
      .status(pgMapped.status)
      .json(withRequestId({ message: pgMapped.message, code: pgMapped.code }, req));
    return;
  }

  // Any AppError (or subclass, including DomainError).
  if (err instanceof AppError) {
    if (!err.isOperational || err.statusCode >= 500) {
      captureException(err, {
        requestId: req.id,
        method: req.method,
        url: req.url,
        userId: req.user?.id,
        code: err.code,
        operational: err.isOperational,
      });
    }
    res.status(err.statusCode).json(withRequestId(err.toJSON(), req));
    return;
  }

  // Anything else — unhandled. Always capture full detail; never leak stack
  // to the client in production.
  captureException(err, {
    requestId: req.id,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    unhandled: true,
  });

  // Platform admins get the underlying message even in production — they own
  // the deployment and need it to diagnose schema/data drift without log
  // access. Regular users still get the opaque message + requestId.
  const isAdmin = Boolean(req.user?.isAdmin);
  res.status(500).json(
    withRequestId(
      {
        message: isProduction() && !isAdmin ? "Internal Server Error" : err.message,
        code: "INTERNAL_ERROR",
        ...(isAdmin && isProduction() ? { adminDetail: { name: err.name } } : {}),
      },
      req
    )
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
        code: "ROUTE_NOT_FOUND",
      },
      req
    )
  );
}

/**
 * Wrap async route handlers to catch errors automatically.
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
