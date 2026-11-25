import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

const rows = [row("1", "INV-001", "Acme Trading", 5), row("2", "INV-002", "شركة النور", 40)];

describe("payment chasing overdue tab", () => {
  it("filters by customer name or invoice number, case-insensitively", () => {
    expect(filterOverdueRows(rows, "")).toHaveLength(2);
    expect(filterOverdueRows(rows, "  acme ").map((r) => r.invoice.id)).toEqual(["1"]);
    expect(filterOverdueRows(rows, "inv-002").map((r) => r.invoice.id)).toEqual(["2"]);
    expect(filterOverdueRows(rows, "النور")).toHaveLength(1);
    expect(filterOverdueRows(rows, "zzz")).toHaveLength(0);
  });

  it("offers a retry button in the load-error state", async () => {
    await loadLocale("en");
    useI18n.getState().setLocale("en");
    const props = { rows: [], queue: [], loading: false, error: true, sending: false };
    const noop = () => {};
    const withRetry = wrap(
      createElement(OverdueTab, { ...props, onRetry: noop, onSend: noop, onToggleDoNotChase: noop })
    );
    expect(withRetry).toContain("button-retry-overdue");
    expect(withRetry).toContain(en["invoices.reminders.retry"]);
  });

  it("renders the search box when rows exist", async () => {
    await loadLocale("en");
    useI18n.getState().setLocale("en");
    const noop = () => {};
    const html = wrap(
      createElement(OverdueTab, {
        rows,
        queue: [],
        loading: false,
        error: false,
        sending: false,
        onSend: noop,
        onToggleDoNotChase: noop,
      })
    );
    expect(html).toContain("input-search-overdue");
    expect(html).toContain(en["invoices.reminders.searchPlaceholder"]);
  });

  it("has Arabic copy for every new key", () => {
    for (const k of Object.keys(en).filter((k) =>
      /reminders\.(search|noMatch|clearSearch|retry|pauseError)/.test(k)
    )) {
      expect((ar as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
