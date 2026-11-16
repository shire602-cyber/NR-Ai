/**
 * Minimal zod (v3) -> JSON Schema converter for the OpenAPI document of the
 * public API (/api/v1/openapi.json). Covers the constructs the v1 schemas use:
 * objects, strings (uuid/regex/length), numbers, booleans, enums, literals,
 * arrays, unions, optional/nullable/default and effects (transform/refine,
 * described by their input schema).
 */
import { z, type ZodTypeAny } from "zod";

export type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; description?: string } & Record<string, unknown>;
  const withDesc = (s: JsonSchema): JsonSchema =>
    schema.description ? { ...s, description: schema.description } : s;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: JsonSchema = { type: "string" };
      for (const c of (def.checks as Array<Record<string, unknown>>) ?? []) {
        if (c.kind === "uuid") out.format = "uuid";
        if (c.kind === "email") out.format = "email";
        if (c.kind === "url") out.format = "uri";
        if (c.kind === "min") out.minLength = c.value;
        if (c.kind === "max") out.maxLength = c.value;
        if (c.kind === "regex") out.pattern = String((c.regex as RegExp).source);
      }
      return withDesc(out);
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const out: JsonSchema = { type: "number" };
      for (const c of (def.checks as Array<Record<string, unknown>>) ?? []) {
        if (c.kind === "int") out.type = "integer";
        if (c.kind === "min") out.minimum = c.value;
        if (c.kind === "max") out.maximum = c.value;
      }
      return withDesc(out);
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return withDesc({ type: "boolean" });
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return withDesc({ type: "string", enum: [...(def.values as string[])] });
    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return withDesc({ enum: Object.values(def.values as Record<string, unknown>) });
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return withDesc({ const: def.value });
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const out: JsonSchema = { type: "array", items: zodToJsonSchema(def.type as ZodTypeAny) };
      if (def.minLength) out.minItems = (def.minLength as { value: number }).value;
      if (def.maxLength) out.maxItems = (def.maxLength as { value: number }).value;
      return withDesc(out);
    }
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v);
        if (!v.isOptional()) required.push(k);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length) out.required = required;
      if ((def.unknownKeys as string) === "strict") out.additionalProperties = false;
      return withDesc(out);
    }
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return withDesc({
        oneOf: (def.options as ZodTypeAny[]).map((o) => zodToJsonSchema(o)),
      });
    case z.ZodFirstPartyTypeKind.ZodOptional:
      return zodToJsonSchema(def.innerType as ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { ...zodToJsonSchema(def.innerType as ZodTypeAny), nullable: true };
    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const inner = zodToJsonSchema(def.innerType as ZodTypeAny);
      return { ...inner, default: (def.defaultValue as () => unknown)() };
    }
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return withDesc(zodToJsonSchema(def.schema as ZodTypeAny));
    case z.ZodFirstPartyTypeKind.ZodPipeline:
      return zodToJsonSchema(def.in as ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodRecord:
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
  query?: z.AnyZodObject;
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
