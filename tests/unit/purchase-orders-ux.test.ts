// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { filterPurchaseOrders } from "../../client/src/lib/purchase-order-filters";
import enStatuses from "../../client/src/locales/en/components.json";
import arStatuses from "../../client/src/locales/ar/components.json";
import { stripArabicMarks } from "../../shared/arabic-text";
import {
  COMPANY_ID,
  apiCalls,
  buttonByText,
  byTestId,
  click,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
// After the harness import: the queryClient mock factory below calls into it.
import { queryClient } from "../../client/src/lib/queryClient";
import PurchaseOrders from "../../client/src/pages/PurchaseOrders";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
const noCompany = vi.hoisted(() => ({ value: false }));
vi.mock("../../client/src/hooks/useDefaultCompany", () => {
  const base = formHarnessCompanyMock();
  return {
    useDefaultCompany: () => {
      const result = base.useDefaultCompany();
      return noCompany.value
        ? { ...result, company: undefined, companyId: undefined, isLoading: true }
        : result;
    },
  };
});
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true, isLoading: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const orders = [
  { number: "PO-001", vendorName: "Acme Trading", status: "draft" },
  { number: "PO-002", vendorName: "مؤسسة النور", status: "partially_received" },
  { number: "PO-003", vendorName: null, status: "sent" },
];

describe("purchase order list search", () => {
  it("returns everything for a blank query and tolerates undefined", () => {
    expect(filterPurchaseOrders(orders, "  ", enStatuses)).toHaveLength(3);
    expect(filterPurchaseOrders(undefined, "x", enStatuses)).toEqual([]);
  });
  it("matches number, vendor (Arabic too) and status", () => {
    expect(filterPurchaseOrders(orders, "po-002", enStatuses).map((o) => o.number)).toEqual([
      "PO-002",
    ]);
    expect(filterPurchaseOrders(orders, "acme", enStatuses)).toHaveLength(1);
    expect(filterPurchaseOrders(orders, "النور", enStatuses)).toHaveLength(1);
    expect(filterPurchaseOrders(orders, "partially received", enStatuses)).toHaveLength(1);
  });
  it("returns nothing for an unknown term", () => {
    expect(filterPurchaseOrders(orders, "zzz", enStatuses)).toEqual([]);
  });

  it("matches Arabic-Indic and Persian digits against ASCII digits, on both sides", () => {
    for (const query of ["PO-٠٠٢", "۰۰۲"]) {
      expect(filterPurchaseOrders(orders, query, enStatuses).map((o) => o.number)).toEqual([
        "PO-002",
      ]);
    }
    const stored = [{ number: "PO-٠٠٥", vendorName: "متجر ۲۴", status: "draft" }];
    expect(filterPurchaseOrders(stored, "005", enStatuses)).toEqual(stored);
    expect(filterPurchaseOrders(stored, "24", enStatuses)).toEqual(stored);
  });

  it("matches a vocalized Arabic status from an unvocalized query, and the reverse", () => {
    const vocalizedSent = arStatuses["components.statusSent"];
    expect(vocalizedSent).toMatch(/[ً-ٰٟ]/);
    const unvocalizedSent = stripArabicMarks(vocalizedSent);
    expect(unvocalizedSent).not.toBe(vocalizedSent);
    expect(filterPurchaseOrders(orders, unvocalizedSent, arStatuses).map((o) => o.number)).toEqual([
      "PO-003",
    ]);
    expect(filterPurchaseOrders(orders, vocalizedSent, arStatuses).map((o) => o.number)).toEqual([
      "PO-003",
    ]);

    const approvedLabel = arStatuses["components.statusApproved"];
    const vocalizedApproved = "مُعْتَمَد";
    expect(stripArabicMarks(vocalizedApproved)).toBe(approvedLabel);
    expect(
      filterPurchaseOrders(
        [{ number: "PO-004", vendorName: "Acme", status: "approved" }],
        vocalizedApproved,
        arStatuses
      ).map((o) => o.number)
    ).toEqual(["PO-004"]);
  });
});

describe("purchase order search UI", () => {
  beforeAll(async () => {
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });

  afterEach(async () => {
    await unmountPage();
    useI18n.setState({ locale: "en" });
    document.documentElement.removeAttribute("dir");
  });

  async function renderSearch(locale: "en" | "ar") {
    resetHarness();
    useI18n.setState({ locale });
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    setFixtures({
      [`/api/companies/${COMPANY_ID}/purchase-orders`]: [
        orders[0],
        { ...orders[1], status: "approved" },
      ].map((order) => ({
        ...order,
        id: order.number,
        companyId: COMPANY_ID,
        date: "2026-03-15",
        expectedDeliveryDate: "2026-03-20",
        currency: "AED",
        total: 100,
      })),
    });
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("input-search-po"));
    return byTestId("input-search-po") as HTMLInputElement;
  }

  it("finds an approved order using the Arabic label rendered by its badge", async () => {
    const search = await renderSearch("ar");
    const badge = [...document.querySelectorAll('[data-cell="status"]')].find(
      (cell) => cell.textContent === "معتمد"
    );
    expect(badge).toBeDefined();

    await type(search, badge!.textContent!);

    expect(byTestId("purchase-orders-table")?.textContent).toContain("PO-002");
    expect(byTestId("purchase-orders-table")?.textContent).not.toContain("PO-001");
  });

  it.each([
    { locale: "ar" as const, query: "PO-002", direction: "rtl" },
    { locale: "en" as const, query: "النور", direction: "ltr" },
  ])(
    "keeps the icon and input on the $direction start edge for $query",
    async ({ locale, query, direction }) => {
      const search = await renderSearch(locale);
      await type(search, query);

      // jsdom has no layout. Check the shared direction and logical positioning utilities.
      const icon = search.parentElement?.querySelector("svg");
      expect(icon?.matches(`:dir(${direction})`)).toBe(true);
      expect(search.matches(`:dir(${direction})`)).toBe(true);
      expect(icon?.classList.contains("start-3")).toBe(true);
      expect(icon?.classList.contains("top-1/2")).toBe(false);
      expect(search.parentElement?.classList.contains("items-center")).toBe(true);
      expect(search.classList.contains("ps-9")).toBe(true);
      expect(byTestId("purchase-orders-table")?.textContent).toContain("PO-002");
    }
  );

  it("announces no matches and restores search focus after clearing", async () => {
    const search = await renderSearch("en");
    const announcement = document.querySelector('[role="status"]');
    expect(announcement?.textContent).toBe("");

    search.focus();
    await type(search, "no-such-order");

    expect(document.activeElement).toBe(search);
    expect(document.querySelector('[role="status"]')).toBe(announcement);
    expect(announcement?.textContent).toBe("No matching purchase orders");
    const noMatch = byTestId("empty-purchase-orders-search");
    expect(noMatch?.textContent).toContain("No matching purchase orders");
    const clear = buttonByText(/^Clear search$/, noMatch!);
    clear?.focus();
    expect(document.activeElement).toBe(clear);
    await click(clear);

    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("");
    expect(announcement?.textContent).toBe("");
    expect(byTestId("empty-purchase-orders-search")).toBeNull();
    expect(byTestId("purchase-orders-table")?.textContent).toContain("PO-001");
  });
});

describe("purchase order list load states", () => {
  const queryKey = ["/api/companies", COMPANY_ID, "purchase-orders"];
  const row = {
    id: "PO-001",
    companyId: COMPANY_ID,
    number: "PO-001",
    vendorName: "Acme Trading",
    status: "draft",
    date: "2026-03-15",
    expectedDeliveryDate: "2026-03-20",
    currency: "AED",
    total: 100,
  };
  const fetchOrders = vi.fn<() => Promise<unknown[]>>();

  beforeAll(async () => {
    await loadLocale("en");
  });

  beforeEach(() => {
    resetHarness();
    useI18n.setState({ locale: "en" });
    fetchOrders.mockReset();
    queryClient.setQueryDefaults(queryKey, { queryFn: () => fetchOrders() });
  });

  afterEach(async () => {
    await unmountPage();
    onlineManager.setOnline(true);
    queryClient.setQueryDefaults(queryKey, {});
  });

  const table = () => byTestId("purchase-orders-table");

  function expectNoEmptyState() {
    expect(byTestId("empty-purchase-orders")).toBeNull();
    expect(byTestId("empty-purchase-orders-search")).toBeNull();
  }

  async function refresh() {
    await act(async () => {
      void queryClient.refetchQueries({ queryKey });
    });
    await flush();
  }

  it("shows the failure instead of an empty list, and Retry recovers through loading", async () => {
    fetchOrders.mockRejectedValueOnce(new Error("boom"));
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("error-purchase-orders"));

    expect(byTestId("error-purchase-orders")?.getAttribute("role")).toBe("alert");
    expectNoEmptyState();

    let resolve!: (rows: unknown[]) => void;
    fetchOrders.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await click(buttonByText(/^Try again$/, byTestId("error-purchase-orders")!));

    expect(fetchOrders).toHaveBeenCalledTimes(2);
    expect(byTestId("error-purchase-orders")).toBeNull();
    expectNoEmptyState();
    expect(table()?.textContent).not.toContain("PO-001");

    await act(async () => resolve([row]));
    await flushUntil(() => !!table()?.textContent?.includes("PO-001"));
    expect(table()?.textContent).toContain("PO-001");
  });

  it("returns to the failure when Retry fails again", async () => {
    fetchOrders.mockRejectedValue(new Error("boom"));
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("error-purchase-orders"));

    await click(buttonByText(/^Try again$/, byTestId("error-purchase-orders")!));
    await flushUntil(() => !!byTestId("error-purchase-orders"));

    expect(fetchOrders).toHaveBeenCalledTimes(2);
    expect(byTestId("error-purchase-orders")).not.toBeNull();
    expectNoEmptyState();
  });

  it("announces a paused first load and recovers on reconnect", async () => {
    onlineManager.setOnline(false);
    fetchOrders.mockResolvedValue([row]);
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("list-query-waiting"));

    expect(byTestId("list-query-waiting")?.getAttribute("role")).toBe("status");
    expect(byTestId("list-query-waiting")?.textContent).toBe(
      "Loading is paused. It will resume automatically when possible."
    );
    expect(fetchOrders).not.toHaveBeenCalled();
    expectNoEmptyState();

    await act(async () => onlineManager.setOnline(true));
    await flushUntil(() => !!table()?.textContent?.includes("PO-001"));

    expect(table()?.textContent).toContain("PO-001");
    expect(byTestId("list-query-waiting")).toBeNull();
  });

  it("shows the empty state only after a successful empty load", async () => {
    fetchOrders.mockResolvedValue([]);
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("empty-purchase-orders"));

    expect(byTestId("empty-purchase-orders")).not.toBeNull();
    expect(byTestId("error-purchase-orders")).toBeNull();
    expect(byTestId("list-query-waiting")).toBeNull();
  });

  it("shows loading, no empty message and no request while there is no company", async () => {
    noCompany.value = true;
    try {
      await renderPage(PurchaseOrders);
      await flush();

      expect(byTestId("purchase-orders-table")).not.toBeNull();
      expect(byTestId("table-skeleton")).not.toBeNull();
      expectNoEmptyState();
      expect(byTestId("error-purchase-orders")).toBeNull();
      expect(byTestId("list-query-waiting")).toBeNull();
      expect(document.body.textContent).not.toContain("No purchase orders yet");
      expect(fetchOrders).not.toHaveBeenCalled();
      expect(apiCalls()).toEqual([]);
    } finally {
      noCompany.value = false;
    }
  });

  it("keeps a cached empty list and offers Retry when the refresh fails", async () => {
    fetchOrders.mockResolvedValueOnce([]);
    await renderPage(PurchaseOrders);
    await flushUntil(() => !!byTestId("empty-purchase-orders"));

    fetchOrders.mockRejectedValueOnce(new Error("boom"));
    await refresh();

    expect(queryClient.getQueryState(queryKey)?.status).toBe("error");
    expect(table()).not.toBeNull();
    expect(table()?.querySelector("table")).toBeNull();
    expect(byTestId("table-skeleton")).toBeNull();
    expect(byTestId("empty-purchase-orders")).not.toBeNull();
    expect(byTestId("error-purchase-orders")).toBeNull();
    expect(byTestId("stale-data-notice")?.getAttribute("role")).toBe("alert");
    expect(buttonByText(/^Retry$/, byTestId("stale-data-notice")!)).toBeTruthy();
    expect(byTestId("list-query-waiting")).toBeNull();
  });

  it.each(["failed", "paused"] as const)(
    "keeps cached rows and search usable when a background refresh is %s",
    async (mode) => {
      fetchOrders.mockResolvedValueOnce([row]);
      await renderPage(PurchaseOrders);
      await flushUntil(() => !!byTestId("input-search-po"));

      if (mode === "failed") fetchOrders.mockRejectedValueOnce(new Error("boom"));
      else onlineManager.setOnline(false);
      await refresh();

      const state = queryClient.getQueryState(queryKey);
      if (mode === "failed") expect(state?.status).toBe("error");
      else expect(state?.fetchStatus).toBe("paused");
      expect(table()?.textContent).toContain("PO-001");
      expect(byTestId("error-purchase-orders")).toBeNull();
      expect(byTestId("list-query-waiting")).toBeNull();

      await type(byTestId("input-search-po"), "no-such-order");
      expect(byTestId("empty-purchase-orders-search")).not.toBeNull();
      expect(queryClient.getQueryData(queryKey)).toEqual([row]);
    }
  );
});

describe("purchase order locale keys", () => {
  for (const key of ["poSearch", "poNoMatch", "poNoMatchBody", "eyebrow"]) {
    it(`purchases.${key} exists in en and ar`, () => {
      for (const loc of ["en", "ar"]) {
        const c = JSON.parse(
          readFileSync(`client/src/locales/${loc}/purchases.json`, "utf8")
        ) as Record<string, string>;
        expect(c[`purchases.${key}`]).toBeTruthy();
      }
    });
  }
});
