// @vitest-environment jsdom
/**
 * D1: public site (landing, pricing, auth, legal) on the shared marketing shell.
 * Behaviour tests: render the real pages in jsdom and check what a visitor gets:
 * per-route SEO meta, a complete Arabic rendering, honest VAT copy, consistent
 * sample figures, and a light/dark theme that does not leak into the app.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
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
  /(?:connect to|sync from) (?:a |your )?(?:live )?bank\s+feeds?/i,
  /money-back/i,
  /UAE-hosted/i,
  // "Most popular" is a plan-card highlight the owner asked for (X6b); it states no user count.
  /trusted by/i,
  /SOC 2 (Type II )?(certified|compliant)/i,
];

it.each([
  ["en", "ltr"],
  ["ar", "rtl"],
] as const)(
  "opens CSV import from the legacy banking URL in %s",
  async (locale, direction) => {
    const originalUrl = window.location.href;
    const { queryClient } = await import("../../client/src/lib/queryClient");
    try {
      window.history.replaceState(null, "", "/bank-feeds");
      await setLocale(locale);
      queryClient.setQueryData(["/api/auth/me"], {
        id: "owner",
        userType: "customer",
      });
      const companies = [{ id: "company", name: "Test Company", onboardingCompleted: true }];
      queryClient.setQueryData(["/api/companies"], companies);
      queryClient.setQueryData(["/api/companies", "company", "billing", "subscription"], {
        trialLocked: false,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          Response.json(String(input).endsWith("/api/companies") ? companies : [])
        )
      );
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        }))
      );

      const [{ default: App }] = await Promise.all([
        import("../../client/src/App"),
        import("../../client/src/pages/BankReconciliation"),
      ]);
      await act(async () => root.render(createElement(App)));
      await vi.waitFor(
        async () => {
          await act(async () => {});
          expect(window.location.pathname + window.location.search).toBe(
            "/bank-reconciliation?import=1"
          );
          expect(document.documentElement.dir).toBe(direction);
          const dialog = document.querySelector('[role="dialog"]');
          expect(dialog).not.toBeNull();
          expect(dialog?.textContent).toContain(BANK_RECONCILIATION_COPY[locale]);
        },
        { timeout: 4000 }
      );
    } finally {
      act(() => root.render(null));
      queryClient.clear();
      vi.unstubAllGlobals();
      window.history.replaceState(null, "", originalUrl);
    }
  },
  15000
);

describe("D1 public site", () => {
  it("[D1] the landing page leads with an honest value proposition and sets its SEO meta", async () => {
    const { default: PhaseSite } =
      await import("../../client/src/components/marketing/phase/PhaseSite");
    await act(async () => root.render(createElement(PhaseSite)));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Your books. Your VAT. Your e-invoices. Done.");
    expect(document.title).toContain(h1?.textContent);
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute("content")
    ).toContain("Bilingual tax invoices, AI receipt capture");
    // Primary CTAs keep their routes.
    const register = container.querySelector('[data-testid="button-hero-start"]');
    expect(register?.getAttribute("href")).toBe("/register?step=account");
    expect(container.querySelector('[data-testid="button-hero-demo"]')?.getAttribute("href")).toBe(
      "/en/book-demo"
    );
    expect(container.textContent).toContain("then submit it in EmaraTax.");
    // Every homepage section is present, under its own stable anchor.
    for (const id of [
      "announcement",
      "hero",
      "e-invoicing-deadlines",
      "tour",
      "savings",
      "compare",
      "features",
      "firms",
      "trust",
      "migration",
      "pricing",
      "faq",
      "final-cta",
    ]) {
      expect(
        container.querySelector(`section#${id}[data-testid="section-${id}"]`),
        id
      ).not.toBeNull();
    }
    // No provider is named; the e-invoicing answer says it is built in and included.
    expect(container.textContent).not.toMatch(/A-?Cube|Complyance/i);
    expect(container.textContent).toContain("accredited service provider, built into");
    expect(container.textContent).toContain("Upload a CSV exported from your bank");
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
      const title = "دفاترك. ضريبتك. فواتيرك الإلكترونية. كلها منجزة.";
      expect(container.querySelector("h1")?.textContent).toBe(title);
      expect(document.title).toContain(title);
      expect(container.querySelector('.phase-site[lang="ar"][dir="rtl"]')).not.toBeNull();
      // The hero stage is lazy-loaded; wait for the live stage to replace its placeholder.
      for (let i = 0; i < 30 && !container.querySelector('[data-testid="hero-stage"]'); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      const stage = container.querySelector('.mz-hero [data-testid="hero-stage"]');
      expect(stage?.getAttribute("role")).toBe("img");
      expect(stage?.getAttribute("aria-label")).toMatch(/[؀-ۿ]{3}/);
      expect(stage?.textContent).toContain("بيانات تجريبية");
      expect(container.querySelector(".mz-hero img")).toBeNull();
      expect(container.querySelector('a[hreflang="en"]')?.getAttribute("href")).toBe("/en");
      expect(container.textContent).toContain("عبر مزوّد خدمة معتمد مدمج في");
      expect(container.textContent).not.toMatch(/A-?Cube|Complyance/i);
      expect(container.textContent).toContain("ارفع كشف حسابك البنكي بصيغة CSV");
      expect(container.querySelector('a[href="/ar/migration-guides/zoho"] bdi')?.textContent).toBe(
        "Zoho Books"
      );
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

  it.each([
    [
      "en",
      "read-only",
      "UAE e-invoicing is built in and included on every plan, delivered through an accredited service provider.",
    ],
    [
      "ar",
      "للقراءة فقط",
      "الفوترة الإلكترونية في الإمارات مدمجة ومشمولة في كل باقة، وتُنفَّذ عبر مزوّد خدمة معتمد.",
    ],
  ] as const)(
    "explains trial expiry and included e-invoicing in %s pricing",
    async (locale, lock, einvoicing) => {
      await setLocale(locale);
      await render("Pricing");
      expect(container.textContent).toContain(lock);
      expect(container.textContent).toContain(einvoicing);
      expect(container.textContent).not.toMatch(/A-?Cube|Complyance/i);
    }
  );
});
