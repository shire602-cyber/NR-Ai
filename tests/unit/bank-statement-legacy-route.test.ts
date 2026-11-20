// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import BankFeeds from "../../client/src/pages/BankFeeds";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "test-company" }),
}));

describe("Legacy bank route", () => {
  it.each(["en", "ar"] as const)(
    "offers CSV reconciliation in %s even with a configured provider",
    async (locale) => {
      await loadLocale(locale);
      useI18n.getState().setLocale(locale);
      const client = new QueryClient();
      client.setQueryData(["/api/bank/providers"], {
        isConfigured: true,
        statuses: [{ id: "lean", label: "Lean Technologies", configured: true, status: "live" }],
        redirectUris: [],
      });
      client.setQueryData(
        ["/api/companies", "test-company", "bank-accounts"],
        [{ id: "account", nameEn: "Bank account", nameAr: "حساب بنكي" }]
      );
      client.setQueryData(
        ["/api/companies", "test-company", "bank-connections"],
        [{ id: "connection", bankAccountId: "account", provider: "lean", status: "active" }]
      );
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(createElement(QueryClientProvider, { client }, createElement(BankFeeds)));
        });
        expect(container.textContent).toContain(BANK_RECONCILIATION_COPY[locale]);
        expect(container.querySelector("a")?.getAttribute("href")).toBe(
          "/bank-reconciliation?import=1"
        );
        expect(container.textContent).not.toMatch(
          /Bank feeds|Sync now|Lean Technologies|الربط البنكي|مزامنة الآن/i
        );
      } finally {
        act(() => root.unmount());
        client.clear();
      }
    }
  );
});
