import { describe, expect, it, vi } from "vitest";
import express from "express";
import { AiQuotaExceededError } from "../../server/services/ai/usage-meter";

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/storage", () => ({
  storage: { hasCompanyAccess: vi.fn(async () => true) },
}));
vi.mock("../../server/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

const scan = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/autonomous-gl.service", () => ({
  scanAndClassifyTransactions: scan,
  autoPostHighConfidence: vi.fn(async () => ({ posted: 0 })),
  processUserFeedback: vi.fn(),
  getAIGLStats: vi.fn(),
}));

import { registerAIGLRoutes } from "../../server/routes/ai-gl.routes";

async function postScan() {
  const app = express();
  app.use(express.json());
  registerAIGLRoutes(app);
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/companies/co-1/ai-gl/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("R05-26 AI GL scan respects the monthly AI cap", () => {
  it("R05-26 returns 429 AI_QUOTA_EXCEEDED when the scan hits the company cap", async () => {
    scan.mockRejectedValueOnce(
      new AiQuotaExceededError("Monthly AI usage limit reached for this company", {
        tokens: 10,
        costUsd: 1,
        tokenCap: 5,
        costCapUsd: null,
      })
    );
    const res = await postScan();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AI_QUOTA_EXCEEDED");
  });

  it("R05-26 a normal scan still reports its summary", async () => {
    scan.mockResolvedValueOnce({ scanned: 2, classified: 2, ruleMatched: 1, aiClassified: 1 });
    const res = await postScan();
    expect(res.status).toBe(200);
    expect(res.body.scan.scanned).toBe(2);
  });
});
