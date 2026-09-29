import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/monitoring", () => ({ captureException: capture }));

import { globalErrorHandler } from "../../server/middleware/errorHandler";
import { AppError, ValidationError, NotFoundError } from "../../server/errors";

function run(err: unknown) {
  let status = 0;
  const res: any = {
    status(s: number) {
      status = s;
      return this;
    },
    json() {
      return this;
    },
  };
  const req: any = {
    id: "req-9",
    method: "POST",
    url: "/api/companies/co-1/x?token=abc",
    params: { companyId: "co-1" },
    user: { id: "u-1" },
  };
  globalErrorHandler(err as Error, req, res, () => {});
  return status;
}

describe("central error handler: monitoring capture policy", () => {
  beforeEach(() => capture.mockClear());

  it("does not capture 4xx application errors, even non-operational ones", () => {
    expect(run(new ValidationError("bad"))).toBe(400);
    expect(run(new NotFoundError("Invoice"))).toBe(404);
    expect(run(new AppError("weird", 409, false))).toBe(409);
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures 5xx AppErrors with request context", () => {
    expect(run(new AppError("db down", 503))).toBe(503);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toMatchObject({
      requestId: "req-9",
      method: "POST",
      userId: "u-1",
      companyId: "co-1",
    });
  });

  it("captures unhandled errors (500) exactly once", () => {
    expect(run(new Error("kaboom"))).toBe(500);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
