/**
 * v1 response envelope `{success, data, error:{code,message,details}, meta}`.
 *
 * Handlers either answer through ok()/fail(), or they dispatch to an internal
 * route whose raw JSON is rewritten here: errors keep their `code` and gain the
 * envelope, successes go through the route's mapper. One res.json wrapper does
 * both, then runs the after-json hooks (idempotency storage) before sending.
 */
import type { NextFunction, Request, Response } from "express";
import { createLogger } from "../config/logger";
import type { AfterJsonHook, SuccessMapper } from "./context";

const log = createLogger("api-v1");

const ENVELOPED = new WeakSet<object>();

const DEFAULT_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  422: "BUSINESS_RULE_VIOLATION",
  429: "RATE_LIMITED",
};

export interface Envelope {
  success: boolean;
  data: unknown;
  error: { code: string; message: string; details?: unknown } | null;
  meta: Record<string, unknown>;
}

/** Mark an already-built envelope (a stored replay) so the res.json wrapper leaves it alone. */
export function markEnveloped<T extends object>(body: T): T {
  ENVELOPED.add(body);
  return body;
}

function build(req: Request, partial: Omit<Envelope, "meta">, meta?: Record<string, unknown>): Envelope {
  const env: Envelope = { ...partial, meta: { requestId: req.id ?? null, ...(meta ?? {}) } };
  ENVELOPED.add(env);
  return env;
}

export function okEnvelope(req: Request, data: unknown, meta?: Record<string, unknown>): Envelope {
  return build(req, { success: true, data, error: null }, meta);
}

export function errorEnvelope(
  req: Request,
  status: number,
  code: string | undefined,
  message: string,
  details?: unknown
): Envelope {
  return build(req, {
    success: false,
    data: null,
    error: { code: code ?? DEFAULT_CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "ERROR"), message, ...(details !== undefined ? { details } : {}) },
  });
}

export function ok(req: Request, res: Response, data: unknown, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json(okEnvelope(req, data, meta));
}

export function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json(errorEnvelope(req, status, code, message, details));
}

/** Map an internal error body ({message, code, details?, errors?}) into the envelope. */
function mapInternalError(req: Request, status: number, body: any): Envelope {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const details =
      body.details !== undefined
        ? body.details
        : body.errors || body.formErrors
          ? { fields: body.errors ?? undefined, form: body.formErrors ?? undefined }
          : undefined;
    return errorEnvelope(req, status, typeof body.code === "string" ? body.code : undefined, String(body.message ?? body.error ?? "Request failed"), details);
  }
  return errorEnvelope(req, status, undefined, typeof body === "string" ? body : "Request failed");
}

/** Installs the res.json wrapper. Must be the first v1 middleware. */
export function installEnvelope(req: Request, res: Response, next: NextFunction): void {
  const original = res.json.bind(res);
  res.json = function wrappedJson(body?: unknown) {
    const status = res.statusCode;
    void (async () => {
      let out: unknown = body;
      try {
        if (body && typeof body === "object" && ENVELOPED.has(body as object)) {
          out = body;
        } else if (status >= 400) {
          // A closed period is a business rule, not a permission problem: 422 PERIOD_LOCKED.
          const locked = status === 403 && /locked period/i.test(String((body as any)?.message ?? ""));
          if (locked) res.status(422);
          out = mapInternalError(req, locked ? 422 : status, locked ? { ...(body as object), code: "PERIOD_LOCKED" } : body);
        } else {
          const mapper = res.locals.v1Map as SuccessMapper | undefined;
          const data = mapper ? await mapper(status, body, req) : body;
          // A create answers 201 with a Location, whatever the internal route used.
          const created = res.locals.v1Created as ((data: any) => string | undefined) | undefined;
          if (created) {
            res.status(201);
            const location = created(data);
            if (location) res.setHeader("Location", location);
          }
          out = okEnvelope(req, data);
        }
      } catch (err) {
        log.error({ err, path: req.originalUrl }, "v1 response mapping failed");
        res.status(500);
        out = errorEnvelope(req, 500, "INTERNAL_ERROR", "The response could not be produced");
      }
      const hooks: AfterJsonHook[] = res.locals.v1Hooks ?? [];
      for (const hook of hooks) {
        try {
          await hook(res.statusCode, out);
        } catch (err) {
          log.error({ err }, "v1 after-json hook failed");
        }
      }
      original(out);
    })();
    return res;
  } as typeof res.json;
  next();
}
