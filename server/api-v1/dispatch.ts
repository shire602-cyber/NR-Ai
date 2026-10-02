/**
 * Writes and reports are not re-implemented: after v1 has authenticated,
 * limited, scoped, de-duplicated, validated and tenant-pinned a request, it is
 * handed to the internal route that the UI uses. The v1 router leaves with
 * next("router"); dispatchMiddleware (mounted right after it) rewrites the
 * method, url, query and body, and the rest of the app serves it as the key's
 * creator. Locks, VAT, numbering, approvals and journals stay single-sourced.
 */
import type { NextFunction, Request, Response } from "express";
import type { SuccessMapper } from "./context";

const TARGET = Symbol.for("muhasib.apiV1Target");

export interface DispatchTarget {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Internal path with query string, e.g. /api/companies/<id>/invoices */
  url: string;
  body?: unknown;
}

export function dispatchTo(
  req: Request,
  res: Response,
  next: NextFunction,
  target: DispatchTarget,
  opts: { map?: SuccessMapper; created?: (data: any) => string | undefined } = {}
): void {
  res.locals.v1Map = opts.map;
  res.locals.v1Created = opts.created;
  (req as any)[TARGET] = target;
  next("router");
}

export function dispatchMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const target = (req as any)[TARGET] as DispatchTarget | undefined;
  if (!target) return next();
  delete (req as any)[TARGET];
  const search = target.url.split("?")[1] ?? "";
  req.method = target.method;
  req.url = target.url;
  req.originalUrl = target.url;
  (req as any).query = Object.fromEntries(new URLSearchParams(search));
  req.body = target.body ?? {};
  // Express caches the parsed URL on the request; the cached copy no longer matches.
  (req as any)._parsedUrl = undefined;
  next();
}
