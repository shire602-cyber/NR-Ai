// Report status metadata, persona filters, report viewer categories, workspace tabs and hrefs.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { BadgeProps } from "@/components/ui/badge";
import { translateNow } from "@/lib/i18n";
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
  live: {
    get label() {
      return translateNow("reportCenter.statusLive");
    },
    variant: "success",
  },
  api: {
    get label() {
      return translateNow("reportCenter.statusApiReady");
    },
    variant: "info",
  },
  planned: {
    get label() {
      return translateNow("reportCenter.statusPlanned");
    },
    variant: "neutral",
  },
};

export const roadmapImpactMeta = {
  high: {
    get label() {
      return translateNow("reportCenter.impactHigh");
    },
    variant: "warning",
  },
  medium: {
    get label() {
      return translateNow("reportCenter.impactMedium");
    },
    variant: "info",
  },
  low: {
    get label() {
      return translateNow("reportCenter.impactLow");
    },
    variant: "neutral",
  },
} as const satisfies Record<string, { label: string; variant: BadgeProps["variant"] }>;

export const triggerSeverityMeta = {
  critical: {
    get label() {
      return translateNow("reportCenter.severityCritical");
    },
    variant: "danger",
  },
  review: {
    get label() {
      return translateNow("reportCenter.severityReview");
    },
    variant: "warning",
  },
  info: {
    get label() {
      return translateNow("reportCenter.severityMonitor");
    },
    variant: "info",
  },
} as const satisfies Record<
  ReportAutomationTriggerSeverity,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthStatusMeta = {
  working: {
    get label() {
      return translateNow("reportCenter.depthWorking");
    },
    variant: "success",
  },
  hardening: {
    get label() {
      return translateNow("reportCenter.depthHardening");
    },
    variant: "warning",
  },
  "data-needed": {
    get label() {
      return translateNow("reportCenter.depthDataNeeded");
    },
    variant: "info",
  },
} as const satisfies Record<
  ReportProductDepthStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthEvidenceCheckpointStatusMeta = {
  "current-proxy": {
    get label() {
      return translateNow("reportCenter.checkpointCurrentProxy");
    },
    variant: "neutral",
  },
  "missing-source": {
    get label() {
      return translateNow("reportCenter.checkpointMissingSource");
    },
    variant: "warning",
  },
  guardrail: {
    get label() {
      return translateNow("reportCenter.checkpointGuardrail");
    },
    variant: "info",
  },
} as const satisfies Record<
  ReportEvidenceCheckpointStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  {
    id: "all",
    get label() {
      return translateNow("reportCenter.personaAll");
    },
  },
  {
    id: "owner",
    get label() {
      return translateNow("reportCenter.personaOwner");
    },
  },
  {
    id: "freelancer",
    get label() {
      return translateNow("reportCenter.personaFreelancer");
    },
  },
  {
    id: "accountant",
    get label() {
      return translateNow("reportCenter.personaAccountant");
    },
  },
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
    get label() {
      return translateNow("reportCenter.tabHome");
    },
    get description() {
      return translateNow("reportCenter.tabHomeDesc");
    },
  },
  {
    id: "reports",
    get label() {
      return translateNow("reportCenter.tabReports");
    },
    get description() {
      return translateNow("reportCenter.tabReportsDesc");
    },
  },
  {
    id: "suites",
    get label() {
      return translateNow("reportCenter.tabSuites");
    },
    get description() {
      return translateNow("reportCenter.tabSuitesDesc");
    },
  },
  {
    id: "comparisons",
    get label() {
      return translateNow("reportCenter.tabComparisons");
    },
    get description() {
      return translateNow("reportCenter.tabComparisonsDesc");
    },
  },
  {
    id: "automation",
    get label() {
      return translateNow("reportCenter.tabAutomation");
    },
    get description() {
      return translateNow("reportCenter.tabAutomationDesc");
    },
  },
  {
    id: "delivery",
    get label() {
      return translateNow("reportCenter.tabDelivery");
    },
    get description() {
      return translateNow("reportCenter.tabDeliveryDesc");
    },
  },
  {
    id: "setup",
    get label() {
      return translateNow("reportCenter.tabSetup");
    },
    get description() {
      return translateNow("reportCenter.tabSetupDesc");
    },
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
  if (workspace && workspace !== "reports") {
    params.set("workspace", workspace);
  }

  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export const reportDeliveryRunStatusFilters: Array<{
  id: ReportDeliveryRunStatusFilter;
  label: string;
}> = [
  {
    id: "all",
    get label() {
      return translateNow("reportCenter.allRuns");
    },
  },
  {
    id: "queued",
    get label() {
      return translateNow("reportCenter.runQueued");
    },
  },
  {
    id: "sent",
    get label() {
      return translateNow("reportCenter.runSent");
    },
  },
  {
    id: "failed",
    get label() {
      return translateNow("reportCenter.runFailed");
    },
  },
];

export const reportDeliveryAutomationCommandLabels: Record<
  ReportDeliveryAutomationCommand,
  string
> = {
  get retry() {
    return translateNow("reportCenter.cmdRetry");
  },
  get review() {
    return translateNow("reportCenter.cmdReview");
  },
  get queue() {
    return translateNow("reportCenter.cmdQueue");
  },
  get comparison() {
    return translateNow("reportCenter.cmdComparison");
  },
};

export const reportWorkspaceIcons: Record<ReportWorkspaceIcon, LucideIcon> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

export const invoiceStatusLabels: Record<string, string> = {
  get draft() {
    return translateNow("reportCenter.invoiceStatusDraft");
  },
  get sent() {
    return translateNow("reportCenter.invoiceStatusSent");
  },
  get posted() {
    return translateNow("reportCenter.invoiceStatusPosted");
  },
  get partial() {
    return translateNow("reportCenter.invoiceStatusPartial");
  },
  get paid() {
    return translateNow("reportCenter.invoiceStatusPaid");
  },
  get void() {
    return translateNow("reportCenter.invoiceStatusVoid");
  },
  get cancelled() {
    return translateNow("reportCenter.invoiceStatusCancelled");
  },
};

export const inactiveInvoiceStatuses = new Set(["void", "cancelled"]);

/**
 * X5 (J1 L5): an invoice counts as unpaid when it is an issued sales invoice (not a credit note)
 * with an open balance; the server's settlement balance decides when it is present.
 */
export function isUnpaidInvoice(invoice: {
  status: string;
  invoiceType?: string | null;
  openBalanceBase?: number | null;
}): boolean {
  if (invoice.invoiceType === "credit_note") return false;
  if (!["sent", "posted", "partial"].includes(invoice.status)) return false;
  if (typeof invoice.openBalanceBase === "number") return invoice.openBalanceBase > 0;
  return true;
}

export const nonRevenueInvoiceStatuses = new Set(["draft", "void", "cancelled"]);

export const inactiveVendorBillStatuses = new Set(["paid", "void", "cancelled"]);

export const nonPayableVendorBillStatuses = new Set(["void", "cancelled"]);

/**
 * E3 (J1-r3 / J2-r3): the reports whose page shows the balances KPI strip (customer / vendor open
 * balance, net AR less AP). The strip and the balance-summaries query both read this list, so
 * the strip is never shown on a report that did not load its figures (it read 0.00 on AP aging).
 */
export const BALANCE_STRIP_REPORT_IDS = [
  "customer-balances",
  "ap-aging",
  "vendor-balances",
  "inventory-valuation",
  "inventory-movement",
  "depreciation-schedule",
  "fixed-asset-register",
] as const;
