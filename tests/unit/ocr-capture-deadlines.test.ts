import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const { anthropicCreate, openaiCreate, getCapturedReceipt, getUserRole, resolveBulkTargets } =
  vi.hoisted(() => ({
    anthropicCreate: vi.fn(),
    openaiCreate: vi.fn(),
    getCapturedReceipt: vi.fn(),
    getUserRole: vi.fn(),
    resolveBulkTargets: vi.fn(),
  }));

vi.mock("../../server/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/middleware/auth")>()),
  authenticateRequest: async () => ({ user: { id: "user-1", userType: "customer" } }),
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", userType: "customer" } as Express.User;
    next();
  },
}));
vi.mock("../../server/middleware/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/middleware/rbac")>()),
  firmContextOf: vi.fn(),
  requireFirmAccess:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  requireFirmPermission:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));
vi.mock("../../server/services/firm/bulk.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/firm/bulk.service")>()),
  resolveBulkTargets,
}));
vi.mock("../../server/services/ocr-provider-clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/ocr-provider-clients")>()),
  createOcrClients: () => ({
    anthropic: { messages: { create: anthropicCreate } },
    openai: { chat: { completions: { create: openaiCreate } } },
  }),
}));
vi.mock("../../server/services/ai/usage-meter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/ai/usage-meter")>()),
  assertAiQuota: vi.fn(),
}));
vi.mock("../../server/storage", async () => ({
  storage: {
    hasCompanyAccess: async () => true,
    getUserRole,
    getCapturedReceipt,
    createCapturedReceipt: (await import("../../server/storage/receipts")).ReceiptStorage.prototype
      .createCapturedReceipt,
  },
}));

import { db } from "../../server/db";
import { startOcrDeadline } from "../../server/http/ocr-deadline";
import { companyRolePolicy } from "../../server/middleware/companyRolePolicy";
import { registerBillPayRoutes } from "../../server/routes/bill-pay.routes";
import { registerFirmBulkRoutes } from "../../server/routes/firm-bulk.routes";

async function post(register: (app: express.Express) => void, path: string, body: unknown) {
  const app = express();
  app.use(startOcrDeadline);
  app.use(express.json());
  app.use("/api", companyRolePolicy);
  register(app);
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function stubDeadline() {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
  return { controller, timeout };
}

const bulkItems = ["first.png", "second.png", "third.png"].map((filename, index) => ({
  companyId: COMPANY_ID,
  imageData: `data:image/png;base64,${Buffer.from([1, 2, index]).toString("base64")}`,
  filename,
}));
const ocrResponse = { content: [{ type: "text", text: '{"merchant":"Shop","subtotal":50}' }] };
const billPath = `/api/companies/${COMPANY_ID}/bills/capture`;
const billBody = {
  file: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%%EOF").toString("base64")}`,
};

function stubReceiptTransaction(returning: () => Promise<Array<{ id: string }>>) {
  const insert = vi.fn(() => ({
    values: () => ({ onConflictDoNothing: () => ({ returning }) }),
  }));
  const select = () => ({ from: () => ({ where: async () => [] }) });
  const tx = { insert, select } as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0];
  const transaction = vi.spyOn(db, "transaction").mockImplementation((run) => run(tx));
  return { insert, transaction };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("Bill capture and firm bulk OCR deadlines", () => {
  it("returns OCR_TIMEOUT while the company-role lookup is still pending", async () => {
    const { controller, timeout } = stubDeadline();
    let finishLookup!: (role: { role: string }) => void;
    getUserRole.mockImplementation(() => {
      expect(timeout).toHaveBeenCalledExactlyOnceWith(40_000);
      setImmediate(() => controller.abort());
      return new Promise((resolve) => {
        finishLookup = resolve;
      });
    });
    try {
      const response = await post(registerBillPayRoutes, billPath, billBody);
      expect(response).toMatchObject({ status: 504, body: { code: "OCR_TIMEOUT" } });
      expect(getUserRole).toHaveBeenCalledTimes(1);
    } finally {
      finishLookup?.({ role: "owner" });
    }
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("returns OCR_TIMEOUT for a stalled bill extraction and passes the request signal to the provider", async () => {
    const { controller, timeout } = stubDeadline();
    getUserRole.mockImplementation(async () => {
      expect(timeout).toHaveBeenCalledExactlyOnceWith(40_000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      return { role: "owner" };
    });
    anthropicCreate.mockImplementation((_params, options) => {
      expect(options.signal).toBe(controller.signal);
      setImmediate(() => controller.abort());
      return new Promise<never>(() => {});
    });
    const response = await post(registerBillPayRoutes, billPath, billBody);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(40_000);
    expect(response).toMatchObject({ status: 504, body: { code: "OCR_TIMEOUT" } });
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("returns saved receipt IDs when the next bulk item stalls and stops the batch", async () => {
    const { controller, timeout } = stubDeadline();
    const { insert } = stubReceiptTransaction(async () => [{ id: "receipt-1" }]);
    resolveBulkTargets.mockResolvedValue([COMPANY_ID]);
    anthropicCreate.mockResolvedValueOnce(ocrResponse).mockImplementation((_params, options) => {
      expect(options.signal).toBe(controller.signal);
      setImmediate(() => controller.abort());
      return new Promise<never>(() => {});
    });

    const response = await post(registerFirmBulkRoutes, "/api/firm/bulk/ocr", { items: bulkItems });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(40_000);
    expect(response).toMatchObject({
      status: 504,
      body: {
        code: "OCR_TIMEOUT",
        results: [
          { companyId: COMPANY_ID, filename: "first.png", success: true, receiptId: "receipt-1" },
        ],
      },
    });
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(anthropicCreate).toHaveBeenNthCalledWith(1, expect.anything(), {
      signal: controller.signal,
    });
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("rejects the receipt transaction if the insert finishes after the deadline", async () => {
    const { controller } = stubDeadline();
    resolveBulkTargets.mockResolvedValue([COMPANY_ID]);
    anthropicCreate.mockResolvedValue(ocrResponse);
    let finishInsert!: (receipt: { id: string }) => void;
    const receipt = new Promise<Array<{ id: string }>>((resolve) => {
      finishInsert = (saved) => resolve([saved]);
    });
    const { insert, transaction } = stubReceiptTransaction(() => {
      setImmediate(() => controller.abort());
      return receipt;
    });

    const response = await post(registerFirmBulkRoutes, "/api/firm/bulk/ocr", { items: bulkItems });
    expect(response).toMatchObject({ status: 504, body: { code: "OCR_TIMEOUT", results: [] } });
    expect(insert).toHaveBeenCalledTimes(1);
    finishInsert({ id: "late-receipt" });
    await expect(transaction.mock.results[0].value).rejects.toBe(controller.signal.reason);
  });
});
