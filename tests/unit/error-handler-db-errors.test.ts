import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/services/monitoring", () => ({ captureException: vi.fn() }));

import { globalErrorHandler } from "../../server/middleware/errorHandler";

function run(err: unknown) {
  let status = 0;
  let body: any;
  const res: any = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  };
  globalErrorHandler(err as Error, { id: "req-1", method: "POST", url: "/x" } as any, res, () => {});
  return { status, body };
}

const SQL = 'insert into "invoice_lines" ("id", "quantity", "unit_price") values ($1, $2, $3)';

// Shape drizzle produces: message carries the SQL text and the bound params,
// the real pg error hangs off `cause`.
function drizzleError(pgCode: string, pgMessage: string) {
  const cause: any = new Error(pgMessage);
  cause.code = pgCode;
  const err: any = new Error(`Failed query: ${SQL}\nparams: 11,200000000000,0.01`);
  err.name = "DrizzleQueryError";
  err.query = SQL;
  err.params = [1, 2e11, 0.01];
  err.cause = cause;
  return err;
}

const leaks = (body: unknown) => {
  const text = JSON.stringify(body);
  return /insert into|params|select |\$1|invoice_lines/i.test(text);
};

describe("central error handler: database errors", () => {
  it("maps 22003 numeric_value_out_of_range to a clean 400", () => {
    const { status, body } = run(drizzleError("22003", "numeric field overflow"));
    expect(status).toBe(400);
    expect(body.code).toBe("AMOUNT_OUT_OF_RANGE");
    expect(leaks(body)).toBe(false);
  });

  it("maps 22P02 invalid_text_representation to a clean 400", () => {
    const { status, body } = run(drizzleError("22P02", 'invalid input syntax for type numeric: "abc"'));
    expect(status).toBe(400);
    expect(leaks(body)).toBe(false);
  });

  it("maps 23502 to a clean 400 without SQL", () => {
    const { status, body } = run(drizzleError("23502", 'null value in column "x"'));
    expect(status).toBe(400);
    expect(leaks(body)).toBe(false);
  });

  it("never puts SQL text or parameters in an unhandled 500 (development)", () => {
    const { status, body } = run(drizzleError("XX000", "internal error"));
    expect(status).toBe(500);
    expect(leaks(body)).toBe(false);
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("still returns the plain message of an ordinary unhandled error in development", () => {
    const { status, body } = run(new Error("boom"));
    expect(status).toBe(500);
    expect(body.message).toBe("boom");
  });

  it("strips a query that reaches the handler as a bare 'Failed query' message", () => {
    const { body } = run(new Error(`Failed query: ${SQL}\nparams: 1`));
    expect(leaks(body)).toBe(false);
  });
});
