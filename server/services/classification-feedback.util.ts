import type { ClassifierMethod } from "../../shared/schema";

export const VALID_CLASSIFIER_METHODS: ClassifierMethod[] = [
  "rule",
  "keyword",
  "statistical",
  "openai",
];

/**
 * Pure helper for the manual-upload learning loop: decide whether the user
 * accepted the AI's suggested category and normalise the classifier method.
 *
 * `wasAccepted` is a case-insensitive, trimmed match of suggested vs. final
 * category. An unrecognised/absent method falls back to "openai" - the safe
 * default that records the row without falsely claiming a deterministic rule
 * produced it.
 */
export function evaluateClassificationFeedback(
  suggestedCategory: string,
  finalCategory: string | null | undefined,
  rawMethod: unknown
): { wasAccepted: boolean; method: ClassifierMethod } {
  const wasAccepted =
    typeof finalCategory === "string" &&
    finalCategory.trim().toLowerCase() === suggestedCategory.trim().toLowerCase();
  const method: ClassifierMethod = VALID_CLASSIFIER_METHODS.includes(rawMethod as ClassifierMethod)
    ? (rawMethod as ClassifierMethod)
    : "openai";
  return { wasAccepted, method };
}

export interface AutoPostGateInput {
  /** Per-company autopilot flag (defaults off). */
  autopilotEnabled: boolean;
  /** The human kept the AI's suggested category (didn't override it). */
  userKeptSuggestion: boolean;
  /** Classifier confidence on the re-classification, 0-1. */
  confidence: number;
  /** Per-company auto-post confidence threshold, e.g. 0.9. */
  autopostThreshold: number;
  /** timesAccepted of the matched merchant rule, or null when none matched. */
  ruleTimesAccepted: number | null;
  hasExpenseAccount: boolean;
  hasPaymentAccount: boolean;
  /** Net pre-VAT amount; must be positive to post a meaningful entry. */
  netAmount: number;
  /** Receipt currency; only AED auto-posts because there is no FX path yet. */
  currency: string;
}

/**
 * Pure gate deciding whether a manually-uploaded, human-reviewed receipt is
 * eligible for auto-posting to the ledger. Mirrors the email-intake autopilot's
 * Stage-5 conditions, plus an extra human-in-the-loop guard: never auto-post
 * when the user overrode the AI's category. The order is intentional.
 */
export function evaluateAutoPostGate(i: AutoPostGateInput): { ok: boolean; reason: string } {
  if (!i.autopilotEnabled) return { ok: false, reason: "autopilot_disabled" };
  if (!i.userKeptSuggestion) return { ok: false, reason: "user_overrode_category" };
  if (!(i.netAmount > 0)) return { ok: false, reason: "non_positive_amount" };
  if ((i.currency || "AED").toUpperCase() !== "AED") return { ok: false, reason: "non_aed" };
  if (!(i.confidence >= i.autopostThreshold)) return { ok: false, reason: "low_confidence" };
  if (i.ruleTimesAccepted === null || i.ruleTimesAccepted < 5) {
    return { ok: false, reason: "rule_not_trusted" };
  }
  if (!i.hasExpenseAccount) return { ok: false, reason: "no_expense_account" };
  if (!i.hasPaymentAccount) return { ok: false, reason: "no_payment_account" };
  return { ok: true, reason: "eligible" };
}
