import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodSchema } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Build an Express middleware that validates a single request part with a
 * Zod schema. On success, the parsed (typed) value is reassigned back onto
 * the request so handlers see the coerced/stripped data. On failure, a 400
 * with a structured error payload is returned and the chain stops.
 *
 *   router.post('/x', validate({ body: createXSchema }), handler);
 */
export function validate(schemas: Partial<Record<RequestPart, ZodSchema>>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      for (const [part, schema] of Object.entries(schemas) as Array<[RequestPart, ZodSchema]>) {
        if (!schema) continue;
        const parsed = schema.parse((req as any)[part]);
        // params is read-only on Express but reassigning the prop works at runtime;
        // body/query can be overwritten directly.
        (req as any)[part] = parsed;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          message: 'Validation error',
          errors: err.flatten().fieldErrors,
          formErrors: err.flatten().formErrors,
        });
        return;
      }
      next(err);
    }
  };
}
