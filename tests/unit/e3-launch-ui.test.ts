// @vitest-environment jsdom
/**
 * E3 launch fixes, rendered (J1-r3 / J2-r3 / J3-r3 / J4-r3):
 *  - VAT Periods tab and the deadlines card read Filed / Paid from the return lifecycle;
 *  - a company that is not VAT registered sees "not registered" on /vat-filing, not figures;
 *  - an employee is not offered the expense-claim Review tab;
 *  - the row "Capitalise" asks for the paid-from account and the input VAT and sends it;
 *  - new invoice lines of a services company start on Service Revenue; bill line pickers leave
 *    out cash, bank, header and contra accounts.
 */
import { act } from "react";
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
  setResponse,
  type,
  pickOption,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { permissionsForRole, type CompanyRole } from "../../shared/permissions";
import { defaultLineIncomeAccountId } from "../../client/src/lib/invoice-defaults";
import { purchaseLineAccountGroups } from "../../client/src/lib/control-account-options";

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

const text = () => document.body.textContent ?? "";
const access = (role: CompanyRole) => ({
  [`${C}/team/me`]: {
    role,
    permissions: permissionsForRole(role),
    grantableRoles: [],
    viaFirmAccess: false,
    userId: "u-1",
  },
});

async function render(
  page: string,
  fixtures: Record<string, unknown>,
  role: CompanyRole = "owner"
) {
  setFixtures({ [C]: { ...COMPANY }, ...access(role), ...fixtures });
  const mod = await import(`../../client/src/pages/${page}.tsx`);
  await renderPage(mod.default ?? mod[Object.keys(mod)[0]]);
  await flush(5);
}

describe("[E3][J3-r3] VAT Periods and deadlines follow the return lifecycle", () => {
  it("a filed and paid Q3 reads Paid with its figures; the card shows the next return, not late", async () => {
    const lifecycle = {
      returnId: "r1",
      returnStatus: "filed",
      stage: "paid",
      filed: true,
      paymentDate: "2026-10-27T00:00:00.000Z",
      outputVat: 1500,
      inputVat: 200,
      netVatPayable: 1300,
    };
    setFixtures({
      [C]: { ...COMPANY },
      ...access("owner"),
      [`/api/vat/autopilot/periods/${COMPANY_ID}`]: [
        {
          id: null,
          companyId: COMPANY_ID,
          periodStart: "2026-07-01T00:00:00.000Z",
          periodEnd: "2026-09-30T23:59:59.999Z",
          dueDate: "2026-10-28T00:00:00.000Z",
          frequency: "quarterly",
          status: "accepted",
          outputVat: 1500,
          inputVat: 200,
          netVatPayable: 1300,
          calculatedAt: null,
          deadline: { daysUntilDue: -21, level: "ok", isOverdue: false },
          lifecycle,
        },
      ],
      [`/api/vat/autopilot/due-dates?companyId=${COMPANY_ID}`]: [
        {
          companyId: COMPANY_ID,
          companyName: "Synthetic",
          trnVatNumber: "100000000000003",
          periodEnd: "2026-12-31T23:59:59.999Z",
          dueDate: "2027-01-28T00:00:00.000Z",
          status: "draft",
          daysUntilDue: 71,
          level: "ok",
          lifecycle: null,
        },
      ],
    });
    const { VatPeriodsPanel } = await import("../../client/src/pages/VATAutopilot");
    await renderPage(VatPeriodsPanel);
    await flush(5);
    const status = byTestId("status-vat-period-2026-07-01");
    expect(status?.textContent).toBe("Paid");
    const row = status!.closest("tr")!;
    expect(row.textContent).not.toMatch(/Overdue/);
    expect(row.textContent).toContain("1,300.00");
    expect(byTestId("button-select-vat-period-2026-07-01")?.textContent).not.toMatch(/Prepare/);
    expect(text()).not.toMatch(/\d+d late/);
  });
});

describe("[E3][J2-r3] VAT page of a company that is not VAT registered", () => {
  it("says the company is not registered instead of showing input VAT", async () => {
    await render("VATFiling", {
      [C]: { ...COMPANY, trnVatNumber: null, taxRegistrationType: "Non-registered" },
      [`${C}/vat-returns`]: [],
    });
    expect(byTestId("card-vat-not-registered")).not.toBeNull();
    expect(byTestId("button-create-return")).toBeNull();
  });
});

describe("[E3][J3-r3] expense claims Review tab", () => {
  it("is not offered to an employee; an approver sees it", async () => {
    await render("ExpenseClaims", {}, "employee");
    expect(text()).not.toMatch(/Review/);
    await unmountPage();
    await render("ExpenseClaims", {}, "accountant");
    expect([...document.querySelectorAll('[role="tab"]')].map((e) => e.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Review/)])
    );
  });
});

describe("[E3][J3-r3] capitalise an asset from its row", () => {
  it("asks for the paid-from account and the input VAT, then sends both", async () => {
    const ASSET = "fa000000-0000-4000-8000-0000000000e3";
    await render("FixedAssets", {
      [`${C}/fixed-assets`]: [
        {
          id: ASSET,
          asset_name: "Forklift",
          category: "vehicles",
          status: "active",
          purchase_date: "2026-09-01",
          purchase_cost: "60000",
          accumulated_depreciation: "0",
          net_book_value: "60000",
          needs_capitalization_je: true,
          capitalization_entry_id: null,
        },
      ],
      [`${C}/fixed-assets/summary`]: {
        totalAssets: 1,
        totalCost: 60000,
        totalAccumulatedDepreciation: 0,
        totalNetBookValue: 60000,
        byCategory: [],
      },
      [`${C}/accounts`]: [
        { id: "a-bankh", code: "1020", nameEn: "Bank Accounts", type: "asset", subType: "bank" },
        {
          id: "a-bank",
          code: "1021",
          nameEn: "Main bank",
          type: "asset",
          subType: "bank",
          parentId: "a-bankh",
        },
      ],
    });
    // The row action lives in the ⋯ menu; open it and pick Capitalise.
    const menu = [...document.querySelectorAll<HTMLElement>("button[aria-haspopup='menu']")].pop();
    expect(menu, "row menu").toBeTruthy();
    // Radix opens a menu on keyboard Enter (jsdom has no pointer events).
    await act(async () => {
      menu!.focus();
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush(3);
    const item = byTestId(`button-capitalize-${ASSET}`)!;
    expect(item).not.toBeNull();
    await click(item);
    expect(byTestId("dialog-capitalize")).not.toBeNull();
    await type(byTestId("input-capitalize-input-vat"), "3000");
    await click(byTestId("button-confirm-capitalize"));
    await flush(5);
    const post = apiCalls("POST").find((c) => c.url === `/api/fixed-assets/${ASSET}/capitalize`);
    expect(post?.body).toEqual({ paymentAccountId: "a-bank", inputVat: 3000 });
  });
});

describe("[E3][J1-r3] line account defaults and pickers", () => {
  const accounts = [
    { id: "s", code: "4020", type: "income", nameEn: "Service Revenue" },
    { id: "g", code: "4010", type: "income", nameEn: "Product Sales" },
  ];
  it("a company with no stock items starts invoice lines on Service Revenue", () => {
    expect(defaultLineIncomeAccountId(accounts, [])).toBe("s");
    expect(defaultLineIncomeAccountId(accounts, [{ productType: "service" }])).toBe("s");
    expect(defaultLineIncomeAccountId(accounts, [{ productType: "inventory" }])).toBeUndefined();
  });

  it("bill / expense lines offer expenses and fixed assets, never cash, bank, contra or headers", () => {
    const groups = purchaseLineAccountGroups([
      { id: "cash", code: "1010", type: "asset", subType: "cash", nameEn: "Cash on Hand" },
      { id: "bankh", code: "1020", type: "asset", subType: "bank", nameEn: "Bank Accounts" },
      {
        id: "bank",
        code: "1021",
        type: "asset",
        subType: "bank",
        nameEn: "Main",
        parentId: "bankh",
      },
      { id: "pre", code: "1060", type: "asset", subType: "other_current_asset", nameEn: "Prepaid" },
      { id: "eq", code: "1210", type: "asset", subType: "fixed_asset", nameEn: "Office Equipment" },
      {
        id: "acc",
        code: "1240",
        type: "asset",
        subType: "fixed_asset",
        nameEn: "Accumulated Depreciation",
      },
      { id: "ap", code: "2010", type: "liability", nameEn: "Accounts Payable" },
      { id: "rent", code: "5070", type: "expense", nameEn: "Rent" },
    ]);
    expect(groups.expenses.map((a) => a.id)).toEqual(["rent"]);
    expect(groups.fixedAssets.map((a) => a.id)).toEqual(["eq"]);
    expect(groups.otherAssets.map((a) => a.id)).toEqual(["pre"]);
  });
});

describe("[E3][J1-r3] bank reconciliation summary after Find matches", () => {
  it("the 'with a suggested match' count is the search's own count", async () => {
    const tx = (id: string, amount: number) => ({
      id,
      companyId: COMPANY_ID,
      bankStatementAccountId: null,
      transactionDate: "2026-11-10",
      description: `Line ${id}`,
      amount,
      balance: null,
      reference: null,
      category: null,
      matchStatus: "unmatched",
      isReconciled: false,
      matchedJournalEntryId: null,
      matchedReceiptId: null,
      matchedInvoiceId: null,
      matchConfidence: null,
      importSource: "csv",
      createdAt: "2026-11-10T00:00:00.000Z",
    });
    const match = (id: string) => ({
      bankTransactionId: id,
      matchedType: "invoice",
      matchedId: `inv-${id}`,
      confidence: 95,
      matchReason: "Exact amount match",
    });
    setResponse(`${C}/auto-reconcile`, {
      matches: [match("t1"), match("t2"), match("t2"), match("t3")],
      autoMatchedCount: 0,
      manualReviewCount: 4,
      totalUnreconciled: 4,
    });
    await render("BankReconciliation", {
      [`${C}/bank-statements/transactions`]: [
        tx("t1", 100),
        tx("t2", 200),
        tx("t3", 300),
        tx("t4", 5),
      ],
    });
    expect(text()).toMatch(/0 with a suggested match/);
    await click(byTestId("button-auto-reconcile"));
    await flush(5);
    expect(text()).toMatch(/3 with a suggested match/);
  });
});

describe("[E3][J4-r3] an existing account accepting a team invitation", () => {
  it("signs in and comes back with accept=1; the invitation is accepted and the company opened", async () => {
    const realFetch = globalThis.fetch;
    const TOKEN = "tok-e3";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes(`/api/team-invitations/${TOKEN}`)) {
        return new Response(
          JSON.stringify({
            email: "sara@example.ae",
            role: "accountant",
            company: { id: "co-2", name: "Second LLC" },
            accountExists: true,
          }),
          { status: 200 }
        );
      }
      if (u.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: { id: "u-1", email: "sara@example.ae" } }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    setResponse(`/api/team-invitations/${TOKEN}/accept`, { companyId: "co-2", role: "accountant" });
    try {
      // Signed out: the sign-in button returns to this invitation with accept=1.
      window.history.replaceState(null, "", `/register?teamInvite=${TOKEN}`);
      vi.doMock("../../client/src/lib/auth", async (orig) => ({
        ...((await orig()) as object),
        fetchCurrentUser: async () => null,
      }));
      const { default: Register } = await import("../../client/src/pages/Register");
      await renderPage(Register);
      await flush(5);
      expect(text()).toMatch(/join the company straight away/);
      await unmountPage();
      vi.doUnmock("../../client/src/lib/auth");
      vi.resetModules();

      // Back from sign-in: accepted without opening the link again.
      window.history.replaceState(null, "", `/register?teamInvite=${TOKEN}&accept=1`);
      vi.doMock("../../client/src/lib/auth", async (orig) => ({
        ...((await orig()) as object),
        fetchCurrentUser: async () => ({ id: "u-1", email: "sara@example.ae" }),
      }));
      const fresh = await import("../../client/src/pages/Register");
      await renderPage(fresh.default);
      await flush(8);
      const post = apiCalls("POST").find((c) => c.url === `/api/team-invitations/${TOKEN}/accept`);
      expect(post, "accepted automatically").toBeTruthy();
      expect(window.localStorage.getItem("muhasib_active_company_id")).toBe("co-2");
    } finally {
      globalThis.fetch = realFetch;
      vi.doUnmock("../../client/src/lib/auth");
    }
  });
});

describe("[E3][J1-r3 / J2-r3] a USD bill's lines and totals are in USD", () => {
  it("the line amount reads the bill currency, not AED", async () => {
    await render("BillPay", {
      [`${C}/bills/summary`]: {
        pending: { count: 0, total: 0 },
        approved: { count: 0, total: 0 },
        partial: { count: 0, total: 0, paid: 0 },
        paid: { count: 0, total: 0 },
        overdue: { count: 0, total: 0 },
      },
      [`${C}/bills/aging`]: {
        current: { count: 0, amount: 0 },
        days_1_30: { count: 0, amount: 0 },
        days_31_60: { count: 0, amount: 0 },
        days_61_90: { count: 0, amount: 0 },
        days_90_plus: { count: 0, amount: 0 },
      },
    });
    await click(byTestId("button-new-bill"));
    const currencyItem = [...document.querySelectorAll("label")]
      .find((l) => (l.textContent ?? "").trim() === "Currency")!
      .closest("div")!;
    await pickOption(currencyItem.querySelector('[role="combobox"]'), "USD");
    await type(document.querySelector('input[name="line_items.0.quantity"]'), "1");
    await type(document.querySelector('input[name="line_items.0.unit_price"]'), "500");
    await flush(3);
    const amount = [...document.querySelectorAll("span")].find(
      (s) => (s.textContent ?? "").trim() === "Amount"
    )!.nextElementSibling!;
    expect(amount.textContent).toMatch(/USD|\$/);
    expect(amount.textContent).not.toMatch(/AED|د\.إ/);
    expect(amount.textContent).toMatch(/500\.00/);
  });
});
