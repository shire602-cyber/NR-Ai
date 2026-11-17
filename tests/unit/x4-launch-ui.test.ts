// @vitest-environment jsdom
/**
 * X4 launch fixes (journey J3), rendered: "My Claims" uses the real signed-in user, approving a
 * claim needs no notes, payroll reimbursement asks for the employee, the purchase-order form
 * links a product, express onboarding keeps the sign-up TRN, budget detail shows plain text
 * and separate income / expense / net variance, and corporate tax filing asks for the
 * EmaraTax reference.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  buttonByText,
  click,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  currentUserQueryKey: ["/api/auth/me"],
  useCurrentUser: () => ({
    data: { id: "u0000000-0000-4000-8000-000000000001", email: "me@x4.test", name: "Me" },
    isLoading: false,
  }),
}));
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
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useLocation: () => ["/onboarding", () => {}],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const ME = "u0000000-0000-4000-8000-000000000001";
const OTHER = "u0000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  await loadLocale("en");
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

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const text = () => document.body.textContent ?? "";

/** Radix tabs and menus activate on mousedown / keyboard, not click. */
async function activate(el: Element | null) {
  if (!el) throw new Error("element not found");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  });
  await flush();
}

function claim(id: string, over: Record<string, unknown>) {
  return {
    id,
    claim_number: `EC-${id.slice(-3)}`,
    title: `Claim ${id.slice(-3)}`,
    description: null,
    total_amount: "120.00",
    currency: "AED",
    status: "draft",
    submitted_by: OTHER,
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("[X4][J3] expense claims", () => {
  it("My Claims lists the signed-in user's claims (not an always-empty stub)", async () => {
    setFixtures({
      [`${C}/expense-claims`]: [
        claim("c0000000-0000-4000-8000-000000000101", { submitted_by: ME, title: "Mine" }),
        claim("c0000000-0000-4000-8000-000000000102", { title: "Someone else's" }),
      ],
    });
    const { default: ExpenseClaims } = await import("../../client/src/pages/ExpenseClaims");
    await renderPage(ExpenseClaims);
    const panel = document.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement;
    expect(panel.textContent).toContain("Mine");
    expect(panel.textContent).not.toContain("Someone else's");
  });

  it("approving with empty notes is allowed; rejecting still needs a reason", async () => {
    const id = "c0000000-0000-4000-8000-000000000103";
    setFixtures({
      [`${C}/expense-claims`]: [claim(id, { status: "submitted", title: "To review" })],
    });
    const { default: ExpenseClaims } = await import("../../client/src/pages/ExpenseClaims");
    await renderPage(ExpenseClaims);
    await activate(document.querySelector('[role="tab"][id$="review"], [role="tab"]:nth-child(2)'));
    await click(document.querySelector('button[aria-label="Approve"]'));
    expect(dialog()).toBeTruthy();
    await submit(dialog().querySelector('button[type="submit"]'));
    const approve = apiCalls("POST").filter((c) => c.url === `/api/expense-claims/${id}/approve`);
    expect(approve).toHaveLength(1);
    expect(text()).not.toContain("Review notes are required");

    await click(document.querySelector('button[aria-label="Reject"]'));
    await submit(dialog().querySelector('button[type="submit"]'));
    expect(apiCalls("POST").filter((c) => c.url.endsWith("/reject"))).toHaveLength(0);
  });

  it("reimbursing through payroll asks which employee and sends employee_id", async () => {
    const id = "c0000000-0000-4000-8000-000000000104";
    const empId = "e0000000-0000-4000-8000-000000000001";
    setFixtures({
      [`${C}/expense-claims`]: [claim(id, { status: "approved", submitted_by: ME })],
      [`${C}/employees`]: [
        { id: empId, full_name: "Payroll Person", employee_number: "E-7", status: "active" },
      ],
    });
    const { default: ExpenseClaims } = await import("../../client/src/pages/ExpenseClaims");
    await renderPage(ExpenseClaims);
    const trigger = document.querySelector(
      '[role="tabpanel"][data-state="active"] button[aria-haspopup="menu"]'
    );
    await activate(trigger);
    await click(byTestId(`claim-payroll-${id}`));
    expect(byTestId("claim-payroll-employee")).toBeTruthy();
    const select = dialog().querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    await type(select, empId);
    await click(byTestId("claim-payroll-confirm"));
    const calls = apiCalls("POST").filter((c) => c.url.endsWith("/payroll-reimbursement"));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ enabled: true });
    expect(calls[0].body).toMatchObject({ employee_id: empId });
  });
});

describe("[X4][J3] purchase order form links a product", () => {
  it("each line has a product picker and the chosen product is sent", async () => {
    const productId = "p0000000-0000-4000-8000-000000000001";
    setFixtures({
      [`${C}/products`]: [{ id: productId, name: "Widget", sku: "W-1", costPrice: 25 }],
    });
    const { default: PurchaseOrders } = await import("../../client/src/pages/PurchaseOrders");
    await renderPage(PurchaseOrders);
    await click(buttonByText(/new purchase order/i));
    expect(byTestId("po-line-product-0")).toBeTruthy();
    const selects = [...dialog().querySelectorAll("select")];
    const productSelect = selects.find((s) =>
      [...s.options].some((o) => o.value === productId)
    ) as HTMLSelectElement;
    expect(productSelect).toBeTruthy();
    await type(productSelect, productId);
    await type(dialog().querySelector('[name="vendorName"]'), "Supplier LLC");
    await submit(dialog().querySelector('button[type="submit"]'));
    const post = apiCalls("POST").find((c) => c.url === `${C}/purchase-orders`);
    expect(post, JSON.stringify(apiCalls())).toBeTruthy();
    expect((post!.body as { lines: Array<Record<string, unknown>> }).lines[0]).toMatchObject({
      productId,
      description: "Widget",
      unitPrice: 25,
    });
  });
});

describe("[X4][J3] express onboarding keeps the sign-up TRN", () => {
  it("prefills the TRN and never sends it blank", async () => {
    setFixtures({
      "/api/companies": [
        { id: COMPANY_ID, name: "J3 Trading", trnVatNumber: "100000000022972", emirate: "dubai" },
      ],
    });
    const { default: Onboarding } = await import("../../client/src/pages/Onboarding");
    await renderPage(Onboarding);
    const trn = byTestId("express-trn") as HTMLInputElement;
    expect(trn.value).toBe("100000000022972");
    await click(byTestId("onboarding-express"));
    await flush(5);
    const patch = apiCalls("PATCH").find((c) => c.url === `/api/companies/${COMPANY_ID}`);
    expect(patch, JSON.stringify(apiCalls())).toBeTruthy();
    expect(patch!.body).toMatchObject({ trnVatNumber: "100000000022972" });
  });
});

describe("[X4][J3] budget detail", () => {
  it("header shows the status text and the summary separates income, expense and net", async () => {
    const budgetId = "b0000000-0000-4000-8000-000000000001";
    const month = (budget: number, actual: number) => ({
      budget,
      actual,
      variance: 0,
      variancePercent: 0,
    });
    const months = (b: number, a: number) =>
      Object.fromEntries(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
          (m, i) => [m, i === 0 ? month(b, a) : month(0, 0)]
        )
      );
    setFixtures({
      [`${C}/budget-plans`]: [
        {
          id: budgetId,
          name: "FY 2026 plan",
          fiscal_year: 2026,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          status: "draft",
          created_at: "2026-01-01",
        },
      ],
      [`/api/budget-plans/${budgetId}/variance`]: {
        budget: { id: budgetId, name: "FY 2026 plan", fiscalYear: 2026 },
        varianceLines: [
          {
            id: "l1",
            category: "Sales",
            description: null,
            accountId: "a1",
            accountType: "income",
            months: months(100_000, 110_000),
            totals: { budget: 100_000, actual: 110_000, variance: 10_000, variancePercent: 10 },
          },
          {
            id: "l2",
            category: "Rent",
            description: null,
            accountId: "a2",
            accountType: "expense",
            months: months(62_500, 52_456.66),
            totals: { budget: 62_500, actual: 52_456.66, variance: 10_043.34, variancePercent: 16 },
          },
        ],
      },
    });
    const { default: Budgets } = await import("../../client/src/pages/Budgets");
    await renderPage(Budgets);
    const open = [...document.querySelectorAll("button, tr, a")].find((el) =>
      /FY 2026 plan/.test(el.textContent ?? "")
    );
    await click(open ?? null);
    expect(text()).not.toContain("[object Object]");
    expect(text()).toMatch(/FY 2026 · Draft/);
    await activate(
      [...document.querySelectorAll('[role="tab"]')].find((tab) =>
        /variance/i.test(tab.textContent ?? "")
      ) ?? null
    );
    await flush(5);
    expect(byTestId("budget-summary-income")?.textContent).toContain("110,000");
    expect(byTestId("budget-summary-expense")?.textContent).toContain("52,456.66");
    expect(byTestId("budget-summary-net")?.textContent).toMatch(/20,043\.34/);
    expect(byTestId("budget-summary-net")?.textContent).toMatch(/Favourable/);
  });
});

describe("[X4][J3] corporate tax: record as filed", () => {
  it("asks for confirmation with the EmaraTax reference and date before filing", async () => {
    const id = "r0000000-0000-4000-8000-000000000001";
    setFixtures({
      [`/api/companies/${COMPANY_ID}/corporate-tax/returns`]: [
        {
          id,
          companyId: COMPANY_ID,
          taxPeriodStart: "2025-01-01",
          taxPeriodEnd: "2025-12-31",
          totalRevenue: 1_000_000,
          totalExpenses: 400_000,
          totalDeductions: 0,
          taxableIncome: 600_000,
          exemptionThreshold: 375_000,
          taxRate: 0.09,
          taxPayable: 20_250,
          status: "reviewed",
          filedAt: null,
          workpaper: null,
          notes: null,
          createdAt: "2026-01-10T00:00:00Z",
        },
      ],
    });
    const { default: CorporateTax } = await import("../../client/src/pages/CorporateTax");
    await renderPage(CorporateTax);
    await click(byTestId(`button-ct-file-${id}`));
    // Nothing is filed by the click itself.
    expect(apiCalls("POST").filter((c) => c.url.endsWith("/transition"))).toHaveLength(0);
    const confirm = byTestId("button-ct-file-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await type(byTestId("input-ct-filing-reference"), "FTA-CT-2026-001");
    await type(byTestId("input-ct-filed-on"), "2026-02-10");
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    const calls = apiCalls("POST").filter((c) => c.url.endsWith(`/returns/${id}/transition`));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      to: "filed",
      filingReference: "FTA-CT-2026-001",
      filedOn: "2026-02-10",
    });
  });
});
