/**
 * Minimal zod (v4) -> JSON Schema converter for the OpenAPI document of the
 * public API (/api/v1/openapi.json). Covers the constructs the v1 schemas use:
 * objects, strings (uuid/regex/length), numbers, booleans, enums, literals,
 * arrays, unions, optional/nullable/default and pipes (transform/preprocess,
 * described by their input schema; refinements live on the schema itself).
 * OpenAPI 3.0 output (`nullable: true`), so z.toJSONSchema() is not used.
 */
import { z, type ZodTypeAny } from "zod";

export type JsonSchema = Record<string, unknown>;

type CheckDef = {
  check?: string;
  format?: string;
  pattern?: RegExp;
  minimum?: number;
  maximum?: number;
  value?: number;
};

function checkDefs(def: Record<string, unknown>): CheckDef[] {
  const checks = (def.checks as Array<{ _zod: { def: CheckDef } }> | undefined) ?? [];
  return checks.map((c) => c._zod.def);
}

function stringFormat(format: string | undefined, out: JsonSchema, pattern?: RegExp): void {
  if (format === "uuid" || format === "guid") out.format = "uuid";
  if (format === "email") out.format = "email";
  if (format === "url") out.format = "uri";
  if (format === "regex" && pattern) out.pattern = String(pattern.source);
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._zod.def as unknown as { type: string } & Record<string, unknown>;
  const withDesc = (s: JsonSchema): JsonSchema =>
    schema.description ? { ...s, description: schema.description } : s;
  switch (def.type) {
    case "string": {
      const out: JsonSchema = { type: "string" };
      // z.guid()/z.uuid() carry their format on the schema itself.
      stringFormat(def.format as string | undefined, out);
      for (const c of checkDefs(def)) {
        if (c.check === "string_format") stringFormat(c.format, out, c.pattern);
        if (c.check === "min_length") out.minLength = c.minimum;
        if (c.check === "max_length") out.maxLength = c.maximum;
      }
      return withDesc(out);
    }
    case "number": {
      const out: JsonSchema = { type: "number" };
      for (const c of checkDefs(def)) {
        if (c.check === "number_format" && /int/.test(c.format ?? "")) out.type = "integer";
        if (c.check === "greater_than") out.minimum = c.value;
        if (c.check === "less_than") out.maximum = c.value;
      }
      return withDesc(out);
    }
    case "boolean":
      return withDesc({ type: "boolean" });
    case "enum":
      return withDesc({
        type: "string",
        enum: Object.values(def.entries as Record<string, string>),
      });
    case "literal":
      return withDesc({ const: (def.values as unknown[])[0] });
    case "array": {
      const out: JsonSchema = { type: "array", items: zodToJsonSchema(def.element as ZodTypeAny) };
      for (const c of checkDefs(def)) {
        if (c.check === "min_length") out.minItems = c.minimum;
        if (c.check === "max_length") out.maxItems = c.maximum;
      }
      return withDesc(out);
    }
    case "object": {
      const shape = def.shape as Record<string, ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v);
        if (!v.isOptional()) required.push(k);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length) out.required = required;
      if (def.catchall instanceof z.ZodNever) out.additionalProperties = false;
      return withDesc(out);
    }
    case "union":
      return withDesc({
        oneOf: (def.options as ZodTypeAny[]).map((o) => zodToJsonSchema(o)),
      });
    case "optional":
      return zodToJsonSchema(def.innerType as ZodTypeAny);
    case "nullable":
      return { ...zodToJsonSchema(def.innerType as ZodTypeAny), nullable: true };
    case "default": {
      const inner = zodToJsonSchema(def.innerType as ZodTypeAny);
      return { ...inner, default: def.defaultValue };
    }
    case "pipe": {
      // .transform() is pipe(input, transform); z.preprocess() is pipe(transform, schema).
      const input = def.in as ZodTypeAny;
      const target = input instanceof z.ZodTransform ? (def.out as ZodTypeAny) : input;
      return withDesc(zodToJsonSchema(target));
    }
    case "record":
      return withDesc({ type: "object", additionalProperties: true });
    default:
      return withDesc({});
  }
}

export interface OpenApiOperation {
  method: "get" | "post";
  path: string; // OpenAPI form: /invoices/{id}
  summary: string;
  scope: string;
  query?: z.ZodObject;
  body?: ZodTypeAny;
  pathParams?: string[];
  responseDescription: string;
}

export function buildOpenApiDocument(ops: OpenApiOperation[], scopes: readonly string[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const parameters: unknown[] = [];
    for (const p of op.pathParams ?? []) {
      parameters.push({
        name: p,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    }
    if (op.query) {
      const shape = op.query.shape as Record<string, ZodTypeAny>;
      for (const [name, s] of Object.entries(shape)) {
        parameters.push({
          name,
          in: "query",
          required: !s.isOptional(),
          schema: zodToJsonSchema(s),
        });
      }
    }
    const operation: Record<string, unknown> = {
      summary: op.summary,
      security: [{ ApiKeyAuth: [] }],
      "x-required-scope": op.scope,
      parameters,
      responses: {
        [op.method === "post" ? "201" : "200"]: { description: op.responseDescription },
        "400": { description: "VALIDATION_ERROR (unknown keys are rejected)" },
        "401": { description: "API_KEY_REQUIRED / API_KEY_INVALID / API_KEY_EXPIRED" },
        "403": { description: `INSUFFICIENT_SCOPE (needs ${op.scope}) or TIER_LOCKED` },
        "404": { description: "Not found in the key's company" },
        "429": { description: "API_KEY_RATE_LIMITED (see Retry-After)" },
      },
    };
    if (op.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: zodToJsonSchema(op.body) } },
      };
    }
    paths[op.path] = { ...(paths[op.path] ?? {}), [op.method]: operation };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Muhasib.ai public API",
      version: "1.0.0",
      description:
        "Versioned REST API for one company. Authenticate with an API key created in " +
        "Developer Settings: `Authorization: ApiKey muh_...` or `X-API-Key: muh_...`. " +
        "Each key is bound to one company, carries scopes and has a per-minute rate limit. " +
        "Money amounts are decimal AED strings or numbers with at most 2 decimals.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
    },
    "x-scopes": [...scopes],
    paths,
  };
}
