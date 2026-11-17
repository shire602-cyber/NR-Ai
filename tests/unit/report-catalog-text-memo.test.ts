/**
 * WP-D (/reports slow first paint): in Arabic the Reports page localizes its catalog models with
 * `ct.deep`, and every string ran the exact lookup, date parsing and ~80 generated-sentence
 * patterns once per occurrence (about 28 s of main-thread time on the seeded company). `cx` now
 * memoizes per translation table; these tests pin that the memo is correct (same output, late
 * catalogs still apply) and that repeated strings are cheap.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogTextByEnglish, createCatalogText } from "../../client/src/lib/reportCatalogText";
import { reportCatalog } from "../../client/src/lib/reportCatalog";
import { loadLocale, t } from "../../client/src/lib/i18n";

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("catalog text memo (WP-D)", () => {
  it("returns the same text as the unmemoized lookup", () => {
    const table = t.ar as Record<string, string>;
    const ct = createCatalogText(table, "ar");
    const samples = [
      ...reportCatalog.slice(0, 20).map((r) => r.name),
      "Nov 01, 2026 - Nov 16, 2026",
      "7 products need stock, reorder, or costing review.",
      "not-a-catalog-string",
      "",
    ];
    for (const english of samples) {
      const once = ct.cx(english);
      expect(ct.cx(english)).toBe(once);
      expect(once).toBe(catalogTextByEnglish(table, "ar", english));
    }
  });

  it("drops the memo when the table gains keys (the catalog overlay landing later applies)", () => {
    const full = t.ar as Record<string, string>;
    const table: Record<string, string> = {};
    for (const [key, value] of Object.entries(full)) {
      if (!key.startsWith("reportCatalog.")) table[key] = value;
    }
    const english = reportCatalog[0].name;
    // Overlay not merged yet: the English text passes through (and is memoized).
    expect(createCatalogText(table, "ar").cx(english)).toBe(english);
    // The overlay lands (as loadLocale("ar") merges it): the next lookup is Arabic.
    for (const [key, value] of Object.entries(full)) {
      if (key.startsWith("reportCatalog.")) table[key] = value;
    }
    const arabic = createCatalogText(table, "ar").cx(english);
    expect(arabic).not.toBe(english);
    expect(arabic).toBe(catalogTextByEnglish(full, "ar", english));
  });

  it("localizes a large model with repeated strings quickly", () => {
    const table = t.ar as Record<string, string>;
    const ct = createCatalogText(table, "ar");
    const row = reportCatalog.slice(0, 40).map((r) => ({
      id: r.id,
      name: r.name,
      question: r.question,
      note: "Unmatched sentence that runs every pattern before falling through",
    }));
    const model = Array.from({ length: 400 }, () => ({ rows: row }));
    const started = performance.now();
    const out = ct.deep(model);
    const elapsed = performance.now() - started;
    expect(out[0].rows[0].id).toBe(row[0].id);
    // 64,000 string fields; without the memo this took several seconds.
    expect(elapsed).toBeLessThan(1500);
  });
});
