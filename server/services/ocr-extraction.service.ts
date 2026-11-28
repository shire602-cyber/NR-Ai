// Reusable receipt/invoice OCR extraction for the email-intake pipeline.
//
// The interactive OCR endpoint (ocr.routes) extracts inline and returns JSON to
// the client. Email intake has no client in the loop, so it needs a callable
// extractor: image/PDF bytes → a normalised OcrReceipt that runAutopilot can
// persist. The amount-reconciliation rules are the shared ones ocr.routes uses so a
// document produces the same figures whichever path it came in through.
//
// normalizeOcrJson is pure (no model, no I/O) and unit-tested. The vision call
// is env-keyed and returns null when no AI provider is configured, so the whole
// thing is a safe no-op until keys + the mailbox are set.

import { createLogger } from "../config/logger";
import type { OcrReceipt } from "./receipt-autopilot.service";
import { createOcrClients, summarizeOcrProviderError } from "./ocr-provider-clients";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { deriveConfidenceBand, type ValidationIssue } from "../../shared/receipt-confidence";
import {
  aiVatRate,
  amountMismatchMessage,
  hasVatFigure,
  printedRateWithZeroVat,
  vatRateAmountConflictMessage,
  reconcileReceiptAmounts,
  vatDerivedMessage,
  vatDerivedSource,
  vatWithoutTrnMessage,
} from "../../shared/receipt-amounts";
import { extractReceipt, RECEIPT_EXTRACTION_PROMPT } from "./ai/receipt-extraction";
import { normalizeModelConfidence, type ReceiptExtraction } from "./ai/structured-output";
import { errorCode } from "../errors";
import { todayDubai } from "@shared/accounting-date";

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

/** Untrusted model JSON; every field is coerced in normalizeOcrJson. */
interface LooseOcrJson {
  merchant?: unknown;
  subtotal?: unknown;
  vatAmount?: unknown;
  vatPercentage?: unknown;
  total?: unknown;
  currency?: unknown;
  category?: unknown;
  date?: unknown;
  lineItems?: unknown;
  supplierTrn?: unknown;
  confidence?: unknown;
}

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
  input: unknown,
  opts: {
    rawText?: string | null;
    imageData?: string | null;
    today?: string;
    /** Number of validation issues found upstream (any issue forces human review). */
    issueCount?: number;
  } = {}
): OcrReceipt {
  const raw = input as LooseOcrJson | null | undefined;
  const sIn = parseNonNegative(raw?.subtotal);
  const vIn = parseNonNegative(raw?.vatAmount);
  // A missing rate defaults to 5% (UAE); an explicit 0 rate or an explicit VAT amount of 0 means zero-rated.
  const { vatPercentage, rateDefaulted: vatRateDefaulted } = aiVatRate(
    raw?.vatAmount,
    raw?.vatPercentage
  );
  const tIn = parseNonNegative(raw?.total);
  // An explicit VAT 0 next to a printed positive rate with a gap: VAT stays 0 as read (same
  // reading as the interactive route and the parser) and the contradiction is held for review.
  const printedRate = printedRateWithZeroVat(raw?.vatAmount, raw?.vatPercentage);
  const rateConflict = printedRate !== null && sIn > 0 && tIn > sIn;

  // Same reconciliation as the interactive OCR route (shared/receipt-amounts.ts, integer fils,
  // half-up) so every path agrees to the fil and subtotal + VAT === total. Intake can AUTO-POST,
  // so the figures must balance or runAutopilot would build an unbalanced entry. Net (subtotal)
  // is runAutopilot's contract.
  const amountsIn = {
    subtotal: sIn,
    vatAmount: vIn,
    total: tIn,
    vatPercentage: rateConflict ? 0 : vatPercentage,
  };
  const {
    subtotal: derivedSubtotal,
    vatAmount: derivedVat,
    total: derivedTotal,
    mismatch: amountsMismatch,
  } = reconcileReceiptAmounts(amountsIn);
  const vatDerivedFrom = vatDerivedSource(amountsIn);

  // Review reasons the person in the queue needs to see (same codes/wording as ocr.routes).
  const reviewIssues: ValidationIssue[] = [];
  if (amountsMismatch) {
    reviewIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message:
        rateConflict && printedRate !== null
          ? vatRateAmountConflictMessage(derivedSubtotal, derivedVat, derivedTotal, printedRate)
          : amountMismatchMessage(
              derivedSubtotal,
              derivedVat,
              derivedTotal,
              vatPercentage,
              hasVatFigure(vIn)
            ),
    });
  }
  // Net and gross printed with no VAT figure at all: the reconciler reads the gap as VAT, but that
  // is an assumption, not a printed figure (same review rule as a total-only receipt).
  const vatNotPrinted =
    raw?.vatAmount === null || raw?.vatAmount === undefined || raw?.vatAmount === "";
  const vatGapAssumed = !vatDerivedFrom && vatNotPrinted && derivedVat > 0 && sIn > 0 && tIn > 0;
  if (vatDerivedFrom || vatGapAssumed) {
    // The VAT is an assumption, not a read figure: a receipt with no VAT amount is not a tax
    // invoice, so it must never auto-post an input-VAT claim.
    reviewIssues.push({
      code: "VAT_DERIVED",
      severity: "warning",
      message: vatDerivedMessage(
        derivedVat,
        vatPercentage,
        vatDerivedFrom ?? "total",
        vatRateDefaulted
      ),
    });
  }
  const trn = validateUaeTrn(typeof raw?.supplierTrn === "string" ? raw.supplierTrn : null);
  if (derivedVat > 0 && !trn.trn && !vatDerivedFrom && !vatGapAssumed) {
    // A VAT figure with no valid supplier TRN cannot be trusted as a read tax-invoice figure.
    reviewIssues.push({
      code: "VAT_NO_TRN",
      severity: "warning",
      message: vatWithoutTrnMessage(derivedVat),
    });
  }

  const category =
    typeof raw?.category === "string" &&
    (VALID_OCR_CATEGORIES as readonly string[]).includes(raw.category)
      ? raw.category
      : "Other";

  const fallbackDate = opts.today ?? todayDubai();
  const date =
    typeof raw?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallbackDate;

  const lineItems = Array.isArray(raw?.lineItems)
    ? (raw.lineItems as Array<{ description?: unknown } | null>).map((li) => ({
        description: String(li?.description || "").slice(0, 500),
      }))
    : [];

  // A missing model confidence is LOW (R05-15); the band decides whether intake may auto-post.
  const extractionConfidence = normalizeModelConfidence(raw?.confidence);
  const band = deriveConfidenceBand({ extractionConfidence });

  return {
    merchant: raw?.merchant ? String(raw.merchant).slice(0, 200) : "Unknown Merchant",
    supplierTrn: trn.trn,
    extractionConfidence,
    needsReview: band.band !== "high" || (opts.issueCount ?? 0) > 0 || reviewIssues.length > 0,
    reviewIssues,
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
    if (errorCode(err) === "AI_QUOTA_EXCEEDED") throw err;
    log.warn(
      { err: summarizeOcrProviderError(err), mimeType: args.mimeType },
      "OCR extraction failed"
    );
    return null; // PDF with only an OpenAI key, or all configured providers failed.
  }
}

// ── WQ2 (8.2): supplier bills captured in the bill editor ──────────────────────────────────

/**
 * Bill-specific rules appended to the receipt prompt. A supplier invoice names two parties; the
 * bill belongs to the BUYER (our company), so the seller's identity must never be confused with
 * the buyer's: the self-TRN guard (4.7) relies on supplierTrn being the seller's TRN.
 */
export const BILL_EXTRACTION_ADDENDUM = `This document is a SUPPLIER INVOICE (a bill) received by the buyer.
- merchant: the SELLER (the party issuing the invoice, usually in the letterhead), never the "Bill to" / "Customer" / "العميل" party.
- supplierTrn: the SELLER's TRN only. If only the buyer's TRN is printed, return null.
- invoiceNumber: the seller's invoice number (Invoice No. / رقم الفاتورة), not a PO or delivery-note number.
- lineItems: one entry per billed line, quantity and unitPrice as printed, total = the line amount BEFORE VAT when the invoice shows net line amounts.`;

export interface BillDocumentExtraction {
  status: "ok" | "not_configured" | "failed";
  data: ReceiptExtraction | null;
  /** Validation issue codes the extraction could not fix (AMOUNT_MISMATCH, DATE_FUTURE, ...). */
  issues: string[];
}

/**
 * Read a supplier invoice (PDF or image bytes) for the bill editor. Never writes anything: the
 * caller maps the result to a draft the user reviews and saves. "not_configured" when no AI
 * provider is set; a quota error propagates (402/429 in the route).
 */
export async function extractBillDocument(args: {
  content: Buffer;
  mimeType: string;
  companyId: string;
  userId?: string | null;
  signal: AbortSignal;
}): Promise<BillDocumentExtraction> {
  const clients = createOcrClients();
  if (!clients.anthropic && !clients.openai) {
    return { status: "not_configured", data: null, issues: [] };
  }
  try {
    const outcome = await extractReceipt({
      clients,
      input: {
        kind: "image",
        base64: args.content.toString("base64"),
        mediaType: args.mimeType,
        promptAddendum: BILL_EXTRACTION_ADDENDUM,
      },
      ctx: { companyId: args.companyId, userId: args.userId ?? null, task: "ocr" },
      signal: args.signal,
    });
    return { status: "ok", data: outcome.data, issues: outcome.issues.map((i) => i.code) };
  } catch (err) {
    args.signal.throwIfAborted();
    if (errorCode(err) === "AI_QUOTA_EXCEEDED") throw err;
    log.warn(
      { err: summarizeOcrProviderError(err), mimeType: args.mimeType },
      "Bill extraction failed"
    );
    return { status: "failed", data: null, issues: [] };
  }
}
