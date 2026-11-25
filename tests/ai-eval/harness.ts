// Receipt-extraction eval harness (R05-27 / R05 test-suite gap).
//
// Fixture format (tests/ai-eval/fixtures/receipts.json, 50 cases, English + Arabic):
//   { id, lang: "en" | "ar", ocrText, expected: {...}, recorded: {...} }
//   - ocrText:  the text a receipt scan/OCR step produced (the model input in eval)
//   - expected: ground truth for the scored fields
//   - recorded: a recorded model reply, replayed in CI so the pipeline (tool-use parsing,
//               zod validation, sanity checks, banding) is exercised without network access
//
// Modes (see receipt-eval.test.ts):
//   recorded (default, CI)   replay `recorded` through extractReceipt with a stub client
//   deterministic (CI)       shared/receipt-ocr-parser on `ocrText` (no model at all)
//   live (RUN_LLM_EVAL=1)    real provider keys, same fixtures, same gates (see gates.ts)

import { readFileSync } from "fs";
import path from "path";
import { normalizeMerchantKey } from "../../shared/arabic-text";

export interface EvalExpected {
  merchant: string;
  date: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  supplierTrn: string | null;
  isTaxInvoice: boolean;
  category: string;
}

export interface EvalCase {
  id: string;
  lang: "en" | "ar";
  ocrText: string;
  expected: EvalExpected;
  recorded: Record<string, unknown>;
}

export function loadEvalCases(): EvalCase[] {
  const file = path.join(__dirname, "fixtures", "receipts.json");
  return JSON.parse(readFileSync(file, "utf8")) as EvalCase[];
}

export type ScoredField = keyof EvalExpected;

export const MONEY_FIELDS: ScoredField[] = ["subtotal", "vatAmount", "total"];

export interface Predicted {
  merchant?: string | null;
  date?: string | null;
  subtotal?: number | null;
  vatAmount?: number | null;
  total?: number | null;
  currency?: string | null;
  supplierTrn?: string | null;
  isTaxInvoice?: boolean | null;
  category?: string | null;
}

function fieldCorrect(field: ScoredField, expected: EvalExpected, got: Predicted): boolean {
  switch (field) {
    case "merchant":
      return normalizeMerchantKey(got.merchant) === normalizeMerchantKey(expected.merchant);
    case "subtotal":
    case "vatAmount":
    case "total":
      return Math.abs((Number(got[field]) || 0) - expected[field]) <= 0.011;
    case "supplierTrn":
      return (got.supplierTrn ?? null) === expected.supplierTrn;
    case "isTaxInvoice":
      return Boolean(got.isTaxInvoice) === expected.isTaxInvoice;
    default:
      return (got[field] ?? null) === expected[field];
  }
}

export interface FieldAccuracy {
  correct: number;
  total: number;
  accuracy: number;
}

export function scoreCases(
  cases: EvalCase[],
  predict: (c: EvalCase) => Predicted,
  fields: ScoredField[]
): { perField: Record<string, FieldAccuracy>; failures: Array<{ id: string; field: string }> } {
  const perField: Record<string, FieldAccuracy> = {};
  const failures: Array<{ id: string; field: string }> = [];
  for (const f of fields) perField[f] = { correct: 0, total: 0, accuracy: 0 };
  for (const c of cases) {
    const got = predict(c);
    for (const f of fields) {
      perField[f].total++;
      if (fieldCorrect(f, c.expected, got)) perField[f].correct++;
      else failures.push({ id: c.id, field: f });
    }
  }
  for (const f of fields) perField[f].accuracy = perField[f].correct / perField[f].total;
  return { perField, failures };
}
