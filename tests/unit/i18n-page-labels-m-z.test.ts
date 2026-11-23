import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script without type declarations
import { scanPages } from "../../scripts/i18n-scan.mjs";

import enCatalog from "../../client/src/locales/en/pageLabels.json";
import arCatalog from "../../client/src/locales/ar/pageLabels.json";
import { brandOnlyPageLabels } from "../helpers/brand-only-page-labels";

const load = (locale: string): Record<string, string> =>
  (locale === "ar" ? arCatalog : enCatalog) as Record<string, string>;

describe("pageLabels i18n catalog (pages M-Z, portal)", () => {
  it("pageLabels catalog has real Arabic translations for every key", () => {
    const en = load("en");
    const ar = load("ar");
    expect(Object.keys(en).length).toBeGreaterThan(950);
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(ar)) {
      if (brandOnlyPageLabels.has(key)) continue;
      expect(value, key).toMatch(/[؀-ۿ]/);
      expect(value, key).not.toBe(en[key]);
    }
  });

  it("pages M-Z and portal/* no longer hard-code JSX copy", () => {
    const { perFile } = scanPages();
    const left = Object.entries(perFile as Record<string, number>).filter(([file]) => {
      const base = (file.split("/").pop() ?? "").toLowerCase();
      return base >= "m" || file.includes("/pages/portal/");
    });
    expect(left).toEqual([]);
  });
});
