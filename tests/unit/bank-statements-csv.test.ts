// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it } from "vitest";
import { ActiveCompanyProvider } from "../../client/src/components/ActiveCompanyProvider";
import { loadLocale, useI18n, t } from "../../client/src/lib/i18n";
import BankFeeds from "../../client/src/pages/BankFeeds";
import { findPublicBankingMention, publicBankingCopy } from "../e2e/lib/public-banking-copy.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const labels = {
  en: { title: "CSV bank statements", action: "Upload a CSV statement" },
  ar: { title: "كشوف الحساب البنكي بصيغة CSV", action: "ارفع كشف حساب بصيغة CSV" },
};

describe("signed-in bank statement entry point", () => {
  it.each(["en", "ar"] as const)(
    "offers the %s CSV workflow while provider status loads and after it is configured",
    async (locale) => {
      const companyId = "company-1";
      const providerKey = ["/api/bank/providers"];
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(["/api/companies"], [{ id: companyId, name: "Fixture company" }]);
      client.setQueryData(
        ["/api/companies", companyId, "bank-accounts"],
        [
          { id: "connected", nameEn: "Connected account" },
          { id: "unconnected", nameEn: "Unconnected account" },
        ]
      );
      client.setQueryData(
        ["/api/companies", companyId, "bank-connections"],
        [{ id: "connection-1", bankAccountId: "connected", provider: "wio", status: "active" }]
      );
      const configured = { providers: ["wio"] };
      let resolveStatus!: (value: typeof configured) => void;
      const providerStatus = new Promise<typeof configured>((resolve) => {
        resolveStatus = resolve;
      });
      const loading = client.fetchQuery({ queryKey: providerKey, queryFn: () => providerStatus });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const previousLocale = useI18n.getState().locale;

      function expectOnlyCsvWorkflow() {
        const expected = labels[locale];
        expect(container.querySelector("h1")?.textContent).toBe(expected.title);
        expect(container.textContent).toContain(publicBankingCopy[locale].answer);
        const actions = [...container.querySelectorAll("a,button")];
        expect(actions.map((action) => action.textContent?.trim())).toEqual([expected.action]);
        expect(actions[0]?.getAttribute("href")).toBe("/bank-reconciliation?import=1");
        const texts = [...container.querySelectorAll("*")].map(
          (node) => node.textContent?.trim() ?? ""
        );
        const navigationLabel = t[locale]["shell.nav.banking"];
        expect(navigationLabel).toBeTruthy();
        expect(
          [...texts, navigationLabel].map(findPublicBankingMention).find(Boolean)
        ).toBeUndefined();
      }

      try {
        await act(async () => {
          useI18n.getState().setLocale(locale);
          root.render(
            createElement(
              QueryClientProvider,
              { client },
              createElement(ActiveCompanyProvider, null, createElement(BankFeeds))
            )
          );
        });
        expect(client.getQueryState(providerKey)?.fetchStatus).toBe("fetching");
        expectOnlyCsvWorkflow();

        await act(async () => {
          resolveStatus(configured);
          await loading;
        });
        expect(client.getQueryData(providerKey)).toEqual(configured);
        expectOnlyCsvWorkflow();
      } finally {
        resolveStatus(configured);
        await loading;
        await act(async () => {
          root.unmount();
          useI18n.getState().setLocale(previousLocale);
        });
        container.remove();
        client.clear();
      }
    }
  );
});
