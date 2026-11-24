// @vitest-environment jsdom
/**
 * Homepage pricing section, FAQ, final CTA, footer and the /pricing page body: rendered in jsdom in
 * English and Arabic. Prices come from shared/plans.ts, never from the copy.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLAN_DEFINITIONS } from "../../shared/plans";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";
import enMarketingBase from "../../client/src/locales/en/marketing.json";
import arMarketingBase from "../../client/src/locales/ar/marketing.json";
import enMarketingHome from "../../client/src/locales/en/marketingHome.json";
import arMarketingHome from "../../client/src/locales/ar/marketingHome.json";
import enMarketingMeta from "../../client/src/locales/en/marketingMeta.json";
import arMarketingMeta from "../../client/src/locales/ar/marketingMeta.json";

const enMarketing = { ...enMarketingBase, ...enMarketingHome, ...enMarketingMeta } as Record<
  string,
  string
>;
const arMarketing = { ...arMarketingBase, ...arMarketingHome, ...arMarketingMeta } as Record<
  string,
  string
>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "../../client/src/components/marketing/phase/home";
const catalogs = { en: enMarketing, ar: arMarketing } as const;
const PROVIDERS = /A-?Cube|Complyance|ZATCA|Saudi|KSA/i;

let container: HTMLDivElement;
let root: Root;
const originalUrl = window.location.href;

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
  window.history.replaceState(null, "", originalUrl);
});

async function render(locale: "en" | "ar", path: string, element: () => Promise<ReactElement>) {
  const { useI18n, loadNamespace } = await import("../../client/src/lib/i18n");
  await loadNamespace(locale, "marketing");
  await loadNamespace(locale, "marketingHome");
  act(() => useI18n.getState().setLocale(locale));
  window.history.replaceState(null, "", `/${locale}${path}`);
  await act(async () => root.render(await element()));
  for (
    let i = 0;
    i < 60 && !container.querySelector('[data-testid="card-plan-enterprise"]') && needsPlans(path);
    i++
  ) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const needsPlans = (path: string) => path === "" || path === "/pricing";

const sectionProps = (locale: "en" | "ar") => ({
  base: `/${locale}`,
  locale,
  tr: ([en, ar]: readonly [string, string]) => (locale === "ar" ? ar : en),
});

/** Visible text lines that are still English (same rules as the Arabic runtime crawl). */
function englishLines(scope: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest('[translate="no"], [aria-hidden="true"], .sr-only')) continue;
    const lang = el.closest("[lang]")?.getAttribute("lang");
    if (lang && !lang.startsWith("ar")) continue;
    const value = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (value && isEnglishLine(value)) out.push(value);
  }
  return out;
}

const pricing = async (locale: "en" | "ar") => {
  const { PricingSection } = await import(`${HOME}/PricingSection`);
  return createElement(PricingSection, sectionProps(locale));
};

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const catalog = catalogs[locale] as Record<string, string>;

  it("shows three plan cards with the e-invoicing badge and the prices from shared/plans.ts", async () => {
    await render(locale, "", () => pricing(locale));
    const section = container.querySelector('section#pricing[data-testid="section-pricing"]');
    expect(section).not.toBeNull();
    const cards = [...container.querySelectorAll('[data-testid^="card-plan-"]')];
    expect(cards).toHaveLength(3);
    for (const plan of PLAN_DEFINITIONS) {
      const card = container.querySelector(`[data-testid="card-plan-${plan.id}"]`)!;
      expect(card.textContent).toContain(String(plan.monthlyPrice));
      const badge = container.querySelector(`[data-testid="badge-einvoicing-${plan.id}"]`);
      expect(badge?.textContent).toBe(catalog["marketing.hxPriceBadge"]);
      expect(badge?.parentElement?.contains(card)).toBe(true);
    }
    // The middle (Professional) card is the highlighted one.
    expect(
      container.querySelector(
        '.mz-price-slot[data-featured="true"] [data-testid="card-plan-professional"]'
      )
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="button-plan-enterprise"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="price-trial-note"]')?.textContent).toBe(
      catalog["marketing.hxPriceTrialNote"]
    );
    expect(container.querySelector('a[href="#compare"]')?.textContent).toBe(
      catalog["marketing.hxPriceCompareLink"]
    );
    expect(container.querySelector('[data-testid="link-price-full"]')?.getAttribute("href")).toBe(
      `/${locale}/pricing`
    );
    expect(container.textContent).not.toMatch(PROVIDERS);
    if (locale === "ar") expect(englishLines(container)).toEqual([]);
  });

  it("answers at least ten questions, with no provider names, and keeps the pinned answers", async () => {
    const { Faq } = await import(`${HOME}/Faq`);
    await render(locale, "/faq", async () => createElement(Faq, sectionProps(locale)));
    const items = [...container.querySelectorAll("details")];
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.every((item) => !item.open)).toBe(true);
    expect(container.textContent).not.toMatch(PROVIDERS);
    expect(container.textContent).not.toMatch(
      /bank feed|live bank|connect your bank|direct filing/i
    );
    const byQuestion = (q: string) =>
      items.find((item) => item.querySelector("summary")?.textContent?.trim() === q);
    expect(byQuestion(catalog["marketing.faq3Q"])?.querySelector("p")?.textContent).toBe(
      catalog["marketing.faq3A"]
    );
    const vat = items.find((item) => item.dataset.faq === "vat");
    expect(vat?.querySelector("p")?.textContent).toMatch(/EmaraTax\)?\.$/);
    // Deadline answer: the dates come from deadlines.ts, with Western digits.
    const deadline = items.find((item) => item.dataset.faq === "deadline")!;
    const text = deadline.textContent ?? "";
    for (const year of ["2026", "2027"]) expect(text).toContain(year);
    expect(text).toContain("5,000");
    expect(text).not.toMatch(/[٠-٩]/);
    expect(text).not.toMatch(/24\/7|FTA[-\s]?(compliant|approved)/i);
    // The e-invoicing answer says it is built in, without claiming the product is accredited itself.
    const einv = items.find((item) => item.dataset.faq === "einvoicing")!;
    expect(einv.textContent).toContain(
      locale === "ar" ? "مزوّد خدمة معتمد مدمج في" : "accredited service provider, built into"
    );
    if (locale === "ar") expect(englishLines(container)).toEqual([]);
  });

  it("closes with the trial CTA and the demo link", async () => {
    const { FinalCta } = await import(`${HOME}/FinalCta`);
    await render(locale, "", async () => createElement(FinalCta, { base: `/${locale}`, locale }));
    const section = container.querySelector('section#final-cta[data-testid="section-final-cta"]');
    expect(section?.querySelector("h2")?.textContent).toBe(catalog["marketing.hxCtaTitle"]);
    expect(section?.querySelector('[data-testid="button-final-trial"]')?.getAttribute("href")).toBe(
      "/register?step=account"
    );
    expect(section?.querySelector('[data-testid="button-final-demo"]')?.getAttribute("href")).toBe(
      `/${locale}/book-demo`
    );
    expect(section?.textContent).toContain(catalog["marketing.hxCtaMicro"]);
    expect(catalog["marketing.hxCtaPrimary"]).not.toMatch(/[٠-٩]/);
    if (locale === "ar") expect(englishLines(container)).toEqual([]);
  });

  it("links tools, comparisons, the e-invoicing guide and legal pages, and the toggle keeps the page", async () => {
    const { SiteFooter } = await import(`${HOME}/SiteFooter`);
    await render(locale, "/pricing", async () => createElement(SiteFooter, sectionProps(locale)));
    const footer = container.querySelector('footer[data-testid="section-footer"]')!;
    const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const href of [
      `/${locale}/tools`,
      `/${locale}/tools/vat-calculator`,
      `/${locale}/compare`,
      `/${locale}/compare/wafeq`,
      `/${locale}/compare/zoho`,
      `/${locale}/uae-e-invoicing`,
      `/${locale}/about`,
      `/${locale}/contact`,
      `/${locale}/trust`,
      "/cookies",
      "/privacy",
      "/terms",
      "/help",
    ]) {
      expect(hrefs, href).toContain(href);
    }
    const other = locale === "ar" ? "en" : "ar";
    const toggle = footer.querySelector('[data-testid="link-foot-language"]');
    expect(toggle?.getAttribute("href")).toBe(`/${other}/pricing`);
    expect(toggle?.getAttribute("lang")).toBe(other);
    const mail = footer.querySelector('[data-testid="link-foot-support"]');
    expect(mail?.getAttribute("dir")).toBe("ltr");
    // WhatsApp stays off until the owner confirms (flags.ts).
    expect(footer.querySelector('[data-testid="link-foot-whatsapp"]')).toBeNull();
    expect(footer.innerHTML).not.toMatch(/wa\.me|whatsapp/i);
    expect(hrefs.some((href) => href === `/${other}/pricing`)).toBe(true);
    if (locale === "ar") expect(englishLines(footer)).toEqual([]);
  });

  it("renders the pricing page: cards, feature matrix, comparison table and FAQ", async () => {
    const { PricingPage } =
      await import("../../client/src/components/marketing/phase/pages/PricingPage");
    await render(locale, "/pricing", async () => createElement(PricingPage, sectionProps(locale)));
    const page = container.querySelector('[data-testid="pricing-page"]')!;
    expect(page.querySelectorAll('[data-testid^="card-plan-"]')).toHaveLength(3);
    const matrix = page.querySelector('table[data-testid="plan-matrix"]')!;
    expect(matrix).not.toBeNull();
    expect(matrix.querySelectorAll("thead th[data-plan]")).toHaveLength(3);
    // E-invoicing: included on every plan.
    const einvoicing = matrix.querySelector(
      'tr[data-row="marketing.prEveryEinvoiceTitle"]'
    ) as HTMLElement;
    expect(einvoicing.querySelectorAll("td .mz-price-yes")).toHaveLength(3);
    // Gated rows come from the shared plan matrix: fixed assets start above Starter.
    const fixedAssets = matrix.querySelector('tr[data-row="marketing.prRowFixedAssets"]')!;
    expect(fixedAssets.querySelectorAll("td .mz-price-yes").length).toBeLessThan(3);
    expect(page.querySelector('section[data-testid="section-compare"]')).not.toBeNull();
    expect(page.querySelectorAll("section#faq details").length).toBeGreaterThanOrEqual(10);
    expect(page.querySelector('[data-testid="price-readonly"]')?.textContent).toBe(
      catalog["marketing.hxPriceReadOnly"]
    );
    expect(page.textContent).not.toMatch(PROVIDERS);
    if (locale === "ar") {
      for (const id of ["section-plan-matrix", "section-faq", "section-pricing"]) {
        const scope = page.querySelector(`[data-testid="${id}"]`)!;
        expect(englishLines(scope), id).toEqual([]);
      }
    }
  });

  it("keeps the monthly/yearly selector and the yearly signup path on the pricing page", async () => {
    const { PricingPage } =
      await import("../../client/src/components/marketing/phase/pages/PricingPage");
    await render(locale, "/pricing", async () => createElement(PricingPage, sectionProps(locale)));
    const page = container.querySelector('[data-testid="pricing-page"]')!;
    const digits = (text: string) =>
      text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,٬\s]/g, "");
    const prices = () =>
      [...page.querySelectorAll('[data-testid^="card-plan-"] .mk-tier__price strong')].map((el) =>
        digits(el.textContent ?? "")
      );
    const hrefs = () =>
      ["starter", "professional"]
        .map((id) => page.querySelector(`[data-testid="button-plan-${id}"]`)?.getAttribute("href"))
        // Enterprise's main CTA is "contact us"; its trial signup is the secondary link.
        .concat(
          page.querySelector('[data-testid="link-plan-trial-enterprise"]')?.getAttribute("href")
        );
    const monthly = page.querySelector('[data-testid="billing-cycle-monthly"]') as HTMLElement;
    const yearly = page.querySelector('[data-testid="billing-cycle-yearly"]') as HTMLElement;
    expect(monthly).not.toBeNull();
    expect(yearly).not.toBeNull();
    expect(prices()).toEqual(["59", "119", "229"]);
    expect(hrefs().every((href) => href && !/cycle=yearly/.test(href))).toBe(true);

    await act(async () => yearly.click());
    expect(prices()).toEqual(["590", "1190", "2290"]);
    expect(
      hrefs().map((href) => /plan=(starter|professional|enterprise)/.test(href ?? ""))
    ).toEqual([true, true, true]);
    expect(hrefs().every((href) => /cycle=yearly/.test(href ?? ""))).toBe(true);

    await act(async () => monthly.click());
    expect(prices()).toEqual(["59", "119", "229"]);
  });

  it("links the full plan comparison to #plan-matrix on the current page in the current language", async () => {
    const { PricingPage } =
      await import("../../client/src/components/marketing/phase/pages/PricingPage");
    await render(locale, "/pricing", async () => createElement(PricingPage, sectionProps(locale)));
    const link = container.querySelector('[data-testid="link-price-matrix"]');
    expect(link?.getAttribute("href")).toBe(`/${locale}/pricing#plan-matrix`);
    expect(container.querySelector("#plan-matrix")).not.toBeNull();
  });
});

describe("catalog", () => {
  it("keeps the new pricing copy free of Eastern Arabic digits and provider names", () => {
    for (const [key, value] of Object.entries(arMarketing)) {
      if (!/^marketing\.hx(Price|Faq|Cta|Foot)/.test(key)) continue;
      expect(value, key).not.toMatch(/[٠-٩]/);
      expect(value, key).not.toMatch(PROVIDERS);
    }
    for (const [key, value] of Object.entries(enMarketing)) {
      if (!/^marketing\.hx(Price|Faq|Cta|Foot)/.test(key)) continue;
      expect(value, key).not.toMatch(PROVIDERS);
    }
  });
});
