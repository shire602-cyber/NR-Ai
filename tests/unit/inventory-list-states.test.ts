// @vitest-environment jsdom
/**
 * Inventory list: a failed products read is a retryable error (not "No products yet"), a
 * whitespace-only search does not hide the catalogue, and service items never show "Low stock".
 * A failed refresh keeps the cached answer, and a paused first load is not an empty catalogue.
 */
import { onlineManager } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  byTestId,
  click,
  COMPANY_ID,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

const mode = vi.hoisted(() => ({ fail: false }));

vi.mock("../../client/src/lib/queryClient", () => {
  const m = formHarnessQueryClientMock();
  const lookupFn = m.getQueryFn();
  m.queryClient.setDefaultOptions({
    queries: {
      retry: false,
      staleTime: Infinity,
      queryFn: async (ctx: { queryKey: readonly unknown[] }) => {
        if (mode.fail && /\/products$/.test(ctx.queryKey.join("/"))) {
          const err = new m.ApiError("SQL error internal-boom");
          err.status = 500;
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

type InventoryComponent = typeof import("../../client/src/pages/Inventory").default;
let InventoryPage: InventoryComponent;

// Preload the page module graph and locales once: the cold dynamic import is transform cost, not
// the behaviour under test, and under a loaded runner it can consume a whole case timeout.
beforeAll(async () => {
  const [mod] = await Promise.all([
    import("../../client/src/pages/Inventory"),
    loadLocale("en"),
    loadLocale("ar"),
  ]);
  InventoryPage = mod.default;
}, 180_000);
beforeEach(() => {
  resetHarness();
  mode.fail = false;
  window.localStorage.clear();
});
afterEach(async () => {
  await unmountPage();
  // onlineManager is global: never leave it offline for the next test.
  onlineManager.setOnline(true);
});

const product = (over: Record<string, unknown>) => ({
  id: "p1",
  name: "Widget",
  nameAr: null,
  sku: "W-1",
  unitPrice: 10,
  costPrice: 5,
  currentStock: 0,
  lowStockThreshold: 10,
  unit: "pcs",
  isActive: true,
  ...over,
});

async function render() {
  await renderPage(InventoryPage);
  await flush(30);
}

const PRODUCTS_URL = `/api/companies/${COMPANY_ID}/products`;

async function refreshProducts() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [PRODUCTS_URL] });
  });
  await flush(5);
  return queryClient.getQueryState([PRODUCTS_URL]);
}

describe("inventory products list", { timeout: 90_000 }, () => {
  it("a failed first read shows a retryable error, and Retry shows the products", async () => {
    mode.fail = true;
    setFixtures({ [PRODUCTS_URL]: [product({ name: "Gadget" })] });
    await render();
    const error = byTestId("inventory-products-error");
    expect(error).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/No products yet/i);
    expect(document.body.textContent).not.toContain("internal-boom");

    mode.fail = false;
    await click(error!.querySelector("button"));
    await flush(30);

    expect(byTestId("inventory-products-error")).toBeNull();
    expect(document.body.textContent).toContain("Gadget");
  });

  it("a failed refresh keeps the cached rows", async () => {
    setFixtures({ [PRODUCTS_URL]: [product({ name: "Gadget" })] });
    await render();

    mode.fail = true;
    const state = await refreshProducts();

    expect(state?.status).toBe("error");
    expect(byTestId("inventory-products-error")).toBeNull();
    expect(document.body.textContent).toContain("Gadget");
  });

  it("a paused first load waits instead of showing the empty catalogue", async () => {
    setFixtures({ [PRODUCTS_URL]: [] });
    onlineManager.setOnline(false);
    await render();

    expect(byTestId("inventory-products-waiting")).not.toBeNull();
    expect(byTestId("inventory-products-error")).toBeNull();
    expect(document.body.textContent).not.toMatch(/No products yet/i);

    await act(async () => onlineManager.setOnline(true));
    await flush(30);

    expect(byTestId("inventory-products-waiting")).toBeNull();
    expect(document.body.textContent).toMatch(/No products yet/i);
  });

  it("service items are not flagged as low stock", async () => {
    setFixtures({
      [`/api/companies/${COMPANY_ID}/products`]: [
        product({ id: "s1", name: "Consulting", productType: "service" }),
        product({ id: "p2", name: "Gadget" }),
      ],
    });
    await render();
    const rows = [...document.querySelectorAll("tr")];
    const svc = rows.find((r) => r.textContent?.includes("Consulting"));
    const goods = rows.find((r) => r.textContent?.includes("Gadget"));
    expect(svc?.textContent).not.toMatch(/low stock/i);
    expect(goods?.textContent).toMatch(/low stock/i);
  });

  it("a whitespace-only search keeps the catalogue visible", async () => {
    setFixtures({ [`/api/companies/${COMPANY_ID}/products`]: [product({ name: "Gadget" })] });
    await render();
    const input = document.querySelector("input[aria-label]") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "   ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Gadget");
  });
});
