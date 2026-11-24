import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const COMPANY = "11111111-1111-4111-8111-111111111111";

vi.mock("../../server/services/receipt-posting.service", () => ({
  resolveReceiptRate: vi.fn(async () => ({ rate: 1, source: null })),
}));
vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

const state = vi.hoisted(() => ({
  receipts: [] as any[],
  saved: [] as Array<{ mime: string; ext?: string; size: number }>,
  audits: [] as any[],
  exactDuplicate: null as any,
  fuzzy: [] as any[],
  serveBuffer: Buffer.alloc(0),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getReceiptsByCompanyId: vi.fn(async () => state.receipts),
    getReceipt: vi.fn(async (id: string) => state.receipts.find((r) => r.id === id)),
    getCapturedReceipt: vi.fn(async () => undefined),
    createCapturedReceipt: vi.fn(async (r: any) => {
      const row = { id: `r-${state.receipts.length + 1}`, ...r };
      state.receipts.push(row);
      return { receipt: row, replay: false };
    }),
    createTransactionClassification: vi.fn(async () => ({ id: "c-1" })),
  },
}));
vi.mock("../../server/services/socket.service", () => ({
  createAndEmitNotification: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/period-lock.service", () => ({
  assertPeriodNotLocked: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/audit.service", () => ({
  recordAudit: vi.fn(async (a: any) => {
    state.audits.push(a);
  }),
}));
vi.mock("../../server/services/retention.service", () => ({
  assertRetentionExpired: vi.fn(),
}));
vi.mock("../../server/services/excel-export.service", () => ({
  buildOcrReceiptsWorkbook: vi.fn(),
  buildExportFilename: vi.fn(),
  receiptToExportRow: vi.fn(),
}));
vi.mock("../../server/services/receipt-autopilot.service", () => ({
  recordClassificationFeedback: vi.fn(async () => undefined),
  autoPostManualReceipt: vi.fn(async () => ({ autoPosted: false })),
}));
vi.mock("../../server/services/receipt-duplicates", async () => {
  const actual = await vi.importActual<typeof import("../../server/services/receipt-duplicates")>(
    "../../server/services/receipt-duplicates"
  );
  return {
    ...actual,
    findReceiptByContentHash: vi.fn(async () => state.exactDuplicate),
    findFuzzyDuplicatesInDb: vi.fn(async () => state.fuzzy),
  };
});
vi.mock("../../server/services/fileStorage", async () => {
  const actual = await vi.importActual<typeof import("../../server/services/fileStorage")>(
    "../../server/services/fileStorage"
  );
  return {
    ...actual,
    saveReceiptFile: vi.fn(async (buf: Buffer, info: any) => {
      state.saved.push({ mime: info.mime, ext: info.ext, size: buf.length });
      return `receipts/test-${state.saved.length}.${info.ext}`;
    }),
    readReceiptImage: vi.fn(async () => ({
      buffer: state.serveBuffer,
      contentType: "image/jpeg", // the legacy mislabel
    })),
    deleteReceiptImage: vi.fn(),
    assertWithinStorageQuota: vi.fn(async () => undefined),
    getCompanyStorageUsage: vi.fn(async () => 1234),
  };
});

import { registerReceiptRoutes } from "../../server/routes/receipts.routes";

function png(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}
const gif = () => {
  const b = Buffer.alloc(16);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(2, 6);
  b.writeUInt16LE(2, 8);
  return b;
};
const url = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString("base64")}`;

function app() {
  const a = express();
  a.use(express.json({ limit: "3mb" }));
  registerReceiptRoutes(a);
  return a;
}

async function req(method: string, path: string, body?: unknown) {
  const server = app().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") || "";
    return {
      status: res.status,
      headers: res.headers,
      body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const base = {
  merchant: "Spinneys",
  amount: 100,
  vatAmount: 5,
  date: "2026-11-10T00:00:00.000Z",
  category: "Meals",
  currency: "AED",
};

beforeEach(() => {
  state.receipts.length = 0;
  state.saved.length = 0;
  state.audits.length = 0;
  state.exactDuplicate = null;
  state.fuzzy = [];
  state.serveBuffer = Buffer.alloc(0);
});

describe("R05-06 / R05-08 upload validation on the receipt route", () => {
  it("R05-06 HTML bytes labelled image/png are rejected with 400 UNSUPPORTED_FILE and nothing is stored", async () => {
    const html = Buffer.from("<html><script>alert(1)</script>");
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      imageData: url("image/png", html),
    });
    expect(res.status).toBe(400);
    expect((res.body as any).code).toBe("UNSUPPORTED_FILE");
    expect(state.saved).toHaveLength(0);
    expect(state.receipts).toHaveLength(0);
  });

  it("R05-06 a GIF is stored as .gif with its true type, and the receipt records mime, size and sha256", async () => {
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      imageData: url("image/gif", gif()),
    });
    expect(res.status).toBe(200);
    expect(state.saved[0]).toMatchObject({ mime: "image/gif", ext: "gif" });
    expect(state.receipts[0]).toMatchObject({
      imagePath: "receipts/test-1.gif",
      fileMime: "image/gif",
      fileSize: 16,
    });
    expect(state.receipts[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("R05-08 PDFs are accepted on the receipt route", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF");
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      imageData: url("application/pdf", pdf),
    });
    expect(res.status).toBe(200);
    expect(state.saved[0]).toMatchObject({ mime: "application/pdf", ext: "pdf" });
  });

  it("R05-07 oversize uploads are rejected with 413 FILE_TOO_LARGE", async () => {
    const big = Buffer.concat([png(), Buffer.alloc(2 * 1024 * 1024)]);
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      imageData: url("image/png", big),
    });
    expect(res.status).toBe(413);
    expect((res.body as any).code).toBe("FILE_TOO_LARGE");
  });

  it("R05-17 a malformed supplier TRN is rejected, a valid one is stored", async () => {
    const bad = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      supplierTrn: "12345",
    });
    expect(bad.status).toBe(400);
    expect((bad.body as any).code).toBe("INVALID_TRN");
    const ok = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      supplierTrn: "100 1234 5670 0003",
    });
    expect(ok.status).toBe(200);
    expect(state.receipts[0].supplierTrn).toBe("100123456700003");
  });
});

describe("R05-18 duplicate detection at upload", () => {
  it("R05-18 an exact duplicate (same content hash) returns 409 with the matching receipt", async () => {
    state.exactDuplicate = { id: "r-old", merchant: "Spinneys", amount: 100, date: "2026-11-10" };
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      imageData: url("image/png", png()),
    });
    expect(res.status).toBe(409);
    expect((res.body as any).code).toBe("DUPLICATE_RECEIPT");
    expect((res.body as any).duplicateOf.id).toBe("r-old");
    expect(state.saved).toHaveLength(0);
  });

  it("R05-18 confirmDuplicate lets the user upload the same file again", async () => {
    state.exactDuplicate = { id: "r-old", merchant: "Spinneys", amount: 100, date: "2026-11-10" };
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, {
      ...base,
      confirmDuplicate: true,
      imageData: url("image/png", png()),
    });
    expect(res.status).toBe(200);
    expect(state.saved).toHaveLength(1);
    expect(state.receipts[0]).not.toHaveProperty("confirmDuplicate");
  });

  it("R05-18 a fuzzy match is saved but returned as a warning", async () => {
    state.fuzzy = [
      { id: "r-old", merchant: "Spinneys LLC", similarity: 0.9, reasons: ["Same amount"] },
    ];
    const res = await req("POST", `/api/companies/${COMPANY}/receipts`, { ...base });
    expect(res.status).toBe(200);
    expect((res.body as any).duplicateWarnings).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
  });

  it("R05-18 check-similar no longer crashes when merchant is missing", async () => {
    state.receipts.push({
      id: "r-1",
      merchant: "Spinneys",
      amount: 100,
      date: new Date("2026-11-10"),
      category: "Meals",
    });
    const res = await req("POST", `/api/companies/${COMPANY}/receipts/check-similar`, {
      amount: 100,
      date: "2026-11-11",
    });
    expect(res.status).toBe(200);
    expect((res.body as any).hasSimilar).toBe(true);
    const empty = await req("POST", `/api/companies/${COMPANY}/receipts/check-similar`, {});
    expect(empty.status).toBe(200);
    expect((empty.body as any).hasSimilar).toBe(false);
  });

  it("R05-18 check-similar matches Arabic merchant names", async () => {
    state.receipts.push({
      id: "r-2",
      merchant: "سبينيس ذ.م.م",
      amount: 50,
      date: new Date("2026-11-10"),
    });
    const res = await req("POST", `/api/companies/${COMPANY}/receipts/check-similar`, {
      merchant: "سبينيس",
      amount: 52,
    });
    expect((res.body as any).hasSimilar).toBe(true);
  });
});

describe("R05-06 serving and R05-23 audit of AI decisions", () => {
  it("R05-06 the image route serves the TRUE type (sniffed) with a matching extension", async () => {
    state.receipts.push({ id: "r-9", companyId: COMPANY, imagePath: "receipts/legacy.jpg" });
    state.serveBuffer = png(); // stored as .jpg historically but really a PNG
    const res = await req("GET", `/api/companies/${COMPANY}/receipts/r-9/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/receipt-r-9\.png/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("R05-20 thumbnails report unavailable (without sharp) instead of failing", async () => {
    state.receipts.push({ id: "r-9", companyId: COMPANY, imagePath: "receipts/x.png" });
    state.serveBuffer = png();
    const res = await req("GET", `/api/companies/${COMPANY}/receipts/r-9/image?size=thumb`);
    expect(res.status).toBe(200);
    expect(["unavailable", null]).toContain(res.headers.get("x-thumbnail"));
  });

  it("R05-23 records the reviewer, decision and confidence band in the audit log", async () => {
    state.receipts.push({ id: "r-5", companyId: COMPANY });
    const res = await req("POST", `/api/companies/${COMPANY}/receipts/r-5/review-decision`, {
      decision: "corrected",
      band: "review",
      note: "fixed VAT",
    });
    expect(res.status).toBe(200);
    expect(state.audits[0]).toMatchObject({
      userId: "user-1",
      companyId: COMPANY,
      action: "receipt.ai_review",
      entityId: "r-5",
      after: {
        reviewerId: "user-1",
        decision: "corrected",
        confidenceBand: "review",
        note: "fixed VAT",
      },
    });
    const bad = await req("POST", `/api/companies/${COMPANY}/receipts/r-5/review-decision`, {
      decision: "maybe",
      band: "review",
    });
    expect(bad.status).toBe(400);
  });

  it("R05-20 upload-policy exposes limits, accepted types, antivirus status and quota", async () => {
    const res = await req("GET", `/api/companies/${COMPANY}/receipts/upload-policy`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      maxFileBytes: 2 * 1024 * 1024,
      virusScan: "requires_external",
      storage: { usedBytes: 1234 },
    });
    expect((res.body as any).allowedTypes).toContain("application/pdf");
  });
});
