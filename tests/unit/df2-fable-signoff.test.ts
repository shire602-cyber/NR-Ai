// @vitest-environment jsdom
/**
 * DF2: Fable final design review (build 503312b) sign-off blockers and polish, as behaviour
 * tests. Each page is rendered in jsdom with fixture-backed queries (tests/unit/helpers/form-harness).
 *
 * B9   an empty company sees an empty state and no KPI row of zeros (fixed assets, expense claims,
 *      cost centers, exchange rates, cash-flow forecast, backup, document vault).
 * B11  journal entry detail shows the entry number, never the row UUID.
 * B13  admin activity log is a feed: no UUIDs in the sentence, one-line formatted dates.
 * B15  StatCard puts the delta pill on its own line under 640 px.
 * P8   English months are three letters ("30 Sep 2026", never "Sept").
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  COMPANY_ID,
  renderPage,
  resetHarness,
  setFixtures,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { formatDate, formatDateTime, formatDateTimePlain } from "../../client/src/lib/format-date";
import { activitySentence } from "../../client/src/lib/activity-log-labels";

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
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  // An owner: every control enabled (E2 added gate / gateApproval to the hook).
  useCompanyPermission: () => ({
    can: () => true,
    gate: () => ({}),
    gateApproval: () => ({}),
    known: true,
    role: "owner",
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
const kpiTiles = () => document.querySelectorAll(".text-kpi").length;
const emptyStates = () => document.querySelectorAll('[data-testid*="empty"]').length;

beforeAll(async () => {
  await loadLocale("en");
});
beforeEach(() => resetHarness());
afterEach(async () => {
  await unmountPage();
});

describe("[DF2 P8] display dates", () => {
  it("abbreviates September like every other month", () => {
    expect(formatDate("2026-09-30", "en")).toBe("30 Sep 2026");
    expect(formatDate("2026-06-01", "en")).toBe("1 Jun 2026");
  });
  it("formats a timestamp on one line", () => {
    const d = new Date(2026, 10, 18, 4, 8);
    expect(formatDateTime(d, "en")).toBe("18 Nov 2026, 04:08");
    // Isolated runs (RLI date PDI, LRI time PDI) keep the day number in place in a flex row.
    expect(formatDateTime(d, "ar").replace(/[\u2066-\u2069]/g, "")).toMatch(/^18 \S+ 2026، 04:08$/);
    expect(formatDateTimePlain(d, "ar")).toMatch(/^18 \S+ 2026، 04:08$/);
  });
});

describe("[DF2 B13] activity sentences", () => {
  const t = {
    "activityLog.action.expense_claim.approve": "Expense claim approved",
  } as Record<string, string>;
  it("drops the UUID and replaces generic server text with the action label", () => {
    const log = {
      action: "expense_claim.approve",
      entityType: "expense_claim",
      description: "Expense claim approve on expense claim 4f0c1bf3-fd81-4a4b-aaa5-9a87e5058430",
    };
    const sentence = activitySentence(t, log, "en");
    expect(sentence).toBe("Expense claim approved");
    expect(sentence).not.toMatch(UUID);
  });
  it("keeps a specific sentence with its document number", () => {
    const log = {
      action: "journal.create_draft",
      description: "Journal entry JE-20261118-005 saved as draft",
    };
    expect(activitySentence(t, log, "en")).toBe("Journal entry JE-20261118-005 saved as draft");
  });
  it("prints a period date in the display format, not ISO", () => {
    const log = {
      action: "period_lock.override",
      description: "Period lock override on period 2026-08-31",
    };
    const sentence = activitySentence(t, log, "en");
    expect(sentence).not.toMatch(/2026-08-31/);
    expect(sentence).toContain("31 Aug 2026");
  });
});

describe("[DF2 B9] empty company: no KPI row of zeros", () => {
  it("fixed assets", async () => {
    setFixtures({
      [`${C}/fixed-assets`]: [],
      [`${C}/fixed-assets/summary`]: {
        totalAssets: 0,
        totalCost: 0,
        totalAccumulatedDepreciation: 0,
        totalNetBookValue: 0,
        byCategory: [],
      },
    });
    const { default: Page } = await import("../../client/src/pages/FixedAssets");
    await renderPage(Page);
    expect(kpiTiles()).toBe(0);
    expect(emptyStates()).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/assets registered/i);
  });

  it("fixed assets with an asset keeps its tiles", async () => {
    setFixtures({
      [`${C}/fixed-assets`]: [
        {
          id: "a1",
          assetName: "Delivery van",
          assetNumber: "FA-1",
          category: "Vehicles",
          purchaseDate: "2026-01-01",
          purchaseCost: 96000,
          salvageValue: 0,
          usefulLifeYears: 5,
          depreciationMethod: "straight_line",
          accumulatedDepreciation: 0,
          netBookValue: 96000,
          status: "active",
        },
      ],
      [`${C}/fixed-assets/summary`]: {
        totalAssets: 1,
        totalCost: 96000,
        totalAccumulatedDepreciation: 0,
        totalNetBookValue: 96000,
        byCategory: [],
      },
    });
    const { default: Page } = await import("../../client/src/pages/FixedAssets");
    await renderPage(Page);
    expect(kpiTiles()).toBe(3);
  });

  it("expense claims", async () => {
    setFixtures({ [`${C}/expense-claims`]: [], [`${C}/expense-claims/summary`]: {} });
    const { default: Page } = await import("../../client/src/pages/ExpenseClaims");
    await renderPage(Page);
    expect(kpiTiles()).toBe(0);
    expect(emptyStates()).toBeGreaterThan(0);
  });

  it("cost centers", async () => {
    setFixtures({
      [`${C}/cost-centers`]: [],
      [`${C}/cost-centers/profitability`]: {
        costCenters: [],
        totals: {
          activeCostCenterCount: 0,
          costCenterCount: 0,
          totalIncome: 0,
          totalExpenses: 0,
          netIncome: 0,
        },
      },
    });
    const { default: Page } = await import("../../client/src/pages/CostCenters");
    await renderPage(Page);
    expect(kpiTiles()).toBe(0);
    expect(document.getElementById("cc-pl-title")).toBeNull();
  });

  it("document vault: no tiles, no corner icons, an empty state", async () => {
    setFixtures({ [`/api/companies/${COMPANY_ID}/documents`]: [] });
    const { default: Page } = await import("../../client/src/pages/DocumentVault");
    await renderPage(Page);
    expect(kpiTiles()).toBe(0);
    expect(document.querySelector(".text-2xl")).toBeNull();
    expect(emptyStates()).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="input-search-documents"]')).toBeNull();
  });

  it("cash-flow forecast", async () => {
    setFixtures({
      [`${C}/cashflow/forecast`]: {
        currentBalance: 0,
        projections: [
          {
            week: 1,
            weekStart: "2026-11-18",
            weekEnd: "2026-11-24",
            expectedInflows: 0,
            expectedOutflows: 0,
            projectedBalance: 0,
          },
        ],
        insights: [],
        assumptions: [],
        items: [],
      },
    });
    const { default: Page } = await import("../../client/src/pages/CashFlowForecast");
    await renderPage(Page);
    expect(kpiTiles()).toBe(0);
    expect(document.querySelector('[data-testid="forecast-empty"]')).not.toBeNull();
  });
});

describe("[DF2 B11] journal entry detail", () => {
  it("shows the entry number, not the row UUID", async () => {
    const id = "d9338947-88a8-4f93-b110-e9f93dcce864";
    setFixtures({
      [`/api/journal/${id}`]: {
        id,
        companyId: COMPANY_ID,
        entryNumber: "JE-20261118-005",
        date: "2026-11-18",
        memo: "Office rent",
        status: "posted",
        lifecycleStatus: "posted",
        source: "manual",
        sourceId: null,
        entryKind: "standard",
        approvalStatus: null,
        reversedByEntryId: null,
        reversalOf: null,
        reversedByEntry: null,
        reversalOfEntry: null,
        createdAt: "2026-11-18T04:08:00.000Z",
        lines: [],
      },
    });
    const { default: Detail } = await import("../../client/src/pages/JournalEntryDetail");
    const { hook } = memoryLocation({ path: `/journal/${id}` });
    const Wrapped = () =>
      createElement(
        Router,
        { hook },
        createElement(Route, { path: "/journal/:id", component: Detail })
      );
    await renderPage(Wrapped);
    const cell = document.querySelector('[data-testid="text-entry-id"]');
    expect(cell?.textContent).toBe("JE-20261118-005");
    expect(document.body.textContent).not.toContain(id);
  });
});

describe("[DF2 B15] StatCard delta pill", () => {
  it("stacks the pill under the label on small screens", async () => {
    const { StatCard } = await import("../../client/src/components/ui/stat-card");
    await renderPage(() =>
      createElement(StatCard, {
        label: "Net margin",
        value: "23.9%",
        delta: { label: "+278.3 pts", direction: "up", tone: "positive" },
      })
    );
    const label = [...document.querySelectorAll("span")].find(
      (s) => s.textContent === "Net margin"
    );
    const row = label?.parentElement;
    // Column under 640 px, row from `sm` up: the pill can never squeeze the label.
    expect(row?.className).toMatch(/\bflex-col\b/);
    expect(row?.className).toMatch(/\bsm:flex-row\b/);
  });
});
