import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { isProduction } from "../config/env";
import { RetentionViolationError } from "../services/retention.service";
import { AppError, RetentionError, ValidationError, AuthError } from "../errors";
import { captureException } from "../services/monitoring";

// Re-export AppError so existing imports of AppError from this module keep working.
export { AppError };

function captureContext(req: Request, extra: Record<string, unknown> = {}) {
  return {
    requestId: req.id,
    method: req.method,
    url: req.url,
    userId: (req as any).user?.id,
    companyId: req.params?.companyId,
    ...extra,
  };
}

function withRequestId<T extends object>(body: T, req: Request): T & { requestId?: string } {
  return req.id ? { ...body, requestId: req.id } : body;
}

/**
 * Walk an error's `cause` chain (max 5 hops) looking for a Postgres
 * SQLSTATE code. Drizzle wraps the underlying pg error in
 * DrizzleQueryError, so the code usually lives one level down.
 */
function hasPgErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Message that is safe to return to a client. Drizzle's query errors carry the
 * full SQL statement and its bound parameters in `message` ("Failed query:
 * insert into ... params: ..."); those must never leave the server, in any
 * environment. Use the underlying driver error's message instead (e.g.
 * "numeric field overflow"), and fall back to a generic text when even that
 * looks like SQL. The full error is still captured server-side.
 */
function safeClientMessage(err: Error): string {
  const looksLikeSql = (m: string) =>
    /^\s*failed query/i.test(m) ||
    /\b(insert\s+into|update\s+"?\w+"?\s+set|delete\s+from|select\s+.+\s+from)\b/i.test(m) ||
    /\bparams:/i.test(m);
  const carriesQuery =
    typeof (err as { query?: unknown }).query === "string" ||
    Array.isArray((err as { params?: unknown }).params);
  const message = typeof err.message === "string" ? err.message : "";
  if (!carriesQuery && !looksLikeSql(message)) return message;
  const cause = (err as { cause?: { message?: unknown } }).cause;
  const causeMessage = typeof cause?.message === "string" ? cause.message : "";
  return causeMessage && !looksLikeSql(causeMessage) ? causeMessage : "Database error";
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
    const re = new RetentionError(err.retentionExpiresAt, "Record");
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
    const ve = new ValidationError("Validation error", {
      errors: err.flatten().fieldErrors,
      formErrors: err.flatten().formErrors,
    });
    res.status(ve.statusCode).json(withRequestId(ve.toJSON(), req));
    return;
  }

  // JWT errors — keep behaviour but emit a typed AuthError.
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    const ae = new AuthError("Invalid or expired token", "AUTH_INVALID_TOKEN");
    res.status(ae.statusCode).json(withRequestId(ae.toJSON(), req));
    return;
  }

  // Postgres "invalid input syntax" (22P02) — e.g. a malformed UUID in a
  // path param reaching a uuid column. This is bad *input*, not a server
  // fault: answer 400, not 500. Drizzle wraps the pg error, so walk the
  // cause chain looking for the SQLSTATE code.
  if (hasPgErrorCode(err, "22P02")) {
    res.status(400).json(
      withRequestId(
        { message: "Invalid identifier format", code: "INVALID_IDENTIFIER" },
        req
      )
    );
    return;
  }

  // Postgres numeric_value_out_of_range (22003) — a number too large for its
  // column (e.g. quantity 2e11 into numeric(15,4)). Bad input, not a server
  // fault, and the response must not carry the statement that failed.
  if (hasPgErrorCode(err, "22003")) {
    res.status(400).json(
      withRequestId(
        {
          message: "A numeric value is too large or out of range",
          code: "AMOUNT_OUT_OF_RANGE",
        },
        req
      )
    );
    return;
  }

  // Postgres unique violation (23505) — e.g. creating a cost centre with a
  // code that already exists. A conflict with existing data, not a server
  // fault: answer 409, not 500.
  if (hasPgErrorCode(err, "23505")) {
    res.status(409).json(
      withRequestId(
        { message: "A record with this value already exists", code: "DUPLICATE_VALUE" },
        req
      )
    );
    return;
  }

  // Postgres not-null violation (23502) — a required field the route-level
  // validation missed (e.g. cost centre without `code`). Bad input, not a
  // server fault: answer 400, not 500.
  if (hasPgErrorCode(err, "23502")) {
    res.status(400).json(
      withRequestId(
        { message: "A required field is missing", code: "REQUIRED_FIELD_MISSING" },
        req
      )
    );
    return;
  }

  // Any AppError (or subclass).
  if (err instanceof AppError) {
    // Monitoring is for server faults only: a 4xx is the caller's mistake and
    // would drown real incidents (even when flagged non-operational).
    if (err.statusCode >= 500) {
      captureException(err, captureContext(req, { code: err.code, operational: err.isOperational }));
    }
    res.status(err.statusCode).json(withRequestId(err.toJSON(), req));
    return;
  }

  // Anything else — unhandled. Always capture full detail; never leak stack
  // to the client in production.
  captureException(err, captureContext(req, { unhandled: true }));

  // Platform admins get the underlying message even in production — they own
  // the deployment and need it to diagnose schema/data drift without log
  // access. Regular users still get the opaque message + requestId.
  const isAdmin = Boolean((req as any).user?.isAdmin);
  res.status(500).json(
    withRequestId(
      {
        message: isProduction() && !isAdmin ? "Internal Server Error" : safeClientMessage(err),
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
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
