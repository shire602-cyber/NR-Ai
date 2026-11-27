// The dist/ test below inspects the built bundle (build output, skipped when dist/ is absent);
// the code-splitting behaviour itself is asserted by calling loadLocale.
/**
 * S5 bundle budget: locale namespace catalogs are code-split out of the main bundle (one lazy
 * chunk per namespace and locale) and Arabic is fetched only for the Arabic locale.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import arReportCenter from "../../client/src/locales/ar/reportCenter.json";
import { isLocaleLoaded, loadLocale, t, useI18n } from "../../client/src/lib/i18n";

const root = process.cwd();

describe("S5 locale catalogs are code-split", () => {
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

  // CI runs this after `npm run build` with REQUIRE_BUILD_OUTPUT=1: a missing build must fail there.
  it.runIf(process.env.REQUIRE_BUILD_OUTPUT === "1")("build output is present (CI)", () => {
    expect(
      existsSync(join(root, "dist/public/assets")),
      "run `npm run build` first: dist/public/assets missing"
    ).toBe(true);
  });

  it.skipIf(!existsSync(join(root, "dist/public/assets")))(
    "the built main bundle carries no namespace catalog copy",
    () => {
      const assets = join(root, "dist/public/assets");
      const main = readdirSync(assets).find((f) => /^index-[A-Za-z0-9_-]{8}\.js$/.test(f));
      expect(main).toBeTruthy();
      const js = readFileSync(join(assets, main!), "utf8");
      const ar = arReportCenter as Record<string, string>;
      const samples = Object.values(ar)
        .filter((v) => v.length > 25)
        .slice(0, 5);
      expect(samples.length).toBeGreaterThan(0);
      for (const v of samples) expect(js.includes(v), v).toBe(false);
    }
  );
});
