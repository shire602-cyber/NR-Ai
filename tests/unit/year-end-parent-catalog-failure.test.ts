// @vitest-environment jsdom
// Its own file, apart from year-end-card-catalog-failure.test.ts, so the Arabic app-wide load
// starts cold.
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isLocaleLoaded, loadLocale, t, useCatalogRevision, useI18n } from "@/lib/i18n";
import MonthEndClose from "@/pages/MonthEndClose";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1", isLoading: false }),
}));
// Simulates the Arabic yearEndClose catalog chunk failing to load; everything else is real.
vi.mock("@/locales/ar/yearEndClose.json", () => {
  throw new Error("catalog chunk failed");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), import("@/pages/month-end/YearEndCloseCard")]);
});

afterEach(() => {
  unmount?.();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  useI18n.setState({ locale: "en" });
});

function RevisionProbe() {
  return createElement("output", { "data-testid": "revision" }, useCatalogRevision());
}

const responses: Record<string, unknown> = {
  checklist: {
    checklist: [{ id: 1, title: "Bank reconciliation", description: "Review", status: "complete" }],
  },
  history: [{ id: "close-1", periodEnd: "2025-01-31", status: "locked", closedBy: "Reviewer" }],
  settings: {
    postYearEndClosingEntry: false,
    requireChecklistToLock: false,
    lockThroughDate: null,
    permissions: { canLock: true, canUnlock: false, canReopenHardClose: false },
  },
};

describe("month-end page with a failing Arabic year-end catalog", () => {
  it("loads the app-wide catalog and contains the failure to the year-end card", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey: [path] }) => {
            const name = String(path).split("?")[0].split("/").pop()!;
            return responses[name] ?? [];
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
    const revision = () => Number(document.querySelector('[data-testid="revision"]')!.textContent);
    expect(isLocaleLoaded("ar")).toBe(false);
    notifyManager.setScheduler((callback) => queueMicrotask(callback));
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Fragment, null, createElement(RevisionProbe), createElement(MonthEndClose))
        )
      );
    });
    const before = revision();

    // The same app-wide load the shell and the command palette use.
    await act(async () => {
      useI18n.setState({ locale: "ar" });
      await expect(loadLocale("ar")).resolves.toBeUndefined();
    });
    expect(isLocaleLoaded("ar")).toBe(true);
    expect(revision()).toBeGreaterThan(before);
    expect(Object.keys(t.ar)).not.toContain("yearEndClose.title");

    const failure = await vi.waitFor(
      async () => {
        await act(async () => {
          await vi.dynamicImportSettled();
        });
        const el = document.querySelector('[data-testid="year-end-close-error"]');
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 5000 }
    );
    const copy = t.ar;
    expect(failure.querySelector('[role="alert"]')?.textContent).toBe(copy.yearEndCloseUnavailable);

    for (const key of ["pageLabels.closeChecklist", "pageLabels.closeHistory", "pages.allClear"]) {
      expect(copy[key], key).toMatch(/[؀-ۿ]/);
      expect(document.body.textContent, key).toContain(copy[key]);
    }
    const table = document.querySelector("table")?.textContent;
    expect(table).toContain("Reviewer");
    expect(table).toContain(copy["pageLabels.closedBy"]);

    // The default (previous) month is not the locked one, so the lock dialog can open.
    const trigger = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === copy["pages.lockPeriod"]
    )!;
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      copy["monthEnd.lockType"]
    );
  });
});
