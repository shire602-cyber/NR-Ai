// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { StatementLoadError } from "../../client/src/components/reports/StatementLoadError";
import FinancialStatements from "../../client/src/pages/FinancialStatements";
import { flushUntil } from "./helpers/form-harness";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "test-company", company: null, isLoading: false }),
}));

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocale("en");
  await loadLocale("ar");
}, 120_000);

describe("financial statements load error", () => {
  it.each([
    ["en", "Failed to load the statement.", "Try again"],
    ["ar", "تعذّر تحميل القائمة.", "حاول مرة أخرى"],
  ] as const)("announces the failure with a retry in %s", async (locale, message, retry) => {
    const prior = useI18n.getState().locale;
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      useI18n.setState({ locale });
      await act(async () => {
        root.render(
          createElement(StatementLoadError, {
            messageKey: "statements.loadFailed",
            onRetry: () => {},
          })
        );
      });
      expect(node.querySelector('[role="alert"]')).not.toBeNull();
      expect(node.textContent).toContain(message);
      expect(node.textContent).toContain(retry);
    } finally {
      await act(async () => root.unmount());
      useI18n.setState({ locale: prior });
    }
  });

  it.each(["profit-loss", "balance-sheet", "cash-flow"])(
    "keeps the focused Try again button mounted in the %s tab while a retry fails",
    async (tab) => {
      const retry = Promise.withResolvers<never>();
      const fetchStatement = vi
        .fn()
        .mockRejectedValueOnce(new Error("Initial statement load failed"))
        .mockReturnValueOnce(retry.promise);
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryFn: async ({ queryKey }) =>
              String(queryKey[0]).includes(`/financial-statements/${tab}?`)
                ? fetchStatement()
                : null,
          },
        },
      });
      const location = memoryLocation({
        path: `/financial-statements?tab=${tab}`,
        searchHook: true,
      });
      const node = document.createElement("div");
      const root = createRoot(document.body.appendChild(node));
      const retryButton = () => node.querySelector<HTMLButtonElement>('[role="alert"] button');

      try {
        await act(async () => {
          root.render(
            createElement(
              QueryClientProvider,
              { client },
              createElement(
                Router,
                { hook: location.hook, searchHook: location.searchHook },
                createElement(FinancialStatements)
              )
            )
          );
        });
        await flushUntil(() => retryButton() !== null, 1000);

        const button = retryButton();
        expect(button).not.toBeNull();
        button?.focus();
        expect(document.activeElement).toBe(button);

        await act(async () => button?.click());
        await flushUntil(
          () =>
            fetchStatement.mock.calls.length >= 2 &&
            retryButton() === button &&
            document.activeElement === button,
          1000
        );
        expect(fetchStatement).toHaveBeenCalledTimes(2);
        expect(retryButton()).toBe(button);
        expect(button?.disabled).toBe(false);
        expect(document.activeElement).toBe(button);

        await act(async () => retry.reject(new Error("Statement retry failed")));
        await flushUntil(
          () =>
            retryButton() === button &&
            document.activeElement === button &&
            button?.getAttribute("aria-busy") !== "true",
          1000
        );
        expect(retryButton()).toBe(button);
        expect(button?.disabled).toBe(false);
        expect(document.activeElement).toBe(button);
      } finally {
        await act(async () => root.unmount());
        client.clear();
        node.remove();
      }
    }
  );
});
