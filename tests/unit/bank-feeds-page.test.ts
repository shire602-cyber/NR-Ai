// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, type QueryFunctionContext } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { reportAutomationStarters } from "../../client/src/lib/reportCatalog";
import arReports from "../../client/src/locales/ar-catalog/reportCatalog.json";
import arMarketing from "../../client/src/locales/ar/marketing.json";
import arOnboarding from "../../client/src/locales/ar/onboarding.json";
import arErrors from "../../client/src/locales/ar/serverErrors.json";
import enMarketing from "../../client/src/locales/en/marketing.json";
import enOnboarding from "../../client/src/locales/en/onboarding.json";
import enErrors from "../../client/src/locales/en/serverErrors.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const localeCases = [
  {
    locale: "en",
    statements: "CSV bank statements",
    importAction: "Upload a CSV statement",
  },
  {
    locale: "ar",
    statements: "كشوف الحساب البنكي بصيغة CSV",
    importAction: "ارفع كشف حساب بصيغة CSV",
  },
] as const;

async function mountPage(
  locale: "en" | "ar",
  queryFn: (context: QueryFunctionContext) => Promise<unknown>,
  check: (node: HTMLDivElement) => void | Promise<void>
) {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn, retry: false } } });
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  try {
    window.history.replaceState({}, "", "/bank-feeds");
    await act(async () => {
      useI18n.getState().setLocale(locale);
      root.render(createElement(QueryClientProvider, { client }, createElement(BankFeeds)));
    });
    await check(node);
  } finally {
    act(() => root.unmount());
    node.remove();
    client.clear();
    await act(async () => useI18n.getState().setLocale("en"));
  }
}

describe.each(localeCases)("signed-in bank page ($locale)", (copy) => {
  it.each([false, true])(
    "offers only statement import when provider configuration is %s",
    async (configured) => {
      const read = vi.fn(async ({ queryKey }: QueryFunctionContext) => {
        if (queryKey[0] === "/api/bank/providers")
          return {
            isConfigured: configured,
            statuses: [{ id: "lean", label: "Lean", configured, status: "sandbox" }],
            redirectUris: [],
          };
        if (queryKey[2] === "bank-accounts")
          return [{ id: "linked", nameEn: "Operating account", nameAr: "الحساب التشغيلي" }];
        return [
          { id: "connection-1", provider: "lean", bankAccountId: "linked", status: "active" },
        ];
      });
      await mountPage(copy.locale, read, (node) => {
        const link = node.querySelector('[data-testid="button-feeds-import-statement"]');
        expect(link?.getAttribute("href")).toBe("/bank-reconciliation?import=1");
        expect(link?.textContent).toBe(copy.importAction);
        expect(node.querySelector("h1")?.textContent).toBe(copy.statements);
        expect(document.title).toBe(copy.statements);
        expect(node.querySelectorAll("button")).toHaveLength(0);
        expect(node.textContent).not.toMatch(/bank\s+feeds?|bank connections|الربط\s+البنكي/i);
        expect(read).not.toHaveBeenCalled();
      });
    }
  );
});

describe("statement-only banking guidance", () => {
  it.each([
    { locale: "en", marketing: enMarketing, onboarding: enOnboarding, errors: enErrors },
    { locale: "ar", marketing: arMarketing, onboarding: arOnboarding, errors: arErrors },
  ])("directs $locale users to CSV from onboarding, help and older bank links", (copy) => {
    expect(copy.onboarding["onboarding.bankCardDesc"]).toContain("CSV");
    expect(copy.onboarding["onboarding.bankConnectedDescription"]).toContain("CSV");
    expect(copy.onboarding["onboarding.bankAddDescription"]).toContain("CSV");
    expect(copy.marketing["marketing.faq3Q"]).toMatch(/bank account|حسابي البنكي/i);
    expect(copy.marketing["marketing.faq3A"]).toContain("CSV");
    for (const key of [
      "serverErrors.BANK_CONNECTION_NOT_FOUND",
      "serverErrors.BANK_FEED_ACCOUNT_NOT_LINKED",
      "serverErrors.BANK_FEED_NOT_CONFIGURED",
      "serverErrors.BANK_FEED_NOT_SUPPORTED",
      "serverErrors.BANK_FEED_NO_ACCOUNTS",
      "serverErrors.BANK_FEED_PROVIDER_ERROR",
      "serverErrors.BANK_FEED_RECONNECT_REQUIRED",
      "serverErrors.BANK_FEED_UNKNOWN_PROVIDER",
      "serverErrors.INVALID_OAUTH_STATE",
      "serverErrors.REDIRECT_URI_NOT_ALLOWED",
    ] as const) {
      expect(copy.errors[key], key).toContain("CSV");
    }
  });

  it("uses imported bank statements for the cash report in both languages", () => {
    const starter = reportAutomationStarters.find(({ id }) => id === "owner-cash-control-autopilot");
    expect(starter?.setupSteps[0]).toContain("CSV");
    expect(arReports["reportCatalog.starter.owner-cash-control-autopilot.setupSteps.0"]).toContain(
      "CSV"
    );
  });
});
