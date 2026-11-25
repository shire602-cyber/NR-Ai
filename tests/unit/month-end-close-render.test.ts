// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, t, useI18n } from "@/lib/i18n";
import MonthEndClose from "@/pages/MonthEndClose";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1", isLoading: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

afterEach(() => {
  unmount?.();
  useI18n.getState().setLocale("en");
});

async function mountPage(
  locale: "en" | "ar",
  checklist: "failed" | "empty" | "incomplete" | "complete",
  historyQuery = async (): Promise<unknown> => []
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey: [path] }) => {
          const endpoint = String(path);
          if (endpoint.includes("/checklist?")) {
            if (checklist === "failed") throw new Error("Checklist unavailable");
            return {
              checklist:
                checklist === "empty"
                  ? []
                  : [
                      {
                        id: 1,
                        title: "Bank reconciliation",
                        description: "Review",
                        status: checklist,
                      },
                    ],
            };
          }
          if (endpoint.endsWith("/history")) return historyQuery();
          if (endpoint.endsWith("/settings")) return null;
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
  await act(async () => {
    useI18n.getState().setLocale(locale);
    root.render(createElement(QueryClientProvider, { client }, createElement(MonthEndClose)));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(client.isFetching()).toBe(0);
  });
}

describe.each(["en", "ar"] as const)("lock dialog (%s)", (locale) => {
  it.each(["failed", "empty", "incomplete", "complete"] as const)(
    "shows the appropriate checklist guidance when the checklist is %s",
    async (state) => {
      await mountPage(locale, state);
      const copy = t[locale];
      const trigger = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === copy["pages.lockPeriod"]
      );
      expect(trigger).toBeDefined();
      await act(async () => trigger!.click());

      const dialog = document.querySelector('[role="alertdialog"]')!;
      const override = dialog.querySelector('[data-testid="checkbox-override-checklist"]');
      if (state === "incomplete") {
        expect(override).not.toBeNull();
        expect(dialog.textContent).toContain(copy["monthEnd.overrideChecklist"]);
        expect(dialog.textContent).toContain(copy["monthEnd.checklistIncomplete"]);
      } else {
        expect(override).toBeNull();
        expect(dialog.textContent).not.toContain(copy["monthEnd.overrideChecklist"]);
        expect(dialog.textContent).not.toContain(copy["monthEnd.checklistIncomplete"]);
      }
      if (state === "failed" || state === "empty") {
        expect(dialog.textContent).toContain(copy["monthEnd.lockChecklistUnavailable"]);
      } else {
        expect(dialog.textContent).not.toContain(copy["monthEnd.lockChecklistUnavailable"]);
      }
    }
  );
});

it("keeps the close history retry button focused, announces progress and renders recovered history", async () => {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  const historyQuery = vi
    .fn(async () => promise)
    .mockRejectedValueOnce(new Error("History unavailable"));
  await mountPage("en", "complete", historyQuery);
  const copy = t.en;
  const error = () => document.querySelector('[data-testid="history-error"]');
  await vi.waitFor(() =>
    expect(error()?.textContent).toContain(copy["monthEnd.historyLoadFailed"])
  );
  expect(document.querySelector("table")).toBeNull();

  const retry = error()!.querySelector("button")!;
  expect(retry.textContent).toBe(copy["monthEnd.retry"]);
  retry.focus();
  await act(async () => retry.click());
  await vi.waitFor(() => {
    expect(error()?.querySelector('[role="status"]')?.textContent).toBe(
      copy["monthEnd.retryingHistory"]
    );
  });
  expect(error()?.querySelector("button")).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("true");

  await act(async () => {
    resolve([{ id: "close-1", periodEnd: "2025-01-31", status: "locked", closedBy: "Reviewer" }]);
  });
  await vi.waitFor(() =>
    expect(document.querySelector("table")?.textContent).toContain("Reviewer")
  );
  expect(error()).toBeNull();
  expect(historyQuery).toHaveBeenCalledTimes(2);
});
