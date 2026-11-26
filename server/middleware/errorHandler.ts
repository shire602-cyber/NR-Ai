import { sizeErrorBody } from "../http/upload-errors";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { RetentionViolationError } from "../services/retention.service";
import { AppError, RetentionError, ValidationError, AuthError } from "../errors";
import { captureException } from "../services/monitoring";
import { MoneyError } from "../../shared/money";
import { flattenIssues, zodFieldErrors } from "../http/strict-body";
import { portalInviteLogPath } from "../http/portal-invite-privacy";
import { createLogger } from "../config/logger";

const log = createLogger("error-handler");

/** 5xx answers that are the documented "not configured" state, not faults: never reported. */
export const EXPECTED_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "PAYMENTS_REQUIRES_EXTERNAL",
]);

// Re-export AppError so existing imports of AppError from this module keep working.
export { AppError };

function withRequestId<T extends object>(body: T, req: Request): T & { requestId?: string } {
  return req.id ? { ...body, requestId: req.id } : body;
}

/**
 * Walk an error's `cause` chain (max 5 hops) looking for a Postgres
 * SQLSTATE code for input errors, transaction conflicts, or temporary unavailability.
 * Drizzle wraps the underlying pg error in DrizzleQueryError, so the code
 * usually lives one level down.
 */
function findMappedPgError(err: unknown): { code: string; source: object } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      (Object.hasOwn(PG_ERRORS, code) || /^2[23][0-9A-Z]{3}$/.test(code))
    ) {
      return { code, source: current };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Postgres SQLSTATEs caused by client input. The response never carries SQL
 * text, constraint names or column values — only a stable code.
 */
const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  "40001": {
    status: 409,
    code: "TRANSACTION_CONFLICT",
    message: "The operation conflicted with another update. Please retry.",
  },
  "40P01": {
    status: 409,
    code: "TRANSACTION_CONFLICT",
    message: "The operation conflicted with another update. Please retry.",
  },
  "57P01": {
    status: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "The service is temporarily unavailable.",
  },
  "57P03": {
    status: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "The service is temporarily unavailable.",
  },
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
  if (err instanceof URIError && (err as HttpLikeError).status === 400) {
    return { status: 400, body: { message: "Malformed request", code: "BAD_REQUEST" } };
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
  const body = mapped.status === 413 ? sizeErrorBody(req, "PAYLOAD_TOO_LARGE") : mapped.body;
  res.status(mapped.status).json(withRequestId(body, req));
}

/**
 * Global error handler middleware.
 * Must be registered AFTER all routes.
 *
 * Returns a consistent error shape:
 *   { message, code, requestId, details? }
 * Unexpected failures are logged with method, route template and request ID.
 * Client-input failures never answer 500.
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) return next(err);
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
    const flat = flattenIssues(err);
    const ve = new ValidationError("Validation error", {
      errors: flat.fieldErrors,
      formErrors: flat.formErrors,
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
    requestTransportErrorHandler(err, req, res, next);
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
  const pgFound = err instanceof AppError ? null : findMappedPgError(err);
  const pgCode = pgFound?.code ?? null;
  const pgMapped = pgCode ? PG_ERRORS[pgCode] : undefined;
  if (pgMapped && pgFound) {
    // Server-side only: constraint/table/detail (detail can hold key values) never reach the body.
    const pg = pgFound.source as { constraint?: unknown; table?: unknown; detail?: unknown };
    log.warn(
      {
        requestId: req.id,
        pgCode,
        code: pgMapped.code,
        constraint: pg.constraint,
        table: pg.table,
        detail: pg.detail,
        method: req.method,
        path: req.originalUrl || req.url,
      },
      "postgres error mapped to client response"
    );
    if (pgMapped.status === 503) res.setHeader("Retry-After", "1");
    res
      .status(pgMapped.status)
      .json(withRequestId({ message: pgMapped.message, code: pgMapped.code }, req));
    return;
  }

  const invitePath = portalInviteLogPath(req.originalUrl || req.url);
  if (invitePath && (!(err instanceof AppError) || !err.isOperational || err.statusCode >= 500)) {
    captureException(new Error("Customer portal invitation request failed"), {
      requestId: req.id,
      method: req.method,
      route: invitePath,
    });
    const status = err instanceof AppError ? err.statusCode : 500;
    const deliveryFailed = err instanceof AppError && err.code === "PORTAL_INVITE_DELIVERY_FAILED";
    res.status(status).json(
      withRequestId(
        deliveryFailed
          ? {
              message: "Could not deliver the invitation email",
              code: "PORTAL_INVITE_DELIVERY_FAILED",
            }
          : { message: "Could not process the invitation", code: "INTERNAL_ERROR" },
        req
      )
    );
    return;
  }

  // Any AppError (or subclass, including DomainError).
  if (err instanceof AppError) {
    // S5-SEC-6: a refusal the product expects (no payment gateway configured) is not an incident.
    const expected = err.isOperational && EXPECTED_UNAVAILABLE_CODES.has(err.code);
    if (expected) res.locals.expectedRefusal = true;
    if (!expected && (!err.isOperational || err.statusCode >= 500)) {
      captureException(err, {
        requestId: req.id,
        method: req.method,
        route: typeof req.route?.path === "string" ? req.route.path : undefined,
        code: err.code,
        operational: err.isOperational,
      });
    }
    const body = err.toJSON();
    if (err.statusCode === 413 && err.code === "FILE_TOO_LARGE") {
      Object.assign(body, sizeErrorBody(req, err.code));
    }
    res.status(err.statusCode).json(withRequestId(body, req));
    return;
  }

  // Correlate unexpected failures with the request and registered route.
  captureException(err, {
    requestId: req.id,
    method: req.method,
    route: typeof req.route?.path === "string" ? req.route.path : undefined,
    unhandled: true,
  });

  res.status(500).json(
    withRequestId(
      {
        message: "Internal Server Error",
        code: "INTERNAL_ERROR",
      },
      req
    )
  );
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const path = (req.originalUrl || req.url).split(/[?#]/, 1)[0];
  res.status(404).json(
    withRequestId(
      {
        message: `Route ${req.method} ${portalInviteLogPath(path) ?? path} not found`,
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
