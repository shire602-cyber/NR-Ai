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
  getTierFeatures,
  matchGateRule,
  usagePeriod,
} from "../../server/middleware/featureGate";
import {
  mapAccountType,
  moneyToFils,
  parseImportCsv,
  parseImportDate,
  splitCodeAndName,
} from "../../server/services/migration-import/mappers";

const TIERS = ["free", "starter", "professional", "enterprise"] as const;

/**
 * R20-10: the Pricing page is rendered in jsdom and its comparison table is read back
 * (a check icon per included tier, a dash otherwise) instead of parsing page source.
 */
const GATE_ROW_LABELS: Record<string, string> = {
  payroll: "Payroll & WPS",
  fixedAssets: "Fixed Assets & Depreciation",
  bulkOps: "Bulk Operations",
  recurringInvoices: "Recurring Invoices",
  multiCurrency: "Multi-Currency Documents",
  invoicePayment: "Online Invoice Payment Links",
  webhooks: "Signed Webhooks",
  apiAccess: "API Access",
};

async function pricingGates(): Promise<Array<{ gate: string; tiers: Record<string, boolean> }>> {
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
  const rows = [...container.querySelectorAll("tr")];
  const out: Array<{ gate: string; tiers: Record<string, boolean> }> = [];
  for (const [gate, label] of Object.entries(GATE_ROW_LABELS)) {
    const row = rows.find((r) => r.querySelector("td")?.textContent?.trim() === label);
    if (!row) continue;
    const cells = [...row.querySelectorAll("td")].slice(1);
    const included = cells.map((c) => c.querySelector(".lucide-check") !== null);
    out.push({
      gate,
      tiers: {
        free: included[0],
        starter: included[1],
        professional: included[2],
        enterprise: included[3],
      },
    });
  }
  act(() => root.unmount());
  container.remove();
  return out;
}

describe("W5-B plan matrix", () => {
  it("[R19-05] every centrally gated feature is on the Pricing page with the same tiers as TIER_FEATURES", async () => {
    const gates = await pricingGates();
    expect(gates.map((g) => g.gate).sort()).toEqual(Object.keys(GATE_ROW_LABELS).sort());
    const onPage = new Set(gates.map((g) => g.gate));
    for (const f of [
      "payroll",
      "fixedAssets",
      "bulkOps",
      "recurringInvoices",
      "multiCurrency",
      "invoicePayment",
      "webhooks",
      "apiAccess",
    ]) {
      expect(centrallyGatedFeatures(), f).toContain(f);
      expect(onPage, f).toContain(f);
    }
    for (const g of gates) {
      for (const tier of TIERS) {
        expect(`${g.gate}@${tier}=${g.tiers[tier]}`).toBe(
          `${g.gate}@${tier}=${!!getTierFeatures(tier)[g.gate]}`
        );
      }
    }
  });

  it("[R19-05] the gate table maps routes to features (webhook provider callbacks never match)", () => {
    const f = (m: string, p: string, body?: unknown) =>
      matchGateRule(PLAN_FEATURE_RULES, m, p, { body } as never)?.feature ?? null;
    expect(f("GET", "/api/companies/c1/payroll-runs")).toBe("payroll");
    expect(f("POST", "/api/payroll-runs/x/approve")).toBe("payroll");
    expect(f("GET", "/api/companies/c1/fixed-assets")).toBe("fixedAssets");
    expect(f("POST", "/api/companies/c1/invoices", { currency: "USD" })).toBe("multiCurrency");
    expect(f("POST", "/api/companies/c1/invoices", { currency: "AED" })).toBeNull();
    expect(f("POST", "/api/webhooks/stripe")).toBeNull();
    expect(f("POST", "/api/webhooks/invoice-payments/stripe")).toBeNull();
    expect(f("POST", "/api/webhooks/0b8f7f7a-2f6e-4d7a-9a83-2d4f3c1b1a11/test")).toBe("webhooks");
    expect(f("GET", "/api/companies/c1/api-keys")).toBe("apiAccess");
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
