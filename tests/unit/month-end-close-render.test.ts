// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, t, useI18n } from "@/lib/i18n";
import * as closeApi from "@/lib/queryClient";
import MonthEndClose from "@/pages/MonthEndClose";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1", isLoading: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

beforeAll(async () => {
  // MonthEndClose lazy-loads YearEndCloseCard; preload so React.lazy resolves synchronously-ish.
  await Promise.all([
    loadLocale("en"),
    loadLocale("ar"),
    import("@/pages/month-end/YearEndCloseCard"),
  ]);
});

afterEach(() => {
  unmount?.();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  useI18n.getState().setLocale("en");
});

async function mountPage(
  locale: "en" | "ar",
  checklist: "failed" | "empty" | "incomplete" | "complete",
  historyQuery = async (): Promise<unknown> => [],
  options?: { canUnlock?: boolean; checklistQuery?: () => Promise<unknown> }
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey: [path] }) => {
          const endpoint = String(path);
          if (endpoint.includes("/checklist?")) {
            if (options?.checklistQuery) return options.checklistQuery();
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
          if (endpoint.endsWith("/settings")) {
            return {
              postYearEndClosingEntry: false,
              requireChecklistToLock: false,
              lockThroughDate: null,
              permissions: {
                canLock: true,
                canUnlock: options?.canUnlock ?? false,
                canReopenHardClose: false,
              },
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
  await act(async () => {
    useI18n.getState().setLocale(locale);
    root.render(createElement(QueryClientProvider, { client }, createElement(MonthEndClose)));
    await vi.dynamicImportSettled();
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(client.isFetching()).toBe(0);
    expect(
      document.querySelector(
        '[data-testid="history-error"], [data-testid="history-waiting"], [data-testid="history-refresh-error"], [data-testid="history-empty"], table'
      )
    ).not.toBeNull();
  });
  return client;
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

it("sends a checklist override only when selected for the current lock submission", async () => {
  const apiRequest = vi.spyOn(closeApi, "apiRequest").mockResolvedValue({});
  await mountPage("en", "incomplete");
  const copy = t.en;
  const button = (root: ParentNode, label: string) =>
    Array.from(root.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)!;
  const trigger = button(document, copy["pages.lockPeriod"]);
  const openLock = async () => {
    await act(async () => trigger.click());
    return document.querySelector('[role="alertdialog"]')!;
  };
  const lockOverride = (dialog: Element) =>
    dialog.querySelector<HTMLInputElement>('[data-testid="checkbox-override-checklist"]')!;
  const yearEndOverride = await vi.waitFor(() => {
    const label = Array.from(document.querySelectorAll("label")).find(
      (item) => item.textContent?.trim() === copy["monthEnd.overrideChecklist"]
    );
    const input = label?.querySelector("input");
    expect(input).toBeTruthy();
    return input!;
  });
  await act(async () => yearEndOverride.click());

  let dialog = await openLock();
  expect(lockOverride(dialog).checked).toBe(false);
  await act(async () => lockOverride(dialog).click());
  expect(button(dialog, copy["pages.lockPeriod"]).disabled).toBe(true);
  await act(async () => button(dialog, copy["pages.cancel"]).click());

  dialog = await openLock();
  expect(lockOverride(dialog).checked).toBe(false);
  await act(async () => button(dialog, copy["pages.lockPeriod"]).click());
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const [method, endpoint, payload] = apiRequest.mock.calls[0];
  expect(method).toBe("POST");
  expect(endpoint).toBe("/api/companies/company-1/month-end/lock-period");
  expect(payload).not.toHaveProperty("overrideChecklist");

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(trigger.disabled).toBe(false);
  });
  dialog = await openLock();
  await act(async () => {
    lockOverride(dialog).click();
    const reason = dialog.querySelector<HTMLInputElement>("#lock-reason")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      reason,
      "Approved exception"
    );
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button(dialog, copy["pages.lockPeriod"]).click());
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(apiRequest).toHaveBeenLastCalledWith("POST", endpoint, {
    ...(payload as object),
    overrideChecklist: true,
    reason: "Approved exception",
  });
  expect(yearEndOverride.checked).toBe(true);
});

it.each(["online", "offline"])(
  "keeps the close history retry focused when started %s",
  async (connection) => {
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
    if (connection === "offline") {
      await act(async () => onlineManager.setOnline(false));
    }
    retry.focus();
    await act(async () => retry.click());
    if (connection === "offline") {
      await vi.waitFor(() => {
        expect(error()?.querySelector('[role="status"]')?.textContent).toBe(
          copy["monthEnd.historyWaitingForConnection"]
        );
      });
      expect(error()?.querySelector("button")).toBe(retry);
      expect(document.activeElement).toBe(retry);
      expect(retry.getAttribute("aria-disabled")).toBe("true");
      expect(historyQuery).toHaveBeenCalledTimes(1);
      await act(async () => onlineManager.setOnline(true));
    }
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
  }
);

it("keeps cached close history and its actions when a refresh fails", async () => {
  const copy = t.en;
  const record = {
    id: "close-1",
    periodEnd: "2025-01-31",
    status: "locked",
    closedBy: "Reviewer",
  };
  const { promise, resolve } = Promise.withResolvers<unknown>();
  const steps = ["success", "fail", "hang"] as const;
  const historyQuery = vi.fn(async () => {
    const step = steps.shift() ?? "hang";
    if (step === "success") return [record];
    if (step === "fail") throw new Error("refresh failed");
    return promise;
  });
  const client = await mountPage("en", "complete", historyQuery, { canUnlock: true });
  const tableText = () => document.querySelector("table")?.textContent ?? "";
  await vi.waitFor(() => expect(tableText()).toContain("Reviewer"));
  expect(document.querySelector('[data-testid="button-reopen-2025-01-31"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="button-unlock-2025-01-31"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="history-refresh-error"]')).toBeNull();

  await act(async () => {
    await client
      .invalidateQueries({ queryKey: ["/api/companies/company-1/month-end/history"] })
      .catch(() => undefined);
  });
  const refreshError = () => document.querySelector('[data-testid="history-refresh-error"]');
  await vi.waitFor(() =>
    expect(refreshError()?.textContent).toContain(copy["monthEnd.historyRefreshFailed"])
  );
  expect(tableText()).toContain("Reviewer");
  expect(document.querySelector('[data-testid="button-reopen-2025-01-31"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="button-unlock-2025-01-31"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain(copy["pageLabels.noPeriodClosingsRecordedYet"]);
  expect(document.querySelector('[data-testid="history-error"]')).toBeNull();

  const retry = refreshError()!.querySelector("button")!;
  expect(retry.textContent).toBe(copy["monthEnd.retry"]);
  retry.focus();
  await act(async () => retry.click());
  await vi.waitFor(() =>
    expect(refreshError()?.querySelector('[role="status"]')?.textContent).toBe(
      copy["monthEnd.retryingHistory"]
    )
  );
  expect(refreshError()?.querySelector("button")).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(tableText()).toContain("Reviewer");

  await act(async () => {
    resolve([{ ...record, closedBy: "Refreshed reviewer" }]);
  });
  await vi.waitFor(() => expect(tableText()).toContain("Refreshed reviewer"));
  expect(refreshError()).toBeNull();
  expect(document.querySelector('[data-testid="button-reopen-2025-01-31"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="button-unlock-2025-01-31"]')).not.toBeNull();
});

it("shows a waiting state for an initial offline history load", async () => {
  const copy = t.en;
  await act(async () => onlineManager.setOnline(false));
  const historyQuery = vi.fn(async () => []);
  await mountPage("en", "complete", historyQuery);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="history-waiting"]')?.textContent).toBe(
      copy["monthEnd.historyWaitingToLoad"]
    )
  );
  const waiting = document.querySelector('[data-testid="history-waiting"]');
  expect(waiting?.getAttribute("role")).toBe("status");
  expect(document.body.textContent).not.toContain(copy["pageLabels.noPeriodClosingsRecordedYet"]);
  expect(document.querySelector('[data-testid="history-error"]')).toBeNull();
  expect(historyQuery).not.toHaveBeenCalled();

  await act(async () => onlineManager.setOnline(true));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(copy["pageLabels.noPeriodClosingsRecordedYet"])
  );
  expect(document.querySelector('[data-testid="history-waiting"]')).toBeNull();
  expect(historyQuery).toHaveBeenCalledTimes(1);
});

it.each(["online", "offline"] as const)(
  "keeps the checklist retry focused when started %s",
  async (connection) => {
    const copy = t.en;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const checklistQuery = vi
      .fn(async () => promise)
      .mockRejectedValueOnce(new Error("Checklist unavailable"));
    await mountPage("en", "failed", async () => [], { checklistQuery });
    const error = () => document.querySelector('[data-testid="checklist-error"]');
    await vi.waitFor(() =>
      expect(error()?.textContent).toContain(copy["monthEnd.checklistLoadFailed"])
    );
    expect(document.querySelector(".h-14")).toBeNull();

    const retry = error()!.querySelector("button")!;
    expect(retry.textContent).toBe(copy["monthEnd.retry"]);
    if (connection === "offline") {
      await act(async () => onlineManager.setOnline(false));
    }
    retry.focus();
    await act(async () => retry.click());
    if (connection === "offline") {
      await vi.waitFor(() =>
        expect(error()?.querySelector('[role="status"]')?.textContent).toBe(
          copy["monthEnd.checklistWaitingForConnection"]
        )
      );
      expect(error()?.querySelector("button")).toBe(retry);
      expect(document.activeElement).toBe(retry);
      expect(retry.getAttribute("aria-disabled")).toBe("true");
      expect(checklistQuery).toHaveBeenCalledTimes(1);
      await act(async () => onlineManager.setOnline(true));
    }
    await vi.waitFor(() =>
      expect(error()?.querySelector('[role="status"]')?.textContent).toBe(
        copy["monthEnd.retryingChecklist"]
      )
    );
    expect(error()?.querySelector("button")).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector(".h-14")).toBeNull();

    await act(async () => {
      resolve({
        checklist: [
          {
            id: 1,
            title: "Bank reconciliation",
            description: "Review",
            status: "complete",
          },
        ],
      });
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Bank reconciliation"));
    expect(error()).toBeNull();
    expect(checklistQuery).toHaveBeenCalledTimes(2);
  }
);
