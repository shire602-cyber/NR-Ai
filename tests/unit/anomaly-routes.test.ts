import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "user@example.com", isAdmin: false, userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/services/anomaly-detection.service", () => ({
  detectAnomalies: vi.fn(async () => ({
    anomalies: [],
    summary: { total: 0, critical: 0, warning: 0, info: 0 },
    scannedAt: "2026-06-13T10:00:00.000Z",
  })),
}));

const unresolvedAlerts: any[] = [];

vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getAnomalyAlertsByCompanyId: vi.fn(async () => []),
    getUnresolvedAnomalyAlerts: vi.fn(async () => unresolvedAlerts),
    createAnomalyAlert: vi.fn(async (data: any) => ({ id: "new-alert", ...data })),
  },
}));

import { registerAnomalyRoutes } from "../../server/routes/anomaly.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAnomalyRoutes(app);
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("anomaly routes", () => {
  beforeEach(() => {
    unresolvedAlerts.length = 0;
  });

  it("returns persisted anomaly alerts with UI-compatible severities", async () => {
    unresolvedAlerts.push(
      {
        id: "alert-medium",
        companyId: "company-1",
        type: "unusual_amount",
        severity: "medium",
        title: "Medium alert",
        description: "Medium persisted severity",
        relatedEntityType: "receipt",
        relatedEntityId: "receipt-1",
        createdAt: new Date("2026-06-13T09:00:00.000Z"),
      },
      {
        id: "alert-high",
        companyId: "company-1",
        type: "duplicate",
        severity: "high",
        title: "High alert",
        description: "High persisted severity",
        relatedEntityType: "invoice",
        relatedEntityId: "invoice-1",
        createdAt: new Date("2026-06-13T09:01:00.000Z"),
      },
      {
        id: "alert-low",
        companyId: "company-1",
        type: "unusual_timing",
        severity: "low",
        title: "Low alert",
        description: "Low persisted severity",
        relatedEntityType: "journal_entry",
        relatedEntityId: "journal-1",
        createdAt: new Date("2026-06-13T09:02:00.000Z"),
      },
      {
        id: "alert-critical",
        companyId: "company-1",
        type: "potential_fraud",
        severity: "critical",
        title: "Critical alert",
        description: "Critical persisted severity",
        relatedEntityType: "receipt",
        relatedEntityId: "receipt-2",
        createdAt: new Date("2026-06-13T09:03:00.000Z"),
      }
    );

    const res = await get(appWithRoutes(), "/api/companies/company-1/anomalies");

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 4, critical: 1, warning: 2, info: 1 });
    expect(res.body.anomalies.map((alert: any) => alert.severity)).toEqual([
      "warning",
      "warning",
      "info",
      "critical",
    ]);
    expect(res.body.anomalies[0]).toMatchObject({
      id: "alert-medium",
      type: "unusual_amount",
      description: "Medium persisted severity",
      amount: 0,
      date: "2026-06-13T09:00:00.000Z",
      relatedId: "receipt-1",
      relatedType: "receipt",
    });
  });
});
