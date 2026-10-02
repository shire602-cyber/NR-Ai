import { describe, it, expect } from "vitest";
import { ROUTES, buildV1Router, listMountedRoutes, isWrite } from "../../server/api-v1/routes";
import { buildOpenApiDocument } from "../../server/api-v1/openapi";

const toOpenApi = (p: string) => `/api/v1${p.replace(/:(\w+)/g, "{$1}")}`;

describe("v1 route table", () => {
  it("is exactly what the router mounts (introspection)", () => {
    const mounted = listMountedRoutes(buildV1Router())
      .filter((r) => r.path !== "/openapi.json")
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const declared = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(mounted).toEqual(declared);
  });

  it("has unique operation ids and a scope on every keyed route", () => {
    const ids = ROUTES.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROUTES) {
      expect(r.scope, r.operationId).toMatch(/^(read|write):[a-z]+$/);
      if (r.method === "get") expect(r.scope!.startsWith("read:"), r.operationId).toBe(true);
    }
  });

  it("reads need read scopes, writes need write scopes (payments aside)", () => {
    for (const r of ROUTES.filter(isWrite)) expect(r.scope!.startsWith("write:"), r.operationId).toBe(true);
  });
});

describe("OpenAPI 3.1 document", () => {
  const doc = buildOpenApiDocument() as any;

  it("documents every mounted route and nothing else", () => {
    const documented = Object.entries(doc.paths)
      .flatMap(([p, m]) => Object.keys(m as object).map((k) => `${k} ${p}`))
      .sort();
    expect(documented).toEqual(ROUTES.map((r) => `${r.method} ${toOpenApi(r.path)}`).sort());
    expect(doc.openapi).toBe("3.1.0");
  });

  it("requires the Idempotency-Key header on every write and only on writes", () => {
    for (const r of ROUTES) {
      const op = doc.paths[toOpenApi(r.path)][r.method];
      const has = op.parameters.some((p: any) => p.name === "Idempotency-Key" && p.required === true);
      expect(has, r.operationId).toBe(isWrite(r));
    }
  });

  it("turns every body schema into a closed JSON Schema (unknown keys rejected)", () => {
    for (const r of ROUTES.filter((x) => x.body)) {
      const schema = doc.paths[toOpenApi(r.path)][r.method].requestBody.content["application/json"].schema;
      expect(schema.type, r.operationId).toBe("object");
      expect(schema.additionalProperties, r.operationId).toBe(false);
      expect(Object.keys(schema.properties).length, r.operationId).toBeGreaterThan(0);
    }
  });

  it("describes money inputs as strings or numbers and outputs as strings", () => {
    const invoice = doc.paths["/api/v1/invoices"].post.requestBody.content["application/json"].schema;
    const line = invoice.properties.lines.items;
    expect(JSON.stringify(line.properties.unitPrice)).toContain('"string"');
    const out = doc.paths["/api/v1/invoices/{id}"].get.responses["200"].content["application/json"].schema.properties.data;
    expect(out.properties.total.type).toBe("string");
  });

  it("declares the bearer scheme and the shared error schema", () => {
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(doc.components.schemas.Error.properties.error.properties.code).toBeTruthy();
  });
});
