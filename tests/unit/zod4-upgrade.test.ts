/**
 * R17-27: zod 3.25 carried a high advisory (GHSA-mrhx-c7xc-m3w5, memory
 * exhaustion on oversized constrained collections). The app now runs on
 * zod >= 4.6.6 with drizzle-zod 0.8 and @hookform/resolvers 5, and keeps the
 * zod 3 accept/reject behaviour and validation-error responses.
 */
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { objectShapeOf, strictBody } from "../../server/http/strict-body";
import { zUuid } from "../../shared/validators/primitives";
import { zOptionalUaeTrn } from "../../shared/validators/vat";
import { zCompanyRole } from "../../shared/permissions";
import { insertInvoiceLineSchema, insertInvoicePaymentSchema } from "../../shared/schema";
import { zodResolver } from "../../client/src/lib/zod-resolver";
import pkg from "../../package.json";

const NON_RFC_ID = "00000000-0000-0000-0000-000000000001";

function messages(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}
function runStrict(schema: z.ZodObject, body: unknown) {
  const out: { status?: number; json?: Record<string, unknown>; next: boolean } = { next: false };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      out.json = payload;
      return this;
    },
  } as unknown as Response;
  strictBody(schema)({ body, headers: {} } as unknown as Request, res, (() => {
    out.next = true;
  }) as NextFunction);
  return out;
}

describe("[R17-27] zod 4 upgrade", () => {
  it("installs a zod release with the advisory fixed (>= 4.6.6)", () => {
    expect(pkg.dependencies.zod).toMatch(/^\^4\./);
    const { major, minor, patch } = z.core.version;
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(4_006_006);
  });

  it("keeps the zod 3 default messages clients and tests match on", () => {
    expect(messages(z.object({ a: z.string() }), {})).toEqual(["Required"]);
    expect(messages(z.string(), 5)).toEqual(["Expected string, received number"]);
    expect(messages(z.number().int(), 1.5)).toEqual(["Expected integer, received float"]);
    expect(messages(z.string().min(2), "a")).toEqual([
      "String must contain at least 2 character(s)",
    ]);
    expect(messages(z.array(z.string()).max(1), ["a", "b"])).toEqual([
      "Array must contain at most 1 element(s)",
    ]);
    expect(messages(z.number().positive(), 0)).toEqual(["Number must be greater than 0"]);
    expect(messages(z.number().max(5), 6)).toEqual(["Number must be less than or equal to 5"]);
    expect(messages(z.string().email(), "x")).toEqual(["Invalid email"]);
    expect(messages(zUuid, "x")).toEqual(["Must be a UUID"]);
    expect(messages(z.string().guid(), "x")).toEqual(["Invalid uuid"]);
    expect(messages(z.string().regex(/a/), "b")).toEqual(["Invalid"]);
    expect(messages(z.enum(["a", "b"]), "c")).toEqual([
      "Invalid enum value. Expected 'a' | 'b', received 'c'",
    ]);
    expect(messages(z.enum(["a", "b"]), 3)).toEqual(["Expected 'a' | 'b', received number"]);
    expect(messages(z.literal("a"), "b")).toEqual(['Invalid literal value, expected "a"']);
    expect(messages(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toEqual([
      "Unrecognized key(s) in object: 'b'",
    ]);
    expect(
      messages(
        z.discriminatedUnion("k", [
          z.object({ k: z.literal("a") }),
          z.object({ k: z.literal("b") }),
        ]),
        { k: "c" }
      )
    ).toEqual(["Invalid discriminator value. Expected 'a' | 'b'"]);
    expect(messages(z.union([z.string(), z.number()]), true)).toEqual(["Invalid input"]);
    // zod 3 surfaced the option that failed on a check, not on its type.
    expect(messages(zOptionalUaeTrn, "abc")).toEqual(["TRN must be numeric"]);
  });

  it("schema-level messages still win over the defaults", () => {
    expect(messages(zCompanyRole, "boss")[0]).toMatch(/^Role must be one of: owner/);
    expect(messages(z.string().min(1, "Name is required"), "")).toEqual(["Name is required"]);
  });

  it("accepts any 8-4-4-4-12 hex id like zod 3's .uuid(), in validators and drizzle-zod schemas", () => {
    expect(zUuid.safeParse(NON_RFC_ID).success).toBe(true);
    expect(z.string().guid().safeParse(NON_RFC_ID).success).toBe(true);
    const payment = insertInvoicePaymentSchema.safeParse({
      invoiceId: NON_RFC_ID,
      companyId: NON_RFC_ID,
      amount: 10,
      date: new Date("2026-01-31T00:00:00Z"),
      createdBy: NON_RFC_ID,
    });
    expect(payment.success).toBe(true);
  });

  it("drizzle-zod custom (money) columns stay omittable, as with drizzle-zod 0.7", () => {
    const r = insertInvoiceLineSchema.safeParse({
      invoiceId: NON_RFC_ID,
      description: "Consulting",
      quantity: 1,
    });
    expect(r.success).toBe(true);
  });

  it("strictBody reports only the type error for a wrong-typed field", () => {
    const out = runStrict(
      z.object({ name: z.string().min(1), lines: z.array(z.string()).min(1) }),
      {
        name: [],
        lines: "",
      }
    );
    expect(out.status).toBe(400);
    expect(out.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: {
        name: ["Expected string, received array"],
        lines: ["Expected array, received string"],
      },
      errors: {
        name: ["Expected string, received array"],
        lines: ["Expected array, received string"],
      },
    });
  });

  it("strictBody finds the object shape behind refine, transform and preprocess", () => {
    const base = z.object({ a: z.string() });
    expect(Object.keys(objectShapeOf(base.refine(() => true)) ?? {})).toEqual(["a"]);
    expect(Object.keys(objectShapeOf(base.transform((v) => v)) ?? {})).toEqual(["a"]);
    expect(Object.keys(objectShapeOf(z.preprocess((v) => v, base)) ?? {})).toEqual(["a"]);
    expect(Object.keys(objectShapeOf(base.optional()) ?? {})).toEqual(["a"]);
  });

  it("form resolver returns parsed values and zod 3 messages", async () => {
    const schema = z.object({ name: z.string().min(1), qty: z.coerce.number().default(1) });
    const resolver = zodResolver(schema);
    const opts = { fields: {}, shouldUseNativeValidation: false } as Parameters<typeof resolver>[2];
    const ok = await resolver({ name: "A" } as z.output<typeof schema>, undefined, opts);
    expect(ok.values).toEqual({ name: "A", qty: 1 });
    const bad = await resolver({} as z.output<typeof schema>, undefined, opts);
    expect(bad.errors.name?.message).toBe("Required");
  });
});
