// @vitest-environment jsdom
/**
 * STEP3: the unused admin price editor (Pricing tab, /api/admin/plans, subscription_plans) and the
 * Settings fields the server never reads (trial period, free AI credits, default currency / VAT)
 * are gone. Renders the real Admin page in English and Arabic and reads back what an NR admin sees.
 * Plan prices themselves are asserted in trial-pricing.test.ts (/pricing, /subscription) and in
 * tests/db/step3-price-editor-removed.test.ts (GET /api/billing/plans).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, "../..");
let container: HTMLDivElement;
let root: Root;
let calls: Array<{ method: string; url: string }> = [];
let usersPayload: unknown[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const COMPANY = {
  id: "c1",
  name: "Acme Trading",
  createdAt: "2026-01-01T00:00:00Z",
  isActive: true,
};

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls = [];
  usersPayload = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), url });
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (url.includes("/api/admin/companies")) return json([COMPANY]);
      if (url.includes("/api/admin/users")) return json(usersPayload);
      if (url.includes("/api/admin/stats")) return json({});
      if (url.includes("/api/admin/integrations/status"))
        return json({
          stripe: { configured: false },
          openai: { configured: false },
          googleSheets: { configured: false },
        });
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function openTab(id: string) {
  const trigger = byId(id);
  expect(trigger, id).not.toBeNull();
  await act(async () => {
    // Radix Tabs activates on mousedown.
    trigger!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger!.focus();
  });
  await flush();
}

const GONE: Record<"en" | "ar", string[]> = {
  en: [
    "Pricing",
    "Subscription plans",
    "Add plan",
    "Monthly price",
    "Yearly price",
    "Trial period",
    "Default currency",
    "Default VAT rate",
    "credits per free user",
  ],
  ar: ["الأسعار", "خطط الاشتراك", "إضافة خطة", "السعر الشهري", "السعر السنوي"],
};

describe.each(["en", "ar"] as const)("STEP3: Admin console (%s)", (locale) => {
  async function mountAdmin() {
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale(locale));
    const { queryClient } = await import("../../client/src/lib/queryClient");
    queryClient.clear();
    const { default: Admin } = await import("../../client/src/pages/Admin");
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Admin))
      );
    });
    await flush();
  }

  it("has exactly the four tabs and no Pricing or Settings tab", async () => {
    await mountAdmin();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((el) =>
      el.getAttribute("data-testid")
    );
    expect(tabs).toEqual(["tab-overview", "tab-users", "tab-integrations", "tab-audit"]);
    expect(byId("tab-pricing")).toBeNull();
    expect(byId("tab-settings")).toBeNull();
  });

  it("shows no price-editor or no-op settings text on any tab, and requests no /api/admin/plans", async () => {
    await mountAdmin();
    for (const tab of ["overview", "users", "integrations", "audit"]) {
      await openTab(`tab-${tab}`);
      const text = container.textContent ?? "";
      for (const gone of GONE[locale]) expect(text, `${tab}: ${gone}`).not.toContain(gone);
    }
    // The no-op Settings cards (feature toggles, notification settings) are gone with their tab.
    for (const id of [
      "input-trial-period",
      "input-free-ai-credits",
      "input-vat-rate",
      "select-default-currency",
      "button-save-system-settings",
      "switch-ai-categorization",
      "input-support-email",
      "input-from-email",
      "select-user-filter",
    ]) {
      expect(byId(id), id).toBeNull();
    }
    await act(async () => byId("button-refresh")!.click());
    await flush();
    expect(calls.filter((c) => c.url.includes("/api/admin/plans"))).toEqual([]);
    // The page no longer reads or writes admin_settings (the server keeps the route for
    // WhatsApp rules and AI-GL).
    expect(calls.filter((c) => c.url.includes("/api/admin/settings"))).toEqual([]);
  });

  it("the Users tab shows each user's own company count and no fake Status column", async () => {
    usersPayload = [
      {
        id: "u1",
        name: "Solo",
        email: "solo@x.test",
        createdAt: "2026-01-01T00:00:00Z",
        companyCount: 1,
      },
      {
        id: "u2",
        name: "Many",
        email: "many@x.test",
        createdAt: "2026-01-01T00:00:00Z",
        companyCount: 3,
      },
    ];
    await mountAdmin();
    await openTab("tab-users");
    const rows = [...container.querySelectorAll("tbody tr")].filter((r) =>
      /solo@x\.test|many@x\.test/.test(r.textContent ?? "")
    );
    expect(rows).toHaveLength(2);
    const { translateNow, formatMessage } = await import("../../client/src/lib/i18n");
    const label = (n: number) =>
      formatMessage(translateNow("adminConsole.companiesCount"), { count: n });
    expect(rows[0].textContent).toContain(label(1));
    expect(rows[0].textContent).not.toContain(label(3));
    expect(rows[1].textContent).toContain(label(3));
    const heads = [...container.querySelectorAll("th")].map((e) => e.textContent);
    expect(heads).not.toContain(translateNow("banking.common.status"));
    expect(byId("select-user-filter")).toBeNull();
  });

  it("the company dialog still hosts the plan control with the three paid plans", async () => {
    await mountAdmin();
    await openTab("tab-users");
    // Companies are listed on the Users tab.
    const view = byId("button-view-company-c1");
    expect(view).not.toBeNull();
    await act(async () => view!.click());
    await flush();
    const control = document.body.querySelector('[data-testid="admin-plan-control"]');
    expect(control).not.toBeNull();
    const { translateNow } = await import("../../client/src/lib/i18n");
    expect(control!.textContent).toContain(translateNow("adminConsole.planTitle"));
    expect(document.body.querySelector('[data-testid="admin-plan-apply"]')).not.toBeNull();
  });
});

describe("STEP3: catalogs", () => {
  const REMOVED: Record<string, string[]> = {
    pages: ["pages.pricing", "pages.settings"],
    toasts: ["toasts.failedToSaveSettings", "toasts.pleaseTryAgain2"],
    pageLabels: [
      "subscriptionPlans",
      "addPlan",
      "createNewPlan",
      "addANewSubscriptionPlanForYourCustomers",
      "maxCompanies",
      "maxUsers",
      "editPlan",
      "modifySubscriptionPlanDetails",
      "planName",
      "monthlyPrice",
      "yearlyPrice",
      "advancedReports",
      "aPIAccess",
      "systemSettings",
      "configurePlatformWideSettings",
      "defaultCurrency",
      "aICreditsPerFreeUser",
      "aITransactionCategorization",
      "allUsers",
      "configureEmailAndNotificationPreferences",
      "emailNewUsersUponRegistration",
      "enableOrDisablePlatformFeatures",
      "enableUserReferralRewards",
      "extractDataFromReceiptImages",
      "featureToggles",
      "naturalLanguageFinancialQueries",
      "notificationSettings",
      "oCRReceiptScanning",
      "paymentReminderEmails",
      "referralProgram",
      "saveNotificationSettings",
      "sendLatePaymentReminders",
      "sendWelcomeEmail",
      "smartAssistant",
      "supportEmail",
      "useAIToAutomaticallyCategorizeTransactions",
    ].map((k) => `pageLabels.${k}`),
    adminConsole: [
      "admin.noSubscriptionPlansConfiguredAdd",
      "admin.planCreatedSuccessfully",
      "admin.planUpdatedSuccessfully",
      "admin.planDeletedSuccessfully",
      "admin.failedToCreatePlan",
      "admin.failedToUpdatePlan",
      "admin.failedToDeletePlan",
      "adminConsole.aiCreditsPerMonth",
      "adminConsole.unlimited",
      "adminConsole.savePlan",
      "adminConsole.defaultVatRate",
      "adminConsole.trialPeriodDays",
      "adminConsole.curAED",
      "adminConsole.curUSD",
      "adminConsole.curEUR",
      "adminConsole.curGBP",
      "admin.failedToUpdateSetting",
      "admin.filterByStatus",
      "admin.settingUpdatedSuccessfully",
      "admin.systemSettingsSavedSuccessfully",
      "adminConsole.fromEmail",
    ],
  };
  const load = (lang: string, ns: string) =>
    JSON.parse(
      readFileSync(path.join(ROOT, `client/src/locales/${lang}/${ns}.json`), "utf8")
    ) as Record<string, string>;

  it.each(Object.keys(REMOVED))(
    "%s: removed keys are gone in en and ar, key sets still match",
    (ns) => {
      const en = load("en", ns);
      const ar = load("ar", ns);
      for (const k of REMOVED[ns]) {
        expect(k in en, `en ${k}`).toBe(false);
        expect(k in ar, `ar ${k}`).toBe(false);
      }
      expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    }
  );
});

describe("STEP3: no second price source", () => {
  // Source inspection on purpose: "nothing in the codebase reads a DB price" cannot be enumerated
  // by a behaviour test; this fails the moment a plans table or editor route is reintroduced.
  const FORBIDDEN =
    /subscription_plans|subscriptionPlans|user_subscriptions|\/api\/admin\/plans|priceMonthly/;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (n === "locales") return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });

  it("no file under server/, shared/ or client/src mentions the removed price editor", () => {
    const hits = ["server", "shared", "client/src"]
      .flatMap((d) => walk(path.join(ROOT, d)))
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
