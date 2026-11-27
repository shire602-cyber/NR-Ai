// Source inspection is intentional: these pages need a database-backed session to render, and the
// i18n scanner does not flag single-word JSX literals such as "May" or "Var". The catalog half of
// the test is behavioural (every key exists in both languages, Arabic contains Arabic letters).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const catalog = (lang: string) =>
  JSON.parse(read(`client/src/locales/${lang}/pages.json`)) as Record<string, string>;

const KEYS = [
  "pages.may",
  "pages.june",
  "pages.july",
  "pages.varShort",
  "pages.workpaperLine",
  "pages.supportingWorkpaper",
  "pages.apiKeyColName",
  "pages.apiKeyColKey",
  "pages.apiKeyNamePlaceholder",
];

describe("Arabic app screens: leftover English chrome", () => {
  it("has English and natural Arabic copy for each formerly hardcoded label", () => {
    const en = catalog("en");
    const ar = catalog("ar");
    for (const k of KEYS) {
      expect(en[k], k).toBeTruthy();
      expect(ar[k], k).toMatch(/[؀-ۿ]/);
    }
  });

  it("no longer hardcodes those labels in the page JSX", () => {
    const fixed = read("client/src/pages/FixedAssets.tsx");
    expect(fixed).not.toMatch(/<SelectItem value="[567]">(May|June|July)<\/SelectItem>/);
    expect(read("client/src/pages/Budgets.tsx")).not.toContain(">Var</span>");
    const tax = read("client/src/pages/CorporateTax.tsx");
    expect(tax).not.toContain("<TableHead>Line</TableHead>");
    expect(tax).not.toContain("Supporting workpaper:</span>");
    const dev = read("client/src/pages/DeveloperSettings.tsx");
    expect(dev).not.toContain("<TableHead>Name</TableHead>");
    expect(dev).not.toContain("<TableHead>Key</TableHead>");
    expect(dev).not.toContain('placeholder="e.g., Production Server"');
  });
});
