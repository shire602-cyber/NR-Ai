import { describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "u@example.com", isAdmin: false, userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
  requireCompanyAccess: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/storage", () => ({
  storage: { hasCompanyAccess: vi.fn(async () => true) },
}));
vi.mock("../../server/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) }, db: {} }));

import { registerAIRoutes } from "../../server/routes/ai.routes";
import { aiRowsToParsedRows } from "../../server/services/bank-import.service";

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

describe("Bank statement CSV boundary", () => {
  it("directs callers to CSV without sending text to a configured AI provider", async () => {
    const create = vi.fn();
    const app = express();
    app.use(express.json());
    registerAIRoutes(app, { openaiClient: { chat: { completions: { create } } } as any });
    const r = await post(app, "/api/ai/parse-bank-statement", {
      text: "Statement text long enough to parse",
    });
    expect(create).not.toHaveBeenCalled();
    expect(r.status).toBe(410);
    expect(r.body.code).toBe("STATEMENT_CSV_REQUIRED");
  });

  it("aiRowsToParsedRows never yields NaN", () => {
    const rows = aiRowsToParsedRows([
      { date: "2026-10-01", description: "OK", amount: "1,000.25" },
      { date: "2026-10-01", description: "X", amount: "Infinity" },
    ]);
    expect(rows[0]).toMatchObject({ amount: 1000.25, errors: [] });
    expect(rows[1].errors.length).toBeGreaterThan(0);
    expect(Number.isNaN(rows[1].amount)).toBe(false);
  });
});
