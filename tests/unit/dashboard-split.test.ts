import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs script without type declarations
import { scanPages } from "../../scripts/i18n-scan.mjs";
import { brandOnlyPageLabels } from "../helpers/brand-only-page-labels";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("S6a: dashboard split and i18n long tail", () => {
  it("keeps Dashboard.tsx a thin shell under 1,000 lines", () => {
    const source = read("client/src/pages/Dashboard.tsx");
    expect(source.split("\n").length).toBeLessThan(1000);
    expect(source).toContain("useCustomerDashboardModel");
  });

  it("has no hard-coded JSX strings left in pages A-L or the dashboard folder", () => {
    const { perFile } = scanPages() as { perFile: Record<string, number> };
    const leftovers = Object.entries(perFile).filter(([file]) => {
      const base = file.split("/").pop() ?? "";
      const nested = file.split("/").length > 4;
      return (!nested && base[0].toUpperCase() <= "L") || file.includes("/pages/dashboard/");
    });
    expect(leftovers).toEqual([]);
  });

  it("ships real Arabic for the pageLabels namespace", () => {
    const en = JSON.parse(read("client/src/locales/en/pageLabels.json")) as Record<string, string>;
    const ar = JSON.parse(read("client/src/locales/ar/pageLabels.json")) as Record<string, string>;
    expect(Object.keys(en).length).toBeGreaterThan(600);
    for (const [key, value] of Object.entries(en)) {
      if (brandOnlyPageLabels.has(key)) continue;
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
      if (!/^[A-Za-z0-9.]+$/.test(value)) expect(ar[key], key).not.toBe(value);
    }
  });
});
