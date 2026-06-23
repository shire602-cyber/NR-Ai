import express from "express";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const state = {
    companyId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    activityLogRows: [] as any[],
    poolQuery: vi.fn(async (sql: string) => {
      if (sql.includes("FROM document_requirements")) {
        return {
          rows: [
            {
              id: "doc-req-1",
              document_type: "bank_statement",
              description: "June bank statement is required before refund pack finalization.",
              due_date: "2026-06-20",
              status: "requested",
            },
          ],
        };
      }

      if (sql.includes("FROM documents")) {
        return { rows: [{ category: "tax_certificate", count: 1 }] };
      }

      if (sql.includes("FROM bank_transactions")) {
        return { rows: [{ total: 2, reconciled: 1, unreconciled: 1 }] };
      }

      if (sql.includes("FROM vendor_bills")) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
  return state;
});

const companyId = testState.companyId;

vi.mock("../../server/db", () => ({
  pool: { query: testState.poolQuery },
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: testState.userId, email: "owner@example.com", userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getCompany: vi.fn(async () => ({
      id: testState.companyId,
      name: "Seeded Trading LLC",
      trnVatNumber: "100123456700003",
      contactEmail: "client@example.com",
    })),
    getInvoicesByCompanyId: vi.fn(async () => [
      {
        id: "inv-1",
        number: "INV-001",
        date: "2026-06-10T00:00:00.000Z",
        customerName: "Seeded Customer",
        customerTrn: "100987654300003",
        status: "sent",
        total: 10500,
        vatAmount: 500,
      },
    ]),
    getReceiptsByCompanyId: vi.fn(async () => [
      {
        id: "receipt-1",
        date: "2026-06-12T00:00:00.000Z",
        merchant: "Seeded Supplier",
        amount: 2000,
        vatAmount: 100,
        posted: false,
        rawText: "Seeded supplier receipt OCR text",
      },
    ]),
    getDocuments: vi.fn(async () => [
      {
        id: "doc-1",
        companyId: testState.companyId,
        name: "Output invoice source",
        category: "tax_certificate",
        fileUrl: "/uploads/missing-output-invoice.pdf",
        fileName: "missing-output-invoice.pdf",
        isArchived: false,
      },
    ]),
    getVatReturnsByCompanyId: vi.fn(async () => []),
    getCorporateTaxReturnsByCompanyId: vi.fn(async () => [
      {
        id: "ct-1",
        status: "draft",
        taxPeriodEnd: "2026-12-31T00:00:00.000Z",
        taxPayable: 12600,
        workpaper: {},
      },
    ]),
    getComplianceTasks: vi.fn(async () => [
      {
        id: "task-1",
        title: "VAT filing",
        dueDate: "2026-07-28T00:00:00.000Z",
        category: "vat_filing",
        status: "open",
      },
    ]),
    getActivityLogsByCompany: vi.fn(async () => testState.activityLogRows),
    createActivityLog: vi.fn(async (log: any) => {
      const row = {
        id: `activity-${testState.activityLogRows.length + 1}`,
        createdAt: new Date("2026-06-23T10:00:00.000Z"),
        userId: testState.userId,
        ...log,
      };
      testState.activityLogRows.unshift(row);
      return row;
    }),
  },
}));

vi.mock("../../server/services/firm-vat-workspace.service", () => ({
  listVatWorkpapers: vi.fn(async () => [
    {
      id: "wp-1",
      status: "draft",
      dueDate: "2026-07-28T00:00:00.000Z",
      totalsSnapshot: {
        box8TotalAmount: 10000,
        box8TotalVat: 500,
        box11TotalAmount: 2000,
        box11TotalVat: 100,
        box13RecoverableTax: 100,
        box14PayableTax: 400,
      },
    },
  ]),
  getVatWorkpaperDetail: vi.fn(async () => ({
    rows: [
      {
        id: "row-output-1",
        status: "approved",
        rowCategory: "standard_sale",
        invoiceNumber: "INV-001",
        documentDate: "2026-06-10T00:00:00.000Z",
        counterpartyName: "Seeded Customer",
        counterpartyTrn: "100987654300003",
        taxableAmount: 10000,
        vatAmount: 500,
        sourceDocumentId: "doc-1",
      },
      {
        id: "row-input-1",
        status: "approved",
        rowCategory: "standard_expense",
        invoiceNumber: "BILL-001",
        documentDate: "2026-06-12T00:00:00.000Z",
        counterpartyName: "Seeded Supplier",
        counterpartyTrn: null,
        taxableAmount: 2000,
        vatAmount: 100,
        sourceMethod: "manual",
      },
    ],
    totals: {
      box8TotalAmount: 10000,
      box8TotalVat: 500,
      box11TotalAmount: 2000,
      box11TotalVat: 100,
      box13RecoverableTax: 100,
      box14PayableTax: 400,
    },
  })),
}));

vi.mock("../../server/services/month-end.service", () => ({
  getCloseChecklist: vi.fn(async () => [
    {
      id: "bank-reconciliation",
      title: "Bank reconciliation",
      description: "Reconcile June bank transactions.",
      details: "Reconcile June bank transactions.",
      status: "open",
    },
  ]),
}));

import { storage } from "../../server/storage";
import { registerEvidenceCenterRoutes } from "../../server/routes/evidence-center.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerEvidenceCenterRoutes(app);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any; headers: Headers; arrayBuffer: ArrayBuffer }> {
  const routeMatch = matchRoute(method, path);
  const route = (app as any)._router.stack.find(
    (layer: any) =>
      layer.route?.path === routeMatch.routePath && layer.route?.methods?.[method.toLowerCase()]
  )?.route;
  if (!route) throw new Error(`route not registered: ${method} ${path}`);

  const handlers = route.stack.map((layer: any) => layer.handle);
  const headerMap = new Map<string, string>();
  let statusCode = 200;
  let responseBody: any = null;
  let responseBuffer = new ArrayBuffer(0);

  const req: any = {
    method,
    path,
    url: path,
    params: routeMatch.params,
    body,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  };

  let resolveResult: () => void = () => {};
  let rejectResult: (error: unknown) => void = () => {};
  const result = new Promise<void>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headerMap.set(name.toLowerCase(), value);
      return this;
    },
    json(value: any) {
      responseBody = value;
      const json = JSON.stringify(value);
      responseBuffer = Buffer.from(json).buffer.slice(0);
      resolveResult();
      return this;
    },
    send(value: any) {
      if (Buffer.isBuffer(value)) {
        responseBuffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        responseBody = { raw: value.toString("utf8") };
      } else if (typeof value === "string") {
        const buffer = Buffer.from(value);
        responseBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );
        responseBody = { raw: value };
      } else {
        responseBody = value;
        const buffer = Buffer.from(JSON.stringify(value ?? null));
        responseBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );
      }
      resolveResult();
      return this;
    },
  };

  let handlerIndex = 0;
  const next = (error?: unknown) => {
    if (error) {
      rejectResult(error);
      return;
    }
    const handler = handlers[handlerIndex++];
    if (!handler) {
      resolveResult();
      return;
    }
    try {
      handler(req, res, next);
    } catch (handlerError) {
      rejectResult(handlerError);
    }
  };

  next();
  await result;

  return {
    status: statusCode,
    body: responseBody,
    headers: new Headers(Object.fromEntries(headerMap)),
    arrayBuffer: responseBuffer,
  };
}

function matchRoute(
  method: string,
  path: string
): { routePath: string; params: Record<string, string> } {
  const issueAction = path.match(
    /^\/api\/companies\/([^/]+)\/evidence-center\/issues\/([^/]+)\/actions$/
  );
  if (issueAction && method === "POST") {
    return {
      routePath: "/api/companies/:companyId/evidence-center/issues/:issueId/actions",
      params: { companyId: issueAction[1], issueId: issueAction[2] },
    };
  }

  const clientRequest = path.match(
    /^\/api\/companies\/([^/]+)\/evidence-center\/client-request\/review$/
  );
  if (clientRequest && method === "POST") {
    return {
      routePath: "/api/companies/:companyId/evidence-center/client-request/review",
      params: { companyId: clientRequest[1] },
    };
  }

  const workbook = path.match(/^\/api\/companies\/([^/]+)\/evidence-center\/refund-pack\.xlsx$/);
  if (workbook && method === "GET") {
    return {
      routePath: "/api/companies/:companyId/evidence-center/refund-pack.xlsx",
      params: { companyId: workbook[1] },
    };
  }

  const cover = path.match(/^\/api\/companies\/([^/]+)\/evidence-center\/refund-pack-cover\.pdf$/);
  if (cover && method === "GET") {
    return {
      routePath: "/api/companies/:companyId/evidence-center/refund-pack-cover.pdf",
      params: { companyId: cover[1] },
    };
  }

  const bundle = path.match(/^\/api\/companies\/([^/]+)\/evidence-center\/refund-pack\.zip$/);
  if (bundle && method === "GET") {
    return {
      routePath: "/api/companies/:companyId/evidence-center/refund-pack.zip",
      params: { companyId: bundle[1] },
    };
  }

  const center = path.match(/^\/api\/companies\/([^/]+)\/evidence-center$/);
  if (center && method === "GET") {
    return {
      routePath: "/api/companies/:companyId/evidence-center",
      params: { companyId: center[1] },
    };
  }

  throw new Error(`unmatched route: ${method} ${path}`);
}

describe("evidence center seeded route flow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));
    testState.activityLogRows.length = 0;
    testState.poolQuery.mockClear();
    vi.mocked(storage.createActivityLog).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns seeded evidence workflows, proof status, pack metadata, and guarded request defaults", async () => {
    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center`
    );

    expect(res.status).toBe(200);
    expect(res.body.workflows).toHaveLength(10);
    expect(res.body.refundPack.workbookHref).toContain("/refund-pack.xlsx");
    expect(res.body.refundPack.bundleHref).toContain("/refund-pack.zip");
    expect(res.body.clientRequestDraft.defaultRecipient).toBe("client@example.com");
    expect(res.body.proofDrilldowns.map((line: any) => line.documentStatus)).toContain("attached");
    expect(res.body.proofDrilldowns.map((line: any) => line.documentStatus)).toContain("missing");
    expect(res.body.missingEvidence.some((issue: any) => issue.resolutionStatus === "open")).toBe(
      true
    );
  });

  it("audit-logs issue resolution and applies the issue status on the next response", async () => {
    const before = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center`
    );
    const issueId = before.body.missingEvidence[0].id;

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/evidence-center/issues/${encodeURIComponent(issueId)}/actions`,
      { action: "resolve", reason: "Supplier tax invoice uploaded and checked." }
    );

    expect(res.status).toBe(200);
    expect(storage.createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve",
        entityType: "evidence_issue",
        entityId: issueId,
      })
    );
    expect(res.body.missingEvidence.find((issue: any) => issue.id === issueId)).toMatchObject({
      resolutionStatus: "resolved",
      resolutionReason: "Supplier tax invoice uploaded and checked.",
    });
  });

  it("requires exact reviewed request content before logging manual delivery", async () => {
    const center = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center`
    );

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/evidence-center/client-request/review`,
      {
        recipient: "client@example.com",
        subject: center.body.clientRequestDraft.subject,
        body: center.body.clientRequestDraft.body,
        acknowledgedExactContent: true,
      }
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("reviewed_for_manual_delivery");
    expect(storage.createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "request_reviewed",
        entityType: "evidence_request",
      })
    );
  });

  it("downloads workbook, PDF cover, and ZIP bundle artifacts through authenticated company-scoped routes", async () => {
    const workbook = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center/refund-pack.xlsx`
    );
    const cover = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center/refund-pack-cover.pdf`
    );
    const bundle = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/evidence-center/refund-pack.zip`
    );

    expect(workbook.status).toBe(200);
    expect(workbook.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(workbook.arrayBuffer.byteLength).toBeGreaterThan(1000);
    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toContain("application/pdf");
    expect(cover.arrayBuffer.byteLength).toBeGreaterThan(500);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("application/zip");
    expect(bundle.arrayBuffer.byteLength).toBeGreaterThan(2000);
    expect(Buffer.from(bundle.arrayBuffer).subarray(0, 2).toString("utf8")).toBe("PK");
  });
});
