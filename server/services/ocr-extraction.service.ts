// Reusable receipt/invoice OCR extraction for the email-intake pipeline.
//
// The interactive OCR endpoint (ocr.routes) extracts inline and returns JSON to
// the client. Email intake has no client in the loop, so it needs a callable
// extractor: image/PDF bytes → a normalised OcrReceipt that runAutopilot can
// persist. The amount-reconciliation rules mirror ocr.routes' buildResult so a
// document produces the same figures whichever path it came in through.
//
// normalizeOcrJson is pure (no model, no I/O) and unit-tested. The vision call
// is env-keyed and returns null when no AI provider is configured, so the whole
// thing is a safe no-op until keys + the mailbox are set.

import { createLogger } from "../config/logger";
import type { OcrReceipt } from "./receipt-autopilot.service";
import { createOcrClients, summarizeOcrProviderError } from "./ocr-provider-clients";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { deriveConfidenceBand } from "../../shared/receipt-confidence";
import { extractReceipt, RECEIPT_EXTRACTION_PROMPT } from "./ai/receipt-extraction";
import { normalizeModelConfidence } from "./ai/structured-output";

const log = createLogger("ocr-extraction");

export const VALID_OCR_CATEGORIES = [
  "Office Supplies",
  "Utilities",
  "Travel",
  "Meals",
  "Rent",
  "Marketing",
  "Equipment",
  "Professional Services",
  "Insurance",
  "Maintenance",
  "Communication",
  "Other",
] as const;

export { RECEIPT_EXTRACTION_PROMPT };

function parseNonNegative(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return !isNaN(n) && n >= 0 ? n : 0;
}

/**
 * Normalise a model's raw JSON into the OcrReceipt shape runAutopilot consumes,
 * applying the same amount-reconciliation rules as the interactive OCR route.
 * `today` is injectable for deterministic tests.
 */
export function normalizeOcrJson(
  raw: any,
  opts: {
    rawText?: string | null;
    imageData?: string | null;
    today?: string;
    /** Number of validation issues found upstream (any issue forces human review). */
    issueCount?: number;
  } = {}
): OcrReceipt {
  const sIn = parseNonNegative(raw?.subtotal);
  const vIn = parseNonNegative(raw?.vatAmount);
  const vatPercentage =
    raw?.vatPercentage === null || raw?.vatPercentage === undefined
      ? 5
      : parseNonNegative(raw.vatPercentage);
  const tIn = parseNonNegative(raw?.total);
  const round2 = (x: number) => parseFloat(x.toFixed(2));

  // Reconcile to a self-consistent triple where subtotal + vat == total. The
  // interactive route can leave total==subtotal for a subtotal-only receipt;
  // intake AUTO-POSTS, so the figures must balance or runAutopilot would build
  // an unbalanced entry. Net (subtotal) is runAutopilot's contract.
  let derivedSubtotal: number;
  let derivedVat: number;
  let derivedTotal: number;
  if (tIn > 0 && sIn > 0) {
    derivedSubtotal = sIn;
    derivedTotal = tIn;
    derivedVat = vIn > 0 ? vIn : round2(tIn - sIn);
  } else if (tIn > 0) {
    derivedTotal = tIn;
    derivedSubtotal = round2(tIn / (1 + vatPercentage / 100));
    derivedVat = vIn > 0 ? vIn : round2(derivedTotal - derivedSubtotal);
  } else if (sIn > 0) {
    derivedSubtotal = sIn;
    derivedVat = vIn > 0 ? vIn : round2((sIn * vatPercentage) / 100);
    derivedTotal = round2(sIn + derivedVat);
  } else {
    derivedSubtotal = 0;
    derivedVat = 0;
    derivedTotal = 0;
  }

  const category = (VALID_OCR_CATEGORIES as readonly string[]).includes(raw?.category)
    ? raw.category
    : "Other";

  const fallbackDate = opts.today ?? new Date().toISOString().split("T")[0];
  const date =
    typeof raw?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallbackDate;

  const lineItems = Array.isArray(raw?.lineItems)
    ? raw.lineItems.map((li: any) => ({ description: String(li?.description || "").slice(0, 500) }))
    : [];

  const trn = validateUaeTrn(typeof raw?.supplierTrn === "string" ? raw.supplierTrn : null);
  // A missing model confidence is LOW (R05-15); the band decides whether intake may auto-post.
  const extractionConfidence = normalizeModelConfidence(raw?.confidence);
  const band = deriveConfidenceBand({ extractionConfidence });

  return {
    merchant: raw?.merchant ? String(raw.merchant).slice(0, 200) : "Unknown Merchant",
    supplierTrn: trn.trn,
    extractionConfidence,
    needsReview: band.band !== "high" || (opts.issueCount ?? 0) > 0,
    amount: derivedSubtotal, // net (subtotal) — runAutopilot's contract
    vatAmount: derivedVat,
    total: derivedTotal,
    currency: raw?.currency ? String(raw.currency).slice(0, 10) : "AED",
    date,
    category,
    lineItems,
    rawText: opts.rawText ?? null,
    imageData: opts.imageData ?? null,
  };
}

/** Whether any AI provider is configured (extraction is possible). */
export function isOcrExtractionConfigured(): boolean {
  const { anthropic, openai } = createOcrClients();
  return Boolean(anthropic || openai);
}

/**
 * Extract an OcrReceipt from a document's bytes. Returns null when no AI provider
 * is configured or every provider fails (caller then leaves the doc pending).
 * PDFs need Anthropic's document block; images use Anthropic (preferred) then OpenAI.
 * Extraction is metered against the company's monthly AI cap; a quota error propagates
 * so the caller can leave the document pending rather than silently dropping it.
 */
export async function extractReceiptToOcr(args: {
  content: Buffer;
  mimeType: string;
  rawText?: string | null;
  companyId?: string | null;
}): Promise<OcrReceipt | null> {
  const clients = createOcrClients();
  if (!clients.anthropic && !clients.openai) return null;

  const base64 = args.content.toString("base64");
  try {
    const outcome = await extractReceipt({
      clients,
      input: { kind: "image", base64, mediaType: args.mimeType },
      ctx: { companyId: args.companyId ?? null, task: "ocr" },
    });
    return normalizeOcrJson(outcome.data, {
      rawText: args.rawText,
      imageData: base64,
      issueCount: outcome.issues.length,
    });
  } catch (err) {
    if ((err as any)?.code === "AI_QUOTA_EXCEEDED") throw err;
    log.warn(
      { err: summarizeOcrProviderError(err), mimeType: args.mimeType },
      "OCR extraction failed"
    );
    return null; // PDF with only an OpenAI key, or all configured providers failed.
  }
}
