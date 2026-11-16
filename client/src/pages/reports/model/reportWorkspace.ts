// Report status metadata, persona filters, report viewer categories, workspace tabs and hrefs.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { BadgeProps } from "@/components/ui/badge";
import { Briefcase, ClipboardCheck, type LucideIcon, Users } from "lucide-react";
import type {
  ReportAutomationTriggerSeverity,
  ReportCatalogItem,
  ReportDeliveryAutomationCommand,
  ReportEvidenceCheckpointStatus,
  ReportPersona,
  ReportProductDepthStatus,
  ReportStatus,
  ReportTab,
  ReportWorkspaceIcon,
} from "@/lib/reportCatalog";
import type { PersonaFilter, ReportDeliveryRunStatusFilter } from "./reportTypes";

export const reportStatusMeta: Record<
  ReportStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  live: { label: "Live", variant: "success" },
  api: { label: "API ready", variant: "info" },
  planned: { label: "Planned", variant: "neutral" },
};

export const roadmapImpactMeta = {
  high: { label: "High impact", variant: "warning" },
  medium: { label: "Medium impact", variant: "info" },
  low: { label: "Low impact", variant: "neutral" },
} as const satisfies Record<string, { label: string; variant: BadgeProps["variant"] }>;

export const triggerSeverityMeta = {
  critical: { label: "Critical", variant: "danger" },
  review: { label: "Review", variant: "warning" },
  info: { label: "Monitor", variant: "info" },
} as const satisfies Record<
  ReportAutomationTriggerSeverity,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthStatusMeta = {
  working: { label: "Working", variant: "success" },
  hardening: { label: "Hardening", variant: "warning" },
  "data-needed": { label: "Data needed", variant: "info" },
} as const satisfies Record<
  ReportProductDepthStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthEvidenceCheckpointStatusMeta = {
  "current-proxy": { label: "Current proxy", variant: "neutral" },
  "missing-source": { label: "Missing source", variant: "warning" },
  guardrail: { label: "Guardrail", variant: "info" },
} as const satisfies Record<
  ReportEvidenceCheckpointStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owner", label: "Owner" },
  { id: "freelancer", label: "Freelancer" },
  { id: "accountant", label: "Accountant" },
];

export const reportViewerCategoryLabels: Record<string, string> = {
  "Financial Statements": "Financial Statements",
  "Sales & Receivables": "Sales & Receivables",
  "Purchases & Payables": "Purchases & Payables",
  Payroll: "Payroll",
  "Accountant & Taxes": "Accountant & Taxes",
  "Inventory & Assets": "Inventory & Assets",
  "Management & Planning": "Management & Planning",
};

// R18-10: statements and tax first for an SMB owner.
export const reportViewerCategoryOrder = [
  "Financial Statements",
  "Accountant & Taxes",
  "Sales & Receivables",
  "Purchases & Payables",
  "Payroll",
  "Inventory & Assets",
  "Management & Planning",
] as const;

export const reportViewerCategoryByReportId: Record<string, string> = {
  "ar-aging": "Sales & Receivables",
  "customer-balances": "Sales & Receivables",
  "invoice-status": "Sales & Receivables",
  "revenue-customer": "Sales & Receivables",
  "sales-product-service": "Sales & Receivables",
  "ap-aging": "Purchases & Payables",
  "vendor-balances": "Purchases & Payables",
  "expenses-vendor": "Purchases & Payables",
  "expenses-category": "Purchases & Payables",
  "expense-claims": "Purchases & Payables",
  "vat-summary": "Accountant & Taxes",
  "vat-return": "Accountant & Taxes",
  "corporate-tax-estimate": "Accountant & Taxes",
  "trial-balance": "Accountant & Taxes",
  "bank-reconciliation-report": "Accountant & Taxes",
  "general-ledger": "Accountant & Taxes",
  "account-transactions": "Accountant & Taxes",
  "month-end-close-status": "Accountant & Taxes",
  "audit-trail": "Accountant & Taxes",
  "inventory-valuation": "Inventory & Assets",
  "inventory-movement": "Inventory & Assets",
  "fixed-asset-register": "Inventory & Assets",
  "depreciation-schedule": "Inventory & Assets",
  "budget-actual": "Management & Planning",
  "cash-flow-forecast": "Management & Planning",
  "cost-center-profitability": "Management & Planning",
  "period-comparison": "Management & Planning",
  "consolidated-statements": "Management & Planning",
};

export const reportViewerPersonaPriority: ReportPersona[] = ["owner", "freelancer", "accountant"];

export const ledgerDetailPageSize = 50;

export interface ReportViewerOption {
  id: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  status: ReportStatus;
  order: number;
  reportId?: string;
  tab?: ReportTab;
  href?: string;
  persona?: ReportPersona;
}

export interface ReportViewerGroup {
  category: string;
  label: string;
  rank: number;
  options: ReportViewerOption[];
}

export function reportViewerCategoryLabel(category: string): string {
  return reportViewerCategoryLabels[category] ?? category;
}

export function reportViewerCategoryForReport(report: ReportCatalogItem): string {
  return reportViewerCategoryByReportId[report.id] ?? report.category;
}

export function reportViewerCategoryRank(category: string): number {
  const index = reportViewerCategoryOrder.indexOf(
    category as (typeof reportViewerCategoryOrder)[number]
  );
  return index === -1 ? reportViewerCategoryOrder.length : index;
}

export function reportViewerPersonaForReport(
  report: ReportCatalogItem,
  currentPersona: ReportPersona
): ReportPersona | undefined {
  if (report.personas.includes(currentPersona)) return currentPersona;
  return reportViewerPersonaPriority.find((persona) => report.personas.includes(persona));
}

export type ReportWorkspaceTab =
  | "home"
  | "reports"
  | "suites"
  | "comparisons"
  | "automation"
  | "delivery"
  | "setup";

export const reportWorkspaceTabs: Array<{
  id: ReportWorkspaceTab;
  label: string;
  description: string;
}> = [
  {
    id: "home",
    label: "Home",
    description: "Top reports and next action",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Library, saved views, statements",
  },
  {
    id: "suites",
    label: "Suites",
    description: "Management packs and bundles",
  },
  {
    id: "comparisons",
    label: "Compare",
    description: "Period movement and snapshots",
  },
  {
    id: "automation",
    label: "Automate",
    description: "Rules, queues, command center",
  },
  {
    id: "delivery",
    label: "Delivery",
    description: "Schedules, packs, handoff",
  },
  {
    id: "setup",
    label: "Setup",
    description: "Role workflows and roadmap",
  },
];

export function reportWorkspaceTabFromLocation(search: string, hash: string): ReportWorkspaceTab {
  const anchor = hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const workspace = params.get("workspace");

  if (reportWorkspaceTabs.some((tab) => tab.id === workspace)) {
    return workspace as ReportWorkspaceTab;
  }

  if (
    anchor.startsWith("report-suite") ||
    anchor.startsWith("report-management-brief") ||
    anchor.startsWith("report-pack-template")
  ) {
    return "suites";
  }

  if (
    anchor.startsWith("report-comparison") ||
    anchor === "period-comparison-title" ||
    anchor === "comparison-snapshots-title"
  ) {
    return "comparisons";
  }

  if (
    anchor.startsWith("report-delivery") ||
    anchor.startsWith("pack-readiness") ||
    anchor === "report-accountant-handoff-title" ||
    anchor === "report-pack-readiness-title" ||
    anchor === "report-pack-automation-title"
  ) {
    return "delivery";
  }

  if (
    anchor.startsWith("report-automation") ||
    anchor.startsWith("automation-") ||
    anchor.startsWith("report-trigger-rule") ||
    anchor.startsWith("automation-rule") ||
    anchor === "report-workflow-readiness-title" ||
    anchor === "decision-shortcuts-title" ||
    anchor === "automation-starters-title" ||
    anchor === "trigger-rules-title"
  ) {
    return "automation";
  }

  if (
    anchor.startsWith("report-role") ||
    anchor.startsWith("report-product-depth") ||
    anchor === "report-roadmap-title" ||
    anchor === "persona-workspaces-title"
  ) {
    return "setup";
  }

  if (
    anchor.startsWith("report-quick-access") ||
    anchor.startsWith("report-saved-view") ||
    anchor === "report-workflow-finder-title" ||
    anchor === "reports-catalog-discovery-summary" ||
    anchor === "report-catalog-readiness-title" ||
    anchor === "recommended-reports-title" ||
    anchor === "report-center-title" ||
    anchor === "connected-report-centers-title"
  ) {
    return "reports";
  }

  if (params.has("tab") || params.has("workflowSearch") || params.has("workflowGap")) {
    return "reports";
  }

  return "reports";
}

export function reportsWorkspaceHref({
  persona,
  reportId,
  tab,
  workspace,
}: {
  persona?: PersonaFilter;
  reportId?: string;
  tab?: ReportTab;
  workspace?: ReportWorkspaceTab;
}): string {
  const params = new URLSearchParams();

  if (tab) params.set("tab", tab);
  if (reportId) params.set("report", reportId);
  if (persona && persona !== "all") params.set("persona", persona);
  if (workspace && workspace !== "home" && workspace !== "reports") {
    params.set("workspace", workspace);
  }

  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export const reportDeliveryRunStatusFilters: Array<{
  id: ReportDeliveryRunStatusFilter;
  label: string;
}> = [
  { id: "all", label: "All runs" },
  { id: "queued", label: "Queued" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];

export const reportDeliveryAutomationCommandLabels: Record<
  ReportDeliveryAutomationCommand,
  string
> = {
  retry: "Retry recovery",
  review: "Review guardrails",
  queue: "Queue next pack",
  comparison: "Open comparison",
};

export const reportWorkspaceIcons: Record<ReportWorkspaceIcon, LucideIcon> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

export const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  posted: "Posted",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
  cancelled: "Cancelled",
};

export const inactiveInvoiceStatuses = new Set(["void", "cancelled"]);

export const nonRevenueInvoiceStatuses = new Set(["draft", "void", "cancelled"]);

export const inactiveVendorBillStatuses = new Set(["paid", "void", "cancelled"]);

export const nonPayableVendorBillStatuses = new Set(["void", "cancelled"]);
