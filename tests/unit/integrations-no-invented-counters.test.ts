// @vitest-environment jsdom
/**
 * WP-E release blocker: /integrations-hub showed "Pending reconciliation 12 / Auto-matched 156 /
 * Failed imports 3" and an invented account mapping while nothing was connected. The page now
 * renders only counts computed from rows the server returned, and nothing at all while no
 * platform is connected. Behaviour test: the real page is rendered against stubbed API rows.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));

import {
  connectedCount,
  summarizeImportedTransactions,
} from "../../client/src/pages/integrations/summary";

let container: HTMLDivElement;
let root: Root;
let apiRows: { integrations: unknown[]; transactions: unknown[] };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  apiRows = { integrations: [], transactions: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("csrf-token")) return json({ csrfToken: "t" });
      if (url.includes("/api/integrations/status")) {
        return json({
          connectors: [
            {
              id: "xero",
              category: "accounting",
              label: { en: "Xero", ar: "زيرو" },
              purpose: { en: "Contacts and invoices", ar: "جهات الاتصال والفواتير" },
              status: "requires_external",
            },
          ],
        });
      }
      if (url.includes("/api/integrations/ecommerce/transactions"))
        return json(apiRows.transactions);
      if (url.includes("/api/integrations/ecommerce")) return json(apiRows.integrations);
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { default: IntegrationsHub } = await import("../../client/src/pages/IntegrationsHub");
  queryClient.clear();
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(IntegrationsHub))
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container.textContent ?? "";
}

describe("integrations: no invented counters", () => {
  it("shows no numbers, no transactions tab and no mapping while nothing is connected", async () => {
    const text = await renderPage();
    expect(container.querySelector('[data-testid="integrations-available"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-connect-stripe_payouts"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="connector-xero"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tab-transactions"]')).toBeNull();
    expect(container.querySelector('[data-testid="integrations-summary"]')).toBeNull();
    for (const phrase of [
      "Failed imports",
      "Auto-matched",
      "Pending reconciliation",
      "Account mapping",
      "1000 - Cash",
      "Requires app registration",
    ]) {
      expect(text).not.toContain(phrase);
    }
    // No digit anywhere on the page: every figure would have to be invented.
    expect(text).not.toMatch(/\d/);
  });

  it("counts only rows the server returned once a platform is connected", async () => {
    apiRows.integrations = [
      {
        id: "i-1",
        platform: "stripe_payouts",
        isActive: true,
        connectionStatus: "connected",
        lastSyncAt: null,
        syncStatus: "idle",
        syncError: null,
      },
    ];
    apiRows.transactions = [
      {
        id: "t1",
        platform: "stripe_payouts",
        transactionType: "charge",
        amount: 100,
        currency: "AED",
        transactionDate: "2026-11-01",
        isReconciled: true,
      },
      {
        id: "t2",
        platform: "stripe_payouts",
        transactionType: "charge",
        amount: 50,
        currency: "AED",
        transactionDate: "2026-11-02",
        isReconciled: false,
      },
    ];
    await renderPage();
    expect(container.querySelector('[data-testid="tab-transactions"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Failed imports");
    expect(summarizeImportedTransactions(apiRows.transactions as never)).toEqual({
      total: 2,
      reconciled: 1,
      awaitingReconciliation: 1,
    });
  });

  it("summary helpers never default to a figure", () => {
    expect(summarizeImportedTransactions([])).toBeNull();
    expect(summarizeImportedTransactions(undefined)).toBeNull();
    expect(connectedCount(undefined)).toBe(0);
    expect(connectedCount([{ isActive: true, connectionStatus: "not_connected" }])).toBe(0);
    expect(connectedCount([{ isActive: true, connectionStatus: "connected" }])).toBe(1);
  });
});
