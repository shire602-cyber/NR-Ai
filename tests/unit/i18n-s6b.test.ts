import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script without type declarations
import { scanPages } from "../../scripts/i18n-scan.mjs";

const load = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(`client/src/locales/${locale}/s6b.json`, "utf8"));

describe("S6b i18n long tail (pages M-Z, portal)", () => {
  it("s6b catalog has real Arabic translations for every key", () => {
    const en = load("en");
    const ar = load("ar");
    expect(Object.keys(en).length).toBeGreaterThan(250);
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(ar)) {
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
