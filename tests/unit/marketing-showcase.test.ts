// @vitest-environment jsdom
/**
 * Homepage sections E: feature showcase rows, accounting-firms band, trust and security, migration.
 * Rendered in EN and AR. jsdom has no IntersectionObserver, so lazy visuals mount at once; the
 * owner flags are mocked so both the default (off) and the switched-on states are covered.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { marketingPaths } from "../../client/src/components/marketing/phase/route-content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flags = vi.hoisted(() => ({ proof: false, residency: false, freeHelp: false }));
vi.mock("../../client/src/components/marketing/phase/home/flags", () => ({
  get SHOW_PROOF_PLACEHOLDERS() {
    return flags.proof;
  },
  get SHOW_DATA_RESIDENCY() {
    return flags.residency;
  },
  get FREE_MIGRATION_HELP() {
    return flags.freeHelp;
  },
  SHOW_WHATSAPP: false,
  PROVIDER_FEES_CONFIRMED_ZERO: false,
}));

const FEATURE_PATHS = [
  "/product/ai-document-scanning",
  "/product/invoicing",
  "/product/vat",
  "/product/bank-reconciliation",
  "/product/payroll",
  "/product/accounting-reports",
  "/product/inventory",
];
const BANNED =
  /a-?cube|complyance|zatca|saudi|\bksa\b|bank feed|live bank|connect your bank|direct filing/i;
const ARABIC = /[؀-ۿ]/;

describe("homepage sections E", () => {
  let container: HTMLDivElement;
  let root: Root;
  let catalog: Record<string, Record<string, unknown>>;

  beforeAll(async () => {
    const i18n = await import("../../client/src/lib/i18n");
    await Promise.all([i18n.loadLocale("en"), i18n.loadLocale("ar")]);
    catalog = i18n.t as never;
  });

  beforeEach(() => {
    flags.proof = false;
    flags.residency = false;
    flags.freeHelp = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mount(name: string, locale: "en" | "ar") {
    const mod = (await import(
      `../../client/src/components/marketing/phase/home/${name}.tsx`
    )) as Record<string, never>;
    const tr = ((pair: readonly [string, string]) => pair[locale === "ar" ? 1 : 0]) as never;
    await act(async () => {
      root.render(createElement(mod[name], { base: `/${locale}`, locale, tr }));
    });
    // The marketing catalog may still be loading for the forced locale.
    await vi.waitFor(() => {
      if (!container.querySelector("h2")?.textContent) throw new Error("copy not loaded");
    });
  }

  const hrefs = () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

  describe.each(["en", "ar"] as const)("%s", (locale) => {
    it("renders seven showcase rows with heading, three bullets and a feature link", async () => {
      await mount("Showcase", locale);
      const rows = [...container.querySelectorAll<HTMLElement>('[data-testid^="showcase-row-"]')];
      expect(rows).toHaveLength(7);
      expect(container.querySelector("#features")).not.toBeNull();
      const links: string[] = [];
      for (const row of rows) {
        expect(row.querySelector("h3")?.textContent?.trim()).toBeTruthy();
        expect(row.querySelectorAll(".mz-show-bullets li")).toHaveLength(3);
        const link = row.querySelector<HTMLAnchorElement>("a.mz-show-explore");
        expect(link?.getAttribute("aria-label")).toBeTruthy();
        links.push(link!.getAttribute("href")!);
      }
      expect(links).toEqual(FEATURE_PATHS.map((p) => `/${locale}${p}`));
      for (const p of FEATURE_PATHS) expect(marketingPaths).toContain(p);
      // Alternating sides.
      expect(rows.map((r) => r.dataset.flip)).toEqual([
        "false",
        "true",
        "false",
        "true",
        "false",
        "true",
        "false",
      ]);
    });

    it("renders each visual as a labelled sample, statically under reduced motion", async () => {
      await mount("Showcase", locale);
      await vi.waitFor(() => {
        if (container.querySelectorAll("figure.mz-show-visual").length !== 7)
          throw new Error("visuals not loaded");
      });
      const sample = String(catalog[locale]["marketing.hxShowSample"]);
      for (const fig of container.querySelectorAll<HTMLElement>("figure.mz-show-visual")) {
        expect(fig.getAttribute("aria-label")).toBeTruthy();
        expect(fig.querySelector("figcaption")?.textContent).toBe(sample);
        expect(fig.dataset.state).toBe("static");
      }
      // The bilingual invoice shows both languages of the same document.
      const sheets = container.querySelectorAll<HTMLElement>(".mz-show-sheet");
      expect([...sheets].map((s) => s.lang)).toEqual(["en", "ar"]);
      expect(sheets[0]?.textContent).toContain("INV-2001");
      expect(sheets[1]?.textContent).toContain("INV-2001");
    });

    it("states the VAT 201 and bank CSV copy without banned wording", async () => {
      await mount("Showcase", locale);
      const text = container.textContent ?? "";
      expect(text).toContain("EmaraTax");
      expect(text).toContain("CSV");
      expect(text).not.toMatch(BANNED);
      if (locale === "ar") expect(container.querySelector("h2")?.textContent).toMatch(ARABIC);
    });

    it("renders the firms band with its calls to action and a working client switcher", async () => {
      await mount("FirmsBand", locale);
      expect(container.querySelector("#firms")).not.toBeNull();
      expect(hrefs()).toEqual(
        expect.arrayContaining([
          `/${locale}/contact`,
          `/${locale}/solutions/accounting-firms`,
          `/${locale}/solutions/small-business`,
        ])
      );
      const buttons = [...container.querySelectorAll<HTMLButtonElement>(".mz-firm-client")];
      expect(buttons).toHaveLength(3);
      expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
      const before = container.querySelector(".mz-firm-stats")?.textContent;
      act(() => buttons[1]?.click());
      expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector(".mz-firm-stats")?.textContent).not.toBe(before);
      expect(container.querySelector('[data-testid="proof-placeholder-firm"]')).toBeNull();
      expect(container.textContent).not.toMatch(BANNED);
    });

    it("renders the trust facts without the residency line or proof placeholder by default", async () => {
      await mount("TrustSecurity", locale);
      expect(container.querySelector("#trust")).not.toBeNull();
      expect(container.querySelectorAll(".mz-trust-fact")).toHaveLength(6);
      expect(container.textContent).not.toContain(
        String(catalog[locale]["marketing.hxTrustResidency"])
      );
      expect(container.querySelector('[data-testid="proof-placeholder-stories"]')).toBeNull();
      expect(hrefs()).toContain(`/${locale}/trust`);
      expect(container.textContent).not.toMatch(BANNED);
      expect(container.textContent).not.toMatch(/bank-grade|soc ?2|certified|fta-/i);
    });

    it("shows the residency line and proof placeholder only when their flags are on", async () => {
      flags.residency = true;
      flags.proof = true;
      await mount("TrustSecurity", locale);
      expect(container.textContent).toContain(
        String(catalog[locale]["marketing.hxTrustResidency"])
      );
      expect(container.querySelector('[data-testid="proof-placeholder-stories"]')).not.toBeNull();
    });

    it("renders four migration guide links and the default guides line", async () => {
      await mount("Migration", locale);
      expect(container.querySelector("#migration")).not.toBeNull();
      const guides = ["excel", "wafeq", "zoho", "mazeed"].map(
        (s) => `/${locale}/migration-guides/${s}`
      );
      expect(hrefs()).toEqual(expect.arrayContaining(guides));
      for (const guide of guides) {
        expect(container.querySelector(`a[href="${guide}"] bdi`)?.getAttribute("translate")).toBe(
          "no"
        );
      }
      expect(container.querySelector('a[href$="/zoho"] bdi')?.textContent).toBe("Zoho Books");
      expect(container.querySelectorAll(".mz-mig-step")).toHaveLength(3);
      const text = container.textContent ?? "";
      expect(text).toContain(String(catalog[locale]["marketing.hxMigGuides"]));
      expect(text).not.toContain(String(catalog[locale]["marketing.hxMigFreeHelp"]));
      expect(text).not.toMatch(BANNED);
    });

    it("shows the free-help line only when the owner flag is on", async () => {
      flags.freeHelp = true;
      await mount("Migration", locale);
      expect(container.textContent).toContain(String(catalog[locale]["marketing.hxMigFreeHelp"]));
    });
  });
});
