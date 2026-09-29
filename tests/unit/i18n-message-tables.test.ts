import { describe, it, expect } from "vitest";
import { GLOSSARY, glossaryLookup, matchesGlossary } from "../../client/src/lib/i18n-glossary";

// Every per-page table (`Foo.i18n.ts` next to `Foo.tsx`) is validated here:
// same keys in both languages, same {placeholders}, real Arabic, plural forms
// complete, and terminology taken from the glossary.
const modules = import.meta.glob("../../client/src/**/*.i18n.ts", { eager: true }) as Record<
  string,
  { messages: { id: string; tables: { en: Record<string, string>; ar: Record<string, string> } } }
>;

// {count} may be dropped from Arabic zero/one/two forms ("فاتورة واحدة", "فاتورتان")
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((n) => n !== "count").sort().join(",");
const ARABIC = /[؀-ۿ]/;
const PLURAL = ["zero", "one", "two", "few", "many", "other"];

describe("glossary", () => {
  it("has no duplicate English term with conflicting Arabic", () => {
    const seen = new Map<string, string>();
    for (const entry of GLOSSARY) {
      const key = entry.en.trim().replace(/[:：…]+$|\.{3}$/g, "").toLowerCase();
      const previous = seen.get(key);
      if (previous !== undefined) expect(previous, `duplicate glossary term "${entry.en}"`).toBe(entry.ar);
      seen.set(key, entry.ar);
    }
  });

  it("uses real Arabic for every entry", () => {
    for (const entry of GLOSSARY) expect(entry.ar, entry.en).toMatch(ARABIC);
  });
});

describe("page message tables", () => {
  const entries = Object.entries(modules);

  it("finds the tables", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s is complete, consistent and glossary-conformant", (file, mod) => {
    const { en, ar } = mod.messages.tables;
    expect(Object.keys(ar).sort(), `${file}: Arabic keys must equal English keys`).toEqual(
      Object.keys(en).sort()
    );

    const problems: string[] = [];
    for (const [key, english] of Object.entries(en)) {
      const arabic = ar[key];
      if (!arabic || !arabic.trim()) {
        problems.push(`${key}: empty Arabic`);
        continue;
      }
      if (placeholders(english) !== placeholders(arabic))
        problems.push(`${key}: placeholders differ ("${english}" vs "${arabic}")`);
      // Arabic must contain Arabic script unless it deliberately equals the English
      // (file formats, brand names).
      if (!ARABIC.test(arabic) && arabic !== english) problems.push(`${key}: no Arabic script in "${arabic}"`);
      // English left inside Arabic text (a forgotten translation): a lowercase English word,
      // or a multi-word Latin phrase that is not a known brand/file-format phrase.
      // ignore quoted literals and technical tokens (X-Header-Names, sha256, GPT-4o, file.ext)
      const plain = arabic
        .replace(/\{\w+\}/g, " ")
        .replace(/"[^"]*"/g, " ")
        .replace(/\[[A-Za-z_]+\]/g, " ")
        .replace(/\b(Najma Al Raeda Accounting LLC|Najma Al Raeda|Google Fonts|mazeed|Zoho Books|Zoho|Wafeq|WhatsApp|Google Sheets|OpenAI|Stripe|Excel|Muhasib|PINT AE|Naive Bayes)\b/gi, " ")
        .replace(/[A-Za-z0-9._]*[-.0-9][A-Za-z0-9._-]*/g, " ");
      if (ARABIC.test(plain)) {
        const lowercaseWords = plain.match(/(?<![A-Za-z.])[a-z]{4,}(?![A-Za-z])/g) ?? [];
        const phrases = (plain.match(/[A-Za-z]{3,}(?:[ -]+[A-Za-z0-9.]{2,})+/g) ?? []).filter(
          (phrase) => !/^(Google Sheets|Emirates NBD|GPT-4o Vision|Muhasib ai|VAT 201)$/i.test(phrase.trim().replace(/[.,;:]+$/, ""))
        );
        if (lowercaseWords.length || phrases.length)
          problems.push(`${key}: untranslated English "${[...lowercaseWords, ...phrases].join(" | ")}" in "${arabic}"`);
      }

      const term = glossaryLookup(english);
      if (term && !matchesGlossary(term, arabic))
        problems.push(`${key}: "${english}" must be "${term.ar}" (glossary), found "${arabic}"`);
    }

    // plural sets: any base with an `_other` form needs every Arabic category
    for (const key of Object.keys(en).filter((k) => k.endsWith("_other"))) {
      const base = key.slice(0, -"_other".length);
      for (const category of PLURAL)
        if (!ar[`${base}_${category}`]) problems.push(`${base}: Arabic plural form "${category}" missing`);
      if (!en[`${base}_one`]) problems.push(`${base}: English "one" form missing`);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
