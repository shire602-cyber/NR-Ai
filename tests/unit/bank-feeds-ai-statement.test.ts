/**
 * PDF/AI statement parsing with a mocked AI provider (W3-C, R06-24 / R06-12): model output goes
 * through the import pipeline's strict row validation — bad dates and amounts are reported as
 * rejected rows and never become NaN.
 */
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
import { setUsageStore } from "../../server/services/ai/usage-meter";
import { aiRowsToParsedRows } from "../../server/services/bank-import.service";

function mockAi(transactions: unknown[]) {
  const create = vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify({ transactions }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
  return { create, client: { chat: { completions: { create } } } as any };
}

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

describe("AI bank statement parsing [R06-24] [R06-12]", () => {
  it("returns only validated rows from a mocked provider and reports the rest", async () => {
    setUsageStore({
      insert: vi.fn(async () => undefined),
      monthToDate: vi.fn(async () => ({ tokens: 0, costUsd: 0, calls: 0 })),
      getLimits: vi.fn(async () => null),
    } as any);
    const { client, create } = mockAi([
      { date: "2026-10-03", description: "POS CARREFOUR", amount: -105.5, reference: null },
      { date: "2026-10-04", description: "SALARY", amount: "2000" },
      { date: "03/10/2026", description: "BAD DATE", amount: 1 },
      { date: "2026-10-05", description: "NAN", amount: "abc" },
      { date: "2026-10-05", description: "", amount: 4 },
      { date: "2026-10-06", description: "TOO PRECISE", amount: 1.234 },
    ]);
    const app = express();
    app.use(express.json());
    registerAIRoutes(app, { openaiClient: client });
    const r = await post(app, "/api/ai/parse-bank-statement", {
      text: "Statement text long enough to parse",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
    expect(r.body.transactions).toEqual([
      { date: "2026-10-03", description: "POS CARREFOUR", amount: "-105.50", reference: null },
      { date: "2026-10-04", description: "SALARY", amount: "2000.00", reference: null },
    ]);
    expect(r.body.rejected.map((x: { rowIndex: number }) => x.rowIndex)).toEqual([3, 4, 5, 6]);
    expect(JSON.stringify(r.body)).not.toContain("NaN");
  });

  it("without an AI provider the endpoint is 503, not a fake result", async () => {
    const app = express();
    app.use(express.json());
    registerAIRoutes(app, { openaiClient: null });
    const r = await post(app, "/api/ai/parse-bank-statement", {
      text: "Statement text long enough",
    });
    expect(r.status).toBe(503);
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
