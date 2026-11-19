/**
 * Step 1 / S2: system journal descriptions are stored as a key + params (migration 0131) and
 * rendered from the catalog. This is the old scripts/memocheck: it fails when
 *   - a template of shared/journal-memo.ts has no Arabic (or a placeholder the template lacks);
 *   - a server posting still writes a raw English `memo:` text instead of `journalMemo(...)`;
 *   - an English memo of a template (the audit text of old rows) does not read Arabic.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import arJournal from "../../client/src/locales/ar/journal.json";
import enJournal from "../../client/src/locales/en/journal.json";
import { localizeJournalMemo } from "../../client/src/lib/journal-memo";
import {
  JOURNAL_LINE_TEMPLATES,
  JOURNAL_MEMO_TEMPLATES,
  journalMemo,
} from "../../shared/journal-memo";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

const ar = arJournal as Record<string, string>;
const en = enJournal as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

const ALL: Array<[string, string]> = [
  ...Object.entries(JOURNAL_MEMO_TEMPLATES).map(
    ([k, v]) => [`journal.memo.${k}`, v] as [string, string]
  ),
  ...Object.entries(JOURNAL_LINE_TEMPLATES).map(
    ([k, v]) => [`journal.memo.line.${k}`, v] as [string, string]
  ),
];

describe("journal memo registry", () => {
  it("every template has an English and a real Arabic catalog entry with known placeholders", () => {
    for (const [catalogKey, template] of ALL) {
      expect(en[catalogKey], `${catalogKey} (en)`).toBeTruthy();
      expect(ar[catalogKey], `${catalogKey} (ar)`).toBeTruthy();
      expect(hasArabic(ar[catalogKey]), `${catalogKey} is Arabic`).toBe(true);
      const known = new Set(placeholders(template));
      for (const p of placeholders(ar[catalogKey])) {
        expect(known.has(p), `${catalogKey}: {${p}} is not a parameter of "${template}"`).toBe(
          true
        );
      }
      // Arabic keeps every parameter the audit text carries, except ones it drops on purpose.
      const dropped = placeholders(template).filter((p) => !ar[catalogKey].includes(`{${p}}`));
      expect(
        dropped.every((p) => ["link"].includes(p)),
        `${catalogKey} drops {${dropped.join("}, {")}}`
      ).toBe(true);
    }
  });

  it("renders from the stored key with no English left but the parameters", () => {
    for (const [k, template] of Object.entries(JOURNAL_MEMO_TEMPLATES)) {
      const params: Record<string, string> = {};
      for (const p of placeholders(template)) params[p] = p === "method" ? "bank" : "INV-1";
      const fields = journalMemo(k as keyof typeof JOURNAL_MEMO_TEMPLATES, params);
      expect(localizeJournalMemo(en, fields.memo, "en", fields)).toBe(fields.memo);
      const out = localizeJournalMemo(ar, fields.memo, "ar", fields);
      expect(out, k).not.toBe(fields.memo);
      expect(hasArabic(out), k).toBe(true);
      expect(isEnglishLine(out, ["INV-1"]), `${k}: ${out}`).toBe(false);
    }
  });

  it("old rows without a key still read Arabic (the English audit text matches the registry)", () => {
    for (const [k, template] of Object.entries(JOURNAL_MEMO_TEMPLATES)) {
      const params: Record<string, string> = {};
      for (const p of placeholders(template)) params[p] = p === "method" ? "bank" : "INV-1";
      const { memo } = journalMemo(k as keyof typeof JOURNAL_MEMO_TEMPLATES, params);
      const out = localizeJournalMemo(ar, memo, "ar");
      expect(hasArabic(out), `${k}: ${memo}`).toBe(true);
      expect(isEnglishLine(out, ["INV-1"]), `${k}: ${out}`).toBe(false);
    }
  });

  it("a person's own memo is shown unchanged, key or not", () => {
    expect(localizeJournalMemo(ar, "Office rent", "ar", { memo: "Office rent" })).toBe(
      "Office rent"
    );
    // A stale key never overrides text the user typed afterwards.
    expect(
      localizeJournalMemo(ar, "Typed by hand", "ar", {
        memo: "Customer deposit DEP-1 - X",
        memoKey: "customerDeposit",
        memoParams: { ref: "DEP-1", party: "X" },
      })
    ).toBe("Typed by hand");
  });

  it("renders the new deposit shapes", () => {
    const f = journalMemo("customerDeposit", { ref: "DEP-2026-00001", party: "أطلس" });
    expect(f.memo).toBe("Customer deposit DEP-2026-00001 - أطلس");
    expect(localizeJournalMemo(ar, f.memo, "ar", f)).toBe("عربون عميل DEP-2026-00001 - أطلس");
    const a = journalMemo("depositApplied", { ref: "DEP-1", invoice: "INV-1" });
    expect(localizeJournalMemo(ar, a.memo, "ar", a)).toBe("تطبيق العربون DEP-1 على الفاتورة INV-1");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.statSync(f).isDirectory()) walk(f, out);
    else if (f.endsWith(".ts")) out.push(f);
  }
  return out;
}

describe("server postings use the registry", () => {
  // Source inspection: the rule "no raw English memo text in a posting" cannot be a behaviour
  // test, because it spans every posting path (including ones no fixture reaches).
  it("no server file writes an English `memo:` literal or template", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, "../../server"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bmemo:\s*([`"'])([A-Z][^`"']{3,})/g)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${m[1]}${m[2].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
