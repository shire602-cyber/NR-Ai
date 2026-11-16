import { type BadgeProps } from "@/components/ui/badge";
import {
  reportSectionHref,
  reportsHref,
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
  type ReportPersonaWorkspace,
} from "@/lib/reportCatalog";
import { Plus, Receipt, BookOpen, Sparkles, Clock, CheckCircle2, BarChart3 } from "lucide-react";

// ─── Dashboard comparison snapshot ──────────────────────────────────────────

export type DashboardComparisonId = "revenue" | "expenses" | "profit";

export interface DashboardComparisonRow {
  id: DashboardComparisonId;
  label: string;
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  favorable: "increase" | "decrease";
  href: string;
}

export interface DashboardReportAutomationPreference {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

export interface DashboardAutomationAction {
  title: string;
  detail: string;
  href: string;
  cta: string;
  badge: string;
  badgeVariant: BadgeProps["variant"];
  command?: ReportDeliveryAutomationCommand;
  actionType?: "link" | "queue" | "retry";
  subscriptionId?: string;
  runId?: string;
}

export interface DashboardRoleWorkdayAction {
  id: string;
  icon: typeof Plus;
  title: string;
  description: string;
  href: string;
  cta: string;
}

export interface DashboardRoleWorkdayPath {
  eyebrow: string;
  title: string;
  description: string;
  actions: DashboardRoleWorkdayAction[];
}

export interface DashboardReportDeliveryRun {
  id: string;
  subscriptionId: string;
  status: string;
  readinessStatus: "ready" | "setup" | "paused";
  scheduledFor: string;
  createdAt: string;
  errorMessage: string | null;
  channel: string;
  format: string;
  recipients: string;
  deliveryGuardrail: string;
  reportCount: number;
  readyReportCount: number;
  triggerRuleCount: number;
  retriedFromRunId: string | null;
}

export function dashboardPercentChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatDashboardComparisonPercent(value: number | null): string {
  if (value === null) return "New";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function dashboardComparisonBadgeVariant(
  row: DashboardComparisonRow
): BadgeProps["variant"] {
  if (row.percentChange === null || Math.abs(row.delta) < 0.005) return "neutral";
  const improved = row.favorable === "increase" ? row.delta > 0 : row.delta < 0;
  return improved ? "success" : "warning";
}

export function dashboardDeliveryRunReadinessVariant(status: string): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "paused") return "neutral";
  return "warning";
}

export function formatDashboardDeliveryRunTime(
  value: string | Date | null | undefined,
  locale: string
): string {
  if (!value) return "No delivery time";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function dashboardDeliveryRunStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "neutral";
  return "info";
}

export function dashboardDeliveryRunStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function dashboardReportWorkflowSearchScore(
  values: Array<string | number | null | undefined>,
  normalizedSearch: string
): number {
  if (!normalizedSearch) return 0;

  const haystack = values
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();

  let score = haystack.includes(normalizedSearch) ? 100 : 0;
  for (const term of normalizedSearch.split(/\s+/).filter(Boolean)) {
    if (haystack.includes(term)) score += 10;
  }
  return score;
}

export function getDashboardRoleWorkdayPath(
  workspace: ReportPersonaWorkspace
): DashboardRoleWorkdayPath {
  const quickAccessHref = reportSectionHref(workspace, "quick-access");
  const automationHref = reportSectionHref(workspace, "automation-starters");
  const deliveryHref = reportSectionHref(workspace, "delivery-subscriptions");
  const workflowHref = reportSectionHref(workspace, "workflow-finder");

  if (workspace.persona === "freelancer") {
    return {
      eyebrow: "Freelancer path",
      title: "Start with billing, receipts, tax, then automation.",
      description: "A smaller daily path for freelancers before opening the full report library.",
      actions: [
        {
          id: "freelancer-invoice",
          icon: Plus,
          title: "Send or chase invoices",
          description: "Create client invoices and keep open balances visible.",
          href: "/invoices",
          cta: "Invoice",
        },
        {
          id: "freelancer-receipts",
          icon: Receipt,
          title: "Log client expenses",
          description: "Capture receipts before they become month-end cleanup.",
          href: "/receipts",
          cta: "Receipt",
        },
        {
          id: "freelancer-tax-cash",
          icon: BarChart3,
          title: "Review tax and cash",
          description: "Open the freelancer reports for tax exposure and cash pressure.",
          href: quickAccessHref,
          cta: "Reports",
        },
        {
          id: "freelancer-admin-automation",
          icon: Sparkles,
          title: "Start admin automation",
          description: "Turn receipt, collection, and delivery routines into repeatable steps.",
          href: automationHref,
          cta: "Automate",
        },
      ],
    };
  }

  if (workspace.persona === "accountant") {
    return {
      eyebrow: "Accountant path",
      title: "Start with exceptions, close, comparisons, then packs.",
      description:
        "A review-first path for accountants before moving into the full client reporting workspace.",
      actions: [
        {
          id: "accountant-workflow-finder",
          icon: CheckCircle2,
          title: "Find report gaps",
          description: "Open the workflow finder for missing reports, rules, or deliveries.",
          href: workflowHref,
          cta: "Review",
        },
        {
          id: "accountant-close-reports",
          icon: BookOpen,
          title: "Open close reports",
          description: "Review trial balance, ledgers, audit log, and close readiness.",
          href: reportsHref({ tab: "close", persona: workspace.persona }),
          cta: "Close",
        },
        {
          id: "accountant-comparisons",
          icon: BarChart3,
          title: "Run comparisons",
          description: "Check current-vs-prior movement before client review.",
          href: reportSectionHref(workspace, "recommendations"),
          cta: "Compare",
        },
        {
          id: "accountant-pack-delivery",
          icon: Clock,
          title: "Schedule client pack",
          description: "Queue recurring packs with delivery guardrails.",
          href: deliveryHref,
          cta: "Delivery",
        },
      ],
    };
  }

  return {
    eyebrow: "Owner / solo path",
    title: "Start with sales, spend, cash, then the weekly pack.",
    description: "A lighter path for solo entrepreneurs before opening the full report workspace.",
    actions: [
      {
        id: "owner-solo-invoice",
        icon: Plus,
        title: "Record today's sale",
        description: "Create the invoice first so revenue and tax reports stay current.",
        href: "/invoices",
        cta: "Invoice",
      },
      {
        id: "owner-solo-receipts",
        icon: Receipt,
        title: "Capture spend",
        description: "Upload receipts before they become bookkeeping backlog.",
        href: "/receipts",
        cta: "Receipt",
      },
      {
        id: "owner-solo-cash",
        icon: BarChart3,
        title: "Check cash pressure",
        description: "Open owner reports for receivables, runway, VAT, and profit.",
        href: quickAccessHref,
        cta: "Reports",
      },
      {
        id: "owner-solo-pack",
        icon: Clock,
        title: "Queue the weekly pack",
        description: "Send the owner pack after bank, invoice, and receipt updates.",
        href: deliveryHref,
        cta: "Delivery",
      },
    ],
  };
}
