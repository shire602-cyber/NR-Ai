import { describe, expect, it, vi } from "vitest";
import {
  loadEvalCases,
  scoreCases,
  type EvalCase,
  type Predicted,
  type ScoredField,
} from "./harness";
import {
  DETERMINISTIC_GATES,
  LIVE_GATES,
  MAX_ARABIC_GAP,
  RECORDED_GATES,
  type Gates,
} from "./gates";
import { extractReceipt } from "../../server/services/ai/receipt-extraction";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";
import { setUsageStore } from "../../server/services/ai/usage-meter";
import { createOcrClients } from "../../server/services/ocr-provider-clients";

const FIELDS: ScoredField[] = [
  "merchant",
  "date",
  "subtotal",
  "vatAmount",
  "total",
  "currency",
  "supplierTrn",
  "isTaxInvoice",
  "category",
];

const cases = loadEvalCases();
const TODAY = "2026-11-15";

function expectGates(
  perField: Record<string, { accuracy: number }>,
  gates: Gates,
  failures: Array<{ id: string; field: string }>
) {
  for (const [field, min] of Object.entries(gates)) {
    expect(
      perField[field].accuracy,
      `${field} accuracy below gate ${min}; failing cases: ${failures
        .filter((f) => f.field === field)
        .map((f) => f.id)
        .join(", ")}`
    ).toBeGreaterThanOrEqual(min as number);
  }
}

describe("eval fixtures", () => {
  it("has 50 cases covering English and Arabic with unique ids", () => {
    expect(cases).toHaveLength(50);
    expect(cases.filter((c) => c.lang === "en")).toHaveLength(30);
    expect(cases.filter((c) => c.lang === "ar")).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(50);
    // Eastern Arabic-Indic digits appear in a meaningful share of the Arabic cases.
    expect(cases.filter((c) => /[٠-٩]/.test(c.ocrText)).length).toBeGreaterThanOrEqual(8);
  });
});

describe("recorded model replies through the extraction pipeline (CI)", () => {
  setUsageStore({
    insert: async () => undefined,
    monthToDate: async () => ({ tokens: 0, costUsd: 0 }),
    getLimits: async () => null,
  });

  async function replay(c: EvalCase): Promise<Predicted> {
    const create = vi.fn(async () => ({
      content: [{ type: "tool_use", name: "record_receipt", input: c.recorded }],
      usage: { input_tokens: 500, output_tokens: 100 },
    }));
    const outcome = await extractReceipt({
      clients: { anthropic: { messages: { create } } as any, openai: null },
      input: { kind: "text", text: c.ocrText },
      ctx: { companyId: null, task: "ocr" },
      today: TODAY,
    });
    return outcome.data as Predicted;
  }

  it("meets the recorded accuracy gates and Arabic is not materially worse than English", async () => {
    const predictions = new Map<string, Predicted>();
    for (const c of cases) predictions.set(c.id, await replay(c));
    const all = scoreCases(cases, (c) => predictions.get(c.id)!, FIELDS);
    expectGates(all.perField, RECORDED_GATES, all.failures);

    const en = scoreCases(
      cases.filter((c) => c.lang === "en"),
      (c) => predictions.get(c.id)!,
      ["total", "date"]
    );
    const ar = scoreCases(
      cases.filter((c) => c.lang === "ar"),
      (c) => predictions.get(c.id)!,
      ["total", "date"]
    );
    expect(en.perField.total.accuracy - ar.perField.total.accuracy).toBeLessThanOrEqual(
      MAX_ARABIC_GAP
    );
  });

  it("the gates are real: a corrupted model reply is caught by the scorer", async () => {
    const bad = cases.map((c) => ({ ...c, recorded: { ...c.recorded, total: 1 } }));
    const predictions = new Map<string, Predicted>();
    for (const c of bad) {
      try {
        predictions.set(c.id, await replay(c));
      } catch {
        predictions.set(c.id, {});
      }
    }
    const scored = scoreCases(cases, (c) => predictions.get(c.id)!, ["total"]);
    expect(scored.perField.total.accuracy).toBeLessThan(RECORDED_GATES.total!);
  });
});

describe("deterministic parser baseline (no model; the offline fallback) (CI)", () => {
  it("meets the deterministic gates on English and Arabic receipts", () => {
    const scored = scoreCases(
      cases,
      (c) => {
        const p = parseReceiptOcrText(c.ocrText, { fallbackDate: "2000-01-01" });
        return {
          merchant: p.merchant,
          date: p.date,
          subtotal: p.subtotal,
          vatAmount: p.vatAmount,
          total: p.total,
          currency: p.currency,
          supplierTrn: p.supplierTrn,
          isTaxInvoice: p.isTaxInvoice,
        };
      },
      FIELDS.filter((f) => f !== "category")
    );
    expectGates(scored.perField, DETERMINISTIC_GATES, scored.failures);
  });
});

// Live evaluation: only with RUN_LLM_EVAL=1 and real provider keys (never runs in CI).
const live = process.env.RUN_LLM_EVAL === "1";
describe.skipIf(!live)("live model evaluation (RUN_LLM_EVAL=1)", () => {
  it(
    "meets the live accuracy gates",
    async () => {
      const clients = createOcrClients();
      if (!clients.anthropic && !clients.openai) {
        throw new Error("RUN_LLM_EVAL=1 needs ANTHROPIC_API_KEY or OPENAI_API_KEY");
      }
      const predictions = new Map<string, Predicted>();
      for (const c of cases) {
        const outcome = await extractReceipt({
          clients,
          input: { kind: "text", text: c.ocrText },
          ctx: { companyId: null, task: "ocr" },
          today: TODAY,
        });
        predictions.set(c.id, outcome.data as Predicted);
      }
      const scored = scoreCases(cases, (c) => predictions.get(c.id)!, FIELDS);
      console.log(JSON.stringify(scored.perField, null, 2));
      expectGates(scored.perField, LIVE_GATES, scored.failures);
    },
    15 * 60 * 1000
  );
});
