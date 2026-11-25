// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { OverdueTab } from "../../client/src/pages/payment-reminders/OverdueTab";
import { filterOverdueRows } from "../../client/src/pages/payment-reminders/filterOverdueRows";
import type { AgingRow } from "../../client/src/pages/payment-reminders/types";
import en from "../../client/src/locales/en/invoices.json";
import ar from "../../client/src/locales/ar/invoices.json";

const row = (id: string, number: string, customerName: string, daysOverdue: number) =>
  ({
    invoice: { id, number, customerName, currency: "AED", doNotChase: false, chaseLevel: 0 },
    outstanding: 100,
    daysOverdue,
    bucket: "1-30",
    nextLevel: 1,
  }) as unknown as AgingRow;

const rows = [row("1", "INV-001", "Acme Trading", 5), row("2", "INV-002", "شركة النور", 40)];

describe("payment chasing overdue tab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeAll(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await loadLocale("en");
    useI18n.getState().setLocale("en");
  });

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  function renderTab(props: Pick<ComponentProps<typeof OverdueTab>, "rows" | "error" | "onRetry">) {
    const noop = () => {};
    act(() => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(OverdueTab, {
            ...props,
            queue: [],
            loading: false,
            sending: false,
            onSend: noop,
            onToggleDoNotChase: noop,
          })
        )
      );
    });
  }

  it("filters by customer name or invoice number, case-insensitively", () => {
    expect(filterOverdueRows(rows, "")).toHaveLength(2);
    expect(filterOverdueRows(rows, "  acme ").map((r) => r.invoice.id)).toEqual(["1"]);
    expect(filterOverdueRows(rows, "inv-002").map((r) => r.invoice.id)).toEqual(["2"]);
    expect(filterOverdueRows(rows, "النور")).toHaveLength(1);
    expect(filterOverdueRows(rows, "zzz")).toHaveLength(0);
  });

  it("offers a retry button in the load-error state", () => {
    renderTab({ rows: [], error: true, onRetry: () => {} });
    expect(container.querySelector('[data-testid="button-retry-overdue"]')?.textContent).toBe(
      en["invoices.reminders.retry"]
    );
  });

  it("sorts displayed rows without changing the cached order on mount or after clearing", () => {
    const queryKey = ["/api/chasing/overdue", "company-1"];
    queryClient.setQueryData(queryKey, [...rows]);
    const cachedRows = queryClient.getQueryData<AgingRow[]>(queryKey)!;
    const cachedOrder = () => cachedRows.map((r) => r.invoice.number);
    const displayedOrder = () =>
      [...container.querySelectorAll<HTMLTableRowElement>('[data-testid^="overdue-row-"]')].map(
        (tr) => tr.dataset.testid
      );

    renderTab({ rows: cachedRows, error: false });
    const search = container.querySelector<HTMLInputElement>(
      '[data-testid="input-search-overdue"]'
    )!;
    const status = () => container.querySelector('[role="status"]');
    const liveRegion = status();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const typeSearch = (value: string) =>
      act(() => {
        setValue.call(search, value);
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });

    expect(search.placeholder).toBe(en["invoices.reminders.searchPlaceholder"]);
    expect(liveRegion?.textContent).toBe("");
    expect(displayedOrder()).toEqual(["overdue-row-INV-002", "overdue-row-INV-001"]);
    expect(cachedOrder()).toEqual(["INV-001", "INV-002"]);

    search.focus();
    typeSearch("no matching invoice");
    expect(displayedOrder()).toEqual([]);
    expect(status()).toBe(liveRegion);
    expect(liveRegion?.textContent).toBe(en["invoices.reminders.noMatchTitle"]);
    expect(document.activeElement).toBe(search);

    const clearButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === en["invoices.reminders.clearSearch"]
    )!;
    clearButton.focus();
    expect(document.activeElement).toBe(clearButton);
    act(() => clearButton.click());

    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(status()).toBe(liveRegion);
    expect(liveRegion?.textContent).toBe("");
    expect(displayedOrder()).toEqual(["overdue-row-INV-002", "overdue-row-INV-001"]);
    expect(cachedOrder()).toEqual(["INV-001", "INV-002"]);

    typeSearch("   ");
    expect(displayedOrder()).toEqual(["overdue-row-INV-002", "overdue-row-INV-001"]);
    expect(cachedOrder()).toEqual(["INV-001", "INV-002"]);
  });

  it("has Arabic copy for every new key", () => {
    for (const k of Object.keys(en).filter((k) =>
      /reminders\.(search|noMatch|clearSearch|retry|pauseError)/.test(k)
    )) {
      expect((ar as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
