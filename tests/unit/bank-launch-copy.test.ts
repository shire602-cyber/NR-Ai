// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import arOnboarding from "../../client/src/locales/ar/onboarding.json";
import arErrors from "../../client/src/locales/ar/serverErrors.json";
import enOnboarding from "../../client/src/locales/en/onboarding.json";
import enErrors from "../../client/src/locales/en/serverErrors.json";
import BankFeeds from "../../client/src/pages/BankFeeds";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: undefined }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const languages = [
  {
    locale: "en",
    copy: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    onboarding: enOnboarding,
    errors: enErrors,
  },
  {
    locale: "ar",
    copy: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    onboarding: arOnboarding,
    errors: arErrors,
  },
] as const;

beforeAll(async () => {
  await Promise.all(languages.map(({ locale }) => loadLocale(locale)));
});

describe("CSV-only bank reconciliation copy", () => {
  it.each(languages)(
    "offers CSV import when a bank provider is unconfigured in $locale",
    async ({ locale, copy, errors, onboarding }) => {
      const previousLocale = useI18n.getState().locale;
      useI18n.setState({ locale });
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(["/api/bank/providers"], {
        isConfigured: false,
        statuses: [],
        redirectUris: [],
      });
      const element = document.createElement("div");
      const root = createRoot(element);
      try {
        await act(async () => {
          root.render(createElement(QueryClientProvider, { client }, createElement(BankFeeds)));
        });
        expect(Array.from(element.querySelectorAll("p"), (p) => p.textContent)).toContain(copy);
        expect(
          element
            .querySelector('[data-testid="button-feeds-import-statement"]')
            ?.getAttribute("href")
        ).toBe("/bank-reconciliation?import=1");
        expect(element.textContent).not.toMatch(/live (?:bank )?feeds?|الربط البنكي المباشر/i);
        expect(errors["serverErrors.BANK_FEED_NOT_CONFIGURED"]).toBe(copy);
        expect(onboarding["onboarding.bankCardDesc"]).toBe(copy);
      } finally {
        act(() => root.unmount());
        client.clear();
        useI18n.setState({ locale: previousLocale });
      }
    }
  );
});
