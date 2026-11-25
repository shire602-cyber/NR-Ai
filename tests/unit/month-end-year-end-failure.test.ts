// @vitest-environment jsdom
import {
  notifyManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, t, useI18n } from "@/lib/i18n";
import MonthEndClose from "@/pages/MonthEndClose";
import { yearEndRecovery } from "@/pages/month-end/yearEndRecovery";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1", isLoading: false }),
}));
// Simulates an offline module failure: the lazy import of the year-end card rejects.
vi.mock("@/pages/month-end/YearEndCloseCard", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;
let restoreScheduler: (() => void) | undefined;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

afterEach(() => {
  unmount?.();
  restoreScheduler?.();
  restoreScheduler = undefined;
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  useI18n.setState({ locale: "en" });
});

describe.each(["en", "ar"] as const)("year-end card chunk failure (%s)", (locale) => {
  it("keeps the page, shows a localized failure and reloads on retry", async () => {
    const reload = vi.spyOn(yearEndRecovery, "reload").mockImplementation(() => undefined);
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey: [path] }) => {
            const endpoint = String(path);
            if (endpoint.includes("/checklist?")) return { checklist: [] };
            if (endpoint.endsWith("/settings")) {
              return {
                postYearEndClosingEntry: false,
                requireChecklistToLock: false,
                lockThroughDate: null,
                permissions: { canLock: true, canUnlock: false, canReopenHardClose: false },
              };
            }
            return [];
          },
        },
      },
    });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    unmount = () => {
      act(() => root.unmount());
      client.clear();
      container.remove();
    };
    useI18n.setState({ locale });
    // Deliver React Query notifications on microtasks so they flush inside act().
    notifyManager.setScheduler((callback) => queueMicrotask(callback));
    restoreScheduler = () => notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(MonthEndClose)));
      await vi.dynamicImportSettled();
    });
    const failure = await vi.waitFor(async () => {
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(client.isFetching()).toBe(0);
      const el = document.querySelector('[data-testid="year-end-close-error"]');
      expect(el).not.toBeNull();
      return el!;
    });

    const copy = t[locale];
    // The rest of the page (checklist, history, lock controls) is still present.
    expect(document.querySelector('[data-testid="checklist-empty"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="history-empty"]')).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent?.trim() === copy["pages.lockPeriod"]
      )
    ).toBe(true);
    expect(failure.querySelector('[role="alert"]')?.textContent).toBe(copy.yearEndCloseUnavailable);

    const retry = failure.querySelector("button")!;
    expect(retry.textContent).toBe(copy.yearEndCloseReload);
    expect(reload).not.toHaveBeenCalled();
    await act(async () => retry.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
