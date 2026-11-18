// @vitest-environment jsdom
/**
 * E3 (J4-r3 Medium): a read-only Viewer still saw enabled write controls on 14+ pages (Invoices
 * and Bills "Record payment", Contacts "Add contact", Journal "Void", Corporate tax "Calculate" /
 * "Remove", VAT "New VAT draft", Company settings "Save", ...). The server answered 403 only after
 * the click. Every write control on these pages now goes through the same permission gate as
 * Inventory / Fixed assets (useCompanyPermission().gate): disabled, with the role explanation.
 *
 * The check is behavioural: render the page as a viewer with rows that offer row actions, collect
 * every button / menu item whose label is a write action, and require each to be disabled with
 * the reason. The same page as an owner keeps them enabled.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY,
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

const access = (role: CompanyRole) => ({
  [`${C}/team/me`]: {
    role,
    permissions: permissionsForRole(role),
    grantableRoles: [],
    viaFirmAccess: false,
  },
});

const INV = "i0000000-0000-4000-8000-0000000000e3";
const BILL = "b0000000-0000-4000-8000-0000000000e3";
const JE = "j0000000-0000-4000-8000-0000000000e3";

const FIXTURES: Record<string, unknown> = {
  [C]: { ...COMPANY, taxRegistrationType: "Standard" },
  [`${C}/invoices`]: [
    {
      id: INV,
      companyId: COMPANY_ID,
      number: "INV-2026-00001",
      customerName: "Acme LLC",
      date: "2026-11-01T00:00:00.000Z",
      dueDate: "2026-12-01T00:00:00.000Z",
      currency: "AED",
      subtotal: 5000,
      vatAmount: 250,
      total: 5250,
      status: "sent",
      invoiceType: "invoice",
      openBalanceBase: 5250,
      paidAmount: 0,
    },
  ],
  [`${C}/bills`]: [
    {
      id: BILL,
      company_id: COMPANY_ID,
      vendor_name: "Supplier LLC",
      bill_number: "B-1",
      bill_date: "2026-11-01",
      due_date: "2026-12-01",
      currency: "AED",
      subtotal: "1000",
      vat_amount: "50",
      total_amount: "1050",
      amount_paid: "0",
      status: "approved",
    },
  ],
  [`${C}/journal`]: [
    {
      id: JE,
      entryNumber: "JE-20261101-001",
      date: "2026-11-01T00:00:00.000Z",
      memo: "Accrual",
      status: "posted",
      source: "manual",
      lines: [],
      totalDebit: 100,
      totalCredit: 100,
    },
  ],
};

/** Labels of controls that write. A viewer may still open, view, export and download. */
const WRITE_LABEL =
  /^(add|new|create|record payment|record|void|import|save|calculate|remove|delete|edit|mark as|upload|approve|submit|issue|post|reverse|send back|amend|pull)\b/i;
/**
 * Labels that match a write verb but only read: Corporate tax "Calculate" previews the figures
 * (GET /corporate-tax/calculate), which a viewer may run (reports.read).
 */
const READ_ONLY = new Set(["Calculate"]);

const labelOf = (el: HTMLElement) =>
  (
    (el.textContent ?? "").trim() ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    ""
  ).trim();

function writeControls(): HTMLElement[] {
  const nodes = [
    ...document.querySelectorAll<HTMLElement>('button, [role="menuitem"], a[role="button"]'),
  ];
  return nodes.filter((el) => WRITE_LABEL.test(labelOf(el)) && !READ_ONLY.has(labelOf(el)));
}

function enabledWriteControls(): string[] {
  return writeControls()
    .filter((el) => {
      const disabled =
        (el as HTMLButtonElement).disabled ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("data-disabled");
      return !disabled;
    })
    .map((el) => (el.getAttribute("data-testid") ?? "") + ":" + labelOf(el));
}

async function renderAs(role: CompanyRole, page: string, extra: Record<string, unknown> = {}) {
  setFixtures({ ...FIXTURES, ...access(role), ...extra });
  const mod = await import(`../../client/src/pages/${page}.tsx`);
  await renderPage(mod.default);
  await flush(5);
}

const cnt = (count: number, total: number) => ({ count, total, paid: 0, amount: total });
const ctReturn = (id: string, status: string) => ({
  id,
  companyId: COMPANY_ID,
  taxPeriodStart: "2025-01-01",
  taxPeriodEnd: "2025-12-31",
  totalRevenue: 800000,
  totalExpenses: 0,
  totalDeductions: 0,
  taxableIncome: 800000,
  exemptionThreshold: 375000,
  taxRate: 0.09,
  taxPayable: 38250,
  status,
  filedAt: status === "filed" ? "2026-03-01T00:00:00.000Z" : null,
  preparedBy: "someone-else",
  amendmentNumber: 0,
  workpaper: null,
  notes: null,
  createdAt: "2026-01-10T00:00:00.000Z",
});
const PAGE_FIXTURES: Record<string, Record<string, unknown>> = {
  CorporateTax: {
    [`${C}/corporate-tax/returns`]: [
      ctReturn("ct000000-0000-4000-8000-000000000001", "draft"),
      ctReturn("ct000000-0000-4000-8000-000000000002", "computed"),
      ctReturn("ct000000-0000-4000-8000-000000000003", "reviewed"),
      ctReturn("ct000000-0000-4000-8000-000000000004", "filed"),
    ],
  },
  Invoices: {
    [`${C}/invoices?limit=50`]: { items: FIXTURES[`${C}/invoices`], nextCursor: null },
    [`${C}/einvoicing/compliance`]: { items: [] },
    [`${C}/einvoicing/documents`]: { items: [] },
  },
  BillPay: {
    [`${C}/bills/summary`]: {
      pending: cnt(0, 0),
      approved: cnt(1, 1050),
      partial: cnt(0, 0),
      paid: cnt(0, 0),
      overdue: cnt(0, 0),
    },
    [`${C}/bills/aging`]: {
      current: cnt(1, 1050),
      days_1_30: cnt(0, 0),
      days_31_60: cnt(0, 0),
      days_61_90: cnt(0, 0),
      days_90_plus: cnt(0, 0),
    },
  },
  Vendors: {
    [`${C}/vendors`]: [{ id: "v1", name: "Supplier LLC", isActive: true }],
    [`${C}/vendors/aging`]: {
      vendors: [],
      unappliedCredits: 0,
      reconciliation: { glBalance: 0, agingTotal: 0, difference: 0, isReconciled: true },
    },
  },
  ExchangeRates: {
    [`${C}/reports/fx-gains-losses`]: {
      asOf: "2026-11-18",
      baseCurrency: "AED",
      receivables: [],
      payables: [],
      bankAccounts: [],
      totalUnrealizedGain: 0,
      totalUnrealizedLoss: 0,
      netUnrealizedGainLoss: 0,
    },
    [`${C}/exchange-rates/feed-status`]: {
      maxAgeDays: 7,
      stale: [],
      feed: { capability: "manual", configured: [] },
    },
  },
};

/** A row action that must render, so the row-level controls are part of the check. */
const ROW_PROBES: Record<string, string> = {
  Invoices: `button-add-payment-${INV}`,
  Journal: `button-void-journal-${JE}`,
  CorporateTax: "button-ct-unfile-ct000000-0000-4000-8000-000000000004",
};

const PAGES = [
  "Invoices",
  "BillPay",
  "CustomerContacts",
  "Vendors",
  "Journal",
  "ExpenseClaims",
  "CorporateTax",
  "VATFiling",
  "CreditNotes",
  "Quotes",
  "BankReconciliation",
  "CompanySettings",
  "ExchangeRates",
  "ChartOfAccounts",
];

describe("[E3][J4-r3] a read-only viewer is offered no enabled write control", () => {
  for (const page of PAGES) {
    it(`${page}: every write control is disabled with the role reason`, async () => {
      await renderAs("viewer", page, PAGE_FIXTURES[page]);
      const probe = ROW_PROBES[page];
      if (probe) expect(document.querySelector(`[data-testid="${probe}"]`), probe).not.toBeNull();
      expect(JSON.stringify(enabledWriteControls()), page).toBe("[]");
      const denied = [...document.querySelectorAll<HTMLElement>('[data-permission-denied="true"]')];
      expect(denied.length, `${page}: gated controls`).toBeGreaterThan(0);
      for (const el of denied) expect(el.title).toMatch(/role does not allow/i);
    }, 30_000);
  }

  it("an owner keeps the same controls enabled", async () => {
    await renderAs("owner", "CustomerContacts");
    expect(enabledWriteControls().length).toBeGreaterThan(0);
    await unmountPage();
    await renderAs("owner", "Journal");
    expect(enabledWriteControls().length).toBeGreaterThan(0);
  }, 30_000);
});
