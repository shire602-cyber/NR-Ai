import { EMAIL_INTAKE_LIMIT } from "../../server/http/body-limits";
/**
 * R05-19a - end-to-end: a signed sample email webhook produces a draft receipt.
 *
 * Real code under test: webhook signature check, payload mapping, sender gate, attachment
 * hashing/dedup, structured AI extraction (mocked Anthropic client), receipt autopilot
 * (always creates an unposted receipt for review unless the company enabled autopilot).
 * Mocked: storage, DB pool, provider SDK client.
 */
import crypto from "node:crypto";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY = "11111111-1111-4111-8111-111111111111";

const db = vi.hoisted(() => ({
  receipts: [] as any[],
  docs: [] as any[],
  messages: [] as any[],
  classifications: [] as any[],
  hashes: new Set<string>(),
  autopilot: { enabled: false, rules: [] as any[] },
  postedEntries: [] as any[],
}));

vi.mock("../../server/storage", () => ({
  storage: {
    listAllActiveEmailSources: vi.fn(async () => [
      {
        id: "src-1",
        companyId: COMPANY,
        senderEmail: "billing@acme.ae",
        status: "active",
        requireDkimPass: true,
      },
    ]),
    createEmailIntakeMessage: vi.fn(async (m: any) => {
      const row = { id: `msg-${db.messages.length + 1}`, ...m };
      db.messages.push(row);
      return row;
    }),
    getEmailIntakeHashesForCompany: vi.fn(async () => Array.from(db.hashes)),
    createEmailIntakeDocument: vi.fn(async (d: any) => {
      const row = { id: `doc-${db.docs.length + 1}`, ...d };
      db.docs.push(row);
      return row;
    }),
    updateEmailIntakeDocument: vi.fn(async (id: string, patch: any) => {
      Object.assign(db.docs.find((d) => d.id === id)!, patch);
    }),
    updateEmailIntakeMessageStatus: vi.fn(async () => undefined),
    getAccountsByCompanyId: vi.fn(async () => [
      {
        id: "acc-meals",
        code: "6200",
        nameEn: "Meals & Entertainment",
        type: "expense",
        isActive: true,
        isArchived: false,
      },
      {
        id: "acc-bank",
        code: "1010",
        nameEn: "Bank",
        type: "asset",
        isActive: true,
        isArchived: false,
      },
    ]),
    createReceipt: vi.fn(async (r: any) => {
      const row = { id: `r-${db.receipts.length + 1}`, ...r };
      db.receipts.push(row);
      return row;
    }),
    createTransactionClassification: vi.fn(async (c: any) => {
      const row = { id: `c-${db.classifications.length + 1}`, ...c };
      db.classifications.push(row);
      return row;
    }),
    hasCompanyAccess: vi.fn(async () => true),
    getCompany: vi.fn(async () => ({ id: COMPANY, baseCurrency: "AED" })),
    postReceiptAtomic: vi.fn(async (args: any) => {
      db.postedEntries.push(args);
      return { entry: { id: `je-${db.postedEntries.length}` } };
    }),
    updateReceipt: vi.fn(async () => undefined),
  },
}));
vi.mock("../../server/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../../server/services/period-lock.service", () => ({
  assertPeriodNotLocked: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/audit.service", () => ({
  recordAudit: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/training-data.service", () => ({
  getModel: vi.fn(async () => ({
    rules: db.autopilot.rules,
    trainingExamples: [],
    builtAt: Date.now(),
  })),
  getClassifierConfig: vi.fn(async () => ({
    mode: "hybrid",
    accuracyThreshold: 0.8,
    autopilotEnabled: db.autopilot.enabled,
    autopostThreshold: 0.9,
  })),
  invalidateModel: vi.fn(),
  applyAccuracyFailsafe: vi.fn(),
  setClassifierConfig: vi.fn(),
}));
vi.mock("../../server/middleware/rbac", () => ({
  requireFirmRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/services/firm-command-center.service", () => ({
  resolveAccessibleClientIds: vi.fn(async () => []),
}));

const anthropicCreate = vi.hoisted(() => vi.fn());
vi.mock("../../server/services/ocr-provider-clients", async () => {
  const actual = await vi.importActual<typeof import("../../server/services/ocr-provider-clients")>(
    "../../server/services/ocr-provider-clients"
  );
  return {
    ...actual,
    createOcrClients: () => ({
      anthropic: { messages: { create: anthropicCreate } },
      openai: null,
    }),
  };
});

import { registerEmailIntakeRoutes } from "../../server/routes/email-intake.routes";
import { getEmailIntakeStatus } from "../../server/services/email-intake-provider";
import { setUsageStore } from "../../server/services/ai/usage-meter";

const SECRET = "whsec_sample_secret_for_tests";
const sign = (body: string) =>
  crypto.createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("hex");

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

const samplePayload = JSON.stringify({
  messageId: "mail-1",
  from: "Acme Billing <billing@acme.ae>",
  subject: "Receipt for lunch",
  timestamp: "2026-11-10T09:00:00Z",
  dkim: { pass: true },
  attachments: [
    {
      filename: "receipt.png",
      contentType: "image/png",
      content: PNG.toString("base64"),
    },
  ],
});

async function postWebhook(body: string, signature?: string) {
  const app = express();
  app.use("/api/webhooks/email-intake", express.raw({ type: "*/*", limit: EMAIL_INTAKE_LIMIT }));
  app.use(express.json());
  registerEmailIntakeRoutes(app);
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/webhooks/email-intake`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-email-intake-signature": signature } : {}),
      },
      body,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  db.receipts.length = 0;
  db.docs.length = 0;
  db.messages.length = 0;
  db.classifications.length = 0;
  db.hashes.clear();
  db.postedEntries.length = 0;
  db.autopilot.enabled = false;
  db.autopilot.rules = [];
  anthropicCreate.mockReset();
  anthropicCreate.mockResolvedValue({
    content: [
      {
        type: "tool_use",
        name: "record_receipt",
        input: {
          merchant: "Cafe Beirut مقهى بيروت",
          date: "2026-11-10",
          invoiceNumber: "R-55",
          subtotal: 100,
          vatPercentage: 5,
          vatAmount: 5,
          total: 105,
          currency: "AED",
          category: "Meals",
          lineItems: [{ description: "Lunch", quantity: 1, unitPrice: 100, total: 100 }],
          supplierTrn: "100123456700003",
          isTaxInvoice: true,
          simplifiedInvoice: true,
          reverseChargeSuggested: false,
          confidence: 0.93,
        },
      },
    ],
    usage: { input_tokens: 700, output_tokens: 120 },
  });
  setUsageStore({
    insert: async () => undefined,
    monthToDate: async () => ({ tokens: 0, costUsd: 0 }),
    getLimits: async () => null,
  });
  vi.stubEnv("EMAIL_INTAKE_ENABLED", "true");
  vi.stubEnv("EMAIL_INTAKE_WEBHOOK_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setUsageStore(null);
});

describe("R05-19a email-forward capture", () => {
  it("R05-19a a signed sample webhook produces a draft (unposted) receipt queued for review", async () => {
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      messagesIngested: 1,
      documentsStored: 1,
      receiptsCreated: 1,
      queuedForReview: 1,
      autoPosted: 0,
    });
    expect(db.receipts).toHaveLength(1);
    expect(db.receipts[0]).toMatchObject({
      companyId: COMPANY,
      merchant: "Cafe Beirut مقهى بيروت",
      amount: 100,
      vatAmount: 5,
      supplierTrn: "100123456700003",
      posted: false,
      autoPosted: false,
    });
    expect(db.docs[0]).toMatchObject({ ocrStatus: "processed", receiptId: "r-1" });
  });

  it("R05-19a an unsigned or wrongly signed webhook is rejected and creates nothing", async () => {
    const unsigned = await postWebhook(samplePayload);
    expect(unsigned.status).toBe(401);
    const wrong = await postWebhook(samplePayload, sign("tampered"));
    expect(wrong.status).toBe(401);
    expect(db.receipts).toHaveLength(0);
  });

  it("R05-19a the same attachment forwarded twice is skipped as a duplicate", async () => {
    const first = await postWebhook(samplePayload, sign(samplePayload));
    for (const doc of db.docs) db.hashes.add(doc.sha256);
    const second = await postWebhook(samplePayload, sign(samplePayload));
    expect(first.body.receiptsCreated).toBe(1);
    expect(second.body.duplicatesSkipped).toBe(1);
    expect(db.receipts).toHaveLength(1);
  });

  it("R05-15 a low-confidence extraction is queued for review and flagged needsReview", async () => {
    anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_receipt",
          input: {
            merchant: "Blurry Shop",
            date: "2026-11-10",
            total: 105,
            subtotal: 100,
            vatAmount: 5,
            supplierTrn: "100123456700003",
            // no confidence on purpose
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body.autoPosted).toBe(0);
    expect(res.body.queuedForReview).toBe(1);
    expect(db.receipts[0].posted).toBe(false);
    // the extractor marks it for human review, which the autopilot gate honours
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    // Explicit VAT figures and a valid TRN: the ONLY reason left to hold it is the missing
    // confidence, so this fails if the missing-confidence rule regresses.
    const explicit = {
      merchant: "Blurry Shop",
      subtotal: 100,
      vatAmount: 5,
      total: 105,
      supplierTrn: "100123456700003",
    };
    const blurry = normalizeOcrJson(explicit);
    expect(blurry.reviewIssues).toEqual([]);
    expect(blurry.needsReview).toBe(true);
    const clear = { ...explicit, merchant: "Clear Shop" };
    expect(normalizeOcrJson({ ...clear, confidence: 0.95 }).needsReview).toBe(false);
    expect(normalizeOcrJson({ ...clear, confidence: 0.95 }, { issueCount: 1 }).needsReview).toBe(
      true
    );
  });

  it("R05-19a capture status is honest: disabled -> requires_configuration -> enabled", () => {
    expect(getEmailIntakeStatus({}).status).toBe("disabled");
    const needs = getEmailIntakeStatus({ EMAIL_INTAKE_ENABLED: "true" });
    expect(needs.status).toBe("requires_configuration");
    expect(needs.missing.join(" ")).toMatch(/WEBHOOK_SECRET|PROVIDER/);
    expect(
      getEmailIntakeStatus({ EMAIL_INTAKE_ENABLED: "true", EMAIL_INTAKE_WEBHOOK_SECRET: "s" })
        .status
    ).toBe("enabled");
  });

  it("R05-19a the webhook refuses requests while the feature is disabled (default)", async () => {
    vi.stubEnv("EMAIL_INTAKE_ENABLED", "false");
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.status).toBe(503);
    expect(db.receipts).toHaveLength(0);
  });
});

const VALID_TRN = "100123456700003";

describe("email intake: derived VAT never auto-posts", () => {
  /** A company that has Receipt Autopilot on and a trusted rule for the merchant. */
  function enableAutopilot() {
    db.autopilot.enabled = true;
    db.autopilot.rules = [
      {
        id: "rule-1",
        merchantPattern: "Cafe Beirut",
        descriptionPattern: null,
        accountId: "acc-meals",
        category: "Meals",
        confidence: 0.97,
        timesApplied: 12,
        timesAccepted: 10,
        timesRejected: 0,
      },
    ];
  }
  function extraction(fields: Record<string, unknown>) {
    anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_receipt",
          input: {
            merchant: "Cafe Beirut",
            date: "2026-11-10",
            currency: "AED",
            category: "Meals",
            confidence: 0.95,
            ...fields,
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  }

  it("a confident total-only receipt is queued for review, not auto-posted", async () => {
    enableAutopilot();
    extraction({ total: 105 });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
    expect(db.receipts[0]).toMatchObject({ posted: false, autoPosted: false });
  });

  it("a confident subtotal-only receipt is queued for review, not auto-posted", async () => {
    enableAutopilot();
    extraction({ subtotal: 100 });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
  });

  it("derived VAT carries the VAT_DERIVED note on the extraction", async () => {
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    const total = normalizeOcrJson({ merchant: "Shop", total: 105, confidence: 0.95 });
    expect(total).toMatchObject({ amount: 100, vatAmount: 5, total: 105, needsReview: true });
    expect(total.reviewIssues?.map((i) => i.code)).toEqual(["VAT_DERIVED"]);
    expect(total.reviewIssues?.[0].message).toMatch(/worked back from the total/);
    const sub = normalizeOcrJson({ merchant: "Shop", subtotal: 100, confidence: 0.95 });
    expect(sub).toMatchObject({ amount: 100, vatAmount: 5, total: 105, needsReview: true });
    expect(sub.reviewIssues?.[0].message).toMatch(/on the subtotal/);
  });

  it("a receipt with an explicit positive VAT line still auto-posts when otherwise confident", async () => {
    enableAutopilot();
    extraction({
      subtotal: 100,
      vatAmount: 5,
      total: 105,
      vatPercentage: 5,
      supplierTrn: VALID_TRN,
    });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 1, queuedForReview: 0 });
    expect(db.postedEntries).toHaveLength(1);
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    const r = normalizeOcrJson({
      subtotal: 100,
      vatAmount: 5,
      total: 105,
      supplierTrn: VALID_TRN,
      confidence: 0.95,
    });
    expect(r.reviewIssues).toEqual([]);
  });

  it("a mismatching receipt is queued for review, not auto-posted", async () => {
    enableAutopilot();
    // 100 + 5 VAT read, but the total says 130 (service charge / misread)
    extraction({ subtotal: 100, vatAmount: 5, total: 130, supplierTrn: VALID_TRN });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    // The mock-model run above is held by the upstream sanityCheckReceipt (AMOUNT_MISMATCH) even on
    // the base; the normalizeOcrJson assertions below are what pin the new reconcile layer.
    const r = normalizeOcrJson({
      subtotal: 100,
      vatAmount: 5,
      total: 130,
      supplierTrn: VALID_TRN,
      confidence: 0.95,
    });
    expect(r.needsReview).toBe(true);
    expect(r.reviewIssues?.map((i) => i.code)).toEqual(["AMOUNT_MISMATCH"]);
  });

  it("a model that FOLLOWS THE OLD PROMPT (100 / 5 / 105, no TRN) is queued, never auto-posted", async () => {
    enableAutopilot();
    // What a compliant model returned for an unregistered supplier's 105.00 receipt when the
    // prompt told it to compute subtotal = total / 1.05: it looks like an explicit VAT figure.
    extraction({ subtotal: 100, vatPercentage: 5, vatAmount: 5, total: 105, supplierTrn: null });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
    expect(db.receipts[0]).toMatchObject({ posted: false, autoPosted: false });
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    const r = normalizeOcrJson({
      subtotal: 100,
      vatPercentage: 5,
      vatAmount: 5,
      total: 105,
      confidence: 0.95,
    });
    expect(r.needsReview).toBe(true);
    expect(r.reviewIssues?.map((i) => i.code)).toEqual(["VAT_NO_TRN"]);
  });

  it("the same receipt with a valid supplier TRN auto-posts", async () => {
    enableAutopilot();
    extraction({
      subtotal: 100,
      vatPercentage: 5,
      vatAmount: 5,
      total: 105,
      supplierTrn: VALID_TRN,
    });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 1, queuedForReview: 0 });
    expect(db.postedEntries).toHaveLength(1);
  });

  it("an invalid TRN does not unlock auto-post", async () => {
    enableAutopilot();
    extraction({ subtotal: 100, vatPercentage: 5, vatAmount: 5, total: 105, supplierTrn: "12345" });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
  });

  it("a VAT-free receipt (explicit VAT 0.00) still auto-posts without a TRN", async () => {
    enableAutopilot();
    extraction({ subtotal: 105, vatAmount: 0, total: 105, supplierTrn: null });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 1, queuedForReview: 0 });
    expect(db.receipts[0]).toMatchObject({ amount: 105, vatAmount: 0 });
  });

  it("nullable schema: subtotal null, VAT null, total 105 reaches review as VAT_DERIVED", async () => {
    enableAutopilot();
    extraction({ subtotal: null, vatPercentage: null, vatAmount: null, total: 105 });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    const r = normalizeOcrJson({ subtotal: null, vatAmount: null, total: 105, confidence: 0.95 });
    expect(r.reviewIssues?.map((i) => i.code)).toEqual(["VAT_DERIVED"]);
  });

  it("explicit VAT 0 from the model means zero-rated; null means not printed", async () => {
    const { normalizeOcrJson } = await import("../../server/services/ocr-extraction.service");
    const zero = normalizeOcrJson({ merchant: "S", subtotal: null, vatAmount: 0, total: 105 });
    expect(zero).toMatchObject({ amount: 105, vatAmount: 0, total: 105 });
    expect(zero.reviewIssues).toEqual([]);
    const missing = normalizeOcrJson({
      merchant: "S",
      subtotal: null,
      vatAmount: null,
      total: 105,
    });
    expect(missing).toMatchObject({ amount: 100, vatAmount: 5 });
  });

  it("the prompt tells the model never to derive missing figures", async () => {
    const { RECEIPT_EXTRACTION_PROMPT } =
      await import("../../server/services/ai/receipt-extraction");
    expect(RECEIPT_EXTRACTION_PROMPT).not.toMatch(/total \/ 1\.05/);
    expect(RECEIPT_EXTRACTION_PROMPT).toMatch(/NEVER calculate/);
  });

  it("a subtotal + total pair exactly 5% apart is held upstream by the 1% sanity check", async () => {
    // sanityCheckReceipt treats a null VAT as "not printed" (no retry asking the model to fill it
    // in), so the hold comes from normalizeOcrJson: net + gross with no VAT line is VAT_DERIVED.
    enableAutopilot();
    extraction({ subtotal: 100, vatAmount: null, total: 105, supplierTrn: VALID_TRN });
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
  });

  it("a retry that turns an unprinted VAT into 5 is treated as derived, not posted", async () => {
    enableAutopilot();
    const tool = (input: Record<string, unknown>) => ({
      content: [{ type: "tool_use", name: "record_receipt", input }],
    });
    const base = {
      merchant: "Cafe Beirut",
      currency: "AED",
      category: "Meals",
      confidence: 0.95,
      subtotal: 100,
      total: 105,
      supplierTrn: VALID_TRN,
    };
    // First answer: VAT not printed, but a future date forces a correction retry.
    // Retry answer: date fixed AND vatAmount filled in as 5.
    anthropicCreate.mockReset();
    anthropicCreate
      .mockResolvedValueOnce(tool({ ...base, date: "2099-01-01", vatAmount: null }))
      .mockResolvedValue(tool({ ...base, date: "2026-11-10", vatAmount: 5, vatPercentage: 5 }));
    const res = await postWebhook(samplePayload, sign(samplePayload));
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({ autoPosted: 0, queuedForReview: 1 });
    expect(db.postedEntries).toHaveLength(0);
  });
});
