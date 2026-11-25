// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { StatementLoadError } from "../../client/src/components/reports/StatementLoadError";
import FinancialStatements from "../../client/src/pages/FinancialStatements";
import { flushUntil } from "./helpers/form-harness";

const companyState = vi.hoisted(() => ({ id: "test-company" }));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: companyState.id, company: null, isLoading: false }),
}));

// Light stand-in for the calendar popover so the test can edit dates deterministically.
vi.mock("../../client/src/components/ui/date-picker", () => ({
  DatePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    createElement("input", {
      "data-mock-date": "",
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
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

  it("shows the localized waiting message and ignores activation while paused", async () => {
    const onRetry = vi.fn();
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      await act(async () => {
        root.render(
          createElement(StatementLoadError, {
            messageKey: "statements.loadFailed",
            onRetry,
            paused: true,
          })
        );
      });
      const button = node.querySelector("button");
      expect(node.textContent).toContain("Waiting for your connection");
      expect(node.textContent).not.toContain("Failed to load the statement.");
      expect(button?.getAttribute("aria-busy")).toBe("true");
      await act(async () => button?.click());
      expect(onRetry).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(["profit-loss", "balance-sheet", "cash-flow"])(
    "scopes the retained error to the request in the %s tab and pauses offline retries",
    async (tab) => {
      const failed = new Error("Company A failed");
      const fetchStatement = vi.fn(async (companyId: string) => {
        if (companyId === "company-a") throw failed;
        return new Promise<never>(() => {});
      });
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryFn: async ({ queryKey }) => {
              const url = String(queryKey[0]);
              return url.includes(`/financial-statements/${tab}?`)
                ? fetchStatement(url.split("/")[3])
                : null;
            },
          },
        },
      });
      const location = memoryLocation({
        path: `/financial-statements?tab=${tab}`,
        searchHook: true,
      });
      const node = document.createElement("div");
      const root = createRoot(document.body.appendChild(node));
      const alert = () => node.querySelector('[role="alert"]');
      const retryButton = () => node.querySelector<HTMLButtonElement>('[role="alert"] button');
      const renderPage = () =>
        act(async () => {
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

      try {
        companyState.id = "company-a";
        await renderPage();
        await flushUntil(() => retryButton() !== null, 1000);
        expect(alert()?.textContent).toContain("Failed");

        // Offline: the retry is queued, so the waiting message shows and clicks are ignored.
        onlineManager.setOnline(false);
        const button = retryButton();
        await act(async () => button?.click());
        await flushUntil(() => alert()?.textContent?.includes("Waiting for your connection"), 1000);
        expect(alert()?.textContent).toContain("Waiting for your connection");
        const callsWhilePaused = fetchStatement.mock.calls.length;
        await act(async () => button?.click());
        await act(async () => button?.click());
        expect(fetchStatement).toHaveBeenCalledTimes(callsWhilePaused);
        expect(retryButton()).toBe(button);
        onlineManager.setOnline(true);
        await flushUntil(() => fetchStatement.mock.calls.length > callsWhilePaused, 1000);

        // A different request (another company) must not inherit company A's error.
        companyState.id = "company-b";
        await renderPage();
        await flushUntil(() => fetchStatement.mock.calls.some((c) => c[0] === "company-b"), 1000);
        expect(alert()).toBeNull();
        expect(node.querySelector(".skeleton-shimmer")).not.toBeNull();
      } finally {
        onlineManager.setOnline(true);
        companyState.id = "test-company";
        await act(async () => root.unmount());
        client.clear();
        node.remove();
      }
    }
  );

  it.each(["profit-loss", "balance-sheet", "cash-flow"])(
    "keeps the error on date edit alone and shows a skeleton without it after Generate in the %s tab",
    async (tab) => {
      const fetchStatement = vi
        .fn()
        .mockRejectedValueOnce(new Error("Initial statement load failed"))
        .mockImplementation(() => new Promise<never>(() => {}));
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryFn: async ({ queryKey }) =>
              String(queryKey[0]).includes(`/financial-statements/${tab}?`)
                ? fetchStatement(String(queryKey[0]))
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
      const alert = () => node.querySelector('[role="alert"]');
      const retryButton = () => node.querySelector<HTMLButtonElement>('[role="alert"] button');
      const generate = () =>
        Array.from(node.querySelectorAll("button")).find((b) =>
          /Generate/i.test(b.textContent ?? "")
        );

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
        expect(fetchStatement).toHaveBeenCalledTimes(1);

        // Editing a date alone changes no query: the error stays and nothing is requested.
        const input = node.querySelector<HTMLInputElement>("input[data-mock-date]");
        expect(input).not.toBeNull();
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(input, "2020-01-15");
          input?.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(input?.value).toBe("2020-01-15");
        expect(alert()).not.toBeNull();
        expect(fetchStatement).toHaveBeenCalledTimes(1);

        // Generate issues a new, uncached request: skeleton, and no inherited error.
        expect(generate()).toBeDefined();
        await act(async () => generate()?.click());
        await flushUntil(() => fetchStatement.mock.calls.length === 2, 1000);
        expect(String(fetchStatement.mock.calls[1][0])).toContain("2020-01-15");
        expect(alert()).toBeNull();
        expect(node.querySelector(".skeleton-shimmer")).not.toBeNull();
      } finally {
        await act(async () => root.unmount());
        client.clear();
        node.remove();
      }
    }
  );

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
