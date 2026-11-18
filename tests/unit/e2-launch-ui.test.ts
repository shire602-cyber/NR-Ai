// @vitest-environment jsdom
/**
 * E2 (J3-r2 / J4-r2), rendered: the VAT return filing steps after "ready" (record the EmaraTax
 * filing, record the payment or refund, reverse it), the checklist, and a read-only viewer who is
 * not offered writes the server refuses.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY,
  COMPANY_ID,
  apiCalls,
  byTestId,
  click,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { permissionsForRole, type CompanyRole } from "../../shared/permissions";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const RID = "r0000000-0000-4000-8000-0000000000e2";

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => resetHarness());
afterEach(async () => {
  await unmountPage();
});

const text = () => document.body.textContent ?? "";
const all = (id: string) =>
  [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const access = (role: CompanyRole) => ({
  [`${C}/team/me`]: {
    role,
    permissions: permissionsForRole(role),
    grantableRoles: [],
    viaFirmAccess: false,
  },
});

function vatReturn(over: Record<string, unknown>) {
  return {
    id: RID,
    companyId: COMPANY_ID,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-09-30T23:59:59.999Z",
    dueDate: "2026-10-28T00:00:00.000Z",
    status: "ready",
    box8TotalVat: 100,
    box11TotalVat: 20,
    box12TotalDueTax: 100,
    box13RecoverableTax: 20,
    box14PayableTax: 80,
    paymentStatus: "unpaid",
    paymentAmount: null,
    paymentDate: null,
    ftaReferenceNumber: null,
    notes: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

async function renderVat(ret: Record<string, unknown>, role: CompanyRole = "owner") {
  setFixtures({
    [C]: { ...COMPANY },
    [`${C}/vat-returns`]: [vatReturn(ret)],
    [`${C}/accounts`]: [
      {
        id: "a-bank",
        code: "1020",
        nameEn: "Bank",
        type: "asset",
        subType: "bank",
        isActive: true,
      },
      { id: "a-ar", code: "1040", nameEn: "Receivables", type: "asset", subType: "receivable" },
    ],
    [`${C}/bank-accounts`]: [],
    ...access(role),
  });
  const { default: VATFiling } = await import("../../client/src/pages/VATFiling");
  await renderPage(VATFiling);
  await flush(5);
}

describe("[E2][J3-r2] VAT return after 'ready'", () => {
  it("a ready return offers Record filing; the checklist counts it as reviewed", async () => {
    await renderVat({ status: "ready" });
    expect(all(`button-record-filing-${RID}`).length).toBeGreaterThan(0);
    const checklist = byTestId("vat-filing-checklist")!;
    const items = [...checklist.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items[1]).toMatch(/Reviewed and ready.*\(done\)/);
    expect(items[2]).toMatch(/\(not done\)/);
    expect(text()).toMatch(/Ready to file/);

    await click(all(`button-record-filing-${RID}`)[0]);
    const confirm = byTestId("button-confirm-filing") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await type(byTestId("input-fta-reference"), "ET-2026-Q3-77");
    await click(confirm);
    await flush(5);
    const post = apiCalls("POST").find((c) => c.url === `/api/vat-returns/${RID}/submit`);
    expect(post?.body).toMatchObject({ ftaReferenceNumber: "ET-2026-Q3-77" });
    expect((post?.body as { filedOn: string }).filedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((post?.body as { filedOn: string }).filedOn > "2026-09-30").toBe(true);
  });

  it("a filed return offers Record payment for the Box 14 amount and a bank account", async () => {
    await renderVat({ status: "filed", ftaReferenceNumber: "ET-1" });
    expect(all(`button-record-filing-${RID}`)).toHaveLength(0);
    await click(all(`button-record-settlement-${RID}`)[0]);
    expect(byTestId("text-settlement-amount")?.textContent).toContain("80.00");
    await flush(5);
    await click(byTestId("button-confirm-settlement"));
    await flush(5);
    const post = apiCalls("POST").find((c) => c.url === `/api/vat-returns/${RID}/settlement`);
    expect(post?.body).toMatchObject({ paymentAccountId: "a-bank" });
    expect((post?.body as { date: string }).date > "2026-09-30").toBe(true);
  });

  it("a refund return offers Record refund", async () => {
    await renderVat({ status: "filed", box14PayableTax: -190 });
    const btn = all(`button-record-settlement-${RID}`)[0];
    expect(btn.textContent).toMatch(/Record refund/);
  });

  it("a paid return shows Paid, the last checklist step done, and offers a reversal", async () => {
    await renderVat({
      status: "filed",
      paymentStatus: "paid",
      paymentDate: "2026-10-20T00:00:00Z",
    });
    expect(text()).toMatch(/Paid 20 Oct 2026/);
    const items = [...byTestId("vat-filing-checklist")!.querySelectorAll("li")];
    expect(items[3].textContent).toMatch(/Payment recorded.*\(done\)/);
    await click(all(`button-reverse-settlement-${RID}`)[0]);
    const confirm = byTestId("button-confirm-reverse-settlement") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("a viewer sees the step but cannot use it", async () => {
    await renderVat({ status: "ready" }, "viewer");
    const btn = all(`button-record-filing-${RID}`)[0] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/role does not allow/i);
  });
});

describe("[E2][J4-r2] a read-only viewer is not offered writes the server refuses", () => {
  const ASSET = "fa000000-0000-4000-8000-000000000001";
  const PRODUCT = "pd000000-0000-4000-8000-000000000001";

  async function renderAs(role: CompanyRole, page: string, fixtures: Record<string, unknown> = {}) {
    setFixtures({ [C]: { ...COMPANY }, ...access(role), ...fixtures });
    const mod = await import(`../../client/src/pages/${page}.tsx`);
    await renderPage(mod.default);
    await flush(5);
  }
  const denied = (el: Element | null) => {
    expect(el, "control rendered").not.toBeNull();
    expect((el as HTMLButtonElement).disabled).toBe(true);
    expect((el as HTMLElement).title).toMatch(/role does not allow/i);
  };

  it("Fixed assets: Add asset, Record depreciation and Edit are disabled with the reason", async () => {
    const asset = {
      id: ASSET,
      asset_name: "Laptop",
      category: "computers",
      status: "active",
      purchase_date: "2026-01-01",
      purchase_cost: "12000",
      accumulated_depreciation: "0",
      net_book_value: "12000",
    };
    const fx = {
      [`${C}/fixed-assets`]: [asset],
      [`${C}/fixed-assets/summary`]: {
        totalAssets: 1,
        totalCost: 12000,
        totalAccumulatedDepreciation: 0,
        totalNetBookValue: 12000,
        byCategory: [],
      },
    };
    await renderAs("viewer", "FixedAssets", fx);
    denied(byTestId("button-add-asset"));
    denied(byTestId(`button-record-depreciation-${ASSET}`));
    await unmountPage();
    await renderAs("owner", "FixedAssets", fx);
    expect((byTestId("button-add-asset") as HTMLButtonElement).disabled).toBe(false);
    // The row action opens a period choice (never a one-click, future-dated posting).
    await click(byTestId(`button-record-depreciation-${ASSET}`));
    expect(byTestId("dialog-depreciation")).not.toBeNull();
    expect(apiCalls("POST")).toHaveLength(0);
  });

  it("Budgets: New Budget is disabled", async () => {
    await renderAs("viewer", "Budgets");
    denied(byTestId("button-new-budget"));
  });

  it("Inventory: Add product is disabled", async () => {
    await renderAs("viewer", "Inventory", {
      [`${C}/products`]: [{ id: PRODUCT, name: "Widget", isActive: true, currentStock: 3 }],
    });
    denied(byTestId("button-add-product"));
  });

  it("Contacts: Add contact is disabled", async () => {
    await renderAs("viewer", "CustomerContacts");
    denied(byTestId("button-add-contact"));
  });

  it("Purchase orders and expense claims: create is disabled", async () => {
    await renderAs("viewer", "PurchaseOrders");
    denied(byTestId("button-new-po"));
    await unmountPage();
    await renderAs("viewer", "ExpenseClaims");
    denied(byTestId("button-new-claim"));
  });
});
