/**
 * strictBody(schema) — the single request-body contract for routes.
 *
 *   router.post("/x", strictBody(createXSchema), handler)
 *
 * - Unknown keys are rejected (400 VALIDATION_ERROR, `fields[key] = ["Unknown field"]`)
 *   instead of being spread into a Drizzle write (mass assignment, R17-20).
 * - SERVER_OWNED_FIELDS (companyId, status, posted, totals, …) are rejected
 *   unless the route opts in per field with `allowServerOwned`.
 * - On success `req.body` is replaced by the parsed, canonical value.
 *
 * Response shape for every validation failure (also used by validate()):
 *   { message: "Validation error", code: "VALIDATION_ERROR",
 *     fields: { "lines.0.amount": ["…"] }, errors: {...}, formErrors: [...] }
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, ZodError, type ZodTypeAny } from "zod";
import { DomainError } from "../errors";

/**
 * Fields the server owns. A client must never set these directly; the route
 * derives them (companyId from the URL + access check, status from workflow
 * transitions, numbers from the sequence allocator, totals from lines…).
 */
export const SERVER_OWNED_FIELDS = [
  "companyId",
  "status",
  "posted",
  "autoPosted",
  "journalEntryId",
  "isSystemAccount",
  "createdBy",
  "number",
  "entryNumber",
  "totals",
] as const;
export type ServerOwnedField = (typeof SERVER_OWNED_FIELDS)[number];
const SERVER_OWNED = new Set<string>(SERVER_OWNED_FIELDS);

export type FieldErrors = Record<string, string[]>;

export interface ValidationErrorBody {
  message: "Validation error";
  code: "VALIDATION_ERROR";
  fields: FieldErrors;
  /** Legacy zod flatten() shape kept for existing clients of validate(). */
  errors: Record<string, string[] | undefined>;
  formErrors: string[];
  requestId?: string;
}

const ROOT_KEY = "_root";

function addField(fields: FieldErrors, key: string, message: string): void {
  (fields[key] ??= []).push(message);
}

/**
 * The issues of a ZodError as zod 3 reported them. zod 4 runs length checks
 * (min/max/length) even after the value failed its type check, so `[]` for a
 * `z.string().min(1)` field yields "Expected string, received array" plus
 * "Array must contain at least 1 element(s)"; zod 3 stopped at the type error.
 */
export function reportedIssues(err: ZodError): ZodError["issues"] {
  const pathKey = (path: PropertyKey[]) => path.map(String).join("\u0000");
  const typeFailed = new Set(
    err.issues.filter((i) => i.code === "invalid_type").map((i) => pathKey(i.path))
  );
  return err.issues.filter(
    (i) => !((i.code === "too_small" || i.code === "too_big") && typeFailed.has(pathKey(i.path)))
  );
}

/** zod 3's `error.flatten()` over {@link reportedIssues}. */
export function flattenIssues(err: ZodError): {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
} {
  return new ZodError(reportedIssues(err)).flatten();
}

/** Flatten a ZodError into dotted-path field errors ("lines.0.amount"). */
export function zodFieldErrors(err: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of reportedIssues(err)) {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      const prefix = issue.path.length ? `${issue.path.join(".")}.` : "";
      for (const key of issue.keys) addField(fields, `${prefix}${key}`, "Unknown field");
      continue;
    }
    addField(fields, issue.path.length ? issue.path.join(".") : ROOT_KEY, issue.message);
  }
  return fields;
}

export function validationErrorBody(err: ZodError, extra: FieldErrors = {}): ValidationErrorBody {
  const flat = flattenIssues(err);
  const fields = zodFieldErrors(err);
  for (const [k, msgs] of Object.entries(extra)) for (const m of msgs) addField(fields, k, m);
  return {
    message: "Validation error",
    code: "VALIDATION_ERROR",
    fields,
    errors: flat.fieldErrors,
    formErrors: flat.formErrors,
  };
}

function fieldsOnlyBody(fields: FieldErrors): ValidationErrorBody {
  return {
    message: "Validation error",
    code: "VALIDATION_ERROR",
    fields,
    errors: Object.fromEntries(Object.entries(fields).filter(([k]) => k !== ROOT_KEY)),
    formErrors: fields[ROOT_KEY] ?? [],
  };
}

/** Server-owned keys present on a body (own enumerable keys only). */
export function findServerOwnedFields(body: unknown, allow: readonly string[] = []): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const allowed = new Set(allow);
  return Object.keys(body).filter((k) => SERVER_OWNED.has(k) && !allowed.has(k));
}

/**
 * Throw DomainError("SERVER_OWNED_FIELD", 400) if the body tries to set a
 * server-owned field. For handlers that cannot use strictBody yet.
 */
export function assertNoServerOwned(body: unknown, allow: readonly string[] = []): void {
  const found = findServerOwnedFields(body, allow);
  if (found.length) {
    throw new DomainError(
      "SERVER_OWNED_FIELD",
      400,
      { fields: Object.fromEntries(found.map((k) => [k, ["Field is set by the server"]])) },
      `Field(s) set by the server cannot be supplied: ${found.join(", ")}`
    );
  }
}

/**
 * Find the object shape behind optional/default/pipe wrappers, if any.
 * zod 4: refinements stay on the object itself; `.transform()` is
 * pipe(object, transform) and `z.preprocess()` is pipe(transform, object).
 */
export function objectShapeOf(schema: ZodTypeAny): z.ZodRawShape | null {
  let s: ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    if (s instanceof z.ZodObject) return s.shape;
    if (s instanceof z.ZodPipe)
      s = (s.def.in instanceof z.ZodTransform ? s.def.out : s.def.in) as ZodTypeAny;
    else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap() as ZodTypeAny;
    else if (s instanceof z.ZodDefault) s = s.def.innerType as ZodTypeAny;
    else return null;
  }
  return null;
}

export interface StrictBodyOptions {
  /** Server-owned field names this route legitimately accepts (e.g. ["status"]). */
  allowServerOwned?: readonly ServerOwnedField[];
}

export type StrictBodySchema = ZodTypeAny;

/**
 * Validate the request body against an object schema, rejecting unknown and
 * server-owned keys at the top level. Nested objects should use `.strict()`
 * themselves where unknown keys matter.
 */
export function strictBody<S extends StrictBodySchema>(
  schema: S,
  opts: StrictBodyOptions = {}
): RequestHandler {
  const shape = objectShapeOf(schema);
  if (!shape) throw new Error("strictBody(schema) requires a zod object schema");
  const allow = new Set<string>(opts.allowServerOwned ?? []);
  const declaredOwned = Object.keys(shape).filter((k) => SERVER_OWNED.has(k) && !allow.has(k));
  if (declaredOwned.length) {
    // Programmer error: the schema itself lets clients set server-owned fields.
    throw new Error(
      `strictBody schema declares server-owned field(s) ${declaredOwned.join(", ")}; ` +
        `remove them or list them in allowServerOwned`
    );
  }
  const known = new Set(Object.keys(shape));

  return (req: Request, res: Response, next: NextFunction): void => {
    const body: unknown = req.body ?? {};
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res
        .status(400)
        .json(withRequestId(fieldsOnlyBody({ [ROOT_KEY]: ["Body must be a JSON object"] }), req));
      return;
    }
    const pre: FieldErrors = {};
    for (const key of Object.keys(body)) {
      if (SERVER_OWNED.has(key) && !allow.has(key))
        addField(pre, key, "Field is set by the server");
      else if (!known.has(key)) addField(pre, key, "Unknown field");
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      res.status(400).json(withRequestId(validationErrorBody(result.error, pre), req));
      return;
    }
    if (Object.keys(pre).length) {
      res.status(400).json(withRequestId(fieldsOnlyBody(pre), req));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Inline variant for handlers: parse or throw a ZodError (rendered as 400 by
 * the global error handler). Unknown top-level keys are rejected.
 */
export function parseStrict<S extends StrictBodySchema>(schema: S, body: unknown): z.output<S> {
  const shape = objectShapeOf(schema);
  if (shape && body && typeof body === "object" && !Array.isArray(body)) {
    const unknownKeys = Object.keys(body).filter((k) => !(k in shape));
    if (unknownKeys.length) {
      throw new ZodError([
        {
          code: z.ZodIssueCode.unrecognized_keys,
          keys: unknownKeys,
          path: [],
          message: "Unknown field",
        },
      ]);
    }
  }
  return schema.parse(body);
}

function withRequestId<T extends object>(body: T, req: Request): T & { requestId?: string } {
  return req.id ? { ...body, requestId: req.id } : body;
}
