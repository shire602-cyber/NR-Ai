# Codex Task — Receipt automation: learning loop + guarded auto-post (+ Blob SSRF fix)

> **Supersedes `CODEX_DEPLOY_AUTOPILOT_LEARNING.md`** — deploy this single doc; it
> contains that change plus the auto-post increment. Apply on top of current
> `main`.
>
> **What ships (3 things):**
> 1. **Learning loop** — every manual receipt save now records the AI's suggested
>    category vs. the user's final category, training the per-tenant classifier
>    (the Bayes stage trains on `transaction_classifications.was_accepted`).
> 2. **Guarded auto-post** — for companies that have **explicitly enabled
>    autopilot** (`classifier_config.autopilotEnabled`, default **false**), a
>    high-confidence receipt backed by a trusted merchant rule — where the user
>    kept the AI's category — is posted to the ledger automatically (no manual
>    "Post"). Its input VAT then flows into the VAT 201 (which already aggregates
>    `posted = true` receipts). Safe by default: changes nothing until a firm opts in.
> 3. **Blob SSRF hardening** — `redirect: "error"` on the Vercel-Blob read fetch.
>
> Verified locally: `npm run check` clean (72 modules, 8 contracts), `npm test`
> green (881 unit tests incl. 13 new), `tsc` exits 0. No DB migration.

---

## New file 1 — `server/services/classification-feedback.util.ts`

```ts
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
 * category. An unrecognised/absent method falls back to "openai" — the safe
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
  /** Classifier confidence on the (re-)classification, 0–1. */
  confidence: number;
  /** Per-company auto-post confidence threshold (e.g. 0.9). */
  autopostThreshold: number;
  /** timesAccepted of the matched merchant rule, or null when none matched. */
  ruleTimesAccepted: number | null;
  hasExpenseAccount: boolean;
  hasPaymentAccount: boolean;
  /** Net (pre-VAT) amount; must be positive to post a meaningful entry. */
  netAmount: number;
  /** Receipt currency; only AED auto-posts (no FX path yet). */
  currency: string;
}

/**
 * Pure gate deciding whether a manually-uploaded, human-reviewed receipt is
 * eligible for auto-posting to the ledger. Mirrors the email-intake autopilot's
 * Stage-5 conditions, plus an extra human-in-the-loop guard: we never auto-post
 * when the user overrode the AI's category. Returns a machine-readable reason
 * for telemetry. Order is intentional (cheapest / most-common rejections first).
 */
export function evaluateAutoPostGate(i: AutoPostGateInput): { ok: boolean; reason: string } {
  if (!i.autopilotEnabled) return { ok: false, reason: "autopilot_disabled" };
  if (!i.userKeptSuggestion) return { ok: false, reason: "user_overrode_category" };
  if (!(i.netAmount > 0)) return { ok: false, reason: "non_positive_amount" };
  if ((i.currency || "AED").toUpperCase() !== "AED") return { ok: false, reason: "non_aed" };
  if (!(i.confidence >= i.autopostThreshold)) return { ok: false, reason: "low_confidence" };
  if (i.ruleTimesAccepted === null || i.ruleTimesAccepted < 5)
    return { ok: false, reason: "rule_not_trusted" };
  if (!i.hasExpenseAccount) return { ok: false, reason: "no_expense_account" };
  if (!i.hasPaymentAccount) return { ok: false, reason: "no_payment_account" };
  return { ok: true, reason: "eligible" };
}
```

## New file 2 — `tests/unit/classification-feedback.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  evaluateClassificationFeedback,
  evaluateAutoPostGate,
  type AutoPostGateInput,
} from "../../server/services/classification-feedback.util";

const eligible: AutoPostGateInput = {
  autopilotEnabled: true,
  userKeptSuggestion: true,
  confidence: 0.95,
  autopostThreshold: 0.9,
  ruleTimesAccepted: 7,
  hasExpenseAccount: true,
  hasPaymentAccount: true,
  netAmount: 100,
  currency: "AED",
};

describe("evaluateClassificationFeedback", () => {
  it("marks accepted when the user keeps the suggested category", () => {
    const r = evaluateClassificationFeedback("Meals", "Meals", "keyword");
    expect(r.wasAccepted).toBe(true);
    expect(r.method).toBe("keyword");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(evaluateClassificationFeedback("Travel", "  travel ", "rule").wasAccepted).toBe(true);
  });

  it("marks rejected when the user changes the category", () => {
    const r = evaluateClassificationFeedback("Meals", "Office Supplies", "statistical");
    expect(r.wasAccepted).toBe(false);
    expect(r.method).toBe("statistical");
  });

  it("treats a null/undefined final category as not accepted", () => {
    expect(evaluateClassificationFeedback("Meals", null, "openai").wasAccepted).toBe(false);
    expect(evaluateClassificationFeedback("Meals", undefined, "openai").wasAccepted).toBe(false);
  });

  it("falls back to 'openai' for an unknown or missing method", () => {
    expect(evaluateClassificationFeedback("Meals", "Meals", "bogus").method).toBe("openai");
    expect(evaluateClassificationFeedback("Meals", "Meals", undefined).method).toBe("openai");
    expect(evaluateClassificationFeedback("Meals", "Meals", null).method).toBe("openai");
  });

  it("preserves each valid classifier method", () => {
    for (const m of ["rule", "keyword", "statistical", "openai"] as const) {
      expect(evaluateClassificationFeedback("X", "X", m).method).toBe(m);
    }
  });
});

describe("evaluateAutoPostGate", () => {
  it("passes when every condition is met", () => {
    const r = evaluateAutoPostGate(eligible);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("eligible");
  });

  it("is OFF by default — autopilot disabled blocks posting", () => {
    const r = evaluateAutoPostGate({ ...eligible, autopilotEnabled: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("autopilot_disabled");
  });

  it("never posts when the user overrode the AI category", () => {
    const r = evaluateAutoPostGate({ ...eligible, userKeptSuggestion: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("user_overrode_category");
  });

  it("requires confidence at/above the threshold", () => {
    expect(evaluateAutoPostGate({ ...eligible, confidence: 0.89 }).reason).toBe("low_confidence");
    expect(evaluateAutoPostGate({ ...eligible, confidence: 0.9 }).ok).toBe(true);
  });

  it("requires a trusted rule (accepted >= 5 times)", () => {
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: 4 }).reason).toBe(
      "rule_not_trusted"
    );
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: null }).reason).toBe(
      "rule_not_trusted"
    );
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: 5 }).ok).toBe(true);
  });

  it("only posts AED and positive amounts", () => {
    expect(evaluateAutoPostGate({ ...eligible, currency: "USD" }).reason).toBe("non_aed");
    expect(evaluateAutoPostGate({ ...eligible, netAmount: 0 }).reason).toBe("non_positive_amount");
    expect(evaluateAutoPostGate({ ...eligible, netAmount: -5 }).reason).toBe("non_positive_amount");
  });

  it("requires both an expense and a payment account", () => {
    expect(evaluateAutoPostGate({ ...eligible, hasExpenseAccount: false }).reason).toBe(
      "no_expense_account"
    );
    expect(evaluateAutoPostGate({ ...eligible, hasPaymentAccount: false }).reason).toBe(
      "no_payment_account"
    );
  });
});
```

## New code — append to `server/services/receipt-autopilot.service.ts`

**A.** Add the import near the other shared-schema imports:

```ts
import { evaluateAutoPostGate } from "./classification-feedback.util";
```

**B.** Insert this block immediately AFTER the `recordClassificationFeedback`
function and BEFORE the `// Internals` divider. It reuses the module's existing
private helpers (`autoPostJournalEntry`, `pickExpenseAccountForCategory`,
`pickPaymentAccount`, `classifyReceipt`, `getModel`, `getClassifierConfig`,
`getOpenAI`):

```ts
// =============================================
// Manual-upload auto-post
// =============================================

export interface ManualReceiptForAutoPost {
  id: string;
  merchant: string | null;
  /** Net (pre-VAT) amount as stored on the receipt. */
  amount: number | string | null;
  vatAmount: number | string | null;
  currency: string | null;
  date: Date | string;
}

export interface ManualAutoPostResult {
  autoPosted: boolean;
  journalEntryId: string | null;
  /** Machine-readable reason (eligible/posted or why it was skipped). */
  reason: string;
}

/**
 * Auto-post an already-saved, human-reviewed manual receipt — the manual-upload
 * counterpart to the email-intake autopilot. The receipt row already exists
 * (created with the user's reviewed data); this only DECIDES and, if eligible,
 * posts a balanced journal entry and links it back. Safe by default: returns
 * early unless the company has explicitly enabled autopilot.
 *
 * `userKeptSuggestion` MUST be true for posting — if the user changed the AI's
 * category we never post automatically, since that's a signal of disagreement.
 */
export async function autoPostManualReceipt(args: {
  companyId: string;
  uploadedBy: string;
  receipt: ManualReceiptForAutoPost;
  userKeptSuggestion: boolean;
}): Promise<ManualAutoPostResult> {
  const { companyId, uploadedBy, receipt, userKeptSuggestion } = args;
  const skip = (reason: string): ManualAutoPostResult => ({
    autoPosted: false,
    journalEntryId: null,
    reason,
  });

  const config = await getClassifierConfig(companyId);
  const net = Number(receipt.amount) || 0;
  const vat = Number(receipt.vatAmount) || 0;
  const currency = (receipt.currency || "AED").toUpperCase();

  // Cheap guards first — avoid the classify round-trip when obviously ineligible
  // (this is the common case: most companies have autopilot off).
  if (!config.autopilotEnabled) return skip("autopilot_disabled");
  if (!userKeptSuggestion) return skip("user_overrode_category");
  if (!(net > 0)) return skip("non_positive_amount");
  if (currency !== "AED") return skip("non_aed");

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const expenseAccounts = accounts.filter(
    (a) => a.type === "expense" && a.isActive && !a.isArchived
  );

  // Re-classify server-side so the auto-post decision is authoritative (not
  // dependent on client-supplied confidence).
  const model = await getModel(companyId);
  const classification = await classifyReceipt({
    merchant: typeof receipt.merchant === "string" ? receipt.merchant : "",
    amount: net,
    lineItems: [],
    model,
    options: { threshold: config.accuracyThreshold, mode: config.mode },
    openai: getOpenAI(),
    expenseAccountNames: expenseAccounts.map((a) => a.nameEn),
  });

  const autopostThreshold =
    typeof config.autopostThreshold === "number"
      ? config.autopostThreshold
      : DEFAULT_CLASSIFIER_CONFIG.autopostThreshold;
  const matchedRule = classification.matchedRuleId
    ? model.rules.find((r) => r.id === classification.matchedRuleId)
    : null;

  const ruleAccountStillActive =
    classification.accountId && expenseAccounts.some((a) => a.id === classification.accountId);
  const expenseAccountId = ruleAccountStillActive
    ? classification.accountId
    : pickExpenseAccountForCategory(expenseAccounts, classification.category);
  const paymentAccountId = pickPaymentAccount(accounts);

  const gate = evaluateAutoPostGate({
    autopilotEnabled: config.autopilotEnabled,
    userKeptSuggestion,
    confidence: classification.confidence,
    autopostThreshold,
    ruleTimesAccepted: matchedRule ? matchedRule.timesAccepted : null,
    hasExpenseAccount: !!expenseAccountId,
    hasPaymentAccount: !!paymentAccountId,
    netAmount: net,
    currency,
  });
  if (!gate.ok) return skip(gate.reason);

  const ocr: OcrReceipt = {
    merchant: typeof receipt.merchant === "string" ? receipt.merchant : "",
    amount: net,
    vatAmount: vat,
    total: net + vat,
    currency: "AED",
    date:
      typeof receipt.date === "string"
        ? receipt.date
        : new Date(receipt.date).toISOString().split("T")[0],
    category: classification.category,
  };

  let journalEntryId: string;
  try {
    journalEntryId = await autoPostJournalEntry({
      companyId,
      uploadedBy,
      ocr,
      expenseAccountId: expenseAccountId!,
      paymentAccountId: paymentAccountId!,
      accounts,
      classification,
    });
  } catch (err: any) {
    log.error(
      { err: err?.message || err, receiptId: receipt.id },
      "Manual auto-post failed before JE creation — leaving receipt for manual review"
    );
    return skip("post_failed");
  }

  await recordAudit({
    userId: uploadedBy,
    companyId,
    action: "ai_autopost_receipt",
    entityType: "journal_entry",
    entityId: journalEntryId,
    extra: {
      receiptId: receipt.id,
      confidence: classification.confidence,
      autopostThreshold,
      method: classification.method,
      reason: classification.reason,
      merchant: ocr.merchant,
      amount: net + vat,
      source: "manual_upload",
    },
  });

  try {
    await storage.updateReceipt(receipt.id, companyId, {
      posted: true,
      autoPosted: true,
      journalEntryId,
      accountId: expenseAccountId,
      paymentAccountId,
    });
  } catch (err: any) {
    log.error(
      { err: err?.message || err, receiptId: receipt.id, journalEntryId },
      "Manual auto-post: JE created but receipt link update failed — manual repair needed"
    );
  }

  if (classification.matchedRuleId) {
    try {
      await pool.query(
        `UPDATE ai_company_rules SET times_applied = times_applied + 1, updated_at = now() WHERE id = $1 AND company_id = $2`,
        [classification.matchedRuleId, companyId]
      );
    } catch (err: any) {
      log.warn(
        { err: err?.message || err, ruleId: classification.matchedRuleId },
        "Manual auto-post: rule times_applied bump failed — non-fatal"
      );
    }
  }

  return { autoPosted: true, journalEntryId, reason: "posted" };
}
```

## Edit — `server/routes/receipts.routes.ts`

**1.** Add imports after `import { recordAudit } ...`:

```ts
import {
  recordClassificationFeedback,
  autoPostManualReceipt,
} from "../services/receipt-autopilot.service";
import { evaluateClassificationFeedback } from "../services/classification-feedback.util";
```

**2.** In `POST /api/companies/:companyId/receipts`, replace
`const { imageData, ...receiptData } = req.body;` with:

```ts
      const {
        imageData,
        suggestedCategory,
        classifierMethod,
        classifierConfidence,
        classifierReason,
        ...receiptData
      } = req.body;
```

**3.** Immediately BEFORE the `createAndEmitNotification({` call (after the
`recordAudit(...)` for `receipt.create`), insert both blocks:

```ts
      // ── Learning loop ──────────────────────────────────────────────────
      // The manual Receipt Scanner pre-fills a category from the per-tenant AI
      // classifier. Record that suggestion against the user's FINAL category so
      // the model learns from every manual upload (the Bayes stage trains on
      // accepted classifications). Never let this block or fail the save.
      // Tracks whether the user kept the AI's suggested category — gates auto-post.
      let userKeptSuggestion = false;
      if (suggestedCategory && typeof suggestedCategory === "string") {
        try {
          const gross =
            (Number(receipt.amount) || 0) + (Number((receipt as any).vatAmount) || 0);
          const { wasAccepted, method } = evaluateClassificationFeedback(
            suggestedCategory,
            receipt.category,
            classifierMethod
          );
          userKeptSuggestion = wasAccepted;
          const classificationRow = await storage.createTransactionClassification({
            companyId,
            description: receipt.merchant ?? "",
            merchant: receipt.merchant ?? "",
            amount: gross,
            suggestedAccountId: (receipt as any).accountId ?? null,
            suggestedCategory,
            aiConfidence: Number(classifierConfidence) || 0,
            aiReason:
              typeof classifierReason === "string" && classifierReason
                ? classifierReason
                : "Manual receipt upload",
            classifierMethod: method,
          });
          // Mark accepted/rejected + invalidate the cached model + run the
          // accuracy failsafe — the same path the dedicated feedback endpoint uses.
          await recordClassificationFeedback(
            companyId,
            classificationRow.id,
            wasAccepted,
            (receipt as any).accountId ?? null
          );
        } catch (err) {
          log.warn(
            { err: (err as Error).message, receiptId: receipt.id },
            "Classification feedback recording failed (non-fatal)"
          );
        }
      }

      // ── Guarded auto-post ──────────────────────────────────────────────
      // For companies that have explicitly enabled autopilot, a high-confidence
      // receipt backed by a trusted merchant rule (and where the user kept the
      // AI's category) is posted to the ledger automatically — no manual "Post"
      // click. Gated off by default; never blocks or fails the save.
      try {
        const auto = await autoPostManualReceipt({
          companyId,
          uploadedBy: userId,
          receipt: {
            id: receipt.id,
            merchant: receipt.merchant,
            amount: (receipt as any).amount,
            vatAmount: (receipt as any).vatAmount,
            currency: receipt.currency,
            date: (receipt as any).date,
          },
          userKeptSuggestion,
        });
        if (auto.autoPosted) {
          (receipt as any).posted = true;
          (receipt as any).autoPosted = true;
          (receipt as any).journalEntryId = auto.journalEntryId;
          log.info(
            { receiptId: receipt.id, journalEntryId: auto.journalEntryId },
            "Receipt auto-posted on manual upload"
          );
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message, receiptId: receipt.id },
          "Manual auto-post attempt failed (non-fatal — receipt saved)"
        );
      }
```

## Edit — `client/src/pages/Receipts.tsx` (3 small additions)

- In `interface ExtractedData`, after `confidence?: number;` add
  `suggestedCategory?: string;` and
  `classifier?: { method?: string; confidence?: number; reason?: string } | null;`.
- In the `/api/ocr/process` result mapping (`parsed = { ... }`), after
  `confidence: result.confidence ?? 0.85,` add
  `suggestedCategory: result.category || "Other",` and
  `classifier: result.classifier || null,`.
- In the save payload (`receiptData`), after `lineItems: receipt.data!.lineItems || [],`
  add `suggestedCategory`, `classifierMethod`, `classifierConfidence`,
  `classifierReason` read from `receipt.data!.suggestedCategory` /
  `receipt.data!.classifier?.{method,confidence,reason}` (`?? null`).

## Edit — `server/services/fileStorage.ts` (Blob SSRF freebie)

In `readReceiptImage`, change `const res = await fetch(imagePath);` to
`const res = await fetch(imagePath, { redirect: "error" });`.

## Gates + deploy

```bash
npm run check   # tsc + bundle hygiene + route reg (72) + api contract (8)
npm test        # vitest — 881 unit tests incl. 13 new
npm run build
```

Commit, push to `main`, redeploy `NR-Ai`, report the SHA.

## Verify (live)

1. **Learning (everyone):** upload a receipt → change the suggested category →
   Save. A `transaction_classifications` row is written with `was_accepted=false`
   (true if you DON'T change it).
2. **Auto-post (opt-in):** for a test company, set
   `classifier_config.autopilotEnabled=true`; after a merchant's rule has been
   accepted ≥5×, uploading a high-confidence AED receipt for that merchant (and
   keeping the category) should come back already **posted** with a linked
   journal entry, and appear in the VAT 201 input VAT. Companies left at the
   default (autopilot off) see no behaviour change.

## Done when

Gates pass; manual saves record classification feedback; and for an
autopilot-enabled company a qualifying receipt auto-posts a balanced JE that
shows up in the VAT return. Default-off companies are unaffected.
