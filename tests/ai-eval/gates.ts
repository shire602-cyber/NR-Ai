// Accuracy gates for the receipt-extraction eval (50 cases: 30 English, 20 Arabic/bilingual).
//
// These are minimum per-field accuracies, enforced by tests/ai-eval/receipt-eval.test.ts.
//
//  recorded       replayed model replies; CI-safe. Proves the pipeline preserves correct model
//                 output and the gates below are meaningful (two cases are deliberately wrong).
//  deterministic  shared/receipt-ocr-parser on the OCR text alone (no model). This is the
//                 fallback when no AI key is configured or the provider fails, so its gates are
//                 the floor of what a customer gets.
//  live           RUN_LLM_EVAL=1 with real keys. Same fixtures; run before changing prompts,
//                 models (AI_MODEL_OCR) or the schema, and attach the output to the change.
//
// Ratchet: raise these when accuracy improves; never lower them without a written reason.

import type { ScoredField } from "./harness";

export type Gates = Partial<Record<ScoredField, number>>;

export const RECORDED_GATES: Gates = {
  merchant: 0.97,
  date: 0.98,
  subtotal: 0.98,
  vatAmount: 0.98,
  total: 0.98,
  currency: 0.98,
  supplierTrn: 0.98,
  isTaxInvoice: 0.98,
  category: 0.95,
};

export const DETERMINISTIC_GATES: Gates = {
  merchant: 0.9,
  date: 0.9,
  subtotal: 0.9,
  vatAmount: 0.9,
  total: 0.95,
  currency: 0.95,
  supplierTrn: 0.9,
  isTaxInvoice: 0.9,
};

export const LIVE_GATES: Gates = {
  merchant: 0.9,
  date: 0.95,
  subtotal: 0.95,
  vatAmount: 0.95,
  total: 0.97,
  currency: 0.97,
  supplierTrn: 0.9,
  isTaxInvoice: 0.9,
  category: 0.8,
};

/** Arabic cases must not be materially worse than English on the money fields. */
export const MAX_ARABIC_GAP = 0.1;
