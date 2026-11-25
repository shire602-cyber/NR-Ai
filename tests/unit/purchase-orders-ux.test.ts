// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { filterPurchaseOrders } from "../../client/src/lib/purchase-order-filters";
import enStatuses from "../../client/src/locales/en/components.json";
import arStatuses from "../../client/src/locales/ar/components.json";
import { stripArabicMarks } from "../../shared/arabic-text";
import {
  COMPANY_ID,
  buttonByText,
  byTestId,
  click,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import PurchaseOrders from "../../client/src/pages/PurchaseOrders";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
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
