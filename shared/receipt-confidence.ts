// Confidence banding for extracted receipts (R05-15, R05-23). Pure and shared so the
// server (OCR route) and the Receipts page apply the same routing rules.
//
// A model's self-reported confidence is never trusted on its own: a missing value counts
// as zero, a classifier disagreement or any failed validation check caps the band, and the
// final band decides whether a receipt can be accepted quickly or must go to review.

export type ConfidenceBand = "high" | "review" | "low";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface BandInput {
  /** Extraction confidence as reported by the model/parser. Missing means low. */
  extractionConfidence?: number | null;
  /** Internal classifier confidence for the chosen category (optional). */
  classifierConfidence?: number | null;
  /** Whether the AI category and the internal classifier agree (optional). */
  classifierAgrees?: boolean | null;
  issues?: ValidationIssue[];
}

export interface BandResult {
  band: ConfidenceBand;
  score: number;
  reasons: string[];
  reasonCodes: string[];
}

export const HIGH_BAND_MIN = 0.85;
export const REVIEW_BAND_MIN = 0.6;

function clamp01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function deriveConfidenceBand(input: BandInput): BandResult {
  const reasons: string[] = [];
  const reasonCodes: string[] = [];
  const extraction = clamp01(input.extractionConfidence);
  if (extraction === null) {
    reasons.push("Model reported no confidence");
    reasonCodes.push("MISSING_CONFIDENCE");
  }
  let score = extraction ?? 0;

  const classifier = clamp01(input.classifierConfidence);
  if (classifier !== null) score = Math.min(score, classifier);

  if (input.classifierAgrees === false) {
    score = Math.min(score, 0.7);
    reasons.push("AI and internal classifier disagree on the category");
    reasonCodes.push("CLASSIFIER_DISAGREEMENT");
  }

  const issues = input.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (errors.length) {
    score = Math.min(score, 0.5);
  }
  if (warnings.length) {
    score = Math.min(score, HIGH_BAND_MIN - 0.01);
  }
  for (const issue of [...errors, ...warnings]) {
    reasons.push(issue.message);
    reasonCodes.push(issue.code);
  }

  const band: ConfidenceBand =
    score >= HIGH_BAND_MIN ? "high" : score >= REVIEW_BAND_MIN ? "review" : "low";
  return { band, score: Math.round(score * 100) / 100, reasons, reasonCodes };
}

// ---- UI helpers (en + ar) -----------------------------------------------------

export const BAND_LABELS: Record<ConfidenceBand, { en: string; ar: string }> = {
  high: { en: "High confidence", ar: "ثقة عالية" },
  review: { en: "Review recommended", ar: "يُوصى بالمراجعة" },
  low: { en: "Low confidence - review required", ar: "ثقة منخفضة - المراجعة مطلوبة" },
};

/** Low-confidence extractions must be explicitly reviewed before they can be saved. */
export function bandRequiresReview(band: ConfidenceBand | undefined | null): boolean {
  return band === "low";
}

export interface ReviewSnapshot {
  merchant?: string | null;
  date?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  subtotal?: number | null;
  currency?: string | null;
  vatAmount?: number | null;
  category?: string | null;
}

/** "accepted" when the reviewer saved the AI values unchanged, "corrected" otherwise. */
export function receiptReviewDecision(
  original: ReviewSnapshot | undefined | null,
  final: ReviewSnapshot
): "accepted" | "corrected" {
  if (!original) return "corrected";
  const cents = (v: number | null | undefined) => Math.round((Number(v) || 0) * 100);
  const subtotal = (v: ReviewSnapshot) =>
    v.subtotal == null ? cents(v.total) - cents(v.vatAmount) : cents(v.subtotal);
  const same =
    (original.merchant ?? "").trim() === (final.merchant ?? "").trim() &&
    (original.date ?? "") === (final.date ?? "") &&
    (original.invoiceNumber ?? "").trim() === (final.invoiceNumber ?? "").trim() &&
    cents(original.total) === cents(final.total) &&
    subtotal(original) === subtotal(final) &&
    (original.currency ?? "AED") === (final.currency ?? "AED") &&
    cents(original.vatAmount) === cents(final.vatAmount) &&
    (original.category ?? "") === (final.category ?? "");
  return same ? "accepted" : "corrected";
}
