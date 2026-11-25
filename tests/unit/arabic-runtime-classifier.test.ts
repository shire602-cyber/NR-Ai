/**
 * F7 / R18-02: the Arabic runtime crawl (tests/e2e/arabic-runtime-crawl.mjs) and the render
 * guard share one classifier; this pins its allow-list so the 0-English-lines target means
 * the same thing everywhere. Also covers the lib/hooks string scan added to
 * scripts/i18n-scan.mjs (ratchet baseline 0).
 */
import { describe, expect, it } from "vitest";
import { classifyLines, isEnglishLine, toLines } from "../e2e/lib/latin-text.mjs";
// @ts-expect-error - plain .mjs script without type declarations
import { isEnglishPhrase, scanLibHookSource, scanLibHooks } from "../../scripts/i18n-scan.mjs";

describe("F7 Arabic runtime classifier", () => {
  it("[R18-02] flags English UI copy", () => {
    for (const line of [
      "Quick actions",
      "No invoices yet",
      "Owner / Solo Reports",
      "مقارنة الفترات · This month",
      "Export",
      "28 January 2027",
      "Dr: AED 0.00",
    ]) {
      expect(isEnglishLine(line), line).toBe(true);
    }
  });

  it("[R18-02] allows Arabic, numbers, acronyms, brands, emails, document numbers", () => {
    for (const line of [
      "إجراءات سريعة",
      "‏0.00 د.إ.‏",
      "AED 1,250.00",
      "VAT 201",
      "TRN 100123456700003",
      "AE070331234567890123456",
      "INV-0001",
      "Q1 FY2026",
      "اربط Stripe أو Shopify",
      "حزمة Google Sheets",
      "palm@example.com",
      "https://muhasib.ai/help",
      "XLSX · PDF · CSV",
      "Muhasib",
      "2026-01-01 – 2026-03-31",
    ]) {
      expect(isEnglishLine(line), line).toBe(false);
    }
    expect(isEnglishLine("شركة Acme", ["Acme"])).toBe(false);
  });

  it("[R18-02] splits innerText into trimmed lines and counts English ones", () => {
    const lines = toLines("  لوحة التحكم \n\nQuick actions\n  AED 10 \n");
    expect(lines).toEqual(["لوحة التحكم", "Quick actions", "AED 10"]);
    expect(classifyLines(lines)).toEqual({ total: 3, english: 1, samples: ["Quick actions"] });
  });
});

describe("F7 lib/hooks string scan", () => {
  it("[R18-02] recognises English prose, not keys, ids or codes", () => {
    expect(isEnglishPhrase("No receipts yet")).toBe(true);
    expect(isEnglishPhrase("Revenue")).toBe(true);
    expect(isEnglishPhrase("pages.receiptsEmptyTitle")).toBe(false);
    expect(isEnglishPhrase("owner-cash-control-suite")).toBe(false);
    expect(isEnglishPhrase("extension_not_detected")).toBe(false);
    expect(isEnglishPhrase("VAT")).toBe(false);
    expect(isEnglishPhrase("")).toBe(false);
  });

  it("[R18-02] counts user-visible literals and honours i18n-ignore / i18n-ignore-file", () => {
    const src = [
      'export const a = { label: "Total revenue", id: "total-revenue" };',
      'export const b = { title: "pages.someKey" };',
      "// i18n-ignore: brand name",
      'export const c = { title: "Muhasib Cloud" };',
      "toast({ description: `Saved ${count} rows` });",
    ].join("\n");
    expect(scanLibHookSource(src)).toEqual({ hardcoded: 2, justified: 1, hits: [0, 4] });
    const ignored = `// i18n-ignore-file: export workbook cells\n${src}`;
    expect(scanLibHookSource(ignored)).toMatchObject({ hardcoded: 0, justified: 3 });
  });

  it("[R18-02] client/src/lib and client/src/hooks carry no unjustified UI strings", () => {
    const scan = scanLibHooks();
    expect(scan.files).toBeGreaterThan(10);
    expect(scan.samples).toEqual([]);
    expect(scan.hardcoded).toBe(0);
  });
});
