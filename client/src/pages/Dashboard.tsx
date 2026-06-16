import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, StatusBadge, type BadgeProps } from "@/components/ui/badge";
import { ReportLaunchPicker } from "@/components/reports/ReportLaunchPicker";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import { apiRequest } from "@/lib/queryClient";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  calculateReportAutomationHealth,
  getPreferredReportPersona,
  parseReportDeliveryAutomationCommand,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportCatalog,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportHref,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportsHref,
  reportWorkspaceHref,
  setPreferredReportPersona,
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
} from "@/lib/reportCatalog";
import {
  TrendingUp,
  TrendingDown,
  FileText,
  Plus,
  Receipt,
  BookOpen,
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  Coins,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { MeshGradient } from "@/components/ui/mesh-gradient";
import ClientDashboard from "./ClientDashboard";

const CHART_COLORS = {
  primary: "hsl(var(--chart-1))",
  accent: "hsl(var(--chart-2))",
  warning: "hsl(var(--chart-3))",
  info: "hsl(var(--chart-4))",
  muted: "hsl(var(--chart-5))",
};

const PIE_PALETTE = [
  CHART_COLORS.accent,
  CHART_COLORS.primary,
  CHART_COLORS.warning,
  CHART_COLORS.info,
  CHART_COLORS.muted,
];

// ─── Count-up hook ───────────────────────────────────────────────────────────

/** Eases a numeric value toward its target — the landing-page counter feel. */
function useCountUp(target: number, duration = 1400): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effectiveDuration = reduceMotion ? 0 : duration;
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = effectiveDuration === 0 ? 1 : Math.min(1, (now - start) / effectiveDuration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (user?.userType === "client") return <ClientDashboard />;
  return <CustomerDashboard />;
}

// ─── Editorial KPI Card ──────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  trend?: "up" | "down" | "flat";
  spark?: number[];
  accent: "primary" | "success" | "warning" | "info";
  isLoading?: boolean;
  delay?: number;
}

function KpiCard({
  label,
  value,
  delta,
  trend,
  spark,
  accent,
  isLoading,
  delay = 0,
}: KpiCardProps) {
  const accentClasses = {
    primary: "text-foreground",
    success: "text-success-subtle-foreground",
    warning: "text-warning-subtle-foreground",
    info: "text-info-subtle-foreground",
  }[accent];

  const sparkColor = {
    primary: "hsl(var(--chart-1))",
    success: "hsl(var(--success))",
    warning: "hsl(var(--warning))",
    info: "hsl(var(--info))",
  }[accent];

  const sparkData = useMemo(() => (spark ?? []).map((v, i) => ({ i, v })), [spark]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Card className="group h-full overflow-hidden hover-lift border-card-border">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              {label}
            </div>
            {delta !== undefined && (
              <div
                className={
                  "inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded " +
                  (trend === "up"
                    ? "bg-success-subtle text-success-subtle-foreground"
                    : trend === "down"
                      ? "bg-danger-subtle text-danger-subtle-foreground"
                      : "bg-neutral-subtle text-neutral-subtle-foreground")
                }
              >
                {trend === "up" ? (
                  <TrendingUp className="w-3 h-3" />
                ) : trend === "down" ? (
                  <TrendingDown className="w-3 h-3" />
                ) : null}
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}%
              </div>
            )}
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <div
                className={
                  "font-mono font-semibold tracking-tight tabular-nums text-[26px] leading-none " +
                  accentClasses
                }
                data-testid={`text-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {value}
              </div>
            )}
            {sparkData.length > 1 && (
              <div className="w-20 h-10 -mb-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={sparkColor} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={sparkColor}
                      strokeWidth={1.5}
                      fill={`url(#spark-${accent})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// ─── Compliance pulse ────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const animated = useCountUp(score, 1200);
  const r = 26;
  const c = 2 * Math.PI * r;
  const color =
    score >= 80
      ? "hsl(var(--success))"
      : score >= 50
        ? "hsl(var(--warning))"
        : "hsl(var(--destructive))";
  return (
    <div
      className="relative w-16 h-16 shrink-0"
      role="img"
      aria-label={`Audit readiness score ${score} out of 100`}
    >
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx={32} cy={32} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={5} />
        <circle
          cx={32}
          cy={32}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, Math.max(0, animated)) / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono font-semibold tabular-nums text-[15px] text-foreground">
        {Math.round(animated)}
      </div>
    </div>
  );
}

function FilingStatusBadge({
  status,
  t,
}: {
  status?: "up_to_date" | "due_soon" | "overdue";
  t: Record<string, string>;
}) {
  if (status === "overdue")
    return (
      <Badge variant="danger" dot>
        {t.overdue ?? "Overdue"}
      </Badge>
    );
  if (status === "due_soon")
    return (
      <Badge variant="warning" dot>
        {t.dueSoon ?? "Due soon"}
      </Badge>
    );
  return (
    <Badge variant="success" dot>
      {t.onTrack ?? "On track"}
    </Badge>
  );
}

/**
 * Maps audit-readiness issue strings from /compliance/overview to the screen
 * where the user can resolve them. Strings must match the server exactly
 * (server/routes/compliance-dashboard.routes.ts).
 */
const ISSUE_ACTIONS: Record<string, { href: string; cta: string }> = {
  "No VAT returns filed": { href: "/vat-filing", cta: "File VAT 201" },
  "No chart of accounts configured": { href: "/chart-of-accounts", cta: "Set up accounts" },
  "No journal entries in the last 90 days": { href: "/journal", cta: "Post an entry" },
  "No bank reconciliation rules configured": {
    href: "/bank-reconciliation",
    cta: "Set up reconciliation",
  },
  "Bank reconciliation not set up": { href: "/bank-reconciliation", cta: "Set up reconciliation" },
  "No completed data backups": { href: "/backup-restore", cta: "Run a backup" },
};

function FixItRow({ issue }: { issue: string }) {
  const action = ISSUE_ACTIONS[issue];
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
        <span className="text-[13px] text-foreground/80 truncate">{issue}</span>
      </div>
      {action && (
        <Link href={action.href}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-accent hover:text-accent shrink-0 -me-2"
          >
            {action.cta} <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      )}
    </div>
  );
}

// ─── Dashboard comparison snapshot ──────────────────────────────────────────

type DashboardComparisonId = "revenue" | "expenses" | "profit";

interface DashboardComparisonRow {
  id: DashboardComparisonId;
  label: string;
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  favorable: "increase" | "decrease";
  href: string;
}

interface DashboardReportAutomationPreference {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

interface DashboardAutomationAction {
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

interface DashboardReportDeliveryRun {
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

function dashboardPercentChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatDashboardComparisonPercent(value: number | null): string {
  if (value === null) return "New";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function dashboardComparisonBadgeVariant(row: DashboardComparisonRow): BadgeProps["variant"] {
  if (row.percentChange === null || Math.abs(row.delta) < 0.005) return "neutral";
  const improved = row.favorable === "increase" ? row.delta > 0 : row.delta < 0;
  return improved ? "success" : "warning";
}

function dashboardDeliveryRunReadinessVariant(status: string): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "paused") return "neutral";
  return "warning";
}

function formatDashboardDeliveryRunTime(
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

function dashboardDeliveryRunStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "neutral";
  return "info";
}

function dashboardDeliveryRunStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ─── Quick action ────────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, title, description, href, delay = 0 }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Link href={href}>
        <div className="group relative h-full p-5 rounded-xl border border-card-border bg-card hover-lift cursor-pointer overflow-hidden transition-colors">
          <div
            aria-hidden
            className="absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-accent/8 via-transparent to-primary/5 pointer-events-none"
          />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-foreground/5 text-foreground/80 ring-1 ring-border/60 group-hover:bg-accent/10 group-hover:text-accent group-hover:ring-accent/30 transition-colors">
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <ArrowUpRight className="ms-auto w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </div>
            <div className="mt-4 font-semibold text-[14px] tracking-tight text-foreground">
              {title}
            </div>
            <div className="mt-1 text-[12.5px] text-muted-foreground leading-snug">
              {description}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && (
          <div className="text-[10.5px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/80">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-1 font-display text-[22px] md:text-[26px] leading-none text-foreground tracking-tight">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

// ─── Customer dashboard ──────────────────────────────────────────────────────

function CustomerDashboard() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [preferredReportPersona, setDashboardReportPersona] = useState<ReportPersona>(
    () => getPreferredReportPersona() ?? "owner"
  );
  const preferredReportWorkspace = useMemo(() => {
    return (
      reportPersonaWorkspaces.find((workspace) => workspace.persona === preferredReportPersona) ??
      reportPersonaWorkspaces[0]
    );
  }, [preferredReportPersona]);
  const reportCatalogDiscoveryQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(preferredReportWorkspace.persona),
    queryFn: () => fetchReportCatalogDiscovery(preferredReportWorkspace.persona),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const reportAutomationPreferencesQuery = useQuery<{
    preferences: DashboardReportAutomationPreference[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    enabled: Boolean(selectedCompanyId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const dashboardReportWorkspaces = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const readyReports = reports.filter((report) => report.status !== "planned").length;
      return {
        ...workspace,
        readyReports,
        totalReports: reports.length,
        readinessPercent: reports.length ? Math.round((readyReports / reports.length) * 100) : 0,
        isSelected: workspace.persona === preferredReportPersona,
      };
    });
  }, [preferredReportPersona]);
  const selectDashboardReportPersona = (persona: ReportPersona) => {
    setPreferredReportPersona(persona);
    setDashboardReportPersona(persona);
  };
  const preferredWorkspaceCatalogReports = useMemo(() => {
    return reportCatalog.filter((report) =>
      report.personas.includes(preferredReportWorkspace.persona)
    );
  }, [preferredReportWorkspace.persona]);
  const preferredWorkspaceReports = useMemo(() => {
    return preferredWorkspaceCatalogReports
      .filter((report) => report.status !== "planned")
      .slice(0, 4);
  }, [preferredWorkspaceCatalogReports]);
  const preferredReportPackReadiness = useMemo(() => {
    const readyReports = preferredWorkspaceCatalogReports.filter(
      (report) => report.status !== "planned"
    ).length;
    const plannedReports = preferredWorkspaceCatalogReports.length - readyReports;

    return {
      readyReports,
      plannedReports,
      totalReports: preferredWorkspaceCatalogReports.length,
      automationLanes: preferredReportWorkspace.automations.length,
      syncedLiveReports: reportCatalogDiscoveryQuery.data?.summary.liveReportCount ?? readyReports,
      syncedAutomationLanes:
        reportCatalogDiscoveryQuery.data?.summary.automationPlaybookCount ??
        preferredReportWorkspace.automations.length,
      readinessPercent: preferredWorkspaceCatalogReports.length
        ? Math.round((readyReports / preferredWorkspaceCatalogReports.length) * 100)
        : 0,
    };
  }, [
    preferredReportWorkspace.automations.length,
    preferredWorkspaceCatalogReports,
    reportCatalogDiscoveryQuery.data?.summary.automationPlaybookCount,
    reportCatalogDiscoveryQuery.data?.summary.liveReportCount,
  ]);
  const preferredReportPackTemplates = useMemo(() => {
    return reportPackTemplates
      .filter((template) => template.persona === preferredReportWorkspace.persona)
      .map((template) => {
        const reports = template.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;

        return {
          ...template,
          reports,
          readyReports,
          href: reportPackTemplateHref(template),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const preferredReportAutomationStarters = useMemo(() => {
    return reportAutomationStarters
      .filter((starter) => starter.persona === preferredReportWorkspace.persona)
      .map((starter) => {
        const reports = starter.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;
        const playbooks = starter.playbookIds
          .map((playbookId) =>
            preferredReportWorkspace.automations.find((playbook) => playbook.id === playbookId)
          )
          .filter((playbook): playbook is (typeof preferredReportWorkspace.automations)[number] =>
            Boolean(playbook)
          );

        return {
          ...starter,
          reports,
          readyReports,
          playbooks,
          href: reportAutomationStarterHref(starter),
        };
      });
  }, [preferredReportWorkspace]);
  const preferredReportDecisionShortcuts = useMemo(() => {
    return reportDecisionShortcuts
      .filter((shortcut) => shortcut.persona === preferredReportWorkspace.persona)
      .map((shortcut) => {
        const reports = shortcut.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const primaryReport =
          reports.find((report) => report.id === shortcut.primaryReportId) ?? reports[0];

        return {
          ...shortcut,
          reports,
          primaryReport,
          href: reportDecisionShortcutHref(shortcut),
          primaryReportHref: primaryReport
            ? (reportHref(primaryReport) ?? reportDecisionShortcutHref(shortcut))
            : reportDecisionShortcutHref(shortcut),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const preferredReportTriggerRules = useMemo(() => {
    return reportAutomationTriggerRules
      .filter((rule) => rule.persona === preferredReportWorkspace.persona)
      .map((rule) => {
        const reports = rule.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const primaryReport = reports[0] ?? null;

        return {
          ...rule,
          reports,
          primaryReport,
          href: reportAutomationTriggerRuleHref(rule),
          primaryReportHref: primaryReport
            ? (reportHref(primaryReport) ?? reportAutomationTriggerRuleHref(rule))
            : reportAutomationTriggerRuleHref(rule),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const preferredReportDeliverySubscriptions = useMemo(() => {
    return reportDeliverySubscriptions
      .filter((subscription) => subscription.persona === preferredReportWorkspace.persona)
      .map((subscription) => {
        const reports = subscription.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;
        const triggerRules = subscription.triggerRuleIds
          .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
          .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
        const packTemplate = reportPackTemplates.find(
          (template) => template.id === subscription.packTemplateId
        );

        return {
          ...subscription,
          reports,
          readyReports,
          triggerRules,
          packTemplate,
          href: reportDeliverySubscriptionHref(subscription),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const dashboardPinnedDeliveryAutomationCommand = useMemo(() => {
    const preference = reportAutomationPreferencesQuery.data?.preferences.find(
      (item) => item.persona === preferredReportWorkspace.persona
    );

    return preference
      ? (parseReportDeliveryAutomationCommand(preference.preferredDeliveryAutomationCommand) ??
          undefined)
      : undefined;
  }, [preferredReportWorkspace.persona, reportAutomationPreferencesQuery.data?.preferences]);

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/stats"],
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    enabled: !!selectedCompanyId,
  });

  const { data: journalEntries } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    enabled: !!selectedCompanyId,
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/expense-breakdown"],
    enabled: !!selectedCompanyId,
  });

  const { data: monthlyTrends, isLoading: trendsLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/monthly-trends"],
    enabled: !!selectedCompanyId,
  });

  const { data: compliance } = useQuery<any>({
    queryKey: ["/api/companies", selectedCompanyId, "compliance/overview"],
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const dashboardReportDeliveryRunsQuery = useQuery<{
    runs: DashboardReportDeliveryRun[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs", "dashboard"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    enabled: Boolean(selectedCompanyId),
    retry: 1,
  });

  const queueDashboardReportDeliverySubscription = useMutation({
    mutationFn: (subscriptionId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before queuing delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/queue`
      );
    },
    onSuccess: (result: any) => {
      dashboardReportDeliveryRunsQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: "Report pack queued",
        description: nextRunLabel
          ? `${subscriptionTitle} queued for ${nextRunLabel}.`
          : `${subscriptionTitle} queued from Dashboard.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not queue report pack",
        description: error?.message || "Failed to queue the report pack",
        variant: "destructive",
      });
    },
  });

  const retryDashboardReportDeliveryRun = useMutation({
    mutationFn: (runId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before retrying delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
    },
    onSuccess: (result: any) => {
      dashboardReportDeliveryRunsQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      toast({
        title: "Report delivery retry queued",
        description: `${subscriptionTitle} was requeued from Dashboard.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not retry report delivery",
        description: error?.message || "Failed to retry the report delivery",
        variant: "destructive",
      });
    },
  });

  // Derive deltas + sparklines from monthlyTrends, gracefully handling empty data
  const sparks = useMemo(() => {
    const trends = monthlyTrends ?? [];
    const revenueSeries = trends.map((t) => Number(t?.revenue ?? 0));
    const expenseSeries = trends.map((t) => Number(t?.expenses ?? 0));
    const profitSeries = trends.map((t) => Number(t?.revenue ?? 0) - Number(t?.expenses ?? 0));

    const pctChange = (series: number[]) => {
      if (series.length < 2) return undefined;
      const prev = series[series.length - 2];
      const curr = series[series.length - 1];
      if (!prev) return undefined;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    return {
      revenue: { series: revenueSeries, delta: pctChange(revenueSeries) },
      expenses: { series: expenseSeries, delta: pctChange(expenseSeries) },
      profit: { series: profitSeries, delta: pctChange(profitSeries) },
    };
  }, [monthlyTrends]);

  const dashboardComparisonRows = useMemo(() => {
    const trends = monthlyTrends ?? [];
    const current = trends[trends.length - 1] ?? {};
    const previous = trends[trends.length - 2] ?? {};
    const currentRevenue = Number(current?.revenue ?? 0);
    const previousRevenue = Number(previous?.revenue ?? 0);
    const currentExpenses = Number(current?.expenses ?? 0);
    const previousExpenses = Number(previous?.expenses ?? 0);

    const rows: Record<DashboardComparisonId, DashboardComparisonRow> = {
      revenue: {
        id: "revenue",
        label: "Revenue",
        current: currentRevenue,
        previous: previousRevenue,
        delta: currentRevenue - previousRevenue,
        percentChange: dashboardPercentChange(currentRevenue, previousRevenue),
        favorable: "increase",
        href: reportsHref({ tab: "sales", persona: preferredReportWorkspace.persona }),
      },
      expenses: {
        id: "expenses",
        label: "Expenses",
        current: currentExpenses,
        previous: previousExpenses,
        delta: currentExpenses - previousExpenses,
        percentChange: dashboardPercentChange(currentExpenses, previousExpenses),
        favorable: "decrease",
        href: reportsHref({ tab: "expenses", persona: preferredReportWorkspace.persona }),
      },
      profit: {
        id: "profit",
        label: "Profit",
        current: currentRevenue - currentExpenses,
        previous: previousRevenue - previousExpenses,
        delta: currentRevenue - currentExpenses - (previousRevenue - previousExpenses),
        percentChange: dashboardPercentChange(
          currentRevenue - currentExpenses,
          previousRevenue - previousExpenses
        ),
        favorable: "increase",
        href: reportsHref({ tab: "pl", persona: preferredReportWorkspace.persona }),
      },
    };

    const comparisonOrder = {
      owner: ["revenue", "profit", "expenses"],
      freelancer: ["revenue", "expenses", "profit"],
      accountant: ["profit", "revenue", "expenses"],
    } as const;

    return comparisonOrder[preferredReportWorkspace.persona].map((id) => rows[id]);
  }, [monthlyTrends, preferredReportWorkspace.persona]);

  const reportAutomationHealth = useMemo(() => {
    const comparisonWarnings = dashboardComparisonRows.filter(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    ).length;
    return calculateReportAutomationHealth({
      readinessPercent: preferredReportPackReadiness.readinessPercent,
      automationLaneCount: preferredReportPackReadiness.automationLanes,
      comparisonMetricCount: dashboardComparisonRows.length,
      comparisonWarningCount: comparisonWarnings,
      plannedReportCount: preferredReportPackReadiness.plannedReports,
    });
  }, [dashboardComparisonRows, preferredReportPackReadiness]);

  const dashboardPersonaDeliveryRuns = useMemo(() => {
    const subscriptionIds = new Set(
      preferredReportDeliverySubscriptions.map((subscription) => subscription.id)
    );
    return (dashboardReportDeliveryRunsQuery.data?.runs ?? [])
      .filter((run) => subscriptionIds.has(run.subscriptionId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [dashboardReportDeliveryRunsQuery.data?.runs, preferredReportDeliverySubscriptions]);

  const dashboardLatestDeliveryRun = dashboardPersonaDeliveryRuns[0] ?? null;
  const dashboardLatestFailedDeliveryRun =
    dashboardPersonaDeliveryRuns.find((run) => run.status === "failed") ?? null;
  const dashboardLatestDeliveryRunSubscription = dashboardLatestDeliveryRun
    ? (preferredReportDeliverySubscriptions.find(
        (subscription) => subscription.id === dashboardLatestDeliveryRun.subscriptionId
      ) ?? null)
    : null;
  const dashboardDeliveryRunStatusSummary = useMemo(() => {
    if (!dashboardLatestDeliveryRun) return null;

    const subscriptionTitle = dashboardLatestDeliveryRunSubscription?.title ?? "Report delivery";
    const scheduledLabel = formatDashboardDeliveryRunTime(
      dashboardLatestDeliveryRun.scheduledFor,
      locale
    );
    const statusLabel = dashboardDeliveryRunStatusLabel(dashboardLatestDeliveryRun.status);
    const statusVariant = dashboardDeliveryRunStatusVariant(dashboardLatestDeliveryRun.status);
    const detail =
      dashboardLatestDeliveryRun.status === "failed"
        ? `${subscriptionTitle} failed before ${scheduledLabel}${
            dashboardLatestDeliveryRun.errorMessage
              ? `: ${dashboardLatestDeliveryRun.errorMessage}`
              : "."
          }`
        : dashboardLatestDeliveryRun.status === "sent"
          ? `${subscriptionTitle} was sent for ${scheduledLabel}.`
          : dashboardLatestDeliveryRun.status === "queued"
            ? `${subscriptionTitle} is queued for ${scheduledLabel}.`
            : `${subscriptionTitle} is ${dashboardLatestDeliveryRun.status} for ${scheduledLabel}.`;

    return {
      status: dashboardLatestDeliveryRun.status,
      statusLabel,
      statusVariant,
      detail,
    };
  }, [dashboardLatestDeliveryRun, dashboardLatestDeliveryRunSubscription, locale]);

  const dashboardPinnedAutomationAction = useMemo<DashboardAutomationAction | null>(() => {
    if (!dashboardPinnedDeliveryAutomationCommand) return null;

    const warningComparison = dashboardComparisonRows.find(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    );
    const primaryDeliverySubscription = preferredReportDeliverySubscriptions[0];

    if (dashboardPinnedDeliveryAutomationCommand === "retry") {
      return {
        title: "Recover report delivery",
        detail: dashboardLatestFailedDeliveryRun
          ? `Retry the latest failed ${preferredReportWorkspace.navLabel.toLowerCase()} report delivery from Dashboard.`
          : `Pinned recovery command for ${preferredReportWorkspace.navLabel.toLowerCase()} opens failed deliveries and guardrails before the next pack goes out.`,
        href: reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
        cta: dashboardLatestFailedDeliveryRun ? "Retry delivery" : "Open recovery",
        badge: "Pinned recovery",
        badgeVariant: "warning",
        command: dashboardPinnedDeliveryAutomationCommand,
        actionType: dashboardLatestFailedDeliveryRun ? "retry" : "link",
        runId: dashboardLatestFailedDeliveryRun?.id,
      };
    }

    if (dashboardPinnedDeliveryAutomationCommand === "review") {
      return {
        title: "Review delivery guardrails",
        detail: primaryDeliverySubscription
          ? `${primaryDeliverySubscription.title} is the pinned review path for recipients, cadence, and approval guardrails.`
          : `Open delivery guardrails for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href:
          primaryDeliverySubscription?.href ??
          reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
        cta: "Review guardrails",
        badge: "Pinned review",
        badgeVariant: "info",
        command: dashboardPinnedDeliveryAutomationCommand,
      };
    }

    if (dashboardPinnedDeliveryAutomationCommand === "queue") {
      return {
        title: "Queue next report pack",
        detail: primaryDeliverySubscription
          ? `${primaryDeliverySubscription.title} is pinned as the next automated report pack for this workspace.`
          : `Open pack automation for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href: reportSectionHref(preferredReportWorkspace, "pack-automation"),
        cta: "Queue pack",
        badge: "Pinned queue",
        badgeVariant: "success",
        command: dashboardPinnedDeliveryAutomationCommand,
        actionType: primaryDeliverySubscription ? "queue" : "link",
        subscriptionId: primaryDeliverySubscription?.id,
      };
    }

    return {
      title: "Open comparison pack",
      detail: warningComparison
        ? `${warningComparison.label} movement is pinned for current-vs-prior review.`
        : `Open comparison recommendations for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
      href:
        warningComparison?.href ?? reportSectionHref(preferredReportWorkspace, "recommendations"),
      cta: "Open comparison",
      badge: "Pinned comparison",
      badgeVariant: warningComparison ? "warning" : "info",
      command: dashboardPinnedDeliveryAutomationCommand,
    };
  }, [
    dashboardComparisonRows,
    dashboardLatestFailedDeliveryRun,
    dashboardPinnedDeliveryAutomationCommand,
    preferredReportDeliverySubscriptions,
    preferredReportWorkspace,
  ]);

  const preferredAutomationNextAction = useMemo<DashboardAutomationAction>(() => {
    if (dashboardPinnedAutomationAction) return dashboardPinnedAutomationAction;

    const warningComparison = dashboardComparisonRows.find(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    );

    if (warningComparison) {
      return {
        title: `Review ${warningComparison.label.toLowerCase()} movement`,
        detail: `${warningComparison.label} moved ${formatDashboardComparisonPercent(
          warningComparison.percentChange
        )} vs prior month for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href: warningComparison.href,
        cta: "Open report",
        badge: "Movement",
        badgeVariant: "warning",
      };
    }

    if (
      reportAutomationHealth.reviewSignals > 0 ||
      preferredReportPackReadiness.plannedReports > 0
    ) {
      return {
        title: "Review automation readiness",
        detail: `${reportAutomationHealth.reviewSignals} review signals and ${preferredReportPackReadiness.plannedReports} planned report gaps before scheduled pack delivery.`,
        href: reportSectionHref(preferredReportWorkspace, "automation-rules"),
        cta: "Open rules",
        badge: "Review",
        badgeVariant: "warning",
      };
    }

    const primaryPlaybook = preferredReportWorkspace.automations[0];

    if (primaryPlaybook) {
      return {
        title: primaryPlaybook.title,
        detail: `${primaryPlaybook.trigger}. ${preferredReportWorkspace.packSchedule.automation}`,
        href: reportAutomationPlaybookHref(primaryPlaybook, preferredReportWorkspace.persona),
        cta: primaryPlaybook.cta,
        badge: "Ready lane",
        badgeVariant: "success",
      };
    }

    return {
      title: "Open automation center",
      detail: preferredReportWorkspace.packSchedule.automation,
      href: reportSectionHref(preferredReportWorkspace, "automation-command-center"),
      cta: "Open center",
      badge: "Ready",
      badgeVariant: "success",
    };
  }, [
    dashboardComparisonRows,
    dashboardPinnedAutomationAction,
    preferredReportPackReadiness.plannedReports,
    preferredReportWorkspace,
    reportAutomationHealth.reviewSignals,
  ]);

  const monthLabel = new Date().toLocaleDateString(locale, { month: "long", year: "numeric" });
  const profit = (stats?.revenue || 0) - (stats?.expenses || 0);
  const margin = stats?.revenue > 0 ? (profit / stats.revenue) * 100 : 0;
  const animatedProfit = useCountUp(statsLoading ? 0 : profit);

  return (
    <div className="space-y-12">
      {/* ── Editorial Hero ────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="relative"
      >
        <MeshGradient className="rounded-3xl opacity-60" emerald={0.2} gold={0.16} />
        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          <div className="lg:col-span-7 xl:col-span-8">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-accent mb-3 flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-accent/60" />
              <span className="font-mono">{monthLabel}</span>
            </div>
            <h1 className="font-display text-[40px] md:text-[56px] xl:text-[68px] leading-[1.02] tracking-tightest text-foreground">
              Welcome back<span className="text-accent">.</span>
              <br />
              <span className="text-muted-foreground italic">Here is your financial </span>
              <span className="text-foreground italic">overview.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[14.5px] text-muted-foreground leading-relaxed">
              {t.dashboard ?? "Dashboard"} · A real-time portrait of revenue, expenses, and
              outstanding receivables — built for UAE businesses.
            </p>
          </div>

          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
            <div className="rounded-2xl border border-card-border bg-card/70 p-5 backdrop-blur-xl shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  Net Profit · This Month
                </div>
                <Badge variant={profit >= 0 ? "success" : "danger"} dot>
                  {profit >= 0 ? "Positive" : "Negative"}
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : (
                  <>
                    <span className="font-display text-[36px] md:text-[44px] leading-none tracking-tight tabular-nums text-foreground">
                      {formatCurrency(animatedProfit, "AED", locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                {statsLoading ? null : (
                  <>
                    Margin{" "}
                    <span className="font-mono tabular-nums font-medium text-foreground">
                      {margin.toFixed(1)}%
                    </span>{" "}
                    · Revenue{" "}
                    <span className="font-mono tabular-nums">
                      {formatCurrency(stats?.revenue || 0, "AED", locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/invoices">
                  <Button size="sm" variant="default" data-testid="button-quick-invoice">
                    <FileText className="w-3.5 h-3.5" />
                    New Invoice
                  </Button>
                </Link>
                <Link href="/receipts">
                  <Button size="sm" variant="outline" data-testid="button-quick-receipt">
                    <Receipt className="w-3.5 h-3.5" />
                    Scan Receipt
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Revenue"
          value={formatCurrency(stats?.revenue || 0, "AED", locale)}
          delta={sparks.revenue.delta}
          trend={
            sparks.revenue.delta === undefined
              ? undefined
              : sparks.revenue.delta >= 0
                ? "up"
                : "down"
          }
          spark={sparks.revenue.series}
          accent="success"
          isLoading={statsLoading}
          delay={0.05}
        />
        <KpiCard
          label="Expenses"
          value={formatCurrency(stats?.expenses || 0, "AED", locale)}
          delta={sparks.expenses.delta}
          trend={
            sparks.expenses.delta === undefined
              ? undefined
              : sparks.expenses.delta >= 0
                ? "down"
                : "up"
          }
          spark={sparks.expenses.series}
          accent="warning"
          isLoading={statsLoading}
          delay={0.1}
        />
        <KpiCard
          label="Profit"
          value={formatCurrency(profit, "AED", locale)}
          delta={sparks.profit.delta}
          trend={
            sparks.profit.delta === undefined ? undefined : sparks.profit.delta >= 0 ? "up" : "down"
          }
          spark={sparks.profit.series}
          accent="primary"
          isLoading={statsLoading}
          delay={0.15}
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(stats?.outstanding || 0, "AED", locale)}
          accent="info"
          isLoading={statsLoading}
          delay={0.2}
        />
      </section>

      {/* ── Compliance pulse ─────────────────────────────────────────────── */}
      {compliance && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <SectionHeader
            eyebrow={(t as any).complianceEyebrow ?? "Compliance"}
            title={(t as any).filingPulse ?? "Filing pulse"}
            action={
              <Link href="/compliance-calendar">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  {(t as any).calendarLink ?? "Calendar"} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            }
          />
          <Card className="border-card-border overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/60">
              {/* Audit readiness */}
              <div className="p-5 flex items-center gap-4">
                <ScoreRing score={compliance.auditReadiness?.score ?? 0} />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {(t as any).auditReadiness ?? "Audit readiness"}
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground leading-snug">
                    {(compliance.auditReadiness?.issues?.length ?? 0) === 0
                      ? "No open items — audit-ready books."
                      : `${compliance.auditReadiness.issues.length} open item${compliance.auditReadiness.issues.length === 1 ? "" : "s"} to resolve`}
                  </div>
                </div>
              </div>

              {/* VAT 201 */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    VAT 201
                  </div>
                  <FilingStatusBadge status={compliance.vatStatus?.filingStatus} t={t as any} />
                </div>
                <div className="mt-2 font-mono tabular-nums text-[14px] text-foreground">
                  {compliance.vatStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.vatStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Link href="/vat-filing">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 -ms-3 gap-1 text-accent hover:text-accent"
                  >
                    {(t as any).openVatWorkspace ?? "Open VAT workspace"}{" "}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              {/* Corporate tax */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {(t as any).corporateTaxLabel ?? "Corporate tax"}
                  </div>
                  <FilingStatusBadge status={compliance.corporateTaxStatus?.status} t={t as any} />
                </div>
                <div className="mt-2 font-mono tabular-nums text-[14px] text-foreground">
                  {compliance.corporateTaxStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.corporateTaxStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Link href="/corporate-tax">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 -ms-3 gap-1 text-accent hover:text-accent"
                  >
                    {(t as any).openTaxWorkpaper ?? "Open tax workpaper"}{" "}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Fix-it list — each open item links to the screen that resolves it */}
            {(compliance.auditReadiness?.issues?.length ?? 0) > 0 && (
              <div className="border-t border-border/60">
                <div className="px-5 pt-3 pb-1 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/80">
                  {(t as any).raiseYourScore ?? "Raise your score"}
                </div>
                <div className="divide-y divide-border/40 pb-1.5">
                  {compliance.auditReadiness.issues.map((issue: string) => (
                    <FixItRow key={issue} issue={issue} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        </motion.section>
      )}

      {/* ── AI Insights — refined ────────────────────────────────────────── */}
      {!statsLoading &&
        stats &&
        (stats.revenue > 0 || stats.expenses > 0 || stats.outstanding > 0) && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
          >
            <Card className="overflow-hidden border-card-border">
              <div className="relative p-5 md:p-6">
                <div aria-hidden className="absolute inset-0 bg-spotlight pointer-events-none" />
                <div className="relative flex items-start gap-4">
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/15 to-accent/5 ring-1 ring-accent/25 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-accent" />
                    </div>
                    <span
                      aria-hidden
                      className="absolute -inset-1 rounded-xl bg-accent/10 animate-ping-soft opacity-70"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold tracking-tight text-[15px]">
                        Financial Insights
                      </h3>
                      <Badge variant="info" dot>
                        Real-time
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed text-pretty">
                      {stats.revenue > 0 && stats.expenses > 0 && (
                        <>
                          Your profit margin is{" "}
                          <span className="font-mono font-semibold text-foreground">
                            {margin.toFixed(1)}%
                          </span>
                          .
                          {stats.outstanding > 0 && (
                            <>
                              {" "}
                              You have{" "}
                              <span className="font-mono font-semibold text-warning-subtle-foreground">
                                {formatCurrency(stats.outstanding, "AED", locale)}
                              </span>{" "}
                              in outstanding invoices that need attention.
                            </>
                          )}
                        </>
                      )}
                      {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding > 0 && (
                        <>
                          You have{" "}
                          <span className="font-mono font-semibold text-warning-subtle-foreground">
                            {formatCurrency(stats.outstanding, "AED", locale)}
                          </span>{" "}
                          in outstanding invoices.
                        </>
                      )}
                    </p>
                    <Link href="/ai-cfo">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-3 -ms-3 gap-1.5 text-accent hover:text-accent"
                      >
                        Talk to AI CFO <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          </motion.section>
        )}

      {/* ── Preferred report workspace ──────────────────────────────────── */}
      <section data-testid="dashboard-report-workspace">
        <SectionHeader
          eyebrow="Reports"
          title={preferredReportWorkspace.navLabel}
          action={
            <Link href={reportWorkspaceHref(preferredReportWorkspace)}>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-accent hover:text-accent -me-2"
                data-testid="dashboard-open-report-workspace"
              >
                Open workspace <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          }
        />
        <Card className="border-card-border overflow-hidden">
          <CardContent className="p-0">
            <div
              className="border-b border-border/60 p-5"
              data-testid="dashboard-report-role-switcher"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Reporting mode
                  </div>
                  <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
                    Switch the daily report workspace for owner, solo entrepreneur, freelancer, or
                    accountant workflows.
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-3xl">
                  {dashboardReportWorkspaces.map((workspace) => (
                    <button
                      key={workspace.persona}
                      type="button"
                      onClick={() => selectDashboardReportPersona(workspace.persona)}
                      className={`rounded-md border p-3 text-left transition-colors ${
                        workspace.isSelected
                          ? "border-accent bg-accent/5"
                          : "border-border/70 hover:border-accent hover:bg-accent/5"
                      }`}
                      data-testid={`dashboard-report-mode-${workspace.persona}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">
                            {workspace.navLabel}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {workspace.readyReports}/{workspace.totalReports} reports ready
                          </div>
                        </div>
                        <Badge variant={workspace.isSelected ? "info" : "outline"}>
                          {workspace.readinessPercent}%
                        </Badge>
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {workspace.automations.length} automation lanes
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div
              className="border-b border-border/60 p-5"
              data-testid="dashboard-report-automation-health"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Automation health
                    </div>
                    <Badge variant={reportAutomationHealth.variant} dot>
                      {reportAutomationHealth.label}
                    </Badge>
                    <Badge
                      variant={reportCatalogDiscoveryQuery.isError ? "warning" : "info"}
                      data-testid="dashboard-report-catalog-sync"
                    >
                      {reportCatalogDiscoveryQuery.isLoading
                        ? "Syncing catalog"
                        : reportCatalogDiscoveryQuery.isError
                          ? "Local catalog"
                          : `${preferredReportPackReadiness.syncedLiveReports} synced reports`}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                      {reportAutomationHealth.score}
                    </span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Blends pack readiness, automation lanes, and current-vs-prior movement for the
                    selected workspace.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 md:min-w-[420px]">
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Pack
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {preferredReportPackReadiness.readinessPercent}%
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Lanes
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {preferredReportPackReadiness.syncedAutomationLanes}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Review
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                      {reportAutomationHealth.reviewSignals}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  <Link href={reportSectionHref(preferredReportWorkspace, "automation-operations")}>
                    <Button variant="outline" size="sm">
                      Open operations <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Link
                    href={reportSectionHref(preferredReportWorkspace, "automation-command-center")}
                  >
                    <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                      Open automation center <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Link href={reportSectionHref(preferredReportWorkspace, "automation-starters")}>
                    <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                      Open automation starters <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Link
                    href={reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")}
                  >
                    <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                      Open delivery subscriptions <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Link href={reportSectionHref(preferredReportWorkspace, "automation-rules")}>
                    <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                      Open automation rules <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Link href={reportSectionHref(preferredReportWorkspace, "pack-automation")}>
                    <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                      Review automation health <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>

              <div
                className="mt-4 rounded-md border border-border/70 p-4"
                data-testid="dashboard-next-automation-action"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                        Next automation action
                      </div>
                      <Badge variant={preferredAutomationNextAction.badgeVariant} dot>
                        {preferredAutomationNextAction.badge}
                      </Badge>
                      {preferredAutomationNextAction.command ? (
                        <Badge
                          variant="outline"
                          data-testid={`dashboard-next-automation-command-${preferredAutomationNextAction.command}`}
                        >
                          Pinned command
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-foreground">
                      {preferredAutomationNextAction.title}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {preferredAutomationNextAction.detail}
                    </p>
                    {dashboardDeliveryRunStatusSummary && dashboardLatestDeliveryRun ? (
                      <div
                        className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground"
                        data-testid="dashboard-report-delivery-run-feedback"
                      >
                        <div
                          className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                          data-testid="dashboard-next-automation-run-status"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={dashboardDeliveryRunStatusSummary.statusVariant}
                                dot
                                data-testid={`dashboard-next-automation-run-status-${dashboardDeliveryRunStatusSummary.status}`}
                              >
                                {dashboardDeliveryRunStatusSummary.statusLabel}
                              </Badge>
                              <Badge
                                variant={dashboardDeliveryRunReadinessVariant(
                                  dashboardLatestDeliveryRun.readinessStatus
                                )}
                                data-testid="dashboard-report-delivery-run-readiness"
                              >
                                {dashboardLatestDeliveryRun.readinessStatus}
                              </Badge>
                            </div>
                            <p className="mt-2 min-w-0 break-words">
                              {dashboardDeliveryRunStatusSummary.detail}
                            </p>
                          </div>
                          <Link
                            href={
                              dashboardLatestDeliveryRunSubscription?.href ??
                              reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")
                            }
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-accent hover:text-accent"
                              data-testid="dashboard-report-delivery-run-open"
                            >
                              Open delivery <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-md bg-background/70 p-2">
                            <div className="text-muted-foreground">Scheduled</div>
                            <div
                              className="mt-1 font-medium text-foreground"
                              data-testid="dashboard-report-delivery-run-scheduled"
                            >
                              {formatDashboardDeliveryRunTime(
                                dashboardLatestDeliveryRun.scheduledFor,
                                locale
                              )}
                            </div>
                          </div>
                          <div className="rounded-md bg-background/70 p-2">
                            <div className="text-muted-foreground">Reports</div>
                            <div
                              className="mt-1 font-mono font-semibold text-foreground"
                              data-testid="dashboard-report-delivery-run-report-count"
                            >
                              {dashboardLatestDeliveryRun.readyReportCount}/
                              {dashboardLatestDeliveryRun.reportCount}
                            </div>
                          </div>
                          <div className="rounded-md bg-background/70 p-2">
                            <div className="text-muted-foreground">Channel</div>
                            <div
                              className="mt-1 font-medium text-foreground"
                              data-testid="dashboard-report-delivery-run-channel"
                            >
                              {dashboardLatestDeliveryRun.channel}
                            </div>
                          </div>
                        </div>
                        <p
                          className="mt-3 leading-relaxed"
                          data-testid="dashboard-report-delivery-run-guardrail"
                        >
                          {dashboardLatestDeliveryRun.deliveryGuardrail}
                        </p>
                        {dashboardLatestDeliveryRun.errorMessage ? (
                          <p
                            className="mt-2 text-destructive"
                            data-testid="dashboard-report-delivery-run-error"
                          >
                            {dashboardLatestDeliveryRun.errorMessage}
                          </p>
                        ) : null}
                        {dashboardLatestDeliveryRun.retriedFromRunId ? (
                          <p
                            className="mt-2 text-muted-foreground"
                            data-testid="dashboard-report-delivery-run-retried-from"
                          >
                            Requeued from a failed delivery run.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {preferredAutomationNextAction.actionType === "queue" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={
                        !selectedCompanyId ||
                        queueDashboardReportDeliverySubscription.isPending ||
                        !preferredAutomationNextAction.subscriptionId
                      }
                      onClick={() => {
                        const subscriptionId = preferredAutomationNextAction.subscriptionId;
                        if (!subscriptionId) return;
                        queueDashboardReportDeliverySubscription.mutate(subscriptionId);
                      }}
                      data-testid="dashboard-next-automation-queue"
                    >
                      {queueDashboardReportDeliverySubscription.isPending
                        ? "Queueing"
                        : preferredAutomationNextAction.cta}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  ) : preferredAutomationNextAction.actionType === "retry" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={
                        !selectedCompanyId ||
                        retryDashboardReportDeliveryRun.isPending ||
                        !preferredAutomationNextAction.runId
                      }
                      onClick={() => {
                        const runId = preferredAutomationNextAction.runId;
                        if (!runId) return;
                        retryDashboardReportDeliveryRun.mutate(runId);
                      }}
                      data-testid="dashboard-next-automation-retry"
                    >
                      {retryDashboardReportDeliveryRun.isPending
                        ? "Retrying"
                        : preferredAutomationNextAction.cta}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Link href={preferredAutomationNextAction.href}>
                      <Button variant="outline" size="sm" className="shrink-0">
                        {preferredAutomationNextAction.cta}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>

            <div
              className="border-b border-border/60 p-5"
              data-testid="dashboard-report-trigger-rules"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Trigger rules
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Thresholds that turn {preferredReportWorkspace.navLabel} report movement into
                    automated follow-up.
                  </p>
                </div>
                <Link href={reportSectionHref(preferredReportWorkspace, "trigger-rules")}>
                  <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
                    Open trigger rules <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                {preferredReportTriggerRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-md border border-border/70 p-4"
                    data-testid={`dashboard-report-trigger-rule-${rule.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{rule.title}</div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {rule.threshold}
                        </p>
                      </div>
                      <Badge
                        variant={
                          rule.severity === "critical"
                            ? "danger"
                            : rule.severity === "review"
                              ? "warning"
                              : "info"
                        }
                        dot
                      >
                        {rule.severity === "critical"
                          ? "Critical"
                          : rule.severity === "review"
                            ? "Review"
                            : "Monitor"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Badge variant="outline">{rule.reports.length} reports</Badge>
                      <Badge variant="outline">{rule.cadence}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={rule.primaryReportHref}>
                        <Button variant="outline" size="sm">
                          {rule.actionLabel}
                        </Button>
                      </Link>
                      <Link href={rule.href}>
                        <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                          View rule <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="border-b border-border/60 p-5"
              data-testid="dashboard-report-delivery-subscriptions"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Delivery subscriptions
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Scheduled packs for {preferredReportWorkspace.navLabel} with recipients,
                    channels, and delivery guardrails.
                  </p>
                </div>
                <Link href={reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")}>
                  <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
                    Open subscriptions <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {preferredReportDeliverySubscriptions.map((subscription) => (
                  <div
                    key={subscription.id}
                    className="rounded-md border border-border/70 p-4"
                    data-testid={`dashboard-report-delivery-subscription-${subscription.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {subscription.title}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {subscription.cadence}
                        </p>
                      </div>
                      <Badge variant="outline">{subscription.channel}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">Ready reports</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">
                          {subscription.readyReports}/{subscription.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">Trigger rules</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">
                          {subscription.triggerRules.length}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {subscription.deliveryGuardrail}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={subscription.href}>
                        <Button variant="outline" size="sm">
                          Open subscription
                        </Button>
                      </Link>
                      <Link href={reportSectionHref(preferredReportWorkspace, "pack-automation")}>
                        <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                          Review pack <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="border-b border-border/60 p-5"
              data-testid="dashboard-report-decision-shortcuts"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Business questions
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Start with practical questions for {preferredReportWorkspace.navLabel}, then
                    open the matching report bundle.
                  </p>
                </div>
                <Link href={reportSectionHref(preferredReportWorkspace, "decision-shortcuts")}>
                  <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
                    Open decision shortcuts <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                {preferredReportDecisionShortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="rounded-md border border-border/70 p-4"
                    data-testid={`dashboard-report-decision-shortcut-${shortcut.id}`}
                  >
                    <div className="text-sm font-semibold text-foreground">{shortcut.question}</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {shortcut.answer}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Badge variant="outline">{shortcut.reports.length} reports</Badge>
                      {shortcut.primaryReport ? (
                        <Badge variant="outline">{shortcut.primaryReport.name}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={shortcut.primaryReportHref}>
                        <Button variant="outline" size="sm">
                          Open report
                        </Button>
                      </Link>
                      <Link href={shortcut.href}>
                        <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                          View shortcut <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border/60">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Workspace focus
                    </div>
                    <p className="mt-2 text-[13.5px] text-muted-foreground leading-relaxed">
                      {preferredReportWorkspace.focus}
                    </p>
                    <div className="mt-3 rounded-md border border-border/70 p-3 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Automation outcome:</span>{" "}
                      {preferredReportWorkspace.automationOutcome}
                    </div>
                  </div>
                  <Badge variant="info" dot>
                    {preferredWorkspaceReports.length} ready reports
                  </Badge>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {preferredWorkspaceReports.map((report) => (
                    <Link
                      key={report.id}
                      href={reportHref(report) ?? reportWorkspaceHref(preferredReportWorkspace)}
                    >
                      <div className="rounded-md border border-border/70 p-3 hover:border-accent hover:bg-accent/5 transition-colors cursor-pointer">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-foreground">{report.name}</div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {report.comparison} · {report.automation}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                <div
                  className="mt-5 rounded-md border border-border/70 p-4"
                  data-testid="dashboard-comparison-snapshot"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                        Comparison snapshot
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Current vs prior month for this workspace.
                      </div>
                    </div>
                    <Badge variant="outline">Current vs prior</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {dashboardComparisonRows.map((row) => (
                      <Link key={row.id} href={row.href}>
                        <div className="rounded-md bg-muted/30 p-3 transition-colors hover:bg-accent/5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-medium text-foreground">{row.label}</div>
                            <Badge variant={dashboardComparisonBadgeVariant(row)}>
                              {formatDashboardComparisonPercent(row.percentChange)}
                            </Badge>
                          </div>
                          <div className="mt-2 font-mono text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(row.current, "AED", locale)}
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>Prior {formatCurrency(row.previous, "AED", locale)}</span>
                            <span className="inline-flex items-center gap-1 text-accent">
                              Open <ArrowUpRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-5">
                <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                  Automation lanes
                </div>
                <div className="mt-3 divide-y divide-border/50">
                  {preferredReportWorkspace.automations.map((playbook) => (
                    <div key={playbook.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {playbook.title}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                            {playbook.trigger}
                          </div>
                        </div>
                        <Link
                          href={reportAutomationPlaybookHref(
                            playbook,
                            preferredReportWorkspace.persona
                          )}
                        >
                          <Button variant="outline" size="sm" className="shrink-0">
                            {playbook.cta}
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="border-t border-border/60 p-5"
              data-testid="dashboard-report-pack-readiness"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Report pack readiness
                  </div>
                  <div className="mt-2 text-2xl font-mono font-semibold tabular-nums text-foreground">
                    {preferredReportPackReadiness.readinessPercent}%
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {preferredReportPackReadiness.readyReports} of{" "}
                    {preferredReportPackReadiness.totalReports} workspace reports are ready/API
                    backed. {preferredReportPackReadiness.plannedReports} planned report
                    {preferredReportPackReadiness.plannedReports === 1 ? "" : "s"} need review
                    before fully automated sending.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[420px]">
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Cadence
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-foreground">
                      {preferredReportWorkspace.packSchedule.cadence}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Delivery
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-foreground">
                      {preferredReportWorkspace.packSchedule.delivery}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                      Automations
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-foreground">
                      {preferredReportPackReadiness.automationLanes} lanes ·{" "}
                      {preferredReportWorkspace.packSchedule.automation}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={reportSectionHref(preferredReportWorkspace, "pack-readiness")}>
                  <Button variant="outline" size="sm">
                    Review pack readiness
                  </Button>
                </Link>
                <Link href={reportSectionHref(preferredReportWorkspace, "automation-rules")}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    Open automation rules <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
                <Link href={reportSectionHref(preferredReportWorkspace, "pack-automation")}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    Open pack automation <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            <div
              className="border-t border-border/60 p-5"
              data-testid="dashboard-report-automation-starters"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Automation starters
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Launch setup checklists for the workflows that fit{" "}
                    {preferredReportWorkspace.navLabel}.
                  </p>
                </div>
                <Badge variant="outline">{preferredReportAutomationStarters.length} starters</Badge>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {preferredReportAutomationStarters.map((starter) => (
                  <div
                    key={starter.id}
                    className="rounded-md border border-border/70 p-4"
                    data-testid={`dashboard-report-automation-starter-${starter.id}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-foreground">
                            {starter.title}
                          </div>
                          <Badge variant="info">{starter.setupTime}</Badge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {starter.outcome}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {starter.readyReports}/{starter.reports.length} reports
                          </Badge>
                          <Badge variant="outline">{starter.playbooks.length} playbooks</Badge>
                          <Badge variant="outline">{starter.setupSteps.length} steps</Badge>
                        </div>
                      </div>
                      <Link href={starter.href}>
                        <Button variant="outline" size="sm" className="shrink-0">
                          {starter.primaryAction}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {starter.setupSteps.map((step) => (
                        <div
                          key={step}
                          className="flex gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground"
                        >
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="border-t border-border/60 p-5"
              data-testid="dashboard-report-pack-templates"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    Ready-made report packs
                  </div>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    Start from recurring packs tailored to {preferredReportWorkspace.navLabel}.
                  </p>
                </div>
                <Badge variant="outline">{preferredReportPackTemplates.length} templates</Badge>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {preferredReportPackTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-md border border-border/70 p-4"
                    data-testid={`dashboard-report-pack-template-${template.id}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {template.title}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {template.outcome}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">{template.cadence}</Badge>
                          <Badge variant="outline">
                            {template.readyReports}/{template.reports.length} reports
                          </Badge>
                        </div>
                      </div>
                      <Link href={template.href}>
                        <Button variant="outline" size="sm" className="shrink-0">
                          Open template
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Charts row ───────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Trends"
          title="Revenue vs Expenses"
          action={
            <Badge variant="outline" className="font-mono">
              Last 6 months
            </Badge>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-card-border">
            <CardContent className="p-5">
              {trendsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : monthlyTrends && monthlyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart
                    data={monthlyTrends}
                    margin={{ top: 12, right: 8, bottom: 0, left: -16 }}
                  >
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.warning} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={CHART_COLORS.warning} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="month"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontFamily: "var(--font-mono)" }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      tick={{ fontFamily: "var(--font-mono)" }}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "hsl(var(--border))",
                        strokeWidth: 1,
                        strokeDasharray: "3 3",
                      }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--popover-border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        boxShadow: "var(--shadow-md)",
                      }}
                      formatter={(value: any) => formatCurrency(value, "AED", locale)}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={CHART_COLORS.accent}
                      strokeWidth={2}
                      fill="url(#rev)"
                      name="Revenue"
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke={CHART_COLORS.warning}
                      strokeWidth={2}
                      fill="url(#exp)"
                      name="Expenses"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title="No revenue data yet"
                  body="Issue your first invoice and the trend chart fills in automatically."
                  actionLabel="Create invoice"
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-semibold tracking-tight text-muted-foreground uppercase tracking-[0.12em]">
                {t.expenseBreakdown ?? "Expense Breakdown"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-3">
              {expenseLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : expenseData && expenseData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={expenseData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                      >
                        {expenseData.map((_, i) => (
                          <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--popover-border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontFamily: "var(--font-mono)",
                          boxShadow: "var(--shadow-md)",
                        }}
                        formatter={(value: any) => formatCurrency(value, "AED", locale)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="px-2 pb-3 space-y-1.5">
                    {expenseData.slice(0, 5).map((entry: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
                          />
                          <span className="truncate text-foreground/80">{entry.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-foreground/90">
                          {formatCurrency(entry.value, "AED", locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  icon={Coins}
                  title="No expenses tracked"
                  body="Categorize your first expense to see the breakdown."
                  actionLabel="Create journal entry"
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Shortcuts" title="Quick actions" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickAction
            icon={Plus}
            title="Create Invoice"
            description="Create VAT-ready tax invoices in seconds"
            href="/invoices"
            delay={0.05}
          />
          <QuickAction
            icon={Receipt}
            title="Scan Receipt"
            description="OCR receipts straight into your books"
            href="/receipts"
            delay={0.1}
          />
          <QuickAction
            icon={BookOpen}
            title="Journal Entry"
            description="Record manual double-entry transactions"
            href="/journal"
            delay={0.15}
          />
          <QuickAction
            icon={BarChart3}
            title="View Reports"
            description="P&L, balance sheet, cash flow — exportable"
            href="/reports"
            delay={0.2}
          />
        </div>
      </section>

      <section data-testid="dashboard-report-launch-picker">
        <ReportLaunchPicker
          persona={preferredReportWorkspace.persona}
          companyId={selectedCompanyId}
          preferredDeliveryAutomationCommand={dashboardPinnedDeliveryAutomationCommand}
        />
      </section>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Activity" title="Recent" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                {t.recentInvoices ?? "Recent invoices"}
              </CardTitle>
              <Link href="/invoices">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {invoicesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : recentInvoices && recentInvoices.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {recentInvoices.slice(0, 5).map((invoice: any) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 py-3 group"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-info-subtle text-info-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                            {invoice.customerName}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
                            INV-{invoice.number}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[14px] font-mono font-semibold tabular-nums text-foreground">
                          {formatCurrency(invoice.total, invoice.currency, locale)}
                        </div>
                        <StatusBadge status={invoice.status} className="mt-0.5" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  body="Create your first invoice to get started."
                  actionLabel="Create invoice"
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Recent activity
              </CardTitle>
              <Link href="/journal">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {journalEntries && journalEntries.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {journalEntries.slice(0, 5).map((entry: any) => (
                    <li key={entry.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-success-subtle text-success-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                          {entry.memo || "Journal entry"}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
                          {formatDate(entry.date, locale)}
                        </div>
                      </div>
                      <StatusBadge status="posted" />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={BookOpen}
                  title="No transactions yet"
                  body="Your double-entry ledger is waiting for its first entry."
                  actionLabel="Create journal entry"
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  actionHref,
}: {
  icon: any;
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-muted/60 ring-1 ring-border text-muted-foreground mb-3">
        <Icon className="w-5 h-5" strokeWidth={1.75} />
      </div>
      <div className="text-[14px] font-medium text-foreground tracking-tight">{title}</div>
      <div className="text-[12.5px] text-muted-foreground mt-0.5 max-w-xs leading-relaxed">
        {body}
      </div>
      {actionLabel && actionHref && (
        <Link href={actionHref}>
          <Button variant="outline" size="sm" className="gap-1.5 mt-4">
            <Plus className="w-3.5 h-3.5" />
            {actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
