// @vitest-environment jsdom
/**
 * Inventory list: a failed products read is a retryable error (not "No products yet"), a
 * whitespace-only search does not hide the catalogue, and service items never show "Low stock".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  mode.fail = false;
  window.localStorage.clear();
});
afterEach(unmountPage);

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
  const { default: Inventory } = await import("../../client/src/pages/Inventory");
  await renderPage(Inventory);
  await flush(30);
}

describe("inventory products list", { timeout: 90_000 }, () => {
  it("a failed read shows a retryable error, not the empty catalogue", async () => {
    mode.fail = true;
    await render();
    expect(document.querySelector('[data-testid="inventory-products-error"]')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/No products yet/i);
    expect(document.body.textContent).not.toContain("internal-boom");
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
