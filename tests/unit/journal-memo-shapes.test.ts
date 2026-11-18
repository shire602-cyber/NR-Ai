/**
 * Step 1 / F9: every system-written journal memo shape reads Arabic (client/src/lib/journal-memo.ts).
 * The samples are the exact English texts the server writes (see the file and line next to each);
 * the only Latin left may be a document number, a SKU, a party or a provider name.
 */
import { describe, expect, it } from "vitest";
import arJournal from "../../client/src/locales/ar/journal.json";
import enJournal from "../../client/src/locales/en/journal.json";
import { localizeJournalMemo } from "../../client/src/lib/journal-memo";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

const ar = arJournal as Record<string, string>;
const en = enJournal as Record<string, string>;

const SAMPLES: Array<[string, string, string?]> = [
  // server/storage/sales.ts: payment method codes, including the bank-reconciliation one
  ["Payment received for Invoice INV-2026-00001 - bank_reconciliation", "تسوية بنكية"],
  ["Payment received for Invoice INV-2026-00002 - bank_transfer", "تحويل بنكي"],
  ["Payment received for Invoice INV-2026-00003 - credit_card", "بطاقة"],
  // server/services/inventory/manual.ts
  ["Inventory purchase - AUTO-KIT-1", "شراء مخزون"],
  ["Inventory sale - AUTO-KIT-1", "بيع مخزون"],
  ["Inventory adjustment - AUTO-KIT-1", "تسوية مخزون"],
  ["Inventory opening - AUTO-KIT-1", "مخزون افتتاحي"],
  ["Inventory write-down - AUTO-KIT-1: تالف", "تخفيض قيمة المخزون", "تالف"],
  ["Inventory write-down reversal - AUTO-KIT-1: خطأ جرد", "عكس تخفيض قيمة المخزون", "خطأ جرد"],
  // server/services/inventory/documents.ts
  ["Inventory reversal adjustment - BILL-7", "تسوية عكس المخزون"],
  // server/services/fixed-assets/index.ts
  ["Capitalization: أجهزة المكتب", "رسملة الأصل"],
  // server/routes/expense-claims.routes.ts
  ["Expense claim EXP-0002 approved", "اعتماد مطالبة النفقات"],
  ["Expense claim EXP-0002 reimbursed", "سداد مطالبة النفقات"],
  // server/services/invoice-posting.service.ts: matches before the generic credit note shape
  ["Credit Note CN-2026-00001 - reversal of Invoice INV-2026-00004", "عكس الفاتورة"],
  ["Credit note CN-2026-00002 - أطلس", "إشعار دائن"],
  // server/services/payments/index.ts: the link id (a UUID) is dropped
  [
    "Payment gateway fee (stripe) for link 6d1f3c3e-86c2-4a6e-9a1c-0f0f0f0f0f0f",
    "رسوم بوابة الدفع",
  ],
];

describe("journal memos in Arabic", () => {
  for (const [memo, expected, kept] of SAMPLES) {
    it(`localises: ${memo}`, () => {
      const out = localizeJournalMemo(ar, memo, "ar");
      expect(out).toContain(expected);
      expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      // Latin words may remain only inside document numbers / SKUs / provider names.
      const withoutRefs = out
        .replace(/\b[A-Z]{2,6}-[\w-]*\d[\w-]*\b/g, " ")
        .replace(/\bstripe\b/gi, " ");
      expect(isEnglishLine(withoutRefs)).toBe(false);
      if (kept) expect(out).toContain(kept);
      // English mode never rewrites the server text.
      expect(localizeJournalMemo(en, memo, "en")).toBe(memo);
    });
  }

  it("keeps a memo typed by a person unchanged", () => {
    expect(localizeJournalMemo(ar, "Rent for the office", "ar")).toBe("Rent for the office");
  });

  it("every memo key exists in both catalogs", () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith("journal.memo."))) {
      expect(ar[key], key).toBeTruthy();
    }
  });
});
