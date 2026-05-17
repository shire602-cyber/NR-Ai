import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  getAccessibleCompanies: vi.fn(),
  getCashFlowForecasts: vi.fn(),
  getCompanyUsersByCompanyId: vi.fn(),
  getInvoice: vi.fn(),
  getInvoiceLinesByInvoiceId: vi.fn(),
  hasCompanyAccess: vi.fn(),
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: "firm-user-1",
      email: "firm@example.com",
      isAdmin: false,
      userType: "customer",
      firmRole: "firm_owner",
    };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getAccessibleCompanies: mocks.getAccessibleCompanies,
    getCashFlowForecasts: mocks.getCashFlowForecasts,
    getCompanyUsersByCompanyId: mocks.getCompanyUsersByCompanyId,
    getInvoice: mocks.getInvoice,
    getInvoiceLinesByInvoiceId: mocks.getInvoiceLinesByInvoiceId,
    hasCompanyAccess: mocks.hasCompanyAccess,
  },
}));

vi.mock("../../server/services/pdf-invoice.service", () => ({
  generateInvoicePDF: vi.fn(),
}));

vi.mock("../../server/services/einvoice.service", () => ({
  generateEInvoiceXML: vi.fn(),
}));

import { registerAnalyticsRoutes } from "../../server/routes/analytics.routes";
import { registerInvoiceRoutes } from "../../server/routes/invoices.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAnalyticsRoutes(app);
  registerInvoiceRoutes(app);
  return app;
}

async function request(path: string): Promise<{ status: number; body: any }> {
  const server = appWithRoutes().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("firm-scoped route access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompanyUsersByCompanyId.mockImplementation(() => {
      throw new Error("direct membership lookup should not be used for firm access");
    });
  });

  it("uses firm-aware company access for analytics endpoints", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(true);
    mocks.getCashFlowForecasts.mockResolvedValue([{ id: "forecast-1" }]);

    const response = await request("/api/analytics/forecasts?companyId=client-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: "forecast-1" }]);
    expect(mocks.hasCompanyAccess).toHaveBeenCalledWith("firm-user-1", "client-1");
    expect(mocks.getCompanyUsersByCompanyId).not.toHaveBeenCalled();
  });

  it("uses accessible firm clients for invoice id lookups", async () => {
    mocks.getAccessibleCompanies.mockResolvedValue([{ id: "client-1" }]);
    mocks.getInvoice.mockResolvedValue({
      id: "invoice-1",
      companyId: "client-1",
      number: "INV-001",
    });
    mocks.getInvoiceLinesByInvoiceId.mockResolvedValue([{ id: "line-1", invoiceId: "invoice-1" }]);

    const response = await request("/api/invoices/invoice-1");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "invoice-1", lines: [{ id: "line-1" }] });
    expect(mocks.getAccessibleCompanies).toHaveBeenCalledWith("firm-user-1", "firm_owner");
    expect(mocks.getInvoice).toHaveBeenCalledWith("invoice-1", "client-1");
  });
});
