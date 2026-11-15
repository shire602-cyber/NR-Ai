import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";
import { validationErrorBody } from "../http/strict-body";

type RequestPart = "body" | "query" | "params";

/**
 * Build an Express middleware that validates request parts with Zod schemas.
 * On success, the parsed (typed) value is reassigned back onto the request so
 * handlers see the coerced/stripped data. On failure, a 400 with the shared
 * validation payload (server/http/strict-body.ts) is returned.
 *
 *   router.post('/x', validate({ body: createXSchema }), handler);
 *
 * New body validation should prefer strictBody(schema), which additionally
 * rejects unknown and server-owned keys instead of silently stripping them.
 */
export function validate(schemas: Partial<Record<RequestPart, ZodSchema>>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      for (const [part, schema] of Object.entries(schemas) as Array<[RequestPart, ZodSchema]>) {
        if (!schema) continue;
        const parsed = schema.parse(req[part]);
        // params is read-only on Express but reassigning the prop works at runtime;
        // body/query can be overwritten directly.
        (req as unknown as Record<RequestPart, unknown>)[part] = parsed;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const body = validationErrorBody(err);
        res.status(400).json(req.id ? { ...body, requestId: req.id } : body);
        return;
      }
      next(err);
    }
  };
}
