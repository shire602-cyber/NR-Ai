/** OpenAPI 3.1 generated from the v1 route table and its zod schemas (bundled zod/v4, no extra package). */
import type { Request, Response } from "express";
import { z } from "zod/v4";
import { ALL_SCOPES } from "./keys";
import { ROUTES, isWrite, pathParams, type V1Route } from "./routes";

type Json = Record<string, any>;

function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-2020-12" }) as Json;
  delete out.$schema;
  return out;
}

const errorSchema: Json = {
  type: "object",
  required: ["success", "data", "error", "meta"],
  properties: {
    success: { const: false },
    data: { type: "null" },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string", example: "SCOPE_MISSING" }, message: { type: "string" }, details: {} },
    },
    meta: { type: "object", properties: { requestId: { type: ["string", "null"] } } },
  },
};

function operation(r: V1Route): Json {
  const params: Json[] = pathParams(r.path).map((name) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } }));
  for (const q of r.query ?? []) {
    params.push({
      name: q.name,
      in: "query",
      required: false,
      description: q.description,
      schema: q.enum ? { type: "string", enum: q.enum } : q.format ? { type: "string", format: q.format } : { type: "string" },
    });
  }
  if (isWrite(r)) {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description: "Unique per logical write (1-255 chars). Retrying with the same key and body replays the first response.",
      schema: { type: "string", maxLength: 255 },
    });
  }

  const data = r.response ? schemaOf(r.response, "output") : { type: "object", additionalProperties: true };
  const success: Json = {
    type: "object",
    required: ["success", "data", "error", "meta"],
    properties: {
      success: { const: true },
      data: r.list ? { type: "array", items: data } : data,
      error: { type: "null" },
      meta: { type: "object", properties: { requestId: { type: ["string", "null"] }, ...(r.list ? { nextCursor: { type: ["string", "null"] }, limit: { type: "integer" } } : {}) } },
    },
  };
  const errorRef = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

  const op: Json = {
    operationId: r.operationId,
    summary: r.summary,
    tags: [r.tag],
    security: [{ bearerAuth: [] }],
    "x-required-scope": r.scope,
    parameters: params,
    responses: {
      [String(r.successStatus)]: { description: "Success", content: { "application/json": { schema: success } } },
      "400": errorRef("Validation error"),
      "401": errorRef("Missing, invalid, revoked or expired key"),
      "403": errorRef("Scope missing or plan does not include API access"),
      "404": errorRef("Not found (or belongs to another company)"),
      "429": errorRef("Rate limit exceeded; see Retry-After"),
    },
  };
  if (r.body) op.requestBody = { required: true, content: { "application/json": { schema: schemaOf(r.body, "input") } } };
  if (isWrite(r)) {
    op.responses["409"] = errorRef("State conflict, or the same Idempotency-Key is still in flight");
    op.responses["422"] = errorRef("Business rule (locked period, filed VAT, idempotency key reused, ...)");
  }
  return op;
}

let cached: Json | null = null;

export function buildOpenApiDocument(): Json {
  if (cached) return cached;
  const paths: Json = {};
  for (const r of ROUTES) {
    const openApiPath = `/api/v1${r.path.replace(/:(\w+)/g, "{$1}")}`;
    (paths[openApiPath] ??= {})[r.method] = operation(r);
  }
  cached = {
    openapi: "3.1.0",
    info: {
      title: "Muhasib.ai API",
      version: "1.0.0",
      description:
        "REST API for contacts, items, invoices, bills, payments, journals and reports. Authenticate with `Authorization: Bearer muh_<prefix>_<secret>`. Every write needs an `Idempotency-Key`. Money is a 2-decimal string.",
    },
    servers: [{ url: "/", description: "This server" }],
    security: [{ bearerAuth: [] }],
    tags: Array.from(new Set(ROUTES.map((r) => r.tag))).map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: `API key. Scopes: ${ALL_SCOPES.join(", ")}` },
      },
      schemas: { Error: errorSchema },
    },
  };
  return cached;
}

export function serveOpenApi(_req: Request, res: Response): void {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("application/json").send(JSON.stringify(buildOpenApiDocument()));
}
