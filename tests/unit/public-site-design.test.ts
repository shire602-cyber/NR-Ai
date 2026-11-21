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
import {
  bankingDescriptionSelectors,
  publicBankFeedMentions,
  publicBankingCopy,
} from "../e2e/lib/public-banking-copy.mjs";

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
  HelpCenter: () => import("../../client/src/pages/HelpCenter"),
  TrustSecurity: () => import("../../client/src/pages/TrustSecurity"),
  MigrationGuides: () => import("../../client/src/pages/MigrationGuides"),
  DemoWorkspace: () => import("../../client/src/pages/DemoWorkspace"),
  Services: () => import("../../client/src/pages/Services"),
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
  ...publicBankFeedMentions,
  /money-back/i,
  /UAE-hosted/i,
  // "Most popular" is a plan-card highlight the owner asked for (X6b); it states no user count.
  /trusted by/i,
  /SOC 2 (Type II )?(certified|compliant)/i,
];

function expectNoBankFeedMention() {
  const copy = [...container.querySelectorAll("*")].map((node) => node.textContent ?? "");
  for (const selector of bankingDescriptionSelectors) {
    copy.push(document.head.querySelector(selector)?.getAttribute("content") ?? "");
  }
  for (const pattern of publicBankFeedMentions) {
    expect(copy.find((text) => pattern.test(text))).toBeUndefined();
  }
}

describe("public bank wording gate", () => {
  it.each([
    "Bank feeds",
    "We do not support live bank feeds.",
    "Bank-feed support is coming later.",
    "Keep your books up to date with bank feeds.",
    "Bank-feed-based reconciliation is unavailable.",
    "Bank feeds—coming soon.",
    "Banking feeds",
    "CSV statement import, no live feed needed",
    "Live feeds",
    "Open banking is coming soon.",
    "الربط البنكي",
    "الربط البنكي المباشر غير متاح.",
    "سيتوفر الربط البنكي لاحقًا.",
    "لا ندعم التغذية المصرفية.",
    "الخلاصة البنكية غير متاحة.",
    "مزامنة الحسابات البنكية",
    "الخدمات المصرفية المفتوحة غير متاحة.",
    "استيراد كشف CSV دون الحاجة إلى ربط مباشر",
    "عنوان إعادة التوجيه غير مسموح به للربط البنكي.",
  ])("rejects bank-feed prose in a label, claim, or denial: %s", (text) => {
    expect(publicBankFeedMentions.some((pattern) => pattern.test(text))).toBe(true);
  });

  it.each([
    publicBankingCopy.en.answer,
    publicBankingCopy.ar.answer,
    "Browse live social feeds and exchange rate feeds.",
    "اربط حساب البنك بدليل الحسابات أو استورد كشفًا بصيغة CSV.",
    "/bank-feeds/callback",
    "BANK_FEED_NOT_CONFIGURED",
    "bank_feed_wio",
    "bankFeeds.sync",
  ])("accepts CSV guidance, unrelated feeds and technical identifiers: %s", (text) => {
    expect(publicBankFeedMentions.some((pattern) => pattern.test(text))).toBe(false);
  });
});

describe("D1 public site", () => {
  it.each(["en", "ar"] as const)(
    "keeps the %s banking FAQ, product and metadata CSV-focused",
    async (locale) => {
      const { default: PhaseRoot } =
        await import("../../client/src/components/marketing/phase/PhaseRoot");
      const previousUrl = window.location.href;
      const { question, answer } = publicBankingCopy[locale];
      try {
        window.history.replaceState(null, "", `/${locale}`);
        await act(async () => root.render(createElement(PhaseRoot)));
        const faq = [...container.querySelectorAll("details")].find(
          (details) => details.querySelector("summary")?.textContent?.trim() === question
        );
        expect(faq?.querySelector("p")?.textContent).toBe(answer);
        const { t } = await import("../../client/src/lib/i18n");
        expect(t[locale]["marketing.faq3A"]).toBe(answer);
        expect(t[locale]["pageLabels.cSVStatementImportNoLiveFeedNeeded"]).toBe(answer);
        expect(t[locale]["banking.feeds.unavailableBody"]).toBe(answer);
        expect(t[locale]["serverErrors.BANK_FEED_NOT_CONFIGURED"]).toBe(answer);
        const redirectHint = t[locale]["serverErrors.REDIRECT_URI_NOT_ALLOWED"];
        expect(redirectHint).toContain("CSV");
        for (const mention of publicBankFeedMentions) {
          expect(redirectHint).not.toMatch(mention);
        }
        expectNoBankFeedMention();

        await act(async () =>
          window.history.pushState(null, "", `/${locale}/product/bank-reconciliation`)
        );
        expect(container.querySelector(".phase-lead")?.textContent).toBe(answer);
        for (const selector of bankingDescriptionSelectors) {
          expect(document.head.querySelector(selector)?.getAttribute("content")).toBe(answer);
        }
        expectNoBankFeedMention();
      } finally {
        window.history.replaceState(null, "", previousUrl);
      }
    }
  );

  it("[D1] the landing page leads with an honest value proposition and sets its SEO meta", async () => {
    const { default: PhaseSite } =
      await import("../../client/src/components/marketing/phase/PhaseSite");
    await act(async () => root.render(createElement(PhaseSite)));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Accounting and VAT for UAE businesses");
    expect(document.title).toContain(h1?.textContent);
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute("content")
    ).toContain("Send bilingual invoices");
    // Primary CTAs keep their routes.
    const register = container.querySelector('[data-testid="button-hero-start"]');
    expect(register?.getAttribute("href")).toBe("/register");
    expect(container.querySelector('[data-testid="button-hero-demo"]')?.getAttribute("href")).toBe(
      "/en/book-a-demo"
    );
    expect(container.textContent).toContain(
      "Prepare and review VAT 201 in the app, then submit it in EmaraTax."
    );
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
    const { default: PhaseRoot } =
      await import("../../client/src/components/marketing/phase/PhaseRoot");
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/ar");
    try {
      await act(async () => root.render(createElement(PhaseRoot)));
      const title = "المحاسبة وضريبة القيمة المضافة للشركات في الإمارات";
      expect(container.querySelector("h1")?.textContent).toBe(title);
      expect(document.title).toContain(title);
      expect(container.querySelector('.phase-site[lang="ar"][dir="rtl"]')).not.toBeNull();
      expect(container.querySelector(".phase-hero img")?.getAttribute("src")).toBe(
        "/product/dashboard-ar.webp"
      );
      expect(container.querySelector('a[hreflang="en"]')?.getAttribute("href")).toBe("/en");
      expect(container.textContent).toContain("مزوّد خدمة معتمد واحد لكل نسخة من التطبيق");
      expect(arabicModeEnglishLines()).toEqual([]);
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
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
    // X3: Arabic mode shows the Arabic reading copy, with a notice that the English text governs.
    expect(container.querySelector("article")?.getAttribute("lang")).toBe("ar");
    expect(container.querySelector("article")?.getAttribute("dir")).toBe("rtl");
    expect(container.textContent).toContain(t.ar["marketing.legalArabicNotice"]);
    expect(container.querySelector("article")?.textContent).toContain("سياسة الخصوصية");
    expect(arabicModeEnglishLines()).toEqual([]);
  });

  it("[D1b] public pages use the app's one theme system (light / dark / system)", async () => {
    await render("MuhasibLanding");
    const html = document.documentElement;
    expect(html.classList.contains("dark")).toBe(false);
    const choose = async (option: "light" | "dark" | "system") => {
      const trigger = container.querySelector<HTMLButtonElement>(
        '[data-testid="button-theme-toggle"]'
      );
      expect(trigger, "the shared ThemeToggle is in the marketing header").not.toBeNull();
      await act(async () => {
        trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const item = document.querySelector<HTMLElement>(`[data-testid="theme-option-${option}"]`);
      expect(item, `menu offers ${option}`).not.toBeNull();
      await act(async () => item!.click());
    };
    await choose("dark");
    expect(html.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("muhasib-theme")).toBe("dark");
    await choose("system");
    expect(window.localStorage.getItem("muhasib-theme")).toBe("system");
    await choose("dark");
    act(() => root.unmount());
    root = createRoot(container);
    // One system: leaving the public site keeps the visitor's choice for the app too.
    expect(html.classList.contains("dark")).toBe(true);
    const { useTheme } = await import("../../client/src/lib/theme");
    expect(typeof useTheme).toBe("function");
    await act(async () => {
      const { setThemePreference } = await import("../../client/src/lib/theme");
      setThemePreference("light");
    });
    expect(html.classList.contains("dark")).toBe(false);
  });

  it("[D1b] help, trust, migration, demo and services render without English body copy in Arabic", async () => {
    await setLocale("ar");
    for (const page of [
      "HelpCenter",
      "TrustSecurity",
      "MigrationGuides",
      "DemoWorkspace",
      "Services",
    ] as const) {
      act(() => root.unmount());
      root = createRoot(container);
      await render(page);
      expect(arabicModeEnglishLines(), page).toEqual([]);
    }
  });

  it("[D1b] the product preview shows the post-D2 dashboard strip with shared money and status components", async () => {
    await render("MuhasibLanding");
    const preview = container.querySelector("figure.mk-app");
    expect(preview).not.toBeNull();
    const { t } = await import("../../client/src/lib/i18n");
    const labels = [...preview!.querySelectorAll(".mk-kpi__label")].map((el) => el.textContent);
    expect(labels).toEqual([
      t.en["marketing.previewKpiCash"],
      t.en["marketing.previewKpiReceivables"],
      t.en["marketing.previewKpiPayables"],
      t.en["marketing.previewKpiVat"],
    ]);
    // Amounts come from the shared Money component (".money"), not a marketing formatter.
    expect(preview!.querySelectorAll(".mk-kpi__value .money").length).toBe(4);
    expect(preview!.querySelector(".mk-kpi__value .money")?.textContent).toContain("212,480.50");
    // No certification-style badge anywhere on the landing page.
    expect(container.textContent).not.toMatch(/UAE Tax Ready/i);
  });

  it("[D1] pricing keeps the plan matrix and drops unbacked promises", async () => {
    await render("Pricing");
    const text = container.textContent ?? "";
    for (const claim of UNSUPPORTED_CLAIMS) {
      expect(text, String(claim)).not.toMatch(claim);
    }
    // WQ7: three paid plans, no Free plan card (the trial is of the top plan).
    expect(container.querySelectorAll('[data-testid^="card-plan-"]').length).toBe(3);
    expect(container.querySelector('[data-testid="button-plan-enterprise"]')?.tagName).toBe("A");
  });
});
