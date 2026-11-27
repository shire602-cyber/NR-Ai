// @vitest-environment jsdom
/**
 * P2 negative cash wording: a cash or bank balance below zero keeps its minus sign and is labelled
 * "Overdrawn" / "مكشوف" (projected: "Negative balance" / "رصيد سالب") in text, not colour alone;
 * zero is never called negative; the figure stays an isolated LTR run inside Arabic pages.
 * Covers the shared helper and component and the main cash and bank screens in en and ar.
 */
import { createElement } from "react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  byTestId,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";
import {
  cashBalanceLabel,
  cashBalanceState,
  cashBalanceText,
  isCashOrBankAccount,
} from "../../client/src/lib/cash-balance";
import { stripBidiControls } from "../../client/src/lib/format-money";
import { CashBalance } from "../../client/src/components/ui/cash-balance";
import AccountLedger from "../../client/src/pages/AccountLedger";
import CashFlowForecast from "../../client/src/pages/CashFlowForecast";
import { CashMovement } from "../../client/src/pages/dashboard/PlanningWidgets";
import enComponents from "../../client/src/locales/en/components.json";
import arComponents from "../../client/src/locales/ar/components.json";

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
// Whole pages render here; a cold jsdom render can pass the 5 s default on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const EN = { overdrawn: "Overdrawn", negative: "Negative balance" };
const AR = { overdrawn: "مكشوف", negative: "رصيد سالب" };

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  Element.prototype.scrollIntoView ??= () => undefined;
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
beforeEach(() => {
  resetHarness();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await unmountPage();
  useI18n.setState({ locale: "en" });
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const labels = (scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll('[data-testid="cash-balance-label"]')).map(
    (el) => el.textContent
  );

describe("P2 cash balance helper", () => {
  it("classifies at money precision; zero is never overdrawn", () => {
    expect(cashBalanceState(-1234)).toBe("overdrawn");
    expect(cashBalanceState("-0.01")).toBe("overdrawn");
    expect(cashBalanceState(-0.004)).toBe("zero");
    expect(cashBalanceState(0)).toBe("zero");
    expect(cashBalanceState("0.00")).toBe("zero");
    expect(cashBalanceState(10)).toBe("positive");
    expect(cashBalanceState(null)).toBeNull();
    expect(cashBalanceState("abc")).toBeNull();
  });

  it("recognises cash, bank and petty cash asset accounts like the balance sheet does", () => {
    expect(isCashOrBankAccount({ type: "asset", subType: "bank", code: "1100" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", code: "1020", nameEn: "Current" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", code: "1300", nameEn: "Petty Cash" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", code: "1200", nameEn: "Receivables" })).toBe(false);
    expect(isCashOrBankAccount({ type: "liability", code: "2010", nameEn: "Bank loan" })).toBe(
      false
    );
    expect(isCashOrBankAccount(null)).toBe(false);
  });

  it("words a negative balance in both locales and leaves zero alone", () => {
    expect(cashBalanceLabel(-5, catalogs.en)).toBe(EN.overdrawn);
    expect(cashBalanceLabel(-5, catalogs.ar)).toBe(AR.overdrawn);
    expect(cashBalanceLabel(-5, catalogs.en, "projected")).toBe(EN.negative);
    expect(cashBalanceLabel(-5, catalogs.ar, "projected")).toBe(AR.negative);
    expect(cashBalanceLabel(0, catalogs.en)).toBe("");
    expect(cashBalanceLabel(-0.001, catalogs.ar)).toBe("");
    expect(stripBidiControls(cashBalanceText(-1234, "AED", "en", catalogs.en))).toBe(
      "AED −1,234.00 (Overdrawn)"
    );
    expect(stripBidiControls(cashBalanceText(-1234, "AED", "ar", catalogs.ar))).toBe(
      "−1,234.00 د.إ (مكشوف)"
    );
    expect(stripBidiControls(cashBalanceText(0, "AED", "en", catalogs.en))).toBe("AED 0.00");
  });

  it("has both catalog entries", () => {
    const en = enComponents as Record<string, string>;
    const ar = arComponents as Record<string, string>;
    expect(en["components.cashBalance.overdrawn"]).toBe(EN.overdrawn);
    expect(en["components.cashBalance.negative"]).toBe(EN.negative);
    expect(ar["components.cashBalance.overdrawn"]).toBe(AR.overdrawn);
    expect(ar["components.cashBalance.negative"]).toBe(AR.negative);
  });
});

describe("P2 <CashBalance>", () => {
  const Demo = ({ amount, kind }: { amount: number; kind?: "actual" | "projected" }) =>
    createElement(CashBalance, { amount, kind, "data-testid": "demo" });

  for (const [locale, words] of [
    ["en", EN],
    ["ar", AR],
  ] as const) {
    it(`labels an overdrawn balance in text and keeps the minus sign (${locale})`, async () => {
      useI18n.setState({ locale });
      await renderPage(Demo, { amount: -1234.5 });
      const wrap = document.querySelector('[data-cash-balance="overdrawn"]')!;
      expect(wrap).not.toBeNull();
      expect(labels(wrap)).toEqual([words.overdrawn]);
      // The figure is signed (true minus) inside an isolated LTR run, not Math.abs in red.
      const figure = wrap.querySelector(".money")!;
      expect(figure.getAttribute("dir")).toBe("ltr");
      expect(figure.textContent).toBe("−1,234.50");
      expect(wrap.querySelector(".money-figure")!.getAttribute("dir")).toBe(
        locale === "ar" ? "rtl" : "ltr"
      );
      expect(wrap.querySelector(".money-currency")!.textContent).toBe(
        locale === "ar" ? "د.إ" : "AED"
      );
    });

    it(`says "negative balance" for a projected figure (${locale})`, async () => {
      useI18n.setState({ locale });
      await renderPage(Demo, { amount: -10, kind: "projected" });
      expect(labels()).toEqual([words.negative]);
    });
  }

  it("does not call zero or a positive balance negative", async () => {
    useI18n.setState({ locale: "ar" });
    await renderPage(Demo, { amount: 0 });
    expect(labels()).toEqual([]);
    expect(document.body.textContent).not.toContain("−");
    expect(document.querySelector('[data-cash-balance="zero"]')).not.toBeNull();
    await unmountPage();
    await renderPage(Demo, { amount: -0.004 });
    expect(labels()).toEqual([]);
    await unmountPage();
    await renderPage(Demo, { amount: 50 });
    expect(labels()).toEqual([]);
  });
});

// ── Screens ──────────────────────────────────────────────────────────────────────────────────

const BANK_ID = "a0000000-0000-4000-8000-0000000000b1";
const BANK_ACCOUNT = {
  id: BANK_ID,
  companyId: COMPANY_ID,
  code: "1020",
  nameEn: "Demo Bank Current",
  nameAr: "الحساب الجاري التجريبي",
  type: "asset",
  subType: "bank",
};
const ledgerEntry = (id: string, runningBalance: number, credit: number) => ({
  id,
  date: "2026-03-01T00:00:00.000Z",
  entryNumber: `JE-2026-000${id.slice(-1)}`,
  description: "Supplier payment",
  debit: 0,
  credit,
  runningBalance,
  journalEntryId: "e0000000-0000-4000-8000-0000000000e1",
  journalLineId: id,
  memo: null,
  source: "manual",
  status: "posted",
});
const LEDGER = {
  entries: [ledgerEntry("l1", 0, 1000), ledgerEntry("l2", -1500, 1500)],
  allEntries: [],
  account: BANK_ACCOUNT,
  openingBalance: 1000,
  totalDebit: 0,
  totalCredit: 2500,
  closingBalance: -1500,
  totalCount: 2,
};

describe("P2 account ledger of a bank account", () => {
  for (const [locale, words] of [
    ["en", EN],
    ["ar", AR],
  ] as const) {
    it(`labels the overdrawn closing and running balance, not zero (${locale})`, async () => {
      useI18n.setState({ locale });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(LEDGER), { status: 200 }))
      );
      window.history.replaceState({}, "", `/accounts/${BANK_ID}/ledger`);
      await renderPage(AccountLedger);
      await flushUntil(() => !!document.querySelector('[data-testid="row-entry-l2"]'));

      const closing = byTestId("text-closing-balance")!;
      expect(labels(closing)).toEqual([words.overdrawn]);
      expect(closing.querySelector(".money")!.textContent).toBe("−1,500.00");
      // The opening balance is positive and carries no label.
      expect(labels(byTestId("text-opening-balance")!)).toEqual([]);
      // Running balance: −1,500 is overdrawn, 0 is not.
      const row2 = byTestId("row-entry-l2")!;
      expect(labels(row2)).toEqual([words.overdrawn]);
      expect(row2.textContent).toContain("−1,500.00");
      expect(labels(byTestId("row-entry-l1")!)).toEqual([]);
    });
  }
});

const FORECAST_PREFIX = `/api/companies/${COMPANY_ID}/cashflow/forecast`;
const NEGATIVE_FORECAST = {
  currentBalance: -2500,
  projections: [
    {
      week: 1,
      weekStart: "2026-01-01",
      weekEnd: "2026-01-07",
      expectedInflows: 100,
      expectedOutflows: 50,
      projectedBalance: -2450,
    },
    {
      week: 2,
      weekStart: "2026-01-08",
      weekEnd: "2026-01-14",
      expectedInflows: 2450,
      expectedOutflows: 0,
      projectedBalance: 0,
    },
  ],
  insights: [],
  items: [],
  assumptions: [],
  insufficientData: false,
  scenario: "base",
  summary: { receivablesOverdue: 0, minProjectedBalance: -2450, projectedShortfall: 2450 },
};

describe("P2 cash flow forecast", () => {
  for (const [locale, words] of [
    ["en", EN],
    ["ar", AR],
  ] as const) {
    it(`labels the overdrawn current balance and the negative projected week (${locale})`, async () => {
      useI18n.setState({ locale });
      setFixtures({
        [`${FORECAST_PREFIX}?days=90&scenario=base&delayReceiptsDays=0`]: NEGATIVE_FORECAST,
      });
      await renderPage(CashFlowForecast);
      await flushUntil(() => labels().length >= 2);
      // Current balance (actual) + week 1 (projected); week 2 is zero and unlabelled.
      expect(labels()).toEqual([words.overdrawn, words.negative]);
      expect(document.body.textContent).toContain("−2,500.00");
      expect(document.body.textContent).toContain("−2,450.00");
    });
  }
});

describe("P2 dashboard bank against ledger", () => {
  for (const [locale, words] of [
    ["en", EN],
    ["ar", AR],
  ] as const) {
    it(`labels an overdrawn statement and ledger balance (${locale})`, async () => {
      useI18n.setState({ locale });
      const stats = {
        cashInOut: [],
        bankVsGl: {
          accounts: [
            {
              bankAccountId: "b1",
              name: "Demo Bank",
              currency: "AED",
              hasStatement: true,
              statementBalance: -300,
              glBalance: -300,
              difference: 0,
            },
            {
              bankAccountId: "b2",
              name: "Demo Savings",
              currency: "AED",
              hasStatement: true,
              statementBalance: 0,
              glBalance: 0,
              difference: 0,
            },
          ],
        },
      };
      await renderPage(CashMovement, { stats, loading: false, locale });
      await flush();
      const widget = byTestId("dashboard-bank-vs-gl")!;
      expect(labels(widget)).toEqual([words.overdrawn, words.overdrawn]);
    });
  }
});

describe("P2 dashboard cash position KPI", () => {
  it("sources the cash KPI through CashBalance", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync("client/src/pages/dashboard/DashboardOverview.tsx", "utf8");
    expect(src).toMatch(/<CashBalance\s+amount=\{stats\?\.cashPosition/);
  });
});
