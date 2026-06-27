# Codex Task — manual receipts now train the AI classifier (+ Blob SSRF hardening)

> **What this ships:** Today the manual Receipt Scanner pre-fills a category from
> the per-tenant AI classifier but records **no feedback**, so the model never
> learns from manual uploads. This change records, on every save, the classifier's
> suggested category vs. the user's final category — feeding the Bayes training
> stage (`transaction_classifications.was_accepted`) and invalidating the cached
> model. Net effect: categories get smarter the more the firm uses it. No ledger
> writes, no auto-posting (that's a later increment). Plus a 1-line SSRF hardening
> on the Vercel-Blob read path.
>
> Apply on top of current `main`. Verified locally: `npm run check` clean,
> `npm test` green (874 unit tests incl. 6 new), `tsc` exits 0.

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
```

## New file 2 — `tests/unit/classification-feedback.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { evaluateClassificationFeedback } from "../../server/services/classification-feedback.util";

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
```

## Edit 1 — `server/routes/receipts.routes.ts`

**1a.** After the existing `import { recordAudit } ...` line, add two imports:

```ts
import { recordClassificationFeedback } from "../services/receipt-autopilot.service";
import { evaluateClassificationFeedback } from "../services/classification-feedback.util";
```

**1b.** In the `POST /api/companies/:companyId/receipts` handler, replace:

```ts
      const { imageData, ...receiptData } = req.body;
```

with:

```ts
      // `suggested*` / `classifier*` carry the AI classifier's suggestion so we
      // can record training feedback below. They are NOT receipt columns, so we
      // pull them out before spreading `receiptData` into createReceipt.
      const {
        imageData,
        suggestedCategory,
        classifierMethod,
        classifierConfidence,
        classifierReason,
        ...receiptData
      } = req.body;
```

**1c.** In the same handler, immediately BEFORE the `createAndEmitNotification({` call
(after `recordAudit(...)`), insert:

```ts
      // ── Learning loop ──────────────────────────────────────────────────
      // The manual Receipt Scanner pre-fills a category from the per-tenant AI
      // classifier. Record that suggestion against the user's FINAL category so
      // the model learns from every manual upload (the Bayes stage trains on
      // accepted classifications). Never let this block or fail the save.
      if (suggestedCategory && typeof suggestedCategory === "string") {
        try {
          const gross =
            (Number(receipt.amount) || 0) + (Number((receipt as any).vatAmount) || 0);
          const { wasAccepted, method } = evaluateClassificationFeedback(
            suggestedCategory,
            receipt.category,
            classifierMethod
          );
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

```

## Edit 2 — `client/src/pages/Receipts.tsx`

**2a.** In the `ExtractedData` interface, after `confidence?: number;`, add:

```ts
  // The category the AI classifier originally suggested (snapshotted at OCR
  // time so it survives user edits to `category`) plus how it was derived.
  // Sent back on save to train the per-tenant classifier.
  suggestedCategory?: string;
  classifier?: { method?: string; confidence?: number; reason?: string } | null;
```

**2b.** In the backend-OCR result mapping (the `parsed = { ... }` built from the
`/api/ocr/process` response), after `confidence: result.confidence ?? 0.85,`, add:

```ts
            // Snapshot the AI's suggested category + how it was derived, so we
            // can tell on save whether the user kept or corrected it.
            suggestedCategory: result.category || "Other",
            classifier: result.classifier || null,
```

**2c.** In the save payload (`const receiptData = { ... }` posted to
`/api/companies/${companyId}/receipts`), after `lineItems: receipt.data!.lineItems || [],`, add:

```ts
          // Training feedback: the AI's original suggestion vs. the (possibly
          // edited) category above. Lets the server learn from this upload.
          suggestedCategory: receipt.data!.suggestedCategory ?? null,
          classifierMethod: receipt.data!.classifier?.method ?? null,
          classifierConfidence: receipt.data!.classifier?.confidence ?? null,
          classifierReason: receipt.data!.classifier?.reason ?? null,
```

## Edit 3 — `server/services/fileStorage.ts` (Blob SSRF hardening freebie)

In `readReceiptImage`, replace:

```ts
      const res = await fetch(imagePath);
      if (!res.ok) return null;
```

with:

```ts
      // `redirect: "error"` hardens against SSRF: the URL is allow-listed to the
      // Blob domain, but a 3xx from that host could otherwise bounce us to an
      // internal address. Refuse to follow redirects so the allow-list holds.
      const res = await fetch(imagePath, { redirect: "error" });
      if (!res.ok) return null;
```

## Gates (must pass before deploy)

```bash
npm run check   # tsc + bundle hygiene + route registration (72) + api contract (8)
npm test        # vitest — 874 unit tests incl. the 6 new feedback tests
npm run build   # vite + esbuild bundle
```

## Deploy + verify

1. Commit + push to `main`; redeploy `NR-Ai`.
2. In the app: **Purchases → Expenses (Receipt Scanner)** → upload a receipt →
   Process → change the suggested category to something else → **Save All**.
3. Confirm the save succeeds (no errors). Behind the scenes a
   `transaction_classifications` row is written with `was_accepted = false`
   (because you changed the category). Saving one you DON'T change writes
   `was_accepted = true`. Optional DB check:
   `SELECT suggested_category, was_accepted, classifier_method FROM transaction_classifications ORDER BY created_at DESC LIMIT 5;`

## Done when

Saves still succeed, and `transaction_classifications` rows accumulate with the
correct `was_accepted` flag per upload. No behaviour change to posting or the
ledger. (Auto-posting high-confidence receipts is the next increment.)
