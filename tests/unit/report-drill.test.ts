import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPORT_DRILL_TARGETS } from "../../shared/report-result";
import {
  DRILL_LIST_ROUTE,
  drillHref,
  parseHighlight,
  withHighlight,
} from "../../client/src/lib/report-drill";

const appSource = readFileSync(path.resolve(__dirname, "../../client/src/App.tsx"), "utf8");
const appRoutes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

/** Does an App.tsx route pattern (":id" segments) match this concrete path? */
function routeMatches(pattern: string, href: string): boolean {
  const p = pattern.split("/");
  const h = href.split("?")[0].split("/");
  return p.length === h.length && p.every((seg, i) => seg.startsWith(":") || seg === h[i]);
}
const hasRoute = (href: string) => appRoutes.some((pattern) => routeMatches(pattern, href));

const ID = "3f2b6a5e-1c4d-4e8f-9a7b-0d1c2e3f4a5b";

describe("report drill links", () => {
  it("every drill target has a list route that App.tsx defines", () => {
    for (const target of REPORT_DRILL_TARGETS) {
      const route = DRILL_LIST_ROUTE[target];
      expect(route, target).toBeTruthy();
      expect(hasRoute(route), `${target} -> ${route}`).toBe(true);
    }
  });

  it("every target resolves to an href App.tsx defines, for a typical id", () => {
    for (const target of REPORT_DRILL_TARGETS) {
      const id = target === "report" ? "profit-loss" : target === "activity" ? "invoice:" + ID : ID;
      const href = drillHref({ target, id });
      expect(href, target).toBeTruthy();
      expect(hasRoute(href!), `${target} -> ${href}`).toBe(true);
    }
  });

  it("a journal entry opens its own page and an account opens its ledger", () => {
    expect(drillHref({ target: "journal_entry", id: ID })).toBe(`/journal/${ID}`);
    expect(drillHref({ target: "account", id: ID })).toBe(`/accounts/${ID}/ledger`);
  });

  it("a project opens its own page, and the wave 2 modules open the page they belong to", () => {
    expect(drillHref({ target: "project", id: ID })).toBe(`/projects/${ID}`);
    expect(drillHref({ target: "project", id: "x" })).toBe("/projects");
    expect(drillHref({ target: "approval", id: ID })).toBe(`/approvals?highlight=${ID}`);
    expect(drillHref({ target: "loan", id: ID })).toBe(`/payroll?highlight=${ID}`);
    expect(drillHref({ target: "bank_account", id: ID })).toBe(
      `/bank-reconciliation?highlight=${ID}`
    );
  });

  it("an account named by code opens its ledger when the code is known, else the chart of accounts", () => {
    const map = new Map([["1040", ID]]);
    expect(drillHref({ target: "account", id: "1040" }, { accountIdByCode: map })).toBe(
      `/accounts/${ID}/ledger`
    );
    expect(drillHref({ target: "account", id: "9999" }, { accountIdByCode: map })).toBe(
      "/chart-of-accounts"
    );
    expect(drillHref({ target: "account", id: "2020" })).toBe("/chart-of-accounts");
  });

  it("a report row can lead to another report, but only by a plain report id", () => {
    expect(drillHref({ target: "report", id: "vat-audit-sales" })).toBe(
      "/reports/run/vat-audit-sales"
    );
    expect(drillHref({ target: "report", id: "../../evil" })).toBe("/reports/run");
  });

  it("an activity row opens the module the change happened in", () => {
    expect(drillHref({ target: "activity", id: `invoice:${ID}` })).toBe(
      `/invoices?highlight=${ID}`
    );
    expect(drillHref({ target: "activity", id: "mystery:1" })).toBe("/history");
  });

  it("returns null for no drill or a target the server invented", () => {
    expect(drillHref(undefined)).toBeNull();
    expect(drillHref(null)).toBeNull();
    expect(drillHref({ target: "javascript:alert(1)" as any, id: "x" })).toBeNull();
  });

  it("never puts a foreign id into the path; a non-record id becomes a short label in the query", () => {
    const href = drillHref({ target: "invoice", id: "<script>" });
    expect(href).toBe("/invoices?label=%3Cscript%3E");
    expect(href!.startsWith("/invoices")).toBe(true);
  });

  it("a document opens its module's list with the record id (and its number) to highlight", () => {
    for (const [target, route] of [
      ["invoice", "/invoices"],
      ["bill", "/bill-pay"],
      ["credit_note", "/credit-notes"],
      ["refund", "/credit-notes"],
      ["vendor_credit", "/vendor-credits"],
      ["expense_claim", "/expense-claims"],
      ["receipt", "/receipts"],
      ["bank_txn", "/bank-reconciliation"],
      ["sales_order", "/sales-orders"],
      ["advance", "/customer-advances"],
    ] as const) {
      expect(drillHref({ target, id: ID }), target).toBe(`${route}?highlight=${ID}`);
      expect(drillHref({ target, id: ID }, { label: "INV-001" }), target).toBe(
        `${route}?highlight=${ID}&label=INV-001`
      );
    }
  });

  it("a customer or vendor carries the contact id, or the name for rows grouped by name", () => {
    expect(drillHref({ target: "customer", id: ID }, { label: "Acme" })).toBe(
      `/contacts?highlight=${ID}&label=Acme`
    );
    expect(drillHref({ target: "vendor", id: "Vendor A" })).toBe("/contacts?label=Vendor+A");
  });

  it("parses what a list page was opened for, dropping a malformed id and trimming the label", () => {
    expect(parseHighlight(`?highlight=${ID}&label=INV-1`)).toEqual({ id: ID, label: "INV-1" });
    expect(parseHighlight("?highlight=not-an-id")).toEqual({ id: null, label: null });
    expect(parseHighlight(`?label=${"x".repeat(200)}`).label).toHaveLength(80);
    expect(parseHighlight("")).toEqual({ id: null, label: null });
    expect(withHighlight("/invoices", ID)).toBe(`/invoices?highlight=${ID}`);
  });
});
