import { describe, expect, it } from "vitest";
import { buildCurl, buildOperations, describeType, flattenSchema, groupByTag, matchesFilter } from "./openapi-view";

const spec = {
  openapi: "3.1.0",
  tags: [{ name: "Invoices" }, { name: "Reports" }],
  paths: {
    "/api/v1/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List invoices",
        tags: ["Invoices"],
        "x-required-scope": "read:invoices",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" }, description: "Page size" }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id"],
                        properties: {
                          id: { type: "string", format: "uuid" },
                          dueDate: { anyOf: [{ type: "string" }, { type: "null" }] },
                          lines: { type: "array", items: { type: "object", properties: { unitPrice: { type: "string", description: "2 dp" } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createInvoice",
        summary: "Create a draft invoice",
        tags: ["Invoices"],
        "x-required-scope": "write:invoices",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", required: ["customerName"], properties: { customerName: { type: "string" }, date: { type: "string", example: "2026-10-02" } } },
            },
          },
        },
        responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { data: { type: "object", properties: { id: { type: "string" } } } } } } } } },
      },
    },
    "/api/v1/reports/trial-balance": { get: { operationId: "tb", summary: "Trial balance", tags: ["Reports"], "x-required-scope": "read:reports", responses: {} } },
  },
};

describe("describeType", () => {
  it("handles unions, enums, arrays and formats", () => {
    expect(describeType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
    expect(describeType({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(describeType({ type: "array", items: { type: "string", format: "uuid" } })).toBe("array of string (uuid)");
    expect(describeType(undefined)).toBe("any");
  });
});

describe("flattenSchema", () => {
  it("lists nested array fields with [] paths and keeps required flags", () => {
    const rows = flattenSchema(spec.paths["/api/v1/invoices"].get.responses["200"].content["application/json"].schema.properties.data.items);
    expect(rows.map((r) => r.path)).toEqual(["id", "dueDate", "lines", "lines[].unitPrice"]);
    expect(rows[0].required).toBe(true);
    expect(rows[1].required).toBe(false);
    expect(rows[3].description).toBe("2 dp");
  });
});

describe("buildOperations", () => {
  const ops = buildOperations(spec, "https://app.example.com/");
  it("reads scope, list flag and idempotency requirement", () => {
    const list = ops.find((o) => o.id === "listInvoices")!;
    expect(list.scope).toBe("read:invoices");
    expect(list.isList).toBe(true);
    expect(list.needsIdempotencyKey).toBe(false);
    const create = ops.find((o) => o.id === "createInvoice")!;
    expect(create.needsIdempotencyKey).toBe(true);
    expect(create.bodyFields.map((f) => f.path)).toEqual(["customerName", "date"]);
  });
  it("builds a curl example with auth, idempotency key and a minimal body", () => {
    const create = ops.find((o) => o.id === "createInvoice")!;
    expect(create.curl).toContain('curl -X POST "https://app.example.com/api/v1/invoices"');
    expect(create.curl).toContain("Authorization: Bearer $MUHASIB_API_KEY");
    expect(create.curl).toContain("Idempotency-Key");
    expect(create.curl).toContain('{"customerName":"string"}');
  });
  it("replaces path params in curl", () => {
    expect(buildCurl("https://x", "get", "/api/v1/invoices/{id}", [], undefined)).toContain("/api/v1/invoices/<id>");
  });
});

describe("grouping and filtering", () => {
  const ops = buildOperations(spec, "");
  it("keeps the spec's tag order and drops empty tags", () => {
    expect(groupByTag(spec, ops).map((g) => g.tag)).toEqual(["Invoices", "Reports"]);
  });
  it("filters by path, summary or scope", () => {
    expect(ops.filter((o) => matchesFilter(o, "trial")).map((o) => o.id)).toEqual(["tb"]);
    expect(ops.filter((o) => matchesFilter(o, "write:invoices")).map((o) => o.id)).toEqual(["createInvoice"]);
    expect(ops.filter((o) => matchesFilter(o, "")).length).toBe(3);
  });
});
