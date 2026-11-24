import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";
import {
  SERVER_OWNED_FIELDS,
  assertNoServerOwned,
  findServerOwnedFields,
  parseStrict,
  strictBody,
  zodFieldErrors,
} from "../../server/http/strict-body";
import { validate } from "../../server/middleware/validate";
import { pickAllowed } from "../../server/utils/pick-allowed";
import { DomainError } from "../../server/errors";
import { zDate, zMoney, zText } from "../../shared/validators/primitives";

function run(mw: (req: Request, res: Response, next: NextFunction) => void, body: unknown) {
  const req = { body, headers: {} } as unknown as Request;
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
  mw(req, res, () => {
    out.next = true;
  });
  return { ...out, req };
}

const createExpense = z.object({
  description: zText(200),
  amount: zMoney,
  date: zDate,
  notes: zText(500).optional(),
});

describe("R17-20 strictBody", () => {
  it("passes a valid body and replaces req.body with the parsed value", () => {
    const r = run(strictBody(createExpense), {
      description: " <b>Fuel</b> ",
      amount: "12.5",
      date: "2026-03-01",
    });
    expect(r.next).toBe(true);
    expect(r.req.body).toEqual({ description: "Fuel", amount: "12.50", date: "2026-03-01" });
  });

  it("R17-20: rejects unknown keys with 400 VALIDATION_ERROR and per-field errors", () => {
    const r = run(strictBody(createExpense), {
      description: "Fuel",
      amount: "12.50",
      date: "2026-03-01",
      isAdmin: true,
    });
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: { isAdmin: ["Unknown field"] },
    });
  });

  it("R17-20: rejects server-owned fields even when otherwise valid", () => {
    for (const field of SERVER_OWNED_FIELDS) {
      const r = run(strictBody(createExpense), {
        description: "Fuel",
        amount: "1.00",
        date: "2026-03-01",
        [field]: "x",
      });
      expect(r.status, field).toBe(400);
      expect((r.json?.fields as Record<string, string[]>)[field]).toEqual([
        "Field is set by the server",
      ]);
    }
  });

  it("reports schema errors and unknown keys together", () => {
    const r = run(strictBody(createExpense), {
      amount: "1.001",
      date: "2025-13-01",
      companyId: "c",
    });
    expect(r.status).toBe(400);
    const fields = r.json?.fields as Record<string, string[]>;
    expect(Object.keys(fields).sort()).toEqual(["amount", "companyId", "date", "description"]);
    // Legacy validate() keys are still present for older clients.
    expect(r.json).toHaveProperty("errors");
    expect(r.json).toHaveProperty("formErrors");
  });

  it.each(["constructor", "toString", "__proto__"])(
    "reports the unknown key %s as a validation error",
    (key) => {
      const schema = z.object({});
      const body = { [key]: true };
      const result = run(strictBody(schema), body);
      expect(result.status).toBe(400);
      expect(Object.entries(result.json?.fields ?? {})).toEqual([[key, ["Unknown field"]]]);
      expect(() => parseStrict(schema, body)).toThrow(ZodError);
    }
  );

  it("flattens validation errors for schema fields with inherited object names", () => {
    const schema = z.object({ constructor: z.number() });
    const result = run(strictBody(schema), { constructor: "text" });
    expect(result.status).toBe(400);
    expect(Object.entries(result.json?.errors ?? {})).toEqual([
      ["constructor", [expect.stringContaining("number")]],
    ]);
  });

  it("rejects non-object bodies", () => {
    for (const body of [[1, 2], "str", 5]) {
      const r = run(strictBody(createExpense), body);
      expect(r.status).toBe(400);
      expect(r.json?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("allows a server-owned field only when the route opts in", () => {
    const schema = z.object({ status: z.enum(["draft", "sent"]) });
    expect(() => strictBody(schema)).toThrow(/server-owned/);
    const r = run(strictBody(schema, { allowServerOwned: ["status"] }), { status: "sent" });
    expect(r.next).toBe(true);
  });

  it("supports refined object schemas", () => {
    const schema = z
      .object({ from: zDate, to: zDate })
      .refine((v) => v.from <= v.to, { message: "from must be <= to", path: ["to"] });
    expect(run(strictBody(schema), { from: "2026-01-01", to: "2026-02-01" }).next).toBe(true);
    const r = run(strictBody(schema), { from: "2026-03-01", to: "2026-02-01" });
    expect(r.status).toBe(400);
    expect((r.json?.fields as Record<string, string[]>).to).toEqual(["from must be <= to"]);
    expect(run(strictBody(schema), { from: "2026-01-01", to: "2026-02-01", x: 1 }).status).toBe(
      400
    );
  });

  it("refuses non-object schemas at construction time", () => {
    expect(() => strictBody(z.string())).toThrow();
  });

  it("dotted paths for nested errors", () => {
    const schema = z.object({ lines: z.array(z.object({ amount: zMoney }).strict()) });
    const r = run(strictBody(schema), { lines: [{ amount: "1" }, { amount: "-1", extra: 1 }] });
    const fields = r.json?.fields as Record<string, string[]>;
    expect(fields["lines.1.amount"]).toBeDefined();
    expect(fields["lines.1.extra"]).toEqual(["Unknown field"]);
  });
});

describe("assertNoServerOwned / parseStrict", () => {
  it("finds and throws on server-owned keys", () => {
    expect(findServerOwnedFields({ companyId: 1, name: "x" })).toEqual(["companyId"]);
    expect(findServerOwnedFields({ status: "x" }, ["status"])).toEqual([]);
    expect(() => assertNoServerOwned({ totals: {} })).toThrow(DomainError);
    try {
      assertNoServerOwned({ posted: true, entryNumber: 5 });
    } catch (e) {
      expect((e as DomainError).code).toBe("SERVER_OWNED_FIELD");
      expect((e as DomainError).statusCode).toBe(400);
    }
    expect(() => assertNoServerOwned({ name: "ok" })).not.toThrow();
  });

  it("parseStrict throws ZodError for unknown keys", () => {
    const schema = z.object({ a: z.string() });
    expect(parseStrict(schema, { a: "x" })).toEqual({ a: "x" });
    expect(() => parseStrict(schema, { a: "x", b: 1 })).toThrow(ZodError);
    try {
      parseStrict(schema, { a: "x", b: 1 });
    } catch (e) {
      expect(zodFieldErrors(e as ZodError)).toEqual({ b: ["Unknown field"] });
    }
  });
});

describe("legacy validate() and pickAllowed() keep working", () => {
  it("validate() still strips (non-strict) and returns the shared 400 shape", () => {
    const mw = validate({ body: z.object({ name: z.string() }) });
    const okRun = run(mw, { name: "a", extra: 1 });
    expect(okRun.next).toBe(true);
    expect(okRun.req.body).toEqual({ name: "a" });
    const badRun = run(mw, {});
    expect(badRun.status).toBe(400);
    expect(badRun.json).toMatchObject({
      message: "Validation error",
      code: "VALIDATION_ERROR",
      fields: { name: ["Required"] },
      errors: { name: ["Required"] },
    });
  });

  it("validate() forwards non-zod errors", () => {
    const next = vi.fn();
    const throwing = {
      parse: () => {
        throw new Error("boom");
      },
    } as unknown as z.ZodSchema;
    validate({ body: throwing })({ body: {} } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it("pickAllowed is unchanged", () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    expect(pickAllowed({ a: "x", c: 1 }, schema)).toEqual({ a: "x" });
    expect(pickAllowed({ a: "x", b: 2 }, schema, ["b"])).toEqual({ a: "x" });
  });
});
