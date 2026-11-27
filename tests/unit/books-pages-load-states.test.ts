// @vitest-environment jsdom
/**
 * Accounting-pages verification (2026-11-19): a failed read must read as a failure that can be
 * retried, never as "not found" or as an empty list, and the controls that were unnamed for
 * assistive technology now carry a name.
 *  - JournalEntryDetail: 500 -> load-error state with Retry; 404 -> "Journal entry not found".
 *  - AdminDocuments: the companies call failing is not "no clients you can upload for"; the
 *    company and category selects have accessible names; the TRN label is localised.
 *  - FixedAssets: Retry recovers an initial load failure and cached rows stay searchable; offline
 *    before the first load is not "no assets yet"; the summary fails and retries on its own.
 */
import { onlineManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  COMPANY_ID,
  byTestId,
  click,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  type as typeInput,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";

const mode = vi.hoisted(() => ({ failWith: null as null | { status: number }, failKeys: /$^/ }));

vi.mock("../../client/src/lib/queryClient", () => {
  const m = formHarnessQueryClientMock();
  const lookupFn = m.getQueryFn();
  m.queryClient.setDefaultOptions({
    queries: {
      retry: false,
      staleTime: Infinity,
      queryFn: async (ctx: { queryKey: readonly unknown[] }) => {
        if (mode.failWith && mode.failKeys.test(ctx.queryKey.join("/"))) {
          const err = new m.ApiError("SQL error internal-boom");
          err.status = mode.failWith.status;
          throw err;
        }
        return lookupFn(ctx);
      },
    },
  });
  return m;
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  mode.failWith = null;
  window.localStorage.clear();
});
afterEach(unmountPage);

async function renderEntry(id: string) {
  const { default: Detail } = await import("../../client/src/pages/JournalEntryDetail");
  const { hook } = memoryLocation({ path: `/journal/${id}` });
  const Shell = () =>
    createElement(
      Router,
      { hook },
      createElement(Route, { path: "/journal/:id", component: Detail })
    );
  await renderPage(Shell);
  await flush(30);
}

describe("journal entry detail load failure", () => {
  it("a server error shows a retryable error state, not 'not found'", async () => {
    mode.failWith = { status: 500 };
    mode.failKeys = /api\/journal\//;
    await renderEntry("11111111-1111-4111-8111-111111111111");
    expect(document.querySelector('[data-testid="journal-entry-load-error"]')).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/journal entry not found/i);
    expect(text).not.toContain("internal-boom");
    expect(
      [...document.querySelectorAll("button")].some((b) => /try again/i.test(b.textContent ?? ""))
    ).toBe(true);
  });

  it("a missing entry still reads as not found", async () => {
    mode.failWith = { status: 404 };
    mode.failKeys = /api\/journal\//;
    await renderEntry("22222222-2222-4222-8222-222222222222");
    expect(document.querySelector('[data-testid="journal-entry-load-error"]')).toBeNull();
    expect(document.body.textContent).toMatch(/journal entry not found/i);
    // The icon-only back link has a name (axe link-name).
    const back = document.querySelector('[data-testid="button-back-to-journal"]');
    expect(back?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("admin documents", () => {
  it("a failing company list is an error state, not 'no clients'", async () => {
    mode.failWith = { status: 500 };
    mode.failKeys = /api\/admin\/documents\/companies/;
    const { default: AdminDocuments } = await import("../../client/src/pages/AdminDocuments");
    await renderPage(AdminDocuments);
    await flush(30);
    expect(
      document.querySelector('[data-testid="admin-documents-companies-error"]')
    ).not.toBeNull();
    expect(document.querySelector('[data-testid="text-no-writable-clients"]')).toBeNull();
    expect(document.body.textContent).not.toContain("internal-boom");
  });

  it("the company select has an accessible name", async () => {
    setFixtures({
      "api/admin/documents/companies": [
        { id: "c1", name: "Alpha LLC", trnNumber: "100123456700003" },
      ],
    });
    const { default: AdminDocuments } = await import("../../client/src/pages/AdminDocuments");
    await renderPage(AdminDocuments);
    await flush(30);
    const trigger = document.querySelector('[data-testid="select-client-company"]');
    expect(trigger?.getAttribute("aria-label")).toBeTruthy();
  });
});

it("recovers the fixed asset register with Retry and keeps search focused after a failed refetch", async () => {
  const assetsPath = `/api/companies/${COMPANY_ID}/fixed-assets`;
  mode.failKeys = /\/fixed-assets$/;
  mode.failWith = { status: 500 };
  setFixtures({
    [assetsPath]: [
      {
        id: "van",
        asset_name: "Delivery van",
        category: "Vehicles",
        purchase_cost: "1000",
        status: "active",
      },
      {
        id: "desk",
        asset_name: "Office desk",
        category: "Furniture",
        purchase_cost: "500",
        status: "active",
      },
    ],
  });
  const searchInput = () =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Search by name, category or number"]'
    );
  const tableText = () => document.querySelector("tbody")?.textContent;

  const { default: FixedAssets } = await import("../../client/src/pages/FixedAssets");
  await renderPage(FixedAssets);
  const loadError = () => byTestId("error-state-fixed-assets");
  await flushUntil(() => !!loadError());
  expect(loadError()).toBeTruthy();
  expect(searchInput()).toBeNull();

  mode.failWith = null;
  await click(loadError()!.querySelector("button"));
  await flushUntil(() => !!searchInput());
  expect(loadError()).toBeNull();
  expect(tableText()).toContain("Delivery van");
  expect(tableText()).toContain("Office desk");

  const search = searchInput()!;
  search.focus();
  await typeInput(search, "van");
  expect(tableText()).toContain("Delivery van");
  expect(tableText()).not.toContain("Office desk");

  mode.failWith = { status: 500 };
  const queryKey = [assetsPath];
  await act(async () => {
    await queryClient.refetchQueries({ queryKey, exact: true });
  });
  await flush();
  expect(queryClient.getQueryState(queryKey)?.status).toBe("error");
  expect(loadError()).toBeNull();
  expect(searchInput()).toBe(search);
  expect(document.activeElement).toBe(search);
  expect(tableText()).toContain("Delivery van");
  expect(tableText()).not.toContain("Office desk");

  await typeInput(search, "desk");
  expect(tableText()).toContain("Office desk");
  expect(tableText()).not.toContain("Delivery van");
});

describe("fixed assets offline and summary failure", () => {
  const registerPath = `/api/companies/${COMPANY_ID}/fixed-assets`;
  const summaryPath = `${registerPath}/summary`;
  const rowsText = () => document.querySelector("tbody")?.textContent ?? "";
  const pageText = () => document.body.textContent ?? "";

  beforeEach(() => {
    setFixtures({
      [registerPath]: [
        {
          id: "van",
          asset_name: "Delivery van",
          category: "Vehicles",
          purchase_cost: "1000",
          status: "active",
        },
      ],
      [summaryPath]: {
        totalAssets: 1,
        totalCost: 1000,
        totalAccumulatedDepreciation: 0,
        totalNetBookValue: 1000,
        byCategory: [],
      },
    });
  });
  afterEach(async () => {
    await act(async () => {
      onlineManager.setOnline(true);
      useI18n.getState().setLocale("en");
    });
  });

  async function renderAssets() {
    const { default: FixedAssets } = await import("../../client/src/pages/FixedAssets");
    await renderPage(FixedAssets);
  }

  it.each(["en", "ar"] as const)(
    "announces a paused first load and recovers on reconnect (%s)",
    async (locale) => {
      await act(async () => useI18n.getState().setLocale(locale));
      onlineManager.setOnline(false);
      await renderAssets();
      await flushUntil(() => !!byTestId("list-query-waiting"));

      const offline = byTestId("list-query-waiting");
      expect(offline?.getAttribute("role")).toBe("status");
      expect(offline?.textContent).toBe(catalogs[locale]["common.loadPaused"]);
      expect(offline?.querySelector("button")).toBeNull();
      expect(byTestId("empty-state-fixed-assets")).toBeNull();
      expect(queryClient.getQueryState([registerPath])?.fetchStatus).toBe("paused");

      await act(async () => {
        onlineManager.setOnline(true);
      });
      await flushUntil(() => rowsText().includes("Delivery van"));
      expect(rowsText()).toContain("Delivery van");
      expect(byTestId("list-query-waiting")).toBeNull();
    }
  );

  it("keeps cached rows, search and totals when offline and when a refresh fails", async () => {
    await renderAssets();
    await flushUntil(
      () =>
        rowsText().includes("Delivery van") && pageText().includes(catalogs.en["pages.totalCost"])
    );
    const search = () =>
      document.querySelector(`input[aria-label="${catalogs.en["screens.searchAssets"]}"]`);

    await act(async () => {
      onlineManager.setOnline(false);
      void queryClient.invalidateQueries({ queryKey: [registerPath], exact: true });
    });
    await flush();
    expect(queryClient.getQueryState([registerPath])?.fetchStatus).toBe("paused");
    expect(rowsText()).toContain("Delivery van");
    expect(search()).not.toBeNull();
    expect(byTestId("list-query-waiting")).toBeNull();

    mode.failKeys = /\/fixed-assets(\/summary)?$/;
    mode.failWith = { status: 500 };
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await flushUntil(() => queryClient.getQueryState([registerPath])?.status === "error");
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: [summaryPath], exact: true });
    });
    await flush();
    expect(queryClient.getQueryState([registerPath])?.status).toBe("error");
    expect(queryClient.getQueryState([summaryPath])?.status).toBe("error");
    expect(rowsText()).toContain("Delivery van");
    expect(search()).not.toBeNull();
    expect(pageText()).toContain(catalogs.en["pages.totalCost"]);
    expect(byTestId("error-state-fixed-assets")).toBeNull();
    expect(byTestId("error-state-fixed-assets-summary")).toBeNull();
  });

  it.each(["en", "ar"] as const)(
    "a failed first summary load has its own error and retry; the register works (%s)",
    async (locale) => {
      await act(async () => useI18n.getState().setLocale(locale));
      mode.failKeys = /\/fixed-assets\/summary$/;
      mode.failWith = { status: 500 };
      await renderAssets();
      await flushUntil(
        () => !!byTestId("error-state-fixed-assets-summary") && rowsText().includes("Delivery van")
      );
      const error = byTestId("error-state-fixed-assets-summary");
      expect(error?.textContent).toContain(catalogs[locale]["screens.assetSummaryErrorTitle"]);
      expect(rowsText()).toContain("Delivery van");
      expect(byTestId("error-state-fixed-assets")).toBeNull();

      mode.failWith = null;
      await click(error!.querySelector("button"));
      await flushUntil(() => pageText().includes(catalogs[locale]["pages.totalCost"]));
      expect(byTestId("error-state-fixed-assets-summary")).toBeNull();
      expect(pageText()).toContain(catalogs[locale]["pages.totalCost"]);
    }
  );
});
