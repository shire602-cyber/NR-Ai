import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2,
  Plus,
  Search,
  LayoutGrid,
  List,
  ChevronRight,
  Users,
  Calendar,
  BookOpen,
  Upload,
  AlertTriangle,
  Receipt,
  FolderOpen,
  Calculator,
  CheckCircle2,
  Clock,
  FileText,
  TrendingUp,
  UserCheck,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Company } from "@shared/schema";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";

interface ClientStats {
  invoiceCount: number;
  invoiceTotal: number;
  outstandingAr: number;
  lastReceiptDate: string | null;
  lastBankActivityDate: string | null;
  vatStatus: {
    status: string;
    dueDate: string;
    periodEnd: string;
  } | null;
  assignedStaff: { id: string; name: string; email: string; role: string }[];
}

type ClientWithStats = Company & ClientStats;

interface FirmOverview {
  totalClients: number;
  vatDueThisMonth: number;
  overdueAr: number;
  needsAttention: number;
  missingDocuments: number;
}

interface ImportResult {
  message: string;
  created: { id: string; name: string }[];
  errors: { row: number; name: string; error: string }[];
}

type BookkeeperPriority = "on_track" | "attention" | "critical";
type BookkeeperInterventionLevel = "low" | "medium" | "high";

interface BookkeeperClient {
  companyId: string;
  companyName: string;
  trn: string | null;
  assignedStaff: { id: string; name: string; email: string; role: string }[];
  priority: BookkeeperPriority;
  nextBestAction: string;
  intervention?: {
    score: number;
    level: BookkeeperInterventionLevel;
    title: string;
    reasons: string[];
    ownerAction: string;
    deadlineLabel: string;
    exposureAed: number;
  };
  lastActivity: string | null;
  vat: {
    cohortKey: string;
    cohortLabel: string;
    closeMonths: number[];
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    payableTax: number | null;
    blockers: string[];
  };
  corporateTax: {
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    taxPayable: number | null;
    blockers: string[];
  };
  bookkeeping: {
    closeProgress: number;
    status: BookkeeperPriority;
    blockers: string[];
    openAr: number;
    overdueInvoiceCount: number;
    missingCustomerTrnCount: number;
    unpostedReceiptCount: number;
    unreconciledBankCount: number;
    daysSinceActivity: number | null;
  };
  accounting: {
    status: BookkeeperPriority;
    trialBalanceBalanced: boolean;
    discrepancy: number;
    blockers: string[];
  };
}

interface BookkeeperVatCohort {
  key: string;
  label: string;
  closeMonths: number[];
  closeMonthLabels: string[];
  clientCount: number;
  dueSoon: number;
  blocked: number;
  ready: number;
  clients: {
    companyId: string;
    companyName: string;
    priority: BookkeeperPriority;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    blockers: string[];
    nextBestAction: string;
  }[];
}

type BookkeeperQueueKey = "vat" | "corporateTax" | "bookkeeping" | "accounting";

interface BookkeeperQueueItem {
  companyId: string;
  companyName: string;
  priority: BookkeeperPriority;
  ownerNames: string[];
  dueDate: string | null;
  daysTilDue: number | null;
  metric: string;
  action: string;
  blockers: string[];
}

interface BookkeeperWorkloadOwner {
  staffId: string | null;
  name: string;
  email: string | null;
  clientCount: number;
  critical: number;
  attention: number;
  vatDue28Days: number;
  corporateTaxDue90Days: number;
  bookkeepingBlocked: number;
  averageCloseProgress: number;
}

interface BookkeeperDashboard {
  generatedAt: string;
  summary: {
    totalClients: number;
    critical: number;
    attention: number;
    onTrack: number;
    vatDue28Days: number;
    corporateTaxDue90Days: number;
    bookkeepingBlocked: number;
    interventionHigh?: number;
    interventionMedium?: number;
  };
  vatCohorts: BookkeeperVatCohort[];
  queues?: Record<BookkeeperQueueKey, BookkeeperQueueItem[]>;
  workload?: {
    owners: BookkeeperWorkloadOwner[];
    unassignedClients: number;
    overloadedStaff: number;
  };
  clients: BookkeeperClient[];
}

function formatAed(amount: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateShort(date: string | null | undefined) {
  if (!date) return "—";
  return format(new Date(date), "MMM d");
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "No period";
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function formatDays(days: number | null | undefined) {
  if (days === null || days === undefined) return "No date";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

function priorityClass(priority: BookkeeperPriority | "filed") {
  if (priority === "filed" || priority === "on_track")
    return "bg-green-100 text-green-800 border-green-200";
  if (priority === "critical") return "bg-red-100 text-red-800 border-red-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function priorityLabel(priority: BookkeeperPriority | "filed") {
  if (priority === "on_track") return "On track";
  if (priority === "attention") return "Attention";
  if (priority === "critical") return "Critical";
  return "Filed";
}

function priorityScore(priority: BookkeeperPriority | "filed") {
  if (priority === "critical") return 3;
  if (priority === "attention") return 2;
  return 1;
}

function PriorityBadge({ priority }: { priority: BookkeeperPriority | "filed" }) {
  return <Badge className={priorityClass(priority)}>{priorityLabel(priority)}</Badge>;
}

function interventionClass(level: BookkeeperInterventionLevel) {
  if (level === "high") return "bg-red-100 text-red-800 border-red-200";
  if (level === "medium") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-green-100 text-green-800 border-green-200";
}

function fallbackIntervention(
  client: BookkeeperClient
): NonNullable<BookkeeperClient["intervention"]> {
  const vatOpen = client.vat.status !== "filed";
  const corporateTaxOpen = client.corporateTax.status !== "filed";
  const score = Math.min(
    100,
    priorityScore(client.priority) * 18 +
      (client.assignedStaff.length === 0 ? 12 : 0) +
      (client.bookkeeping.status !== "on_track" ? 12 : 0) +
      (vatOpen && client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28 ? 10 : 0) +
      (corporateTaxOpen &&
      client.corporateTax.daysTilDue !== null &&
      client.corporateTax.daysTilDue <= 90
        ? 6
        : 0)
  );
  const level: BookkeeperInterventionLevel = score >= 65 ? "high" : score >= 35 ? "medium" : "low";
  const reasons = [
    client.assignedStaff.length === 0 ? "No owner assigned" : "",
    ...(vatOpen ? client.vat.blockers : []),
    ...(corporateTaxOpen ? client.corporateTax.blockers : []),
    ...client.bookkeeping.blockers,
    ...client.accounting.blockers,
  ].filter(Boolean);
  return {
    score,
    level,
    title: client.nextBestAction,
    reasons: (reasons.length > 0 ? reasons : ["No active intervention signals"]).slice(0, 5),
    ownerAction: client.nextBestAction,
    deadlineLabel: primaryDeadline(client).label,
    exposureAed: Math.round(Math.max(0, client.bookkeeping.openAr)),
  };
}

function clientIntervention(client: BookkeeperClient) {
  return client.intervention ?? fallbackIntervention(client);
}

function blockerPreview(blockers: string[]) {
  if (blockers.length === 0) return "No blockers";
  if (blockers.length === 1) return blockers[0];
  return `${blockers[0]} +${blockers.length - 1}`;
}

const queueConfig: Record<BookkeeperQueueKey, { label: string; icon: typeof Calendar }> = {
  vat: { label: "VAT", icon: Calendar },
  corporateTax: { label: "Corporate Tax", icon: Calculator },
  bookkeeping: { label: "Bookkeeping", icon: TrendingUp },
  accounting: { label: "Accounting", icon: CheckCircle2 },
};

function ownerPreview(names: string[]) {
  if (names.length === 0) return "Unassigned";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function primaryDeadline(client: BookkeeperClient) {
  const candidates = [
    client.vat.status !== "filed"
      ? {
          label: "VAT",
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric:
            client.vat.payableTax !== null
              ? formatAed(client.vat.payableTax)
              : client.vat.cohortLabel,
        }
      : null,
    client.corporateTax.status !== "filed"
      ? {
          label: "CT",
          dueDate: client.corporateTax.dueDate,
          daysTilDue: client.corporateTax.daysTilDue,
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : "Readiness",
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    dueDate: string | null;
    daysTilDue: number | null;
    metric: string;
  }>;

  candidates.sort((a, b) => (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999));
  return (
    candidates[0] ?? {
      label: "Close",
      dueDate: client.vat.dueDate,
      daysTilDue: client.vat.daysTilDue,
      metric: `${client.bookkeeping.closeProgress}% close-ready`,
    }
  );
}

function productionItem(client: BookkeeperClient, labelOverride?: string) {
  const deadline = primaryDeadline(client);
  return {
    client,
    label: labelOverride ?? deadline.label,
    dueDate: deadline.dueDate,
    daysTilDue: deadline.daysTilDue,
    metric:
      labelOverride === "Close"
        ? `${client.bookkeeping.closeProgress}% close-ready`
        : deadline.metric,
  };
}

function sortProductionItems(items: ReturnType<typeof productionItem>[]) {
  return items.sort((a, b) => {
    const priorityDelta =
      (b.client.priority === "critical" ? 3 : b.client.priority === "attention" ? 2 : 1) -
      (a.client.priority === "critical" ? 3 : a.client.priority === "attention" ? 2 : 1);
    if (priorityDelta !== 0) return priorityDelta;
    return (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999);
  });
}

function OperationsBriefDialog({
  client,
  open,
  onOpenChange,
  onOpenBooks,
  onViewProfile,
}: {
  client: BookkeeperClient | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBooks: (companyId: string) => void;
  onViewProfile: (companyId: string) => void;
}) {
  const lanes = client
    ? [
        {
          key: "vat",
          title: "VAT",
          icon: Calendar,
          status: client.vat.status,
          due: `${formatDateShort(client.vat.dueDate)} · ${formatDays(client.vat.daysTilDue)}`,
          period: formatPeriod(client.vat.periodStart, client.vat.periodEnd),
          metric:
            client.vat.payableTax !== null
              ? formatAed(client.vat.payableTax)
              : client.vat.cohortLabel,
          blockers: client.vat.blockers,
        },
        {
          key: "corporate-tax",
          title: "Corporate Tax",
          icon: Calculator,
          status: client.corporateTax.status,
          due: `${formatDateShort(client.corporateTax.dueDate)} · ${formatDays(client.corporateTax.daysTilDue)}`,
          period: formatPeriod(client.corporateTax.periodStart, client.corporateTax.periodEnd),
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : "Readiness",
          blockers: client.corporateTax.blockers,
        },
        {
          key: "bookkeeping",
          title: "Bookkeeping",
          icon: TrendingUp,
          status: client.bookkeeping.status,
          due: `${client.bookkeeping.closeProgress}% close-ready`,
          period:
            client.bookkeeping.daysSinceActivity === null
              ? "No activity date"
              : `${client.bookkeeping.daysSinceActivity}d since activity`,
          metric: `${client.bookkeeping.unpostedReceiptCount} receipts · ${client.bookkeeping.unreconciledBankCount} bank lines`,
          blockers: client.bookkeeping.blockers,
        },
        {
          key: "accounting",
          title: "Accounting",
          icon: CheckCircle2,
          status: client.accounting.status,
          due: client.accounting.trialBalanceBalanced ? "Balanced" : "Needs review",
          period:
            client.accounting.discrepancy > 0
              ? formatAed(client.accounting.discrepancy)
              : "No variance",
          metric: client.accounting.trialBalanceBalanced
            ? "Trial balance clean"
            : "Trial balance variance",
          blockers: client.accounting.blockers,
        },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{client?.companyName ?? "Client Operations Brief"}</DialogTitle>
          <DialogDescription>
            {client
              ? `${ownerPreview(client.assignedStaff.map((staff) => staff.name))} · ${client.nextBestAction}`
              : "Operational status"}
          </DialogDescription>
        </DialogHeader>

        {client && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Priority</p>
                <div className="mt-1">
                  <PriorityBadge priority={client.priority} />
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="text-sm font-medium mt-1 truncate">
                  {ownerPreview(client.assignedStaff.map((staff) => staff.name))}
                </p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Last activity</p>
                <p className="text-sm font-medium mt-1">{formatDateShort(client.lastActivity)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Open AR</p>
                <p className="text-sm font-medium mt-1">{formatAed(client.bookkeeping.openAr)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lanes.map((lane) => {
                const Icon = lane.icon;
                return (
                  <div key={lane.key} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Icon className="w-4 h-4 text-primary" />
                          {lane.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{lane.period}</p>
                      </div>
                      <PriorityBadge priority={lane.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Timing</p>
                        <p className="font-medium">{lane.due}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Metric</p>
                        <p className="font-medium truncate">{lane.metric}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {lane.blockers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No blockers.</p>
                      ) : (
                        lane.blockers.slice(0, 4).map((blocker) => (
                          <div key={blocker} className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
                            <span>{blocker}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => client && onViewProfile(client.companyId)}
            disabled={!client}
          >
            <ChevronRight className="w-4 h-4 mr-2" />
            Profile
          </Button>
          <Button onClick={() => client && onOpenBooks(client.companyId)} disabled={!client}>
            <BookOpen className="w-4 h-4 mr-2" />
            Open Books
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookkeeperCommandCenter({
  dashboard,
  onOpenBooks,
  onViewProfile,
  onOpenBrief,
  onManageStaff,
}: {
  dashboard?: BookkeeperDashboard;
  onOpenBooks: (companyId: string) => void;
  onViewProfile: (companyId: string) => void;
  onOpenBrief: (companyId: string) => void;
  onManageStaff: () => void;
}) {
  const [activeQueue, setActiveQueue] = useState<BookkeeperQueueKey>("vat");
  const priorityClients = dashboard?.clients.slice(0, 5) ?? [];
  const activeQueueItems = dashboard?.queues?.[activeQueue] ?? [];
  const workloadOwners = useMemo(
    () => dashboard?.workload?.owners ?? [],
    [dashboard?.workload?.owners]
  );
  const productionBuckets = useMemo(() => {
    const clients = dashboard?.clients ?? [];
    const deadlineItems = sortProductionItems(clients.map((client) => productionItem(client)));
    return [
      {
        key: "overdue",
        title: "Overdue / Due Now",
        icon: AlertTriangle,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue <= 0)
          .slice(0, 5),
      },
      {
        key: "week",
        title: "This Week",
        icon: Clock,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue > 0 && item.daysTilDue <= 7)
          .slice(0, 5),
      },
      {
        key: "month",
        title: "Next 28 Days",
        icon: Calendar,
        items: deadlineItems
          .filter(
            (item) => item.daysTilDue !== null && item.daysTilDue > 7 && item.daysTilDue <= 28
          )
          .slice(0, 5),
      },
      {
        key: "blocked",
        title: "Close Blockers",
        icon: TrendingUp,
        items: sortProductionItems(
          clients
            .filter((client) => client.bookkeeping.status !== "on_track")
            .map((client) => productionItem(client, "Close"))
        ).slice(0, 5),
      },
      {
        key: "unassigned",
        title: "Unassigned",
        icon: UserCheck,
        items: deadlineItems.filter((item) => item.client.assignedStaff.length === 0).slice(0, 5),
      },
    ];
  }, [dashboard?.clients]);
  const capacityPlanner = useMemo(() => {
    const clients = dashboard?.clients ?? [];
    const unassigned = clients
      .filter((client) => client.assignedStaff.length === 0)
      .sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority))
      .slice(0, 5);
    const overloaded = workloadOwners
      .filter(
        (owner) =>
          owner.staffId !== null &&
          (owner.critical >= 3 || owner.clientCount >= 15 || owner.averageCloseProgress < 60)
      )
      .slice(0, 5);
    const openCapacity = workloadOwners
      .filter(
        (owner) =>
          owner.staffId !== null &&
          owner.clientCount < 10 &&
          owner.critical === 0 &&
          owner.averageCloseProgress >= 70
      )
      .sort(
        (a, b) => a.clientCount - b.clientCount || b.averageCloseProgress - a.averageCloseProgress
      )
      .slice(0, 5);
    return { unassigned, overloaded, openCapacity };
  }, [dashboard?.clients, workloadOwners]);
  const interventionRadar = useMemo(() => {
    const rankedClients = [...(dashboard?.clients ?? [])].sort((a, b) => {
      const interventionDelta = clientIntervention(b).score - clientIntervention(a).score;
      if (interventionDelta !== 0) return interventionDelta;
      return priorityScore(b.priority) - priorityScore(a.priority);
    });
    return {
      high: rankedClients
        .filter((client) => clientIntervention(client).level === "high")
        .slice(0, 4),
      watchlist: rankedClients
        .filter((client) => clientIntervention(client).level === "medium")
        .slice(0, 4),
      exposure: rankedClients
        .filter((client) => clientIntervention(client).exposureAed > 0)
        .sort((a, b) => clientIntervention(b).exposureAed - clientIntervention(a).exposureAed)
        .slice(0, 4),
    };
  }, [dashboard?.clients]);
  const serviceLaneForecast = useMemo(() => {
    const clients = dashboard?.clients ?? [];
    const makeRow = (
      label: string,
      rowClients: BookkeeperClient[],
      metric: string,
      action: string,
      risk: BookkeeperPriority | "filed" = "on_track"
    ) => ({
      label,
      count: rowClients.length,
      metric,
      action,
      risk,
      primaryCompanyId: rowClients[0]?.companyId,
      sample: rowClients
        .slice(0, 2)
        .map((client) => client.companyName)
        .join(", "),
    });
    const sortedByIntervention = (rowClients: BookkeeperClient[]) =>
      [...rowClients].sort((a, b) => clientIntervention(b).score - clientIntervention(a).score);
    const ctOpen = clients.filter((client) => client.corporateTax.status !== "filed");
    const bookkeepingBlocked = sortedByIntervention(
      clients.filter((client) => client.bookkeeping.status === "critical")
    );
    const bookkeepingAttention = sortedByIntervention(
      clients.filter((client) => client.bookkeeping.status === "attention")
    );
    const bookkeepingReady = clients
      .filter(
        (client) =>
          client.bookkeeping.status === "on_track" && client.bookkeeping.closeProgress >= 90
      )
      .sort((a, b) => b.bookkeeping.closeProgress - a.bookkeeping.closeProgress);
    const accountingVariance = sortedByIntervention(
      clients.filter((client) => client.accounting.status === "critical")
    );
    const accountingReview = sortedByIntervention(
      clients.filter((client) => client.accounting.status === "attention")
    );
    const accountingClean = clients.filter((client) => client.accounting.status === "on_track");

    return [
      {
        key: "vat",
        title: "VAT Cohorts",
        icon: Calendar,
        rows: (dashboard?.vatCohorts ?? []).slice(0, 3).map((cohort) => ({
          label: cohort.label,
          count: cohort.clientCount,
          metric: `${cohort.dueSoon} due · ${cohort.blocked} blocked`,
          action:
            cohort.blocked > 0
              ? "Clear blockers"
              : cohort.dueSoon > 0
                ? "Prepare returns"
                : "Monitor cohort",
          risk:
            cohort.blocked > 0
              ? ("critical" as const)
              : cohort.dueSoon > 0
                ? ("attention" as const)
                : ("on_track" as const),
          primaryCompanyId: cohort.clients[0]?.companyId,
          sample: cohort.clients
            .slice(0, 2)
            .map((client) => client.companyName)
            .join(", "),
        })),
      },
      {
        key: "ct",
        title: "Corporate Tax",
        icon: Calculator,
        rows: [
          makeRow(
            "Due in 30d",
            sortedByIntervention(
              ctOpen.filter((client) => (client.corporateTax.daysTilDue ?? 9999) <= 30)
            ),
            "urgent filings",
            "Lock filing plan",
            "critical"
          ),
          makeRow(
            "Due in 90d",
            sortedByIntervention(
              ctOpen.filter((client) => {
                const days = client.corporateTax.daysTilDue ?? 9999;
                return days > 30 && days <= 90;
              })
            ),
            "preparation window",
            "Start readiness review",
            "attention"
          ),
          makeRow(
            "Future / parked",
            sortedByIntervention(
              ctOpen.filter((client) => (client.corporateTax.daysTilDue ?? 9999) > 90)
            ),
            "future filings",
            "Monitor readiness"
          ),
        ],
      },
      {
        key: "bookkeeping",
        title: "Bookkeeping Close",
        icon: TrendingUp,
        rows: [
          makeRow(
            "Blocked",
            bookkeepingBlocked,
            "source docs / bank gaps",
            "Clear blockers",
            "critical"
          ),
          makeRow(
            "In progress",
            bookkeepingAttention,
            "needs staff push",
            "Finish close work",
            "attention"
          ),
          makeRow("Review-ready", bookkeepingReady, "90%+ close-ready", "Manager review"),
        ],
      },
      {
        key: "accounting",
        title: "Accounting Review",
        icon: CheckCircle2,
        rows: [
          makeRow(
            "TB variance",
            accountingVariance,
            "requires correction",
            "Review journals",
            "critical"
          ),
          makeRow(
            "Needs journals",
            accountingReview,
            "posting required",
            "Post activity",
            "attention"
          ),
          makeRow("Clean files", accountingClean, "balanced ledgers", "Keep cadence"),
        ],
      },
    ];
  }, [dashboard?.clients, dashboard?.vatCohorts]);
  const ctClients =
    dashboard?.clients
      .filter((client) => client.corporateTax.status !== "filed")
      .sort((a, b) => (a.corporateTax.daysTilDue ?? 9999) - (b.corporateTax.daysTilDue ?? 9999))
      .slice(0, 4) ?? [];
  const closeClients =
    dashboard?.clients.filter((client) => client.bookkeeping.status !== "on_track").slice(0, 4) ??
    [];
  const accountingClients =
    dashboard?.clients.filter((client) => client.accounting.status !== "on_track").slice(0, 4) ??
    [];

  return (
    <section className="space-y-4" data-testid="bookkeeper-command-center">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">NR Bookkeeper Command Center</h2>
          <p className="text-sm text-muted-foreground">
            VAT cohorts, corporate tax deadlines, monthly close blockers, and accounting review
            across the client portfolio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
            <Clock className="w-3.5 h-3.5" />
            {dashboard?.generatedAt
              ? `Updated ${format(new Date(dashboard.generatedAt), "MMM d, HH:mm")}`
              : "Loading"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Critical</p>
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.critical ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">VAT due 28d</p>
              <Calendar className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.vatDue28Days ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">CT due 90d</p>
              <Calculator className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-2xl font-bold mt-1">
              {dashboard?.summary.corporateTaxDue90Days ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Close blocked</p>
              <FileText className="w-4 h-4 text-orange-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.bookkeepingBlocked ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Production Planner
            </CardTitle>
            <Badge variant="outline">
              {productionBuckets.reduce((total, bucket) => total + bucket.items.length, 0)} visible
              items
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {productionBuckets.map((bucket) => {
              const Icon = bucket.icon;
              return (
                <div key={bucket.key} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Icon className="w-4 h-4 text-primary" />
                      {bucket.title}
                    </p>
                    <Badge variant="outline">{bucket.items.length}</Badge>
                  </div>
                  <div className="mt-3 space-y-2 min-h-[132px]">
                    {bucket.items.length === 0 && (
                      <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                        Clear
                      </div>
                    )}
                    {bucket.items.map((item) => (
                      <button
                        key={`${bucket.key}-${item.client.companyId}`}
                        type="button"
                        onClick={() => onOpenBrief(item.client.companyId)}
                        className="w-full rounded-md border bg-background px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.client.companyName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.label} · {formatDays(item.daysTilDue)}
                            </p>
                          </div>
                          <PriorityBadge priority={item.client.priority} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{item.metric}</p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                Staff Capacity Planner
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Balance owners before VAT, CT, and close work becomes a bottleneck.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onManageStaff}>
              <Users className="w-4 h-4 mr-2" />
              Manage Staff
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Unassigned Intake</p>
                <Badge variant={capacityPlanner.unassigned.length > 0 ? "destructive" : "outline"}>
                  {capacityPlanner.unassigned.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.unassigned.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    No unassigned clients
                  </div>
                )}
                {capacityPlanner.unassigned.map((client) => (
                  <div
                    key={`unassigned-${client.companyId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {client.nextBestAction}
                        </p>
                      </div>
                      <PriorityBadge priority={client.priority} />
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBrief(client.companyId)}
                      >
                        Brief
                      </Button>
                      <Button size="sm" variant="outline" onClick={onManageStaff}>
                        Assign
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Overloaded Owners</p>
                <Badge variant={capacityPlanner.overloaded.length > 0 ? "secondary" : "outline"}>
                  {capacityPlanner.overloaded.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.overloaded.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    No capacity pressure
                  </div>
                )}
                {capacityPlanner.overloaded.map((owner) => (
                  <div
                    key={`overloaded-${owner.staffId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{owner.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                        </p>
                      </div>
                      <Badge variant={owner.critical > 0 ? "destructive" : "secondary"}>
                        {owner.critical} critical
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                      <span>{owner.vatDue28Days} VAT</span>
                      <span>{owner.corporateTaxDue90Days} CT</span>
                      <span>{owner.bookkeepingBlocked} close blocked</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Available Capacity</p>
                <Badge variant="outline">{capacityPlanner.openCapacity.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.openCapacity.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    No low-load owner found
                  </div>
                )}
                {capacityPlanner.openCapacity.map((owner) => (
                  <div
                    key={`capacity-${owner.staffId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{owner.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                        </p>
                      </div>
                      <Badge variant="outline">Can take work</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {owner.vatDue28Days} VAT due · {owner.bookkeepingBlocked} close blocked
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Intervention Radar
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Prioritize files by deadline pressure, source-document gaps, owner gaps, and
                collection exposure.
              </p>
            </div>
            <div className="flex gap-2">
              <Badge
                variant={
                  (dashboard?.summary.interventionHigh ?? interventionRadar.high.length) > 0
                    ? "destructive"
                    : "outline"
                }
              >
                {dashboard?.summary.interventionHigh ?? interventionRadar.high.length} high
              </Badge>
              <Badge variant="secondary">
                {dashboard?.summary.interventionMedium ?? interventionRadar.watchlist.length}{" "}
                watchlist
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Escalate Today</p>
                <Badge variant={interventionRadar.high.length > 0 ? "destructive" : "outline"}>
                  {interventionRadar.high.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.high.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    No high-risk interventions
                  </div>
                )}
                {interventionRadar.high.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <div
                      key={`intervention-high-${client.companyId}`}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {intervention.title}
                          </p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>
                          {intervention.score}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {intervention.deadlineLabel}
                      </p>
                      <p className="text-xs font-medium mt-1">{intervention.ownerAction}</p>
                      <div className="flex gap-1 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenBrief(client.companyId)}
                        >
                          Brief
                        </Button>
                        <Button size="sm" onClick={() => onOpenBooks(client.companyId)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Watchlist</p>
                <Badge variant="secondary">{interventionRadar.watchlist.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.watchlist.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    No medium-risk watchlist
                  </div>
                )}
                {interventionRadar.watchlist.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <button
                      key={`intervention-watch-${client.companyId}`}
                      type="button"
                      onClick={() => onOpenBrief(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {intervention.ownerAction}
                          </p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>
                          {intervention.score}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {intervention.reasons.slice(0, 2).join(" · ")}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Collection Exposure</p>
                <Badge variant="outline">{interventionRadar.exposure.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.exposure.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    No open exposure in radar
                  </div>
                )}
                {interventionRadar.exposure.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <div
                      key={`intervention-exposure-${client.companyId}`}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground">
                            {client.bookkeeping.overdueInvoiceCount} overdue invoices
                          </p>
                        </div>
                        <Badge variant="outline">{formatAed(intervention.exposureAed)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {intervention.ownerAction}
                      </p>
                      <div className="flex gap-1 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenBrief(client.companyId)}
                        >
                          Brief
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewProfile(client.companyId)}
                        >
                          Profile
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                Service Lane Forecast
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                One portfolio view for VAT cohorts, corporate tax, bookkeeping close, and accounting
                review cadence.
              </p>
            </div>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {serviceLaneForecast.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.key} className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    {lane.title}
                  </p>
                  <div className="mt-3 space-y-2">
                    {lane.rows.map((row) => (
                      <button
                        key={`${lane.key}-${row.label}`}
                        type="button"
                        onClick={() => row.primaryCompanyId && onOpenBrief(row.primaryCompanyId)}
                        disabled={!row.primaryCompanyId}
                        className="w-full rounded-md border bg-background px-3 py-2 text-left transition-colors enabled:hover:bg-muted/50 disabled:cursor-default"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{row.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{row.metric}</p>
                          </div>
                          <Badge className={priorityClass(row.risk)}>{row.count}</Badge>
                        </div>
                        <p className="text-xs font-medium mt-2 truncate">{row.action}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          {row.sample || "No active clients"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Action Queues
              </CardTitle>
              <Badge variant="outline">{activeQueueItems.length} active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(queueConfig) as BookkeeperQueueKey[]).map((key) => {
                const Icon = queueConfig[key].icon;
                const count = dashboard?.queues?.[key]?.length ?? 0;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={activeQueue === key ? "secondary" : "outline"}
                    onClick={() => setActiveQueue(key)}
                    className="gap-1.5"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {queueConfig[key].label}
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </Button>
                );
              })}
            </div>

            <div className="space-y-2">
              {activeQueueItems.length === 0 && (
                <div className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center">
                  <p className="text-sm font-medium">No active queue items</p>
                  <p className="text-xs text-muted-foreground mt-1">This lane is clear for now.</p>
                </div>
              )}
              {activeQueueItems.slice(0, 6).map((item) => (
                <div
                  key={`${activeQueue}-${item.companyId}`}
                  className="rounded-md border px-3 py-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm truncate">{item.companyName}</p>
                        <PriorityBadge priority={item.priority} />
                        <span className="text-xs text-muted-foreground">{item.metric}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{item.action}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5" />
                          {ownerPreview(item.ownerNames)}
                        </span>
                        <span>
                          {formatDateShort(item.dueDate)} · {formatDays(item.daysTilDue)}
                        </span>
                        {item.blockers.length > 1 && <span>{item.blockers.length} blockers</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 sm:shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBrief(item.companyId)}
                      >
                        Brief
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewProfile(item.companyId)}
                      >
                        <ChevronRight className="w-3.5 h-3.5 mr-1" />
                        Profile
                      </Button>
                      <Button size="sm" onClick={() => onOpenBooks(item.companyId)}>
                        <BookOpen className="w-3.5 h-3.5 mr-1" />
                        Open
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Workload Ownership
              </CardTitle>
              {(dashboard?.workload?.unassignedClients ?? 0) > 0 && (
                <Badge variant="destructive">
                  {dashboard?.workload?.unassignedClients} unassigned
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {workloadOwners.length === 0 && (
              <p className="text-sm text-muted-foreground">No staff workload yet.</p>
            )}
            {workloadOwners.slice(0, 6).map((owner) => (
              <div key={owner.staffId ?? "unassigned"} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{owner.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                    </p>
                  </div>
                  <Badge
                    variant={
                      owner.critical > 0
                        ? "destructive"
                        : owner.attention > 0
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {owner.critical > 0
                      ? `${owner.critical} critical`
                      : `${owner.attention} attention`}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${owner.averageCloseProgress}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                  <span>{owner.vatDue28Days} VAT due</span>
                  <span>{owner.corporateTaxDue90Days} CT due</span>
                  <span>{owner.bookkeepingBlocked} close blocked</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">VAT Production Board</CardTitle>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            {(dashboard?.vatCohorts ?? []).slice(0, 3).map((cohort) => (
              <div key={cohort.key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{cohort.label}</p>
                    <p className="text-xs text-muted-foreground">{cohort.clientCount} clients</p>
                  </div>
                  <div className="flex gap-1">
                    {cohort.dueSoon > 0 && (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                        {cohort.dueSoon} due
                      </Badge>
                    )}
                    {cohort.blocked > 0 && (
                      <Badge variant="destructive">{cohort.blocked} blocked</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2 min-h-[132px]">
                  {cohort.clients.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-sm text-muted-foreground text-center">
                      No clients in this cohort
                    </div>
                  )}
                  {cohort.clients.slice(0, 4).map((client) => (
                    <button
                      key={client.companyId}
                      type="button"
                      onClick={() => onOpenBooks(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateShort(client.dueDate)} · {formatDays(client.daysTilDue)}
                          </p>
                        </div>
                        <PriorityBadge priority={client.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {blockerPreview(client.blockers)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Priority Queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorityClients.length === 0 && (
              <p className="text-sm text-muted-foreground">No clients yet.</p>
            )}
            {priorityClients.map((client) => (
              <button
                key={client.companyId}
                type="button"
                onClick={() => onOpenBooks(client.companyId)}
                className="w-full rounded-md border px-3 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <PriorityBadge priority={client.priority} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {client.nextBestAction}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-600" />
              Corporate Tax
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ctClients.length === 0 && (
              <p className="text-sm text-muted-foreground">No CT deadlines requiring action.</p>
            )}
            {ctClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs text-muted-foreground">
                    {formatDays(client.corporateTax.daysTilDue)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.corporateTax.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-600" />
              Bookkeeping Close
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {closeClients.length === 0 && (
              <p className="text-sm text-muted-foreground">Monthly close is on track.</p>
            )}
            {closeClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs font-medium">{client.bookkeeping.closeProgress}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${client.bookkeeping.closeProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.bookkeeping.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Accounting Review
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountingClients.length === 0 && (
              <p className="text-sm text-muted-foreground">Trial balances are clean.</p>
            )}
            {accountingClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <PriorityBadge priority={client.accounting.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.accounting.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function VatStatusBadge({ vatStatus }: { vatStatus: ClientWithStats["vatStatus"] }) {
  if (!vatStatus) return <Badge variant="outline">No VAT</Badge>;
  const due = new Date(vatStatus.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (vatStatus.status === "filed" || vatStatus.status === "submitted") {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Filed</Badge>;
  }
  if (daysUntilDue < 0) {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  if (daysUntilDue <= 14) {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        Due {format(due, "MMM d")}
      </Badge>
    );
  }
  return <Badge variant="outline">Due {format(due, "MMM d")}</Badge>;
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  );
}

function clientNeedsAttention(c: ClientWithStats): boolean {
  // Mirror /api/firm/overview: a client needs attention if AR is outstanding
  // OR the latest VAT return is past its due date and not yet filed/submitted.
  // The list endpoint doesn't expose per-invoice due dates, so outstandingAr>0
  // is used as the AR proxy (slightly broader than server's overdue-only count).
  if (c.outstandingAr > 0) return true;
  if (c.vatStatus && c.vatStatus.status !== "filed" && c.vatStatus.status !== "submitted") {
    const due = new Date(c.vatStatus.dueDate);
    if (due < new Date()) return true;
  }
  return false;
}

function vatDueSoon(c: ClientWithStats): boolean {
  if (!c.vatStatus) return false;
  if (c.vatStatus.status === "filed" || c.vatStatus.status === "submitted") return false;
  const due = new Date(c.vatStatus.dueDate);
  const now = new Date();
  const days = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
}

interface AddClientFormData {
  name: string;
  trnVatNumber: string;
  industry: string;
  legalStructure: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  emirate: string;
  vatFilingFrequency: string;
  vatPeriodStartMonth: string;
  fiscalYearStartMonth: string;
  corporateTaxId: string;
}

const emptyForm: AddClientFormData = {
  name: "",
  trnVatNumber: "",
  industry: "",
  legalStructure: "",
  contactEmail: "",
  contactPhone: "",
  businessAddress: "",
  emirate: "dubai",
  vatFilingFrequency: "quarterly",
  vatPeriodStartMonth: "1",
  fiscalYearStartMonth: "1",
  corporateTaxId: "",
};

type QuickFilter =
  | "all"
  | "critical"
  | "attention"
  | "vat-due"
  | "close-blocked"
  | "unassigned"
  | "no-docs";

export default function ClientPortfolio() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setActiveClientCompany } = useActiveCompany();
  const [view, setView] = useState<"card" | "table">("card");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [briefClientId, setBriefClientId] = useState<string | null>(null);
  const [form, setForm] = useState<AddClientFormData>(emptyForm);

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });

  const { data: overview } = useQuery<FirmOverview>({
    queryKey: ["/api/firm/overview"],
  });

  const { data: bookkeeperDashboard } = useQuery<BookkeeperDashboard>({
    queryKey: ["/api/firm/bookkeeper-dashboard"],
  });

  const bookkeeperByClientId = useMemo(() => {
    return new Map(
      (bookkeeperDashboard?.clients ?? []).map((client) => [client.companyId, client])
    );
  }, [bookkeeperDashboard]);

  const briefClient = useMemo(() => {
    return briefClientId ? bookkeeperByClientId.get(briefClientId) : undefined;
  }, [bookkeeperByClientId, briefClientId]);

  const createMutation = useMutation({
    mutationFn: (data: AddClientFormData) => apiRequest("POST", "/api/firm/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Client created successfully" });
      setAddOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Failed to create client", description: e?.message });
    },
  });

  const switchMutation = useMutation({
    mutationFn: (companyId: string) => apiRequest("POST", `/api/firm/clients/${companyId}/switch`),
    onSuccess: (_, companyId) => {
      setActiveClientCompany(companyId);
      // Force a refetch of /api/companies so the active company is in cache.
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/dashboard");
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: "Could not open client books",
        description: e?.message,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Build base64 in chunks to avoid call-stack overflow on bigger files.
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const fileData = btoa(binary);
      return apiRequest("POST", "/api/firm/clients/import", { fileData }) as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: `Imported ${result.created.length} clients`,
        description:
          result.errors.length > 0 ? `${result.errors.length} errors — see details.` : undefined,
      });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Import failed", description: e?.message });
    },
  });

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const ops = bookkeeperByClientId.get(c.id);
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.trnVatNumber || "").toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      switch (quickFilter) {
        case "critical":
          return ops?.priority === "critical";
        case "attention":
          return ops
            ? ops.priority === "attention" || ops.priority === "critical"
            : clientNeedsAttention(c);
        case "vat-due":
          return ops
            ? ops.vat.status !== "filed" && ops.vat.daysTilDue !== null && ops.vat.daysTilDue <= 28
            : vatDueSoon(c);
        case "close-blocked":
          return ops ? ops.bookkeeping.status !== "on_track" : false;
        case "unassigned":
          return ops ? ops.assignedStaff.length === 0 : c.assignedStaff.length === 0;
        case "no-docs":
          return c.invoiceCount === 0 && !c.lastReceiptDate;
        case "all":
        default:
          return true;
      }
    });
  }, [bookkeeperByClientId, clients, search, quickFilter]);

  const handleOpenBooks = (id: string) => {
    switchMutation.mutate(id);
  };

  const handleViewProfile = (id: string) => {
    navigate(`/firm/clients/${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading client portfolio...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Client Portfolio</h1>
          <p className="text-muted-foreground mt-1">
            {clients.length} client{clients.length !== 1 ? "s" : ""} managed by NRA
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setImportResult(null);
              setImportFile(null);
              setImportOpen(true);
            }}
          >
            <Upload className="w-4 h-4 mr-2" />
            Import Clients
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-client">
            <Plus className="w-4 h-4 mr-2" />
            Add Client
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-total-clients">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Clients</p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-1">{overview?.totalClients ?? clients.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-vat-due">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">VAT due 30d</p>
              <Calendar className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{overview?.vatDueThisMonth ?? 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-overdue-ar">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Overdue AR</p>
              <Receipt className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{formatAed(overview?.overdueAr ?? 0)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-attention">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Needs Attention
              </p>
              <AlertTriangle className="w-4 h-4 text-orange-600" />
            </div>
            <p className="text-2xl font-bold mt-1">{overview?.needsAttention ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <BookkeeperCommandCenter
        dashboard={bookkeeperDashboard}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
        onOpenBrief={setBriefClientId}
        onManageStaff={() => navigate("/firm/staff")}
      />

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={quickFilter === "all" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("all")}
        >
          All ({clients.length})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "critical" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("critical")}
          data-testid="filter-critical"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Critical ({bookkeeperDashboard?.summary.critical ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "attention" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("attention")}
          data-testid="filter-attention"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Needs Attention (
          {(bookkeeperDashboard?.summary.critical ?? 0) +
            (bookkeeperDashboard?.summary.attention ?? 0)}
          )
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "vat-due" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("vat-due")}
          data-testid="filter-vat-due"
        >
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          VAT Due Soon ({bookkeeperDashboard?.summary.vatDue28Days ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "close-blocked" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("close-blocked")}
          data-testid="filter-close-blocked"
        >
          <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
          Close Blocked ({bookkeeperDashboard?.summary.bookkeepingBlocked ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "unassigned" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("unassigned")}
          data-testid="filter-unassigned"
        >
          <UserCheck className="w-3.5 h-3.5 mr-1.5" />
          Unassigned ({bookkeeperDashboard?.workload?.unassignedClients ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "no-docs" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("no-docs")}
          data-testid="filter-no-docs"
        >
          <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
          Missing Documents
        </Button>
      </div>

      {/* Search & view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or TRN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-client-search"
          />
        </div>
        <div className="flex border rounded-md ml-auto">
          <Button
            variant={view === "card" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-r-none"
            onClick={() => setView("card")}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-l-none"
            onClick={() => setView("table")}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg">
            {clients.length === 0 ? "No clients yet" : "No clients match your filters"}
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? "Add your first client company to get started."
              : "Try adjusting your search or quick filter."}
          </p>
          {clients.length === 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Client
            </Button>
          )}
        </div>
      )}

      {bookkeeperDashboard && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                Portfolio Production Matrix
              </CardTitle>
              <Badge variant="outline">{filtered.length} shown</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>Corporate Tax</TableHead>
                  <TableHead>Close</TableHead>
                  <TableHead>Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 12).map((client) => {
                  const ops = bookkeeperByClientId.get(client.id);
                  return (
                    <TableRow key={`matrix-${client.id}`} className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => handleViewProfile(client.id)}
                          className="font-medium text-left hover:underline"
                        >
                          {client.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {client.trnVatNumber || "No TRN"}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops
                          ? ownerPreview(ops.assignedStaff.map((staff) => staff.name))
                          : ownerPreview(client.assignedStaff.map((staff) => staff.name))}
                      </TableCell>
                      <TableCell>
                        {ops ? (
                          <PriorityBadge priority={ops.priority} />
                        ) : (
                          <StatusBadge
                            active={client.invoiceCount > 0 || !!client.lastReceiptDate}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ops ? (
                          <span>
                            {formatDateShort(ops.vat.dueDate)} · {formatDays(ops.vat.daysTilDue)}
                          </span>
                        ) : (
                          <VatStatusBadge vatStatus={client.vatStatus} />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops
                          ? `${formatDateShort(ops.corporateTax.dueDate)} · ${formatDays(ops.corporateTax.daysTilDue)}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {ops ? (
                          <div className="min-w-28">
                            <div className="flex items-center justify-between text-xs">
                              <span>{ops.bookkeeping.closeProgress}%</span>
                              <span className="text-muted-foreground">
                                {priorityLabel(ops.bookkeeping.status)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${ops.bookkeeping.closeProgress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2 min-w-64">
                          <p className="text-sm text-muted-foreground truncate">
                            {ops?.nextBestAction ?? "Open client profile"}
                          </p>
                          <div className="flex gap-1">
                            {ops && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setBriefClientId(client.id)}
                              >
                                Brief
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenBooks(client.id)}
                              disabled={switchMutation.isPending}
                            >
                              <BookOpen className="w-3.5 h-3.5 mr-1" />
                              Open
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > 12 && (
              <p className="text-xs text-muted-foreground mt-3">
                Showing the first 12 clients for the selected filter. Use search or table view for
                the full list.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card view */}
      {view === "card" && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const ops = bookkeeperByClientId.get(client.id);
            return (
              <Card
                key={client.id}
                className="hover:shadow-md transition-shadow"
                data-testid={`client-card-${client.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{client.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {client.trnVatNumber ? `TRN: ${client.trnVatNumber}` : "No TRN registered"}
                      </p>
                    </div>
                    {ops ? (
                      <PriorityBadge priority={ops.priority} />
                    ) : (
                      <StatusBadge active={client.invoiceCount > 0 || !!client.lastReceiptDate} />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ops && (
                    <div className="rounded-md border bg-muted/20 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Next action</p>
                          <p className="text-sm font-medium truncate">{ops.nextBestAction}</p>
                        </div>
                        <span className="text-xs font-medium shrink-0">
                          {ops.bookkeeping.closeProgress}% close
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${ops.bookkeeping.closeProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">Outstanding AR</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {formatAed(client.outstandingAr)}
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">Invoices</p>
                      <p className="font-semibold text-sm mt-0.5">{client.invoiceCount}</p>
                    </div>
                  </div>

                  {/* VAT status */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      VAT Status
                    </span>
                    {ops ? (
                      <PriorityBadge priority={ops.vat.status} />
                    ) : (
                      <VatStatusBadge vatStatus={client.vatStatus} />
                    )}
                  </div>

                  {ops && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>VAT {formatDays(ops.vat.daysTilDue)}</span>
                      <span>CT {formatDays(ops.corporateTax.daysTilDue)}</span>
                    </div>
                  )}

                  {/* Last activity */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Last receipt</span>
                    <span>
                      {client.lastReceiptDate
                        ? format(new Date(client.lastReceiptDate), "MMM d, yyyy")
                        : "Never"}
                    </span>
                  </div>

                  {/* Staff */}
                  {(ops?.assignedStaff.length ?? client.assignedStaff.length) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3.5 h-3.5" />
                      {ops
                        ? ops.assignedStaff.map((s) => s.name).join(", ")
                        : client.assignedStaff.map((s) => s.name).join(", ")}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {ops && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBriefClientId(client.id)}
                      >
                        Brief
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenBooks(client.id)}
                      disabled={switchMutation.isPending}
                      data-testid={`button-open-books-${client.id}`}
                    >
                      <BookOpen className="w-3.5 h-3.5 mr-1.5" />
                      Open Books
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewProfile(client.id)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Table view */}
      {view === "table" && filtered.length > 0 && (
        <div className="border rounded-lg overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>TRN</TableHead>
                <TableHead>Outstanding AR</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>VAT Status</TableHead>
                <TableHead>Close</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => {
                const ops = bookkeeperByClientId.get(client.id);
                return (
                  <TableRow key={client.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{client.name}</p>
                          {ops && <PriorityBadge priority={ops.priority} />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ops?.nextBestAction ?? client.industry ?? "Open profile for details"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.trnVatNumber || "—"}
                    </TableCell>
                    <TableCell className="font-medium">{formatAed(client.outstandingAr)}</TableCell>
                    <TableCell>{client.invoiceCount}</TableCell>
                    <TableCell>
                      {ops ? (
                        <PriorityBadge priority={ops.vat.status} />
                      ) : (
                        <VatStatusBadge vatStatus={client.vatStatus} />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ops
                        ? `${ops.bookkeeping.closeProgress}% close`
                        : client.lastReceiptDate
                          ? format(new Date(client.lastReceiptDate), "MMM d, yyyy")
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm">
                          {ops
                            ? ownerPreview(ops.assignedStaff.map((staff) => staff.name))
                            : client.assignedStaff.length}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {ops && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setBriefClientId(client.id)}
                          >
                            Brief
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleOpenBooks(client.id)}
                          disabled={switchMutation.isPending}
                        >
                          <BookOpen className="w-3.5 h-3.5 mr-1" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewProfile(client.id)}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Client Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
            <DialogDescription>
              Create a new client company. A UAE chart of accounts will be seeded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Al Majid Trading LLC"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trn">TRN / VAT Number</Label>
                <Input
                  id="trn"
                  value={form.trnVatNumber}
                  onChange={(e) => setForm((f) => ({ ...f, trnVatNumber: e.target.value }))}
                  placeholder="100234567890003"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="emirate">Emirate</Label>
                <Select
                  value={form.emirate}
                  onValueChange={(v) => setForm((f) => ({ ...f, emirate: v }))}
                >
                  <SelectTrigger id="emirate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abu_dhabi">Abu Dhabi</SelectItem>
                    <SelectItem value="dubai">Dubai</SelectItem>
                    <SelectItem value="sharjah">Sharjah</SelectItem>
                    <SelectItem value="ajman">Ajman</SelectItem>
                    <SelectItem value="umm_al_quwain">Umm Al Quwain</SelectItem>
                    <SelectItem value="ras_al_khaimah">Ras Al Khaimah</SelectItem>
                    <SelectItem value="fujairah">Fujairah</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="legalStructure">Legal Structure</Label>
                <Select
                  value={form.legalStructure}
                  onValueChange={(v) => setForm((f) => ({ ...f, legalStructure: v }))}
                >
                  <SelectTrigger id="legalStructure">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                    <SelectItem value="Partnership">Partnership</SelectItem>
                    <SelectItem value="Corporation">Corporation</SelectItem>
                    <SelectItem value="Free Zone">Free Zone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="vatFrequency">VAT Frequency</Label>
                <Select
                  value={form.vatFilingFrequency}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatFilingFrequency: v }))}
                >
                  <SelectTrigger id="vatFrequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="vatCloseGroup">VAT Close Group</Label>
                <Select
                  value={form.vatPeriodStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatPeriodStartMonth: v }))}
                >
                  <SelectTrigger id="vatCloseGroup">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="11">Jan / Apr / Jul / Oct</SelectItem>
                    <SelectItem value="12">Feb / May / Aug / Nov</SelectItem>
                    <SelectItem value="1">Mar / Jun / Sep / Dec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fiscalYearStart">Financial Year Start</Label>
                <Select
                  value={form.fiscalYearStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, fiscalYearStartMonth: v }))}
                >
                  <SelectTrigger id="fiscalYearStart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">January</SelectItem>
                    <SelectItem value="2">February</SelectItem>
                    <SelectItem value="3">March</SelectItem>
                    <SelectItem value="4">April</SelectItem>
                    <SelectItem value="5">May</SelectItem>
                    <SelectItem value="6">June</SelectItem>
                    <SelectItem value="7">July</SelectItem>
                    <SelectItem value="8">August</SelectItem>
                    <SelectItem value="9">September</SelectItem>
                    <SelectItem value="10">October</SelectItem>
                    <SelectItem value="11">November</SelectItem>
                    <SelectItem value="12">December</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                placeholder="Trading, Construction, Retail..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="corporateTaxId">Corporate Tax Registration</Label>
              <Input
                id="corporateTaxId"
                value={form.corporateTaxId}
                onChange={(e) => setForm((f) => ({ ...f, corporateTaxId: e.target.value }))}
                placeholder="CT-1002345678"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="contactEmail">Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="info@company.ae"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+971 4 123 4567"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessAddress">Business Address</Label>
              <Input
                id="businessAddress"
                value={form.businessAddress}
                onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))}
                placeholder="Office 301, Business Bay, Dubai"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-create-client"
            >
              {createMutation.isPending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Clients Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Clients</DialogTitle>
            <DialogDescription>
              Upload a CSV or Excel file. Each row becomes a new client company with a UAE chart of
              accounts. Recognised columns: name, TRN, email, phone, industry, address, emirate, VAT
              filing, VAT close group, financial year start, corporate tax ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">CSV / XLSX file</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null);
                  setImportResult(null);
                }}
              />
              <p className="text-xs text-muted-foreground">Up to 500 rows per upload.</p>
            </div>
            {importResult && (
              <div className="rounded border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Imported</span>
                  <span className="text-green-700">{importResult.created.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Errors</span>
                  <span className={importResult.errors.length > 0 ? "text-red-700" : ""}>
                    {importResult.errors.length}
                  </span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-auto text-xs text-muted-foreground space-y-1">
                    {importResult.errors.slice(0, 20).map((e, i) => (
                      <div key={i}>
                        Row {e.row}
                        {e.name ? ` (${e.name})` : ""}: {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => importFile && importMutation.mutate(importFile)}
              disabled={!importFile || importMutation.isPending}
              data-testid="button-import-clients"
            >
              <Upload className="w-4 h-4 mr-2" />
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationsBriefDialog
        client={briefClient}
        open={!!briefClientId}
        onOpenChange={(open) => !open && setBriefClientId(null)}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
      />
    </div>
  );
}
