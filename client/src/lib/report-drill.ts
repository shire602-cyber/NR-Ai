// Row-click targets of the report viewer (Phase 8 D4): where a drill link from a report row leads. The server names the
// target kind and an id (`ReportDrill`); this module turns that into a page that exists in App.tsx.
// tests/unit/report-drill.test.ts checks that every target kind maps to a route App.tsx defines.
//
// A journal entry, an account ledger and a project have their own pages, and a report row can lead to another report.
// Every other record opens its module's list page with `?highlight=<id>` (and `label=<number>`): no list page takes
// an id of its own, so DrillHighlight (components/reports/DrillHighlight.tsx) scrolls to and marks the row when it can
// find it, and otherwise says which record to look for.

import {
  REPORT_DRILL_TARGETS,
  type ReportDrill,
  type ReportDrillTarget,
} from "@shared/report-result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DrillContext {
  /** Chart-of-accounts code to account id, for reports that name an account by its code. */
  accountIdByCode?: ReadonlyMap<string, string>;
  /** What the row's cell says (a document number or a name): kept in the link so the list page can name the record. */
  label?: string;
}

/** Records the list pages show as rows; the link carries their id so the row can be marked. */
const HIGHLIGHT_TARGETS: ReadonlySet<ReportDrillTarget> = new Set<ReportDrillTarget>([
  "invoice",
  "bill",
  "payment",
  "credit_note",
  "refund",
  "quote",
  "purchase_order",
  "vendor_credit",
  "bank_txn",
  "product",
  "asset",
  "employee",
  "payslip",
  "expense_claim",
  "customer",
  "vendor",
  "sales_order",
  "advance",
  "receipt",
  "approval",
  "loan",
  "bank_account",
]);

const MAX_LABEL = 80;

/** `route?highlight=<id>&label=<text>`; the id only when it is a record id, the label only when there is text. */
export function withHighlight(route: string, id: string, label?: string): string {
  const q = new URLSearchParams();
  if (UUID.test(id)) q.set("highlight", id);
  const text = (label ?? (UUID.test(id) ? "" : id)).trim().slice(0, MAX_LABEL);
  if (text) q.set("label", text);
  const query = q.toString();
  return query ? `${route}?${query}` : route;
}

/** What a list page was opened for, read from its query. A malformed id is dropped. */
export function parseHighlight(search: string): { id: string | null; label: string | null } {
  const q = new URLSearchParams(search);
  const id = q.get("highlight");
  const label = q.get("label");
  return {
    id: id && UUID.test(id) ? id : null,
    label: label ? label.trim().slice(0, MAX_LABEL) || null : null,
  };
}

/** The page a drill target opens when the row carries no usable id. */
export const DRILL_LIST_ROUTE: Record<ReportDrillTarget, string> = {
  account: "/chart-of-accounts",
  journal_entry: "/journal",
  invoice: "/invoices",
  bill: "/bill-pay",
  payment: "/invoices",
  credit_note: "/credit-notes",
  refund: "/credit-notes",
  quote: "/quotes",
  purchase_order: "/purchase-orders",
  vendor_credit: "/vendor-credits",
  bank_txn: "/bank-reconciliation",
  product: "/inventory",
  asset: "/fixed-assets",
  employee: "/payroll",
  payslip: "/payroll",
  expense_claim: "/expense-claims",
  activity: "/history",
  customer: "/contacts",
  vendor: "/contacts",
  company: "/firm/clients",
  report: "/reports/run",
  // Wave 2 (rows over the sales order, advance, project, approval, loan and bank feed tables). The modules with no
  // page of their own open the list they belong to.
  sales_order: "/sales-orders",
  advance: "/customer-advances",
  project: "/projects",
  approval: "/approvals",
  loan: "/payroll",
  bank_account: "/bank-reconciliation",
  // A posted receipt (VAT Audit: Purchases Detail rows).
  receipt: "/receipts",
};

/** Activity entries carry "<entityType>:<entityId>"; the entity type picks the module the change happened in. */
const ACTIVITY_ENTITY_ROUTE: Record<string, string> = {
  invoice: "/invoices",
  bill: "/bill-pay",
  vendor_bill: "/bill-pay",
  journal_entry: "/journal",
  account: "/chart-of-accounts",
  quote: "/quotes",
  purchase_order: "/purchase-orders",
  credit_note: "/credit-notes",
  vendor_credit: "/vendor-credits",
  expense_claim: "/expense-claims",
  fixed_asset: "/fixed-assets",
  payroll_run: "/payroll",
  contact: "/contacts",
  customer_contact: "/contacts",
  report_schedule: "/reports/schedules",
};

/** Report ids are simple slugs; anything else is not followed. */
const REPORT_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function isDrillTarget(value: string): value is ReportDrillTarget {
  return (REPORT_DRILL_TARGETS as readonly string[]).includes(value);
}

/** The page for a row's drill, or null when it has none (an unknown target is never turned into a link). */
export function drillHref(
  drill: ReportDrill | undefined | null,
  context: DrillContext = {}
): string | null {
  if (!drill || !isDrillTarget(drill.target)) return null;
  const id = String(drill.id ?? "").trim();
  switch (drill.target) {
    case "journal_entry":
      return UUID.test(id) ? `/journal/${id}` : DRILL_LIST_ROUTE.journal_entry;
    case "account": {
      if (UUID.test(id)) return `/accounts/${id}/ledger`;
      const byCode = id ? context.accountIdByCode?.get(id) : undefined;
      return byCode ? `/accounts/${byCode}/ledger` : DRILL_LIST_ROUTE.account;
    }
    case "project":
      return UUID.test(id) ? `/projects/${id}` : DRILL_LIST_ROUTE.project;
    case "report":
      return REPORT_ID.test(id) ? `/reports/run/${id}` : DRILL_LIST_ROUTE.report;
    case "activity": {
      const [entityType = "", entityId = ""] = id.split(":");
      const route = ACTIVITY_ENTITY_ROUTE[entityType];
      return route ? withHighlight(route, entityId, context.label) : DRILL_LIST_ROUTE.activity;
    }
    default: {
      const route = DRILL_LIST_ROUTE[drill.target];
      return HIGHLIGHT_TARGETS.has(drill.target) ? withHighlight(route, id, context.label) : route;
    }
  }
}
