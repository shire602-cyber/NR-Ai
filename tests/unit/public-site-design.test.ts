// @vitest-environment jsdom
/**
 * D1: public site (landing, pricing, auth, legal) on the shared marketing shell.
 * Behaviour tests: render the real pages in jsdom and check what a visitor gets:
 * per-route SEO meta, a complete Arabic rendering, honest VAT copy, consistent
 * sample figures, and a light/dark theme that does not leak into the app.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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
  BankFeeds: () => import("../../client/src/pages/BankFeeds"),
};

async function render(page: keyof typeof PAGES) {
  const mod = await PAGES[page]();
  await act(async () => root.render(createElement(mod.default)));
}

async function renderBanking(client: QueryClient) {
  const { ActiveCompanyProvider } = await import("../../client/src/components/ActiveCompanyProvider");
  const { default: BankFeeds } = await PAGES.BankFeeds();
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client },
        createElement(ActiveCompanyProvider, { children: createElement(BankFeeds) })
      )
    );
  });
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
  ["en", "CSV bank statements", "Upload a CSV statement", "ltr"],
  ["ar", "كشوف الحساب البنكي بصيغة CSV", "ارفع كشف حساب بصيغة CSV", "rtl"],
] as const)(
  "offers CSV statement upload on the legacy banking page in %s",
  async (locale, title, cta, dir) => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/bank-feeds");
    try {
      await setLocale(locale);
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(["/api/companies"], []);
      await renderBanking(client);
      expect(document.documentElement.dir).toBe(dir);
      expect(container.querySelector("h1")?.textContent).toBe(title);
      const link = container.querySelector('[data-testid="button-feeds-import-statement"]');
      expect(link?.textContent).toBe(cta);
      expect(link?.getAttribute("href")).toBe("/bank-reconciliation?import=1");
      expect(container.textContent).not.toMatch(/\bbank\s+feeds?\b|الربط\s+البنكي/i);
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  }
);

const recoveryConnection = {
  id: "linked-account",
  provider: "lean",
  status: "error",
  hasToken: true,
  bankAccountId: "bank-account",
  accountName: "Current account",
};
const recoveryQueryKey = ["/api/companies", "workspace", "bank-connections"];

function recoveryClient(
  permissions: string[],
  providers: string[],
  queryFn = async () => [{ ...recoveryConnection, status: "active" }]
) {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn, staleTime: Infinity } } });
  client.setQueryData(["/api/companies"], [{ id: "workspace" }]);
  client.setQueryData(["/api/companies", "workspace", "team", "me"], { permissions });
  client.setQueryData(["/api/bank/providers"], { providers });
  client.setQueryData(recoveryQueryKey, [
    recoveryConnection,
    { ...recoveryConnection, id: "csv-only", provider: "manual" },
    { ...recoveryConnection, id: "disconnected", status: "disconnected" },
  ]);
  return client;
}

it.each([
  ["en", "Retry refresh"],
  ["ar", "أعد محاولة التحديث"],
] as const)("retries the failed bank connection and refreshes the page in %s", async (locale, label) => {
  await setLocale(locale);
  const requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (String(url).endsWith("/api/csrf-token")) return Response.json({ csrfToken: "test-csrf" });
    expect(String(url)).toBe("/api/bank-connections/linked-account/sync");
    expect(options?.method).toBe("POST");
    return Response.json({ imported: 2 });
  });
  const reload = vi.fn(async () => [{ ...recoveryConnection, status: "active" }]);
  const client = recoveryClient(["documents.write"], ["lean"], reload);
  const statementKey = ["/api/companies", "workspace", "bank-statements", "transactions"];
  client.setQueryData(statementKey, []);
  await renderBanking(client);

  const buttons = container.querySelectorAll<HTMLButtonElement>("button");
  expect([...buttons].map((button) => button.textContent)).toEqual([label]);
  await act(async () => {
    buttons[0].click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector("button")).toBeNull();
  });
  expect(requests).toHaveBeenCalledWith(
    "/api/bank-connections/linked-account/sync",
    expect.objectContaining({ method: "POST" })
  );
  expect(client.getQueryState(statementKey)?.isInvalidated).toBe(true);
});

it.each([
  { permissions: ["reports.read"], providers: ["lean"] },
  { permissions: ["documents.write"], providers: ["wio"] },
])("offers only CSV upload when retry is unavailable (%j)", async ({ permissions, providers }) => {
  await renderBanking(recoveryClient(permissions, providers));
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector('[href="/bank-reconciliation?import=1"]')).not.toBeNull();
});

describe("D1 public site", () => {
  it("[D1] the landing page leads with an honest value proposition and sets its SEO meta", async () => {
    const { default: PhaseSite } =
      await import("../../client/src/components/marketing/phase/PhaseSite");
    await act(async () => root.render(createElement(PhaseSite)));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Accounting and VAT for UAE businesses");
    expect(document.title).toContain(h1?.textContent);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toContain(
      "Send bilingual invoices"
    );
    // Primary CTAs keep their routes.
    const register = container.querySelector('[data-testid="button-hero-start"]');
    expect(register?.getAttribute("href")).toBe("/register");
    expect(container.querySelector('[data-testid="button-hero-demo"]')?.getAttribute("href")).toBe(
      "/en/book-a-demo"
    );
    expect(container.textContent).toContain("Prepare and review VAT 201 in the app, then submit it in EmaraTax.");
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
      const title = "المحاسبة وضريبة القيمة المضافة للشركات في الإمارات";
      expect(container.querySelector("h1")?.textContent).toBe(title);
      expect(document.title).toContain(title);
      expect(container.querySelector('.phase-site[lang="ar"][dir="rtl"]')).not.toBeNull();
      expect(container.querySelector(".phase-hero img")?.getAttribute("src")).toBe(
        "/product/dashboard-ar.webp"
      );
      expect(container.querySelector('a[hreflang="en"]')?.getAttribute("href")).toBe("/en");
      expect(container.textContent).toContain("مزوّد خدمة معتمد واحد لكل نسخة من التطبيق");
      expect(container.textContent).toContain("ارفع كشف حسابك البنكي بصيغة CSV");
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
