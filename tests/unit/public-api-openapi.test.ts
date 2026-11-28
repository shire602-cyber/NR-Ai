/**
 * W5-B (R19-15): the committed OpenAPI document (docs/api/openapi.json) is the
 * one generated from the /api/v1 zod schemas, and webhook signatures verify.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicApiOpenApiDocument } from "../../server/routes/public-api.routes";
import { API_SCOPES, expandScopes } from "../../server/middleware/api-key-auth";
import { signWebhookPayload, verifyWebhookSignature } from "../../server/services/webhook.service";

describe("W5-B public API contract", () => {
  it("[R19-15] docs/api/openapi.json matches the generated document", () => {
    const committed = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../docs/api/openapi.json"), "utf8")
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(publicApiOpenApiDocument())));
  });

  it("[R19-15] every operation declares a known scope and strict bodies", () => {
    const doc = publicApiOpenApiDocument() as {
      paths: Record<string, Record<string, { "x-required-scope": string; requestBody?: any }>>;
    };
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const [m, op] of Object.entries(ops)) {
        expect(API_SCOPES, `${m} ${p}`).toContain(op["x-required-scope"]);
        if (op.requestBody) {
          expect(op.requestBody.content["application/json"].schema.additionalProperties).toBe(
            false
          );
        }
      }
    }
  });

  it("[R19-01] legacy read/write keys map onto the scope catalogue", () => {
    expect(expandScopes("read")).toEqual(API_SCOPES.filter((s) => s.startsWith("read:")));
    expect(expandScopes("read,write")).toEqual([...API_SCOPES]);
    expect(expandScopes("read:invoices, bogus")).toEqual(["read:invoices"]);
  });

  it("[R19-02] webhook signatures verify and reject tampering and stale timestamps", () => {
    const now = 1_763_200_800;
    const sig = signWebhookPayload("whsec_x", '{"a":1}', now);
    expect(verifyWebhookSignature("whsec_x", '{"a":1}', sig.header, now)).toBe(true);
    expect(verifyWebhookSignature("whsec_x", '{"a":2}', sig.header, now)).toBe(false);
    expect(verifyWebhookSignature("whsec_y", '{"a":1}', sig.header, now)).toBe(false);
    expect(verifyWebhookSignature("whsec_x", '{"a":1}', sig.header, now + 301)).toBe(false);
  });
});
