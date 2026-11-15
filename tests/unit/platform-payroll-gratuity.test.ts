import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// R09-01: the gratuity calculator used a `while (true)` anniversary walk that
// never terminated for an invalid terminationDate (NaN compare) and hung the
// whole server. These tests drive the real route handler chain with mocked
// storage/db and require every bad input to answer 400 in < 50 ms.

const EMPLOYEE_ID = "0b7f3c1e-8a3e-4a55-9d61-2f7d3c0a9b10";
const COMPANY_ID = "6a2d4f0e-1b2c-4d3e-8f90-123456789abc";

const employeeRow = {
  id: EMPLOYEE_ID,
  company_id: COMPANY_ID,
  full_name: "Test Employee",
  nationality: "IN",
  join_date: "2018-01-01",
  basic_salary: "10000.00",
  housing_allowance: "3000.00",
  transport_allowance: "1000.00",
  other_allowance: "0.00",
};

const { dbQuery } = vi.hoisted(() => ({
  dbQuery: vi.fn(async (): Promise<{ rows: Record<string, unknown>[] }> => ({ rows: [] })),
}));

vi.mock("../../server/db", () => ({ db: { $client: { query: dbQuery } } }));
vi.mock("../../server/storage", () => ({
  storage: { hasCompanyAccess: vi.fn(async () => true) },
}));
vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: string } }).user = { id: "user-1" };
    next();
  },
  requireCustomer: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

async function loadGratuityRoute(): Promise<Handler[]> {
  const { registerPayrollRoutes } = await import("../../server/routes/payroll.routes");
  const routes = new Map<string, Handler[]>();
  const capture =
    (method: string) =>
    (path: string, ...handlers: Handler[]) => {
      routes.set(`${method} ${path}`, handlers);
    };
  const app = {
    get: capture("GET"),
    post: capture("POST"),
    put: capture("PUT"),
    patch: capture("PATCH"),
    delete: capture("DELETE"),
    use: () => undefined,
  };
  registerPayrollRoutes(app as never);
  const chain = routes.get("POST /api/companies/:companyId/payroll/gratuity-calculator");
  if (!chain) throw new Error("gratuity route not registered");
  return chain;
}

function invoke(chain: Handler[], body: unknown) {
  return new Promise<{ status: number; body: Record<string, unknown>; ms: number }>(
    (resolveCall, reject) => {
      const started = performance.now();
      let status = 200;
      const res = {
        status(code: number) {
          status = code;
          return res;
        },
        json(payload: Record<string, unknown>) {
          resolveCall({ status, body: payload, ms: performance.now() - started });
          return res;
        },
      } as unknown as Response;
      const req = {
        params: { companyId: COMPANY_ID },
        body,
        headers: {},
      } as unknown as Request;
      let i = 0;
      const next: NextFunction = (err?: unknown) => {
        if (err) {
          // Route errors go to the global handler in production.
          import("../../server/middleware/errorHandler")
            .then(({ globalErrorHandler }) =>
              globalErrorHandler(err as Error, req, res, () => undefined)
            )
            .catch(reject);
          return;
        }
        const h = chain[i++];
        if (!h) return reject(new Error("chain ended without a response"));
        h(req, res, next);
      };
      next();
    }
  );
}

describe("R09-01 gratuity calculator date validation", () => {
  let chain: Handler[];
  beforeEach(async () => {
    chain ??= await loadGratuityRoute();
    dbQuery.mockReset();
    dbQuery.mockResolvedValue({ rows: [employeeRow] });
  });

  it.each([
    "garbage",
    "2025-13-01",
    "11/13/2026",
    "2025-02-30",
    "1800-01-01",
    "+275760-09-13",
    "Infinity",
  ])("R09-01: terminationDate %j → 400 in < 50 ms without touching the DB", async (bad) => {
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, terminationDate: bad });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
    expect(r.body.fields).toHaveProperty("terminationDate");
    expect(r.ms).toBeLessThan(50);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("R09-01: termination before join → 400 TERMINATION_BEFORE_JOIN", async () => {
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, terminationDate: "2017-06-30" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("TERMINATION_BEFORE_JOIN");
    expect(r.ms).toBeLessThan(50);
  });

  it("R09-01: a stored join date that is not a date → 400, not a hang", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ ...employeeRow, join_date: "garbage" }] });
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, terminationDate: "2026-01-01" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_JOIN_DATE");
    expect(r.ms).toBeLessThan(50);
  });

  it("rejects a non-uuid employeeId and unknown keys", async () => {
    expect((await invoke(chain, { employeeId: "x" })).status).toBe(400);
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, companyId: COMPANY_ID });
    expect(r.status).toBe(400);
  });

  it("still computes gratuity for valid dates (8 completed years)", async () => {
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, terminationDate: "2026-01-01" });
    expect(r.status).toBe(200);
    expect(r.body.completedYears).toBe(8);
    expect(r.body.trailingDays).toBe(0);
    // 5×21 + 3×30 = 195 days × (10000/30)
    expect(r.body.totalGratuity).toBe(65000);
  });

  it("an empty terminationDate means today", async () => {
    const r = await invoke(chain, { employeeId: EMPLOYEE_ID, terminationDate: "" });
    expect(r.status).toBe(200);
    expect(r.body.completedYears).toBeGreaterThanOrEqual(8);
  });
});

describe("R09-01 calculateGratuityForEmployee is bounded", () => {
  it("throws DomainError for NaN dates instead of looping", async () => {
    const { calculateGratuityForEmployee } = await import("../../server/routes/payroll.routes");
    const base = { basicSalary: 1000, totalWage: 1500, isGccNational: false };
    const t0 = performance.now();
    expect(() =>
      calculateGratuityForEmployee({
        ...base,
        joinDate: new Date("2020-01-01"),
        endDate: new Date("garbage"),
      })
    ).toThrow(/valid/);
    expect(() =>
      calculateGratuityForEmployee({ ...base, joinDate: new Date(NaN), endDate: new Date() })
    ).toThrow(/valid/);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("extreme but valid spans finish instantly and cap service years", async () => {
    const { calculateGratuityForEmployee, completedAnniversaries } =
      await import("../../server/routes/payroll.routes");
    const t0 = performance.now();
    const r = calculateGratuityForEmployee({
      joinDate: new Date(-8.64e15),
      endDate: new Date(8.64e15),
      basicSalary: 1000,
      totalWage: 1000,
      isGccNational: false,
    });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.completedYears).toBeLessThanOrEqual(100);
    expect(r.isCapped).toBe(true);

    expect(completedAnniversaries(new Date("2020-02-29"), new Date("2021-02-28")).years).toBe(0);
    expect(completedAnniversaries(new Date("2020-01-15"), new Date("2025-01-15")).years).toBe(5);
    expect(completedAnniversaries(new Date("2020-01-15"), new Date("2025-01-14")).years).toBe(4);
    expect(completedAnniversaries(new Date("2025-01-15"), new Date("2020-01-15")).years).toBe(0);
  });
});
