// @vitest-environment jsdom
/**
 * Package G: the UAE e-invoicing hub, compare pages, free-tools index and solution pages, plus the
 * route aliases that serve them. Behaviour tests: render the real PhaseSite at a URL in jsdom and
 * check what a visitor gets in English and Arabic.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enMarketingBase from "../../client/src/locales/en/marketing.json";
import arMarketingBase from "../../client/src/locales/ar/marketing.json";
import enMarketingHome from "../../client/src/locales/en/marketingHome.json";
import arMarketingHome from "../../client/src/locales/ar/marketingHome.json";
import enMarketingMeta from "../../client/src/locales/en/marketingMeta.json";
import arMarketingMeta from "../../client/src/locales/ar/marketingMeta.json";

const enMarketing = { ...enMarketingBase, ...enMarketingHome, ...enMarketingMeta };
const arMarketing = { ...arMarketingBase, ...arMarketingHome, ...arMarketingMeta };
import {
  canonicalMarketingPath,
  hubLead,
  hubTitle,
  marketingMetadata,
  marketingPaths,
} from "../../client/src/components/marketing/phase/route-content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", "/");
});

/** Render the whole marketing site at `path` and wait for the lazy page body. */
async function renderAt(path: string, ready: string) {
  window.history.replaceState(null, "", path);
  const { default: PhaseSite } =
    await import("../../client/src/components/marketing/phase/PhaseSite");
  await act(async () => root.render(createElement(PhaseSite)));
  await vi.waitFor(
    () => {
      if (!container.querySelector(ready)) throw new Error(`waiting for ${ready}`);
    },
    { timeout: 20000 }
  );
}

const PROVIDERS = /A-?Cube|Complyance|ZATCA|Saudi|\bKSA\b/i;

describe("route content", () => {
  it("keeps the hub meta tuples in step with the locale catalogs", () => {
    expect(hubTitle[0]).toBe(enMarketing["marketing.hxHubH1"]);
    expect(hubTitle[1]).toBe(arMarketing["marketing.hxHubH1"]);
    expect(hubLead[0]).toBe(enMarketing["marketing.hxHubLead"]);
    expect(hubLead[1]).toBe(arMarketing["marketing.hxHubLead"]);
  });

  it.each([
    ["/e-invoicing", "/uae-e-invoicing"],
    ["/compare/zoho-books", "/compare/zoho"],
    ["/free-tools", "/tools"],
    ["/accounting-firms", "/solutions/accounting-firms"],
    ["/small-business", "/solutions/small-business"],
  ])("resolves the alias %s to %s and keeps it out of the sitemap list", (alias, target) => {
    expect(canonicalMarketingPath(alias)).toBe(target);
    expect(marketingPaths).toContain(target);
    expect(marketingPaths).not.toContain(alias);
    for (const locale of ["en", "ar"] as const) {
      const meta = marketingMetadata(`/${locale}${alias}`);
      const main = marketingMetadata(`/${locale}${target}`);
      expect(meta?.canonical).toBe(main?.canonical);
      expect(meta?.title).toBe(main?.title);
      expect(meta?.description).toBe(main?.description);
    }
  });

  it.each(["/uae-e-invoicing", "/compare/wafeq", "/compare/zoho", "/tools"])(
    "gives %s separate English and Arabic meta",
    (path) => {
      const en = marketingMetadata(`/en${path}`)!;
      const ar = marketingMetadata(`/ar${path}`)!;
      expect(en.title).not.toBe(ar.title);
      expect(en.description).not.toBe(ar.description);
      expect(ar.title).toMatch(/[؀-ۿ]/);
      expect(ar.description).toMatch(/[؀-ۿ]/);
      expect(en.ar).toBe(ar.canonical);
    }
  );
});

describe.each(["en", "ar"] as const)("UAE e-invoicing hub (%s)", (locale) => {
  const expectedH1 = locale === "ar" ? hubTitle[1] : hubTitle[0];

  it("renders the heading, deadline finder, scope, readiness link and FAQ", async () => {
    await renderAt(`/${locale}/uae-e-invoicing`, '[data-testid="einvoicing-hub"] #faq');
    expect(container.querySelector("h1")?.textContent).toBe(expectedH1);
    expect(container.querySelector('[data-testid="section-e-invoicing-deadlines"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="hub-dates"] tbody')?.children).toHaveLength(3);
    expect(
      container.querySelector('[data-testid="hub-readiness"] input[type="checkbox"]')
    ).not.toBeNull();
    expect(
      container.querySelector(`a[href="/${locale}/tools/e-invoicing-readiness"]`)
    ).not.toBeNull();
    expect(container.querySelectorAll("#faq details")).toHaveLength(6);
    expect(
      container.querySelector('a[href="https://tax.gov.ae/en/taxes/Vat/uae.einvoicing.aspx"]')
    ).not.toBeNull();
    const scope = container.querySelector("#who-is-in-scope")!;
    expect(scope.querySelector(`a[href^="https://mof.gov.ae/${locale}/news/"]`)).not.toBeNull();
    expect(scope.textContent).toContain(
      locale === "ar" ? "المجموعة الضريبية نفسها" : "same tax group"
    );
    expect(container.querySelectorAll("#faq details p")[2].textContent).toContain(
      locale === "ar" ? "عبر إمارات تاكس" : "through EmaraTax"
    );
    expect(container.textContent).not.toMatch(PROVIDERS);
    expect(container.textContent).not.toMatch(/FTA[-\s]?compliant/i);
    if (locale === "ar") expect(container.textContent).not.toMatch(/[٠-٩]/);
    // Every heading level steps down from the single h1.
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("serves the /e-invoicing alias with the same page", async () => {
    await renderAt(`/${locale}/e-invoicing`, '[data-testid="einvoicing-hub"] #faq');
    expect(container.querySelector("h1")?.textContent).toBe(expectedH1);
  });
});

describe.each(["en", "ar"] as const)("compare pages (%s)", (locale) => {
  it.each([
    ["wafeq", "/compare/wafeq"],
    ["zoho", "/compare/zoho"],
    ["zoho", "/compare/zoho-books"],
  ] as const)("renders the %s comparison at %s", async (vendor, path) => {
    await renderAt(`/${locale}${path}`, '[data-testid="compare-migration"]');
    const top = container.querySelector('[data-testid="compare-top"]')!;
    expect(top.querySelectorAll("thead th[scope=col]")).toHaveLength(3);
    expect(top.querySelector(`td[data-column="${vendor}"]`)).not.toBeNull();
    expect(
      top.querySelector(`td[data-column="${vendor === "wafeq" ? "zoho" : "wafeq"}"]`)
    ).toBeNull();
    const cta = container.querySelector('[data-testid="compare-migration"] a.phase-primary');
    expect(cta?.getAttribute("href")).toBe(`/${locale}/migration-guides/${vendor}`);
    expect(
      container.querySelector('[data-testid="compare-migration"] a[href="/register?step=account"]')
    ).not.toBeNull();
    // The existing editorial content stays below the table.
    expect(container.querySelector("[data-editorial-content]")).not.toBeNull();
    expect(container.textContent).not.toMatch(PROVIDERS);
  });
});

describe.each(["en", "ar"] as const)("free tools index (%s)", (locale) => {
  it.each(["/tools", "/free-tools"])("renders cards with live previews at %s", async (path) => {
    await renderAt(`/${locale}${path}`, '[data-testid="tools-index"]');
    const slugs = [
      "vat-calculator",
      "corporate-tax-estimator",
      "e-invoicing-readiness",
      "invoice-template",
    ];
    for (const slug of slugs) {
      expect(container.querySelector(`a[href="/${locale}/tools/${slug}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-testid="preview-${slug}"]`)?.textContent).toBeTruthy();
    }
    // The previews are computed with the tools' own logic: AED 1,000 + 5% VAT, and tax above AED 375,000.
    const vat = container.querySelector('[data-testid="preview-vat-calculator"]')!.textContent!;
    expect(vat).toContain("1,000.00");
    expect(vat).toContain("50.00");
    expect(vat).toContain("1,050.00");
    const corporate = container.querySelector(
      '[data-testid="preview-corporate-tax-estimator"]'
    )!.textContent!;
    expect(corporate).toContain("500,000.00");
    expect(corporate).toContain("11,250.00");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    if (locale === "ar") expect(container.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe.each(["en", "ar"] as const)("solution pages (%s)", (locale) => {
  it.each(["/solutions/accounting-firms", "/accounting-firms"])(
    "renders the firms page at %s",
    async (path) => {
      await renderAt(`/${locale}${path}`, '[data-testid="solution-accounting-firms"]');
      expect(container.querySelector('[data-testid="section-firms"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="section-final-cta"]')).not.toBeNull();
      expect(container.querySelector(`a[href="/${locale}/product/client-portal"]`)).not.toBeNull();
    }
  );

  it.each(["/solutions/small-business", "/small-business"])(
    "renders the small-business page at %s",
    async (path) => {
      await renderAt(`/${locale}${path}`, '[data-testid="solution-small-business"]');
      expect(container.querySelector("#see-it")).not.toBeNull();
      expect(container.querySelector(`a[href="/${locale}#tour"]`)).not.toBeNull();
      expect(container.querySelector(`a[href="/${locale}/product/invoicing"]`)).not.toBeNull();
      expect(container.querySelector('[data-testid="section-final-cta"]')).not.toBeNull();
    }
  );
});
