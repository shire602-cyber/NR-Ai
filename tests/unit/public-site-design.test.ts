// @vitest-environment jsdom
/**
 * D1: public site (landing, pricing, auth, legal) on the shared marketing shell.
 * Behaviour tests: render the real pages in jsdom and check what a visitor gets:
 * per-route SEO meta, a complete Arabic rendering, honest VAT copy, consistent
 * sample figures, and a light/dark theme that does not leak into the app.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await setLocale("en");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

const PAGES = {
  MuhasibLanding: () => import("../../client/src/pages/MuhasibLanding"),
  Pricing: () => import("../../client/src/pages/Pricing"),
  ForgotPassword: () => import("../../client/src/pages/ForgotPassword"),
  PrivacyPolicy: () => import("../../client/src/pages/PrivacyPolicy"),
};

async function render(page: keyof typeof PAGES) {
  const mod = await PAGES[page]();
  await act(async () => root.render(createElement(mod.default)));
}

/** Visible text, skipping user/sample data (translate="no") and explicitly non-Arabic islands. */
function arabicModeEnglishLines(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
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

const UNSUPPORTED_CLAIMS = [
  /FTA[-\s]?(accredited|compliant|registered|approved)/i,
  /submits? (your|the) (VAT )?return(s)? (to|with) the FTA automatically/i,
  /bank feeds?/i,
  /money-back/i,
  /UAE-hosted/i,
  /most popular/i,
  /trusted by/i,
  /SOC 2 (Type II )?(certified|compliant)/i,
];

describe("D1 public site", () => {
  it("[D1] the landing page leads with an honest value proposition and sets its SEO meta", async () => {
    await render("MuhasibLanding");
    const { t } = await import("../../client/src/lib/i18n");
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain(t.en["marketing.heroTitleLead"]);
    expect(document.title).toBe(t.en["marketing.seoHomeTitle"]);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      t.en["marketing.seoHomeDescription"]
    );
    // Primary CTAs keep their routes.
    const register = container.querySelector('[data-testid="button-hero-start"]');
    expect(register?.getAttribute("href")).toBe("/register");
    expect(container.querySelector('[data-testid="button-hero-demo"]')?.getAttribute("href")).toBe(
      "/demo"
    );
    // The FTA boundary is stated, not implied.
    expect(container.textContent).toContain(t.en["marketing.vatNote"]);
    expect(t.en["marketing.faq1A"]).toMatch(/^No\./);
    for (const claim of UNSUPPORTED_CLAIMS) {
      expect(container.textContent ?? "", String(claim)).not.toMatch(claim);
    }
  });

  it("[D1] the VAT preview adds up: box 14 = output VAT less recoverable input VAT", async () => {
    await render("MuhasibLanding");
    const rows = [...container.querySelectorAll("tr")];
    const box = (id: string) =>
      rows.find((r) => r.querySelector(".mk-boxid")?.textContent === id)?.textContent ?? "";
    expect(box("1b")).toContain("17,000.00");
    expect(box("9")).toContain("5,900.00");
    expect(box("14")).toContain("11,100.00");
  });

  it("[D1] the landing page renders fully in Arabic (no stray English copy)", async () => {
    await setLocale("ar");
    await render("MuhasibLanding");
    const { t } = await import("../../client/src/lib/i18n");
    expect(container.querySelector("h1")?.textContent).toContain(t.ar["marketing.heroTitleLead"]);
    expect(document.title).toBe(t.ar["marketing.seoHomeTitle"]);
    expect(arabicModeEnglishLines()).toEqual([]);
  });

  it("[D1] auth and legal pages share the shell in Arabic", async () => {
    await setLocale("ar");
    await render("ForgotPassword");
    expect(arabicModeEnglishLines()).toEqual([]);
    expect(container.querySelector('[data-testid="button-back-login"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await render("PrivacyPolicy");
    const { t } = await import("../../client/src/lib/i18n");
    expect(container.querySelector("h1")?.textContent).toBe(t.ar["marketing.legalPrivacyTitle"]);
    // The governing English text is marked as English, with an Arabic notice above it.
    expect(container.querySelector("article")?.getAttribute("lang")).toBe("en");
    expect(container.textContent).toContain(t.ar["marketing.legalEnglishOnly"]);
  });

  it("[D1] the theme toggle switches dark mode and the public site hands the theme back on exit", async () => {
    await render("MuhasibLanding");
    const html = document.documentElement;
    expect(html.classList.contains("dark")).toBe(false);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-theme-toggle"]'
    );
    act(() => toggle?.click());
    expect(html.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("muhasib-theme")).toBe("dark");
    act(() => toggle?.click());
    expect(html.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("muhasib-theme")).toBe("light");
    act(() => toggle?.click());
    act(() => root.unmount());
    root = createRoot(container);
    // Leaving the public site never forces dark mode onto the signed-in app.
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("[D1] pricing keeps the plan matrix and drops unbacked promises", async () => {
    await render("Pricing");
    const text = container.textContent ?? "";
    for (const claim of UNSUPPORTED_CLAIMS) {
      expect(text, String(claim)).not.toMatch(claim);
    }
    expect(container.querySelectorAll('[data-testid^="card-plan-"]').length).toBe(4);
    expect(container.querySelector('[data-testid="button-plan-enterprise"]')?.tagName).toBe("A");
  });
});
