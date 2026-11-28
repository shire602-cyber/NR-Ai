/**
 * W5-B (R19-05): TIER_FEATURES, the central gate table and the Pricing page
 * matrix agree; import mappers parse the four export layouts' money and dates.
 */
// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../server/services/stripe.service", () => ({ isStripeConfigured: () => false }));

import {
  PLAN_FEATURE_RULES,
  USAGE_LIMIT_RULES,
  centrallyGatedFeatures,
  featureForRequest,
  getTierFeatures,
  getTierLimits,
  matchGateRule,
  usagePeriod,
} from "../../server/middleware/featureGate";
import { FEATURE_MIN_PLAN, type PlanFeature } from "../../shared/plans";
import {
  mapAccountType,
  moneyToFils,
  parseImportCsv,
  parseImportDate,
  splitCodeAndName,
} from "../../server/services/migration-import/mappers";

const TIERS = ["starter", "professional", "enterprise"] as const;

/**
 * R20-10 / WQ7: the Pricing page is rendered in jsdom and its comparison table is read back (a
 * check icon per included plan, a dash otherwise) instead of parsing page source. Every module the
 * plans differ on (shared/plans.ts FEATURE_MIN_PLAN above Starter) must be on the page with the
 * tiers the server gate enforces.
 */
const GATE_ROW_LABELS: Record<string, string> = {
  payroll: "Payroll and WPS",
  fixedAssets: "Fixed assets and depreciation",
  budgets: "Budgets and variance",
  monthEnd: "Month-end close checklist",
  costCenters: "Cost centres",
  purchaseOrders: "Purchase orders",
  expenseClaims: "Expense claims",
  bulkOps: "Bulk operations",
  customerPortal: "Customer portal",
  corporateTax: "Corporate tax (9%)",
  aiAssistant: "Assistant: ask, forecasts and anomaly checks",
  webhooks: "Signed webhooks",
  apiAccess: "API access",
};

async function pricingRows(): Promise<HTMLTableRowElement[]> {
  // framer-motion's in-view reveal needs IntersectionObserver, which jsdom lacks.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  // The Pricing copy lives in the lazily loaded marketing catalog; load it before rendering.
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await loadLocale("en");
  const { default: Pricing } = await import("../../client/src/pages/Pricing");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Pricing));
  });
  const rows = [...container.querySelectorAll("table.mk-ptable tr")].map(
    (r) => r.cloneNode(true) as HTMLTableRowElement
  );
  act(() => root.unmount());
  container.remove();
  return rows;
}

const rowCells = (rows: HTMLTableRowElement[], label: string) => {
  // The label cell may carry a 12 px qualifier line after the label.
  const row = rows.find((r) => r.querySelector("td")?.firstChild?.textContent?.trim() === label);
  return row ? [...row.querySelectorAll("td")].slice(1) : [];
};

describe("WQ7 plan matrix (pricing page = server gates = shared/plans.ts)", () => {
  it("[R19-05] every plan-differentiated module is on the Pricing page with the tiers the server enforces", async () => {
    const rows = await pricingRows();
    const differentiated = (Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]).filter(
      (f) => FEATURE_MIN_PLAN[f] !== "starter"
    );
    expect(differentiated.sort()).toEqual(Object.keys(GATE_ROW_LABELS).sort());
    for (const [gate, label] of Object.entries(GATE_ROW_LABELS)) {
      const cells = rowCells(rows, label);
      expect(cells.length, label).toBe(3);
      const included = cells.map((c) => c.querySelector(".lucide-check") !== null);
      expect(centrallyGatedFeatures(), gate).toContain(gate);
      TIERS.forEach((tier, i) => {
        expect(`${gate}@${tier}=${included[i]}`).toBe(
          `${gate}@${tier}=${!!getTierFeatures(tier)[gate as PlanFeature]}`
        );
      });
    }
  });

  it("[WQ7] limit rows show the shared limits; users are unlimited on every plan", async () => {
    const rows = await pricingRows();
    const text = (label: string) => rowCells(rows, label).map((c) => c.textContent?.trim());
    expect(text("Companies")).toEqual(["1", "3", "Unlimited"]);
    expect(text("Invoices and receipts")[0]).toBe(
      String(getTierLimits("starter").maxInvoicesPerMonth)
    );
    for (const tier of TIERS) expect(getTierLimits(tier).maxUsers).toBe(-1);
  });

  it("[R19-05] the gate table maps writes to features and never gates a read", () => {
    const f = (m: string, p: string, body?: unknown) => featureForRequest(m, p, { body } as never);
    expect(f("POST", "/api/companies/c1/payroll-runs")).toBe("payroll");
    expect(f("GET", "/api/companies/c1/payroll-runs")).toBeNull();
    expect(f("POST", "/api/payroll-runs/x/approve")).toBe("payroll");
    expect(f("POST", "/api/companies/c1/fixed-assets")).toBe("fixedAssets");
    expect(f("GET", "/api/companies/c1/fixed-assets")).toBeNull();
    expect(f("POST", "/api/companies/c1/budget-plans")).toBe("budgets");
    expect(f("POST", "/api/companies/c1/month-end/checklist")).toBe("monthEnd");
    expect(f("POST", "/api/companies/c1/expense-claims")).toBe("expenseClaims");
    expect(f("POST", "/api/companies/c1/corporate-tax/returns")).toBe("corporateTax");
    expect(f("POST", "/api/ai/nl-gateway")).toBe("aiAssistant");
    expect(f("POST", "/api/portal/generate-access")).toBe("customerPortal");
    expect(f("POST", "/api/portal/revoke-access")).toBeNull();
    expect(f("POST", "/api/companies/c1/invoices", { currency: "USD" })).toBe("multiCurrency");
    expect(f("POST", "/api/companies/c1/invoices", { currency: "AED" })).toBe("bookkeeping");
    expect(f("POST", "/api/companies/c1/invoices/x/pdf")).toBeNull();
    expect(f("POST", "/api/companies/c1/journal")).toBe("bookkeeping");
    expect(f("PUT", "/api/companies/c1/billing/change-plan")).toBeNull();
    expect(f("PUT", "/api/companies/c1/automations/categorise")).toBeNull();
    expect(f("POST", "/api/webhooks/stripe")).toBeNull();
    expect(f("POST", "/api/webhooks/invoice-payments/stripe")).toBeNull();
    expect(f("POST", "/api/webhooks/0b8f7f7a-2f6e-4d7a-9a83-2d4f3c1b1a11/test")).toBe("webhooks");
    expect(f("POST", "/api/companies/c1/api-keys")).toBe("apiAccess");
    expect(f("GET", "/api/companies/c1/api-keys")).toBeNull();
    // Every rule's feature exists in the shared matrix.
    for (const r of PLAN_FEATURE_RULES) expect(Object.keys(FEATURE_MIN_PLAN)).toContain(r.feature);
  });

  it("[R19-04] metered creates and the UAE usage month", () => {
    const m = (meth: string, p: string) =>
      matchGateRule(USAGE_LIMIT_RULES, meth, p)?.metric ?? null;
    expect(m("POST", "/api/companies/c1/invoices")).toBe("invoices");
    expect(m("GET", "/api/companies/c1/invoices")).toBeNull();
    expect(m("POST", "/api/companies/c1/invoices/x/payments")).toBeNull();
    expect(m("POST", "/api/companies/c1/receipts")).toBe("receipts");
    expect(m("POST", "/api/ai/categorize")).toBe("ai_calls");
    expect(m("POST", "/api/companies/c1/team/invitations")).toBe("team_members");
    // 2026-01-31 21:00 UTC is already February in Dubai.
    expect(usagePeriod(new Date("2026-01-31T21:00:00Z"))).toBe("2026-02");
  });
});

describe("W5-B import mappers", () => {
  it("[R19-13] money and dates in each system's export style", () => {
    expect(moneyToFils("1,234.50")).toBe(123450);
    expect(moneyToFils("(1,234.50)")).toBe(-123450);
    expect(moneyToFils("AED 10")).toBe(1000);
    expect(moneyToFils("1.005")).toBeNull();
    expect(moneyToFils("")).toBeNull();
    expect(parseImportDate("15/11/2025", "xero")).toBe("2025-11-15");
    expect(parseImportDate("12/01/2025", "quickbooks")).toBe("2025-12-01");
    expect(parseImportDate("31 Dec 2025", "zoho")).toBe("2025-12-31");
    expect(parseImportDate("2025-12-31", "wafeq")).toBe("2025-12-31");
    expect(parseImportDate("31/02/2025", "xero")).toBeNull();
  });

  it("[R19-13] account types and codes from Xero / QuickBooks / Zoho / Wafeq", () => {
    expect(mapAccountType("Accounts receivable (A/R)")).toEqual({
      type: "asset",
      subType: "receivable",
    });
    expect(mapAccountType("Current Asset", "Accounts Receivable")).toEqual({
      type: "asset",
      subType: "receivable",
    });
    expect(mapAccountType("Other Current Liability")).toEqual({
      type: "liability",
      subType: "current_liability",
    });
    expect(mapAccountType("Cost of Goods Sold")).toEqual({
      type: "expense",
      subType: "cost_of_sales",
    });
    expect(mapAccountType("Direct Costs")).toEqual({ type: "expense", subType: "cost_of_sales" });
    expect(mapAccountType("Revenue")).toEqual({ type: "income", subType: "operating_revenue" });
    expect(mapAccountType("Equity")).toEqual({ type: "equity", subType: "owner_equity" });
    expect(mapAccountType("nonsense")).toBeNull();
    expect(splitCodeAndName("Bank Accounts (1020)", undefined)).toEqual({
      code: "1020",
      name: "Bank Accounts",
    });
    expect(splitCodeAndName("1020 Bank Accounts", undefined)).toEqual({
      code: "1020",
      name: "Bank Accounts",
    });
  });

  it("[R19-13] header matching ignores *, case and spacing and finds the header row under report titles", () => {
    const p = parseImportCsv(
      "trial_balance",
      "Trial Balance\nCo\nAccount,Debit - Year to date,Credit - Year to date\nBank (1020),5,\n"
    );
    expect(p.mapping).toMatchObject({
      code: "Account",
      debit: "Debit - Year to date",
      credit: "Credit - Year to date",
    });
    expect(p.records).toHaveLength(1);
    const c = parseImportCsv("customers", "*ContactName,EmailAddress\nA,a@x.example\n");
    expect(c.mapping).toMatchObject({ name: "*ContactName", email: "EmailAddress" });
  });
});
