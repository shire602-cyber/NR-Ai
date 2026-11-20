// @vitest-environment jsdom
/**
 * Sign-in, forgot and reset password paint in the stored language on first render:
 *  - the catalog choice: only the active language's auth namespaces are loaded up front
 *    (not the other language, not help/legal/banking), the rest stays lazy;
 *  - <html lang dir> is applied before the first render (applyDocumentLocale) and, from the
 *    stored preference, before the first paint (client/public/theme-init.js, run for real here).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  document.documentElement.removeAttribute("dir");
  document.documentElement.lang = "en";
  document.documentElement.className = "";
});

describe.each(["/login", "/forgot-password", "/reset-password"])(
  "catalog choice for %s",
  (route) => {
    it("is the small auth set, never the whole catalog", async () => {
      const i18n = await import("../../client/src/lib/i18n");
      const ns = i18n.namespacesForPath(route);
      expect(ns).not.toBeNull();
      expect(ns).toEqual(expect.arrayContaining(["pages", "security"]));
      for (const heavy of ["help", "legal", "banking", "invoices", "reportCenter"]) {
        expect(ns).not.toContain(heavy);
      }
    });

    it("loads Arabic only for an Arabic visitor, without the English or the full Arabic catalog", async () => {
      const i18n = await import("../../client/src/lib/i18n");
      await i18n.loadLocaleForPath("ar", route);
      expect(i18n.isLocaleLoaded("ar")).toBe(false); // the rest stays lazy
      expect(i18n.isLocaleLoaded("en")).toBe(false);
      // The Arabic security copy (an auth namespace) is present; the English one was never fetched.
      expect(i18n.t.ar["security.pageTitle"]).toBe("الأمان");
      expect(i18n.t.en["security.pageTitle"]).toBeUndefined();
      expect(i18n.t.ar["reportCenter.exportToExcel"]).toBeUndefined();
    });
  }
);

describe("document direction on first render and first paint", () => {
  it("applyDocumentLocale sets lang, dir and the rtl class", async () => {
    const { applyDocumentLocale } = await import("../../client/src/lib/i18n");
    applyDocumentLocale("ar");
    const html = document.documentElement;
    expect([html.lang, html.dir, html.classList.contains("rtl")]).toEqual(["ar", "rtl", true]);
    applyDocumentLocale("en");
    expect([html.lang, html.dir, html.classList.contains("ltr")]).toEqual(["en", "ltr", true]);
  });

  const script = readFileSync(path.resolve("client/public/theme-init.js"), "utf8");
  const run = () => new Function(script)();

  it("theme-init.js applies a stored Arabic preference before React runs", () => {
    window.localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" } }));
    run();
    expect([document.documentElement.lang, document.documentElement.dir]).toEqual(["ar", "rtl"]);
  });

  it("leaves English and unreadable preferences alone", () => {
    window.localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "en" } }));
    run();
    expect(document.documentElement.dir).toBe("");
    window.localStorage.setItem("i18n-storage", "{not json");
    run();
    expect(document.documentElement.dir).toBe("");
  });
});
