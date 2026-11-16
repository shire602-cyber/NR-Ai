/**
 * S5 bundle budget: locale namespace catalogs are code-split out of the main bundle (one lazy
 * chunk per namespace and locale) and Arabic is fetched only for the Arabic locale.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocaleLoaded, loadLocale, t, useI18n } from "../../client/src/lib/i18n";

const root = process.cwd();

describe("S5 locale catalogs are code-split", () => {
  it("i18n.ts loads namespace catalogs lazily (no eager glob) and main.tsx awaits the active locale", () => {
    const src = readFileSync(join(root, "client/src/lib/i18n.ts"), "utf8");
    expect(src).toMatch(
      /import\.meta\.glob\("\.\.\/locales\/en\/\*\.json", \{ import: "default" \}\)/
    );
    expect(src).not.toMatch(/eager:\s*true/);
    const main = readFileSync(join(root, "client/src/main.tsx"), "utf8");
    expect(main).toContain("loadLocale(useI18n.getState().locale)");
  });

  it("catalogs merge on demand, once, and only for the requested locale", async () => {
    expect(isLocaleLoaded("ar")).toBe(false);
    await loadLocale("en");
    expect(isLocaleLoaded("en")).toBe(true);
    expect(isLocaleLoaded("ar")).toBe(false);
    expect(t.en["shell.skipToContent"]).toBe("Skip to main content");
    expect(t.ar["shell.skipToContent"]).toBeUndefined();
    await Promise.all([loadLocale("ar"), loadLocale("ar")]);
    expect(isLocaleLoaded("ar")).toBe(true);
    expect(t.ar["shell.skipToContent"]).toBeTruthy();
    expect(typeof useI18n.getState().setLocale).toBe("function");
  });

  it.skipIf(!existsSync(join(root, "dist/public/assets")))(
    "the built main bundle carries no namespace catalog copy",
    () => {
      const assets = join(root, "dist/public/assets");
      const main = readdirSync(assets).find((f) => /^index-[A-Za-z0-9_-]{8}\.js$/.test(f));
      expect(main).toBeTruthy();
      const js = readFileSync(join(assets, main!), "utf8");
      const ar = JSON.parse(
        readFileSync(join(root, "client/src/locales/ar/reportCenter.json"), "utf8")
      ) as Record<string, string>;
      const samples = Object.values(ar)
        .filter((v) => v.length > 25)
        .slice(0, 5);
      expect(samples.length).toBeGreaterThan(0);
      for (const v of samples) expect(js.includes(v), v).toBe(false);
    }
  );
});
