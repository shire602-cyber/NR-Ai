import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "22222222-2222-4222-8222-222222222222";
// X6b: a small per-company OCR budget so the limiter test stays short (read when the route loads).
vi.hoisted(() => {
  process.env.RL_OCR_COMPANY_MAX = "3";
});

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", userType: "customer" };
    next();
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getCompaniesByUserId: vi.fn(async () => [{ id: COMPANY }]),
  },
}));
vi.mock("../../server/services/excel-export.service", () => ({
  buildGenericWorkbook: vi.fn(),
  buildOcrReceiptsWorkbook: vi.fn(),
  buildExportFilename: vi.fn(() => "x.xlsx"),
}));

const classifier = vi.hoisted(() => ({
  result: {
    category: "Meals",
    accountId: null,
    confidence: 0.9,
    method: "keyword",
    reason: "keyword",
  } as any,
  calls: [] as any[],
}));
vi.mock("../../server/services/receipt-autopilot.service", () => ({
  classifyOcrReceipt: vi.fn(async (_company: string, ocr: any) => {
    classifier.calls.push(ocr);
    return classifier.result;
  }),
}));
vi.mock("../../server/services/local-ocr.service", () => ({
  extractReceiptWithLocalOcr: vi.fn(async () => {
    throw new Error("local OCR unavailable in test");
  }),
}));

import { extractReceiptWithLocalOcr } from "../../server/services/local-ocr.service";
import { registerOCRRoutes } from "../../server/routes/ocr.routes";
import { setUsageStore, clearPromptCache } from "../../server/services/ai/usage-meter";

const goodExtraction = {
  merchant: "Spinneys LLC",
  date: "2026-11-10",
  invoiceNumber: "INV-7",
  subtotal: 100,
  vatPercentage: 5,
  vatAmount: 5,
  total: 105,
  currency: "AED",
  category: "Meals",
  lineItems: [{ description: "Coffee قهوة", quantity: 2, unitPrice: 50, total: 100 }],
  supplierTrn: "100123456700003",
  isTaxInvoice: true,
  simplifiedInvoice: false,
  reverseChargeSuggested: false,
  confidence: 0.95,
};

function anthropicReturning(...payloads: any[]) {
  const create = vi.fn(async (_params: any) => {
    const payload = payloads.length > 1 ? payloads.shift() : payloads[0];
    return {
      content: [{ type: "tool_use", name: "record_receipt", input: payload }],
      usage: { input_tokens: 800, output_tokens: 150 },
    };
  });
  return { create, client: { messages: { create } } as any };
}

const PNG = (() => {
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
})();
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;

async function post(app: express.Express, body: unknown) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/ocr/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function appWith(deps: { anthropic?: any; openai?: any }) {
  const app = express();
  app.use(express.json({ limit: "3mb" }));
  registerOCRRoutes(app, { anthropic: deps.anthropic ?? null, openai: deps.openai ?? null });
  return app;
}

beforeEach(() => {
  classifier.calls.length = 0;
  classifier.result = {
    category: "Meals",
    accountId: null,
    confidence: 0.9,
    method: "keyword",
    reason: "keyword",
  };
  clearPromptCache();
});
afterEach(() => setUsageStore(null));

describe("R05-22 / R05-17 OCR route uses forced tool-use and returns the extended schema", () => {
  it("R05-22 calls Anthropic with tool_choice and the AI_MODEL_OCR-routed model", async () => {
    const { client, create } = anthropicReturning(goodExtraction);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.tool_choice).toEqual({ type: "tool", name: "record_receipt" });
    expect(params.tools[0].input_schema.additionalProperties).toBe(false);
    expect(res.body).toMatchObject({
      merchant: "Spinneys LLC",
      total: 105,
      supplierTrn: "100123456700003",
      isTaxInvoice: true,
      simplifiedInvoice: false,
      reverseChargeSuggested: false,
      currency: "AED",
      confidenceBand: "high",
      ocrSource: "ai",
    });
    expect(res.body.lineItems[0].description).toContain("قهوة");
    // the supplier TRN is handed to the classifier for vendor-to-account memory (R05-24)
    expect(classifier.calls[0].supplierTrn).toBe("100123456700003");
  });

  it("S7 hands the classifier line items as { description } objects, not bare strings", async () => {
    const { client } = anthropicReturning(goodExtraction);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    // classifyOcrReceipt reads li.description; strings made every line item empty.
    expect(classifier.calls[0].lineItems).toEqual([{ description: "Coffee قهوة" }]);
  });

  it("R05-15 a missing model confidence is low (0), never the old 0.85 default", async () => {
    const { confidence: _omit, ...noConfidence } = goodExtraction;
    const { client } = anthropicReturning(noConfidence);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBe(0);
    expect(res.body.confidenceBand).toBe("low");
    expect(res.body.reviewReasons.join(" ")).toMatch(/no confidence/i);
    expect(res.body.reviewReasonCodes).toContain("MISSING_CONFIDENCE");
  });

  it("R05-22 retries once when subtotal + VAT does not equal the total, then returns the fix", async () => {
    const { client, create } = anthropicReturning(
      { ...goodExtraction, total: 999 },
      goodExtraction
    );
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(create).toHaveBeenCalledTimes(2);
    const retryPrompt = JSON.stringify(create.mock.calls[1][0].messages);
    expect(retryPrompt).toMatch(/CORRECTION NEEDED/);
    expect(res.body.total).toBe(105);
    expect(res.body.confidenceBand).toBe("high");
  });

  it("R05-22 an extraction that stays inconsistent is routed to low-confidence review", async () => {
    const { client } = anthropicReturning({ ...goodExtraction, total: 999 });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect(res.body.confidenceBand).toBe("low");
    expect(res.body.validationIssues.map((i: any) => i.code)).toContain("AMOUNT_MISMATCH");
  });

  it("a zero-rated receipt whose total exceeds the subtotal keeps VAT 0 and flags the mismatch", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      subtotal: 100,
      vatAmount: 0,
      vatPercentage: 0,
      total: 110,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect(res.body.vatAmount).toBe(0);
    expect(res.body.total).toBe(110);
    expect(res.body.validationIssues.map((i: any) => i.code)).toContain("AMOUNT_MISMATCH");
  });

  it("a 100 / 115.50 receipt with no VAT line: the AMOUNT_MISMATCH note quotes the form's VAT 5, not 0", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      subtotal: 100,
      vatAmount: 0,
      vatPercentage: 5,
      total: 115.5,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect(res.body.vatAmount).toBe(5);
    const notes = res.body.validationIssues.filter((i: any) => i.code === "AMOUNT_MISMATCH");
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/Subtotal 100\.00 \+ VAT 5\.00 does not equal total 115\.50/);
    expect(notes[0].message).not.toMatch(/VAT 0\.00 /);
  });

  it("a raw AMOUNT_MISMATCH note is dropped when the reconciled figures add up (100 / no VAT / 105)", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      subtotal: 100,
      vatAmount: 0,
      vatPercentage: 5,
      total: 105,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect([res.body.subtotal, res.body.vatAmount, res.body.total]).toEqual([100, 5, 105]);
    expect(res.body.validationIssues.map((i: any) => i.code)).not.toContain("AMOUNT_MISMATCH");
    expect(res.body.reviewReasons.join(" ")).not.toMatch(/does not equal/);
  });

  it("a subtotal-only receipt gets a VAT_DERIVED review note and leaves the high band", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      subtotal: 100,
      vatAmount: 0,
      vatPercentage: 5,
      total: 0,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect([res.body.subtotal, res.body.vatAmount, res.body.total]).toEqual([100, 5, 105]);
    const notes = res.body.validationIssues.filter((i: any) => i.code === "VAT_DERIVED");
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/VAT 5\.00 was calculated at 5%/);
    expect(res.body.reviewReasonCodes).toContain("VAT_DERIVED");
    expect(res.body.confidenceBand).not.toBe("high");
  });

  it("a total-only receipt gets a VAT_DERIVED note (worked back from the total) and leaves the high band", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      subtotal: 0,
      vatAmount: 0,
      vatPercentage: 5,
      total: 105,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect([res.body.subtotal, res.body.vatAmount, res.body.total]).toEqual([100, 5, 105]);
    const notes = res.body.validationIssues.filter((i: any) => i.code === "VAT_DERIVED");
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/VAT 5\.00 was worked back from the total at 5%/);
    expect(notes[0].message).toMatch(/valid tax invoice from a VAT-registered supplier/);
    expect(res.body.reviewReasonCodes).toContain("VAT_DERIVED");
    expect(res.body.confidenceBand).not.toBe("high");
  });
  it("a VAT figure with no valid supplier TRN raises VAT_NO_TRN so the reviewer sees it", async () => {
    const { client } = anthropicReturning({ ...goodExtraction, supplierTrn: null });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    const notes = res.body.validationIssues.filter((i: any) => i.code === "VAT_NO_TRN");
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe("warning");
    expect(res.body.confidenceBand).not.toBe("high");
  });

  it("net + gross printed with no VAT line is VAT_DERIVED, not a clean high-confidence receipt", async () => {
    const { client } = anthropicReturning({ ...goodExtraction, vatAmount: null });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect([res.body.subtotal, res.body.vatAmount, res.body.total]).toEqual([100, 5, 105]);
    const codes = res.body.validationIssues.map((i: any) => i.code);
    expect(codes).toContain("VAT_DERIVED");
    expect(res.body.confidenceBand).not.toBe("high");
  });

  it("VAT_DERIVED and no supplier TRN gives one note, not VAT_NO_TRN as well", async () => {
    const { client } = anthropicReturning({
      ...goodExtraction,
      vatAmount: null,
      supplierTrn: null,
    });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    const codes = res.body.validationIssues.map((i: any) => i.code);
    expect(codes).toContain("VAT_DERIVED");
    expect(codes).not.toContain("VAT_NO_TRN");
  });

  it("the company's own TRN read as the supplier's raises VAT_NO_TRN", async () => {
    const { storage } = await import("../../server/storage");
    (storage as any).getCompany = vi.fn(async () => ({ trnVatNumber: "100123456700003" }));
    try {
      const { client } = anthropicReturning(goodExtraction);
      const res = await post(appWith({ anthropic: client }), {
        imageData: PNG_URL,
        companyId: COMPANY,
      });
      expect(res.body.validationIssues.map((i: any) => i.code)).toContain("VAT_NO_TRN");
    } finally {
      delete (storage as any).getCompany;
    }
  });

  it("a VAT-bearing receipt with a valid supplier TRN does not raise VAT_NO_TRN", async () => {
    const { client } = anthropicReturning(goodExtraction);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.body.validationIssues.map((i: any) => i.code)).not.toContain("VAT_NO_TRN");
  });

  it("R05-23 a classifier disagreement drops a confident extraction to the review band", async () => {
    classifier.result = {
      category: "Utilities",
      accountId: null,
      confidence: 0.92,
      method: "keyword",
      reason: "k",
    };
    const { client } = anthropicReturning(goodExtraction);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.body.confidenceBand).toBe("review");
    expect(res.body.classifier.agreesWithAi).toBe(false);
  });

  it("R05-17 an invalid supplier TRN is a warning, not a hard failure", async () => {
    const { client } = anthropicReturning({ ...goodExtraction, supplierTrn: "12345" });
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(200);
    expect(res.body.validationIssues.map((i: any) => i.code)).toContain("TRN_INVALID");
    expect(res.body.confidenceBand).not.toBe("high");
  });

  it("R05-22 falls back to OpenAI strict json_schema when Anthropic fails", async () => {
    const anthropic = {
      messages: { create: vi.fn(async () => Promise.reject(new Error("overloaded"))) },
    };
    const openaiCreate = vi.fn(async (_params: any) => ({
      choices: [{ message: { content: JSON.stringify(goodExtraction) } }],
      usage: { prompt_tokens: 500, completion_tokens: 100 },
    }));
    const res = await post(
      appWith({ anthropic, openai: { chat: { completions: { create: openaiCreate } } } }),
      { imageData: PNG_URL, companyId: COMPANY }
    );
    expect(res.status).toBe(200);
    expect(openaiCreate.mock.calls[0][0].response_format.type).toBe("json_schema");
    expect(openaiCreate.mock.calls[0][0].model).toBe("gpt-4o");
  });
});

describe("R05-06 / R05-26 guards on the OCR route", () => {
  it("R05-06 HTML bytes labelled as a PNG are rejected before any provider call", async () => {
    const { client, create } = anthropicReturning(goodExtraction);
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const res = await post(appWith({ anthropic: client }), {
      imageData: `data:image/png;base64,${html}`,
      companyId: COMPANY,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_FILE");
    expect(create).not.toHaveBeenCalled();
  });

  it("R05-26 returns 429 AI_QUOTA_EXCEEDED over the monthly cap and does not call a provider", async () => {
    setUsageStore({
      insert: async () => undefined,
      monthToDate: async () => ({ tokens: 99_000_000, costUsd: 0 }),
      getLimits: async () => ({ monthlyTokenCap: 1000, monthlyCostCapUsd: null }),
    });
    const { client, create } = anthropicReturning(goodExtraction);
    const res = await post(appWith({ anthropic: client }), {
      imageData: PNG_URL,
      companyId: COMPANY,
    });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("AI_QUOTA_EXCEEDED");
    expect(create).not.toHaveBeenCalled();
  });

  it("R05-26 every provider call is recorded as a usage event", async () => {
    const events: any[] = [];
    setUsageStore({
      insert: async (e) => {
        events.push(e);
      },
      monthToDate: async () => ({ tokens: 0, costUsd: 0 }),
      getLimits: async () => null,
    });
    const { client } = anthropicReturning(goodExtraction);
    await post(appWith({ anthropic: client }), { imageData: PNG_URL, companyId: COMPANY });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      companyId: COMPANY,
      task: "ocr",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 800,
      outputTokens: 150,
    });
  });

  it("R05-09 with no provider and unreadable input the route still answers 503 AI_NOT_CONFIGURED", async () => {
    const res = await post(appWith({}), { imageData: PNG_URL, companyId: COMPANY });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_NOT_CONFIGURED");
  });
});

describe("R05-12 / R05-16 Arabic text without any AI provider", () => {
  it("R05-12 parses an Arabic receipt with Eastern digits through the deterministic fallback", async () => {
    const res = await post(appWith({}), {
      companyId: COMPANY,
      content: "سبينيس\nالتاريخ ١٠/١١/٢٠٢٦\nالإجمالي ١٠٥٫٠٠ د.إ",
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(105);
    expect(res.body.date).toBe("2026-11-10");
    expect(res.body.merchant).toBe("سبينيس");
    expect(res.body.ocrSource).toBe("text-parser");
    // deterministic parser output never reaches "high" without validation + classifier agreement
    expect(["review", "low"]).toContain(res.body.confidenceBand);
  });

  it("R05-17 returns TRN/tax-invoice/reverse-charge signals from Arabic labels", async () => {
    const res = await post(appWith({}), {
      companyId: COMPANY,
      content: [
        "سبينيس ذ.م.م",
        "فاتورة ضريبية",
        "الرقم الضريبي 100123456700003",
        "التاريخ 10/11/2026",
        "المجموع الفرعي 100.00",
        "ضريبة القيمة المضافة 5% 5.00",
        "الإجمالي 105.00 د.إ",
      ].join("\n"),
    });
    expect(res.body).toMatchObject({
      supplierTrn: "100123456700003",
      isTaxInvoice: true,
      subtotal: 100,
      vatAmount: 5,
      total: 105,
    });
  });
});

describe("X3 /api/ocr/status tells the page up front whether automatic reading is on", () => {
  async function status(app: express.Express) {
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/api/ocr/status`);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("reports aiConfigured=false with no AI provider (the page opens manual entry, no 90s spinner)", async () => {
    const res = await status(appWith({}));
    expect(res).toEqual({ status: 200, body: { aiConfigured: false } });
  });

  it("reports aiConfigured=true when a provider client exists", async () => {
    const { client } = anthropicReturning(goodExtraction);
    const res = await status(appWith({ anthropic: client }));
    expect(res.body).toEqual({ aiConfigured: true });
  });
});

describe("X6b OCR fails fast and is rate limited per company", () => {
  it("answers 503 AI_NOT_CONFIGURED at once for an image when no AI provider is set, without starting local OCR", async () => {
    vi.mocked(extractReceiptWithLocalOcr).mockClear();
    const started = Date.now();
    const res = await post(appWith({}), { imageData: PNG_URL, companyId: COMPANY });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_NOT_CONFIGURED");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(extractReceiptWithLocalOcr).not.toHaveBeenCalled();
  });

  it("still parses pasted text without a provider (no 503 for the instant parser)", async () => {
    const res = await post(appWith({}), {
      companyId: COMPANY,
      content: "Spinneys\nDate 10/11/2026\nTotal 105.00 AED",
    });
    expect(res.status).toBe(200);
    expect(res.body.ocrSource).toBe("text-parser");
  });

  it("limits scans per company: the 4th call in the window is 429, another company is unaffected", async () => {
    const app = appWith({});
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (typeof addr === "string" || !addr) throw new Error("no address");
      const call = async (companyId: string) => {
        const r = await fetch(`http://127.0.0.1:${addr.port}/api/ocr/process`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId, content: "Cafe\nTotal 10.00 AED" }),
        });
        return { status: r.status, body: await r.json() };
      };
      for (let i = 0; i < 3; i++) expect((await call(COMPANY)).status).toBe(200);
      const limited = await call(COMPANY);
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
      expect((await call(OTHER_COMPANY)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Receipt OCR request deadline", () => {
  it("returns an application 504 and cancels a stuck provider without starting a fallback", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const localOcr = vi.mocked(extractReceiptWithLocalOcr);
    localOcr.mockClear();
    const create = vi.fn((_params: unknown, options: { signal: AbortSignal }) => {
      expect(options.signal).toBe(deadline.signal);
      return new Promise<never>((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
        setImmediate(() => deadline.abort());
      });
    });
    try {
      const res = await post(appWith({ anthropic: { messages: { create } } }), {
        companyId: COMPANY,
        imageData: PNG_URL,
      });
      expect(timeout).toHaveBeenCalledWith(40_000);
      expect(res.status).toBe(504);
      expect(res.body.code).toBe("OCR_TIMEOUT");
      expect(create).toHaveBeenCalledTimes(1);
      expect(localOcr).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it("enforces the same deadline when the local fallback stalls", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const create = vi.fn().mockRejectedValue(new Error("Provider unavailable"));
    const localOcr = vi.mocked(extractReceiptWithLocalOcr);
    localOcr.mockImplementationOnce(async (_image, signal) => {
      expect(signal).toBe(deadline.signal);
      setImmediate(() => deadline.abort());
      return new Promise<never>(() => {});
    });
    try {
      const res = await post(appWith({ anthropic: { messages: { create } } }), {
        companyId: COMPANY,
        imageData: PNG_URL,
      });
      expect(res.status).toBe(504);
      expect(res.body.code).toBe("OCR_TIMEOUT");
      expect(create).toHaveBeenCalled();
      expect(classifier.calls).toHaveLength(0);
    } finally {
      timeout.mockRestore();
    }
  });
});
