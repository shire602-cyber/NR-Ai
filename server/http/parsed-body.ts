import type { Request } from "express";

/**
 * The request body AFTER `strictBody(schema)` has replaced it with the parsed value. Use this
 * rather than aliasing the raw body (the raw-body guard flags that) so the cast is explicit and
 * greppable. Only valid on routes that run strictBody first.
 */
export function parsedBody<T>(req: Request): T {
  return req.body as T;
}
