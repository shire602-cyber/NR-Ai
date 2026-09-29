import { useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  Copy,
  ScanLine,
  Check,
  XCircle,
  Trash2,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  evaluateAmountExpression,
  parseVatPasteRows,
  vat201CopyGroups,
  vatEmirates,
  vatRowCategories,
  vatRowCategoryLabel,
  type VatRowCategory,
} from "@/lib/vat-workpaper-grid";
import { format } from "date-fns";
import type { Company } from "@shared/schema";
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  clientHasService,
  serviceLabels,
  type ClientServiceCode,
  type ClientServicePlan,
} from "@shared/client-services";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { messages as pageMessages } from "./ClientPortfolio.i18n";

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

type ClientWithStats = Company &
  ClientStats & {
    serviceScope?: ClientServiceCode[];
    servicePlan?: ClientServicePlan;
  };

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
  serviceScope: ClientServiceCode[];
  servicePlan?: ClientServicePlan;
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
  serviceMatrix?: Array<{
    code: ClientServiceCode;
    label: string;
    shortLabel: string;
    clientCount: number;
    critical: number;
    attention: number;
  }>;
  vatCohorts: BookkeeperVatCohort[];
  queues?: Record<BookkeeperQueueKey, BookkeeperQueueItem[]>;
  workload?: {
    owners: BookkeeperWorkloadOwner[];
    unassignedClients: number;
    overloadedStaff: number;
  };
  clients: BookkeeperClient[];
}

type GrowthOpportunityStatus = "open" | "accepted" | "snoozed" | "dismissed" | "completed";

interface GrowthOpportunity {
  id: string;
  companyId: string;
  companyName: string | null;
  opportunityType: string;
  sourceSignal: string;
  title: string;
  reason: string;
  estimatedValue: number;
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  status: GrowthOpportunityStatus;
  ownerUserId: string | null;
  dueDate: string | null;
  snoozedUntil: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface GrowthDashboard {
  summary: {
    estimated: number;
    accepted: number;
    completed: number;
    missed: number;
    openCount: number;
  };
  opportunities: GrowthOpportunity[];
}

interface VatWorkpaperSummary {
  id: string;
  companyId: string;
  companyName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  generatedVatReturnId: string | null;
  totalsSnapshot: Record<string, number>;
  updatedAt: string;
}

interface VatWorkpaperRow {
  id: string;
  rowCategory: VatRowCategory;
  vat201Box: string;
  invoiceNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyTrn: string | null;
  emirate: string | null;
  taxableAmount: number;
  vatAmount: number;
  adjustmentAmount: number;
  grossAmount: number;
  status: "draft" | "approved" | "excluded";
  sourceMethod: "manual" | "ocr" | "import" | "generated";
  notes: string | null;
  auditReason: string | null;
  journalEntryId: string | null;
}

const POSTABLE_VAT_CATEGORIES = [
  "standard_sale",
  "zero_rated_sale",
  "exempt_sale",
  "standard_expense",
  "reverse_charge_input",
  "import",
];

interface VatWorkpaperAttachment {
  id: string;
  rowId: string | null;
  fileName: string;
  mimeType: string;
  filePath: string | null;
  extractedText: string | null;
  createdAt: string;
}

interface VatWorkpaperDetail {
  workpaper: VatWorkpaperSummary;
  company: { id: string; name: string; trnVatNumber: string | null } | null;
  rows: VatWorkpaperRow[];
  attachments: VatWorkpaperAttachment[];
  totals: Record<string, number>;
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
  if (!start || !end) return pageMessages.t("noPeriod");
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function formatDays(days: number | null | undefined) {
  if (days === null || days === undefined) return pageMessages.t("noDate");
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return pageMessages.t("dueToday");
  return `${days}d left`;
}

function inputDate(date: string | null | undefined) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return format(parsed, "yyyy-MM-dd");
}

/** Today as a yyyy-MM-dd string for pre-filling date inputs (local time). */
function todayInput() {
  return format(new Date(), "yyyy-MM-dd");
}

function copyText(value: unknown) {
  void navigator.clipboard?.writeText(String(value ?? "0"));
}

async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read evidence file"));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

async function readEvidenceText(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const isTextLike =
    type.startsWith("text/") ||
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    name.endsWith(".json");
  if (!isTextLike || file.size > 500_000) return "";
  return file.text();
}

function priorityClass(priority: BookkeeperPriority | "filed") {
  if (priority === "filed" || priority === "on_track")
    return "bg-success-subtle text-success-subtle-foreground border-success/30";
  if (priority === "critical")
    return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
  return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
}

function priorityLabel(priority: BookkeeperPriority | "filed") {
  if (priority === "on_track") return pageMessages.t("onTrack");
  if (priority === "attention") return pageMessages.t("attention");
  if (priority === "critical") return pageMessages.t("critical");
  return pageMessages.t("filed");
}

function priorityScore(priority: BookkeeperPriority | "filed") {
  if (priority === "critical") return 3;
  if (priority === "attention") return 2;
  return 1;
}

function PriorityBadge({ priority }: { priority: BookkeeperPriority | "filed" }) {
  return <Badge className={priorityClass(priority)}>{priorityLabel(priority)}</Badge>;
}

function servicesForClient(
  client: Pick<BookkeeperClient, "serviceScope"> | Pick<ClientWithStats, "serviceScope">
): ClientServiceCode[] {
  return client.serviceScope?.length ? client.serviceScope : DEFAULT_CLIENT_SERVICE_CODES;
}

function hasClientService(
  client: Pick<BookkeeperClient, "serviceScope"> | Pick<ClientWithStats, "serviceScope">,
  service: ClientServiceCode
) {
  return clientHasService(servicesForClient(client), service);
}

function ServiceScopeBadges({
  services,
  compact = false,
}: {
  services?: readonly ClientServiceCode[];
  compact?: boolean;
}) {
  const activeServices = services?.length ? [...services] : DEFAULT_CLIENT_SERVICE_CODES;
  const labels = compact
    ? serviceLabels(activeServices)
    : activeServices.map(
        (service) =>
          CLIENT_SERVICE_OPTIONS.find((option) => option.code === service)?.label ?? service
      );

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="text-[11px]">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function interventionClass(level: BookkeeperInterventionLevel) {
  if (level === "high")
    return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
  if (level === "medium")
    return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
  return "bg-success-subtle text-success-subtle-foreground border-success/30";
}

function fallbackIntervention(
  client: BookkeeperClient
): NonNullable<BookkeeperClient["intervention"]> {
  const score = Math.min(
    100,
    priorityScore(client.priority) * 18 +
      (client.assignedStaff.length === 0 ? 12 : 0) +
      (client.bookkeeping.status !== "on_track" ? 12 : 0) +
      (client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28 ? 10 : 0) +
      (client.corporateTax.daysTilDue !== null && client.corporateTax.daysTilDue <= 90 ? 6 : 0)
  );
  const level: BookkeeperInterventionLevel = score >= 65 ? "high" : score >= 35 ? "medium" : "low";
  const reasons = [
    client.assignedStaff.length === 0 ? pageMessages.t("noOwnerAssigned") : "",
    ...client.vat.blockers,
    ...client.corporateTax.blockers,
    ...client.bookkeeping.blockers,
    ...client.accounting.blockers,
  ].filter(Boolean);
  return {
    score,
    level,
    title: client.nextBestAction,
    reasons: (reasons.length > 0 ? reasons : [pageMessages.t("noActiveInterventionSignals")]).slice(
      0,
      5
    ),
    ownerAction: client.nextBestAction,
    deadlineLabel: primaryDeadline(client).label,
    exposureAed: Math.round(Math.max(0, client.bookkeeping.openAr)),
  };
}

function clientIntervention(client: BookkeeperClient) {
  return client.intervention ?? fallbackIntervention(client);
}

function blockerPreview(blockers: string[]) {
  if (blockers.length === 0) return pageMessages.t("noBlockers");
  if (blockers.length === 1) return blockers[0];
  return `${blockers[0]} +${blockers.length - 1}`;
}

const getQueueConfig = (): Record<
  BookkeeperQueueKey,
  { label: string; icon: typeof Calendar }
> => ({
  vat: { label: pageMessages.t("vat"), icon: Calendar },
  corporateTax: { label: pageMessages.t("corporateTax"), icon: Calculator },
  bookkeeping: { label: pageMessages.t("bookkeeping"), icon: TrendingUp },
  accounting: { label: pageMessages.t("accounting"), icon: CheckCircle2 },
});

function ownerPreview(names: string[]) {
  if (names.length === 0) return pageMessages.t("unassigned");
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function primaryDeadline(client: BookkeeperClient) {
  const candidates = [
    hasClientService(client, "vat") && client.vat.status !== "filed"
      ? {
          label: pageMessages.t("vat"),
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric:
            client.vat.payableTax !== null
              ? formatAed(client.vat.payableTax)
              : client.vat.cohortLabel,
        }
      : null,
    hasClientService(client, "corporate_tax") && client.corporateTax.status !== "filed"
      ? {
          label: pageMessages.t("ct"),
          dueDate: client.corporateTax.dueDate,
          daysTilDue: client.corporateTax.daysTilDue,
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : pageMessages.t("readiness"),
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    dueDate: string | null;
    daysTilDue: number | null;
    metric: string;
  }>;

  candidates.sort((a, b) => (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999));
  const fallbackLabel = hasClientService(client, "bookkeeping")
    ? "Close"
    : hasClientService(client, "accounting")
      ? pageMessages.t("accounting")
      : pageMessages.t("profile");
  return (
    candidates[0] ?? {
      label: fallbackLabel,
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
  const tr = pageMessages.useT();

  const lanes = client
    ? [
        {
          key: "vat",
          service: "vat" as const,
          title: tr("vat"),
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
          service: "corporate_tax" as const,
          title: tr("corporateTax"),
          icon: Calculator,
          status: client.corporateTax.status,
          due: `${formatDateShort(client.corporateTax.dueDate)} · ${formatDays(client.corporateTax.daysTilDue)}`,
          period: formatPeriod(client.corporateTax.periodStart, client.corporateTax.periodEnd),
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : tr("readiness"),
          blockers: client.corporateTax.blockers,
        },
        {
          key: "bookkeeping",
          service: "bookkeeping" as const,
          title: tr("bookkeeping"),
          icon: TrendingUp,
          status: client.bookkeeping.status,
          due: `${client.bookkeeping.closeProgress}% close-ready`,
          period:
            client.bookkeeping.daysSinceActivity === null
              ? tr("noActivityDate")
              : `${client.bookkeeping.daysSinceActivity}d since activity`,
          metric: `${client.bookkeeping.unpostedReceiptCount} receipts · ${client.bookkeeping.unreconciledBankCount} bank lines`,
          blockers: client.bookkeeping.blockers,
        },
        {
          key: "accounting",
          service: "accounting" as const,
          title: tr("accounting"),
          icon: CheckCircle2,
          status: client.accounting.status,
          due: client.accounting.trialBalanceBalanced ? tr("balanced") : tr("needsReview"),
          period:
            client.accounting.discrepancy > 0
              ? formatAed(client.accounting.discrepancy)
              : tr("noVariance"),
          metric: client.accounting.trialBalanceBalanced
            ? tr("trialBalanceClean")
            : tr("trialBalanceVariance"),
          blockers: client.accounting.blockers,
        },
      ].filter((lane) => hasClientService(client, lane.service))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{client?.companyName ?? tr("clientOperationsBrief")}</DialogTitle>
          <DialogDescription>
            {client
              ? `${ownerPreview(client.assignedStaff.map((staff) => staff.name))} · ${client.nextBestAction}`
              : tr("operationalStatus")}
          </DialogDescription>
        </DialogHeader>

        {client && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{tr("priority")}</p>
                <div className="mt-1">
                  <PriorityBadge priority={client.priority} />
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{tr("owner")}</p>
                <p className="text-sm font-medium mt-1 truncate">
                  {ownerPreview(client.assignedStaff.map((staff) => staff.name))}
                </p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{tr("lastActivity")}</p>
                <p className="text-sm font-medium mt-1">{formatDateShort(client.lastActivity)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{tr("openAr")}</p>
                <p className="text-sm font-medium mt-1">{formatAed(client.bookkeeping.openAr)}</p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground mb-2">{tr("nrServicesForThisClient")}</p>
              <ServiceScopeBadges services={client.serviceScope} />
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
                        <p className="text-xs text-muted-foreground">{tr("timing")}</p>
                        <p className="font-medium">{lane.due}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{tr("metric")}</p>
                        <p className="font-medium truncate">{lane.metric}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {lane.blockers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{tr("noBlockers2")}</p>
                      ) : (
                        lane.blockers.slice(0, 4).map((blocker) => (
                          <div key={blocker} className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
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
            <ChevronRight className="w-4 h-4 me-2" />
            {tr("profile")}
          </Button>
          <Button onClick={() => client && onOpenBooks(client.companyId)} disabled={!client}>
            <BookOpen className="w-4 h-4 me-2" />
            {tr("openBooks")}
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
  const tr = pageMessages.useT();

  const [activeQueue, setActiveQueue] = useState<BookkeeperQueueKey>("vat");
  const dashboardClients = useMemo(() => dashboard?.clients ?? [], [dashboard?.clients]);
  const workloadOwners = useMemo(
    () => dashboard?.workload?.owners ?? [],
    [dashboard?.workload?.owners]
  );
  const priorityClients = dashboardClients.slice(0, 5);
  const activeQueueItems = dashboard?.queues?.[activeQueue] ?? [];
  const productionBuckets = useMemo(() => {
    const deadlineItems = sortProductionItems(
      dashboardClients.map((client) => productionItem(client))
    );
    return [
      {
        key: "overdue",
        title: tr("overdueDueNow"),
        icon: AlertTriangle,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue <= 0)
          .slice(0, 5),
      },
      {
        key: "week",
        title: tr("thisWeek"),
        icon: Clock,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue > 0 && item.daysTilDue <= 7)
          .slice(0, 5),
      },
      {
        key: "month",
        title: tr("next28Days"),
        icon: Calendar,
        items: deadlineItems
          .filter(
            (item) => item.daysTilDue !== null && item.daysTilDue > 7 && item.daysTilDue <= 28
          )
          .slice(0, 5),
      },
      {
        key: "blocked",
        title: tr("closeBlockers"),
        icon: TrendingUp,
        items: sortProductionItems(
          dashboardClients
            .filter((client) => client.bookkeeping.status !== "on_track")
            .map((client) => productionItem(client, "Close"))
        ).slice(0, 5),
      },
      {
        key: "unassigned",
        title: tr("unassigned"),
        icon: UserCheck,
        items: deadlineItems.filter((item) => item.client.assignedStaff.length === 0).slice(0, 5),
      },
    ];
  }, [dashboardClients]);
  const capacityPlanner = useMemo(() => {
    const unassigned = dashboardClients
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
  }, [dashboardClients, workloadOwners]);
  const interventionRadar = useMemo(() => {
    const rankedClients = [...dashboardClients].sort((a, b) => {
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
  }, [dashboardClients]);
  const serviceLaneForecast = useMemo(() => {
    const clients = dashboardClients;
    const corporateTaxClients = clients.filter((client) =>
      hasClientService(client, "corporate_tax")
    );
    const bookkeepingClients = clients.filter((client) => hasClientService(client, "bookkeeping"));
    const accountingClients = clients.filter((client) => hasClientService(client, "accounting"));
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
    const ctOpen = corporateTaxClients.filter((client) => client.corporateTax.status !== "filed");
    const bookkeepingBlocked = sortedByIntervention(
      bookkeepingClients.filter((client) => client.bookkeeping.status === "critical")
    );
    const bookkeepingAttention = sortedByIntervention(
      bookkeepingClients.filter((client) => client.bookkeeping.status === "attention")
    );
    const bookkeepingReady = bookkeepingClients
      .filter(
        (client) =>
          client.bookkeeping.status === "on_track" && client.bookkeeping.closeProgress >= 90
      )
      .sort((a, b) => b.bookkeeping.closeProgress - a.bookkeeping.closeProgress);
    const accountingVariance = sortedByIntervention(
      accountingClients.filter((client) => client.accounting.status === "critical")
    );
    const accountingReview = sortedByIntervention(
      accountingClients.filter((client) => client.accounting.status === "attention")
    );
    const accountingClean = accountingClients.filter(
      (client) => client.accounting.status === "on_track"
    );

    return [
      {
        key: "vat",
        title: tr("vatCohorts"),
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
        title: tr("corporateTax"),
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
        title: tr("bookkeepingClose"),
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
        title: tr("accountingReview"),
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
  }, [dashboardClients, dashboard?.vatCohorts]);
  const ctClients = dashboardClients
    .filter(
      (client) =>
        hasClientService(client, "corporate_tax") && client.corporateTax.status !== "filed"
    )
    .sort((a, b) => (a.corporateTax.daysTilDue ?? 9999) - (b.corporateTax.daysTilDue ?? 9999))
    .slice(0, 4);
  const closeClients = dashboardClients
    .filter(
      (client) =>
        hasClientService(client, "bookkeeping") && client.bookkeeping.status !== "on_track"
    )
    .slice(0, 4);
  const accountingClients = dashboardClients
    .filter(
      (client) => hasClientService(client, "accounting") && client.accounting.status !== "on_track"
    )
    .slice(0, 4);

  return (
    <section className="space-y-4" data-testid="bookkeeper-command-center">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {tr("nrBookkeeperCommandCenter")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tr("vatCohortsCorporateTaxDeadlinesMonthly")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
            <Clock className="w-3.5 h-3.5" />
            {dashboard?.generatedAt
              ? tr("updated", { format: format(new Date(dashboard.generatedAt), "MMM d, HH:mm") })
              : tr("loading")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("critical")}
              </p>
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.critical ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("vatDue28d")}
              </p>
              <Calendar className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.vatDue28Days ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("ctDue90d")}
              </p>
              <Calculator className="w-4 h-4 text-info" />
            </div>
            <p className="text-2xl font-bold mt-1">
              {dashboard?.summary.corporateTaxDue90Days ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("closeBlocked")}
              </p>
              <FileText className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.bookkeepingBlocked ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                {tr("clientServiceMatrix")}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {tr("scopeEveryClientByServiceBefore")}
              </p>
            </div>
            <Badge variant="outline">
              {dashboard?.summary.totalClients ?? 0} {tr("clients")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              dashboard?.serviceMatrix ??
              CLIENT_SERVICE_OPTIONS.map((option) => ({
                code: option.code,
                label: option.label,
                shortLabel: option.shortLabel,
                clientCount: 0,
                critical: 0,
                attention: 0,
              }))
            ).map((service) => (
              <div key={service.code} className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">{service.label}</p>
                <p className="text-2xl font-bold mt-1">{service.clientCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr("criticalAttention", {
                    critical: service.critical,
                    attention: service.attention,
                  })}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              {tr("productionPlanner")}
            </CardTitle>
            <Badge variant="outline">
              {productionBuckets.reduce((total, bucket) => total + bucket.items.length, 0)}{" "}
              {tr("visibleItems")}
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
                        {tr("clear")}
                      </div>
                    )}
                    {bucket.items.map((item) => (
                      <button
                        key={`${bucket.key}-${item.client.companyId}`}
                        type="button"
                        onClick={() => onOpenBrief(item.client.companyId)}
                        className="w-full rounded-md border bg-background px-2.5 py-2 text-start hover:bg-muted/50 transition-colors"
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
                {tr("staffCapacityPlanner")}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {tr("balanceOwnersBeforeVatCtAnd")}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onManageStaff}>
              <Users className="w-4 h-4 me-2" />
              {tr("manageStaff")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{tr("unassignedIntake")}</p>
                <Badge variant={capacityPlanner.unassigned.length > 0 ? "destructive" : "outline"}>
                  {capacityPlanner.unassigned.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.unassigned.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    {tr("noUnassignedClients")}
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
                        {tr("brief")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={onManageStaff}>
                        {tr("assign")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{tr("overloadedOwners")}</p>
                <Badge variant={capacityPlanner.overloaded.length > 0 ? "secondary" : "outline"}>
                  {capacityPlanner.overloaded.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.overloaded.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    {tr("noCapacityPressure")}
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
                          {tr("clientsAvgClose", {
                            clientCount: owner.clientCount,
                            averageCloseProgress: owner.averageCloseProgress,
                          })}
                        </p>
                      </div>
                      <Badge variant={owner.critical > 0 ? "destructive" : "secondary"}>
                        {tr("critical2", { critical: owner.critical })}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                      <span>{tr("vat2", { vatDue28Days: owner.vatDue28Days })}</span>
                      <span>
                        {tr("ct2", { corporateTaxDue90Days: owner.corporateTaxDue90Days })}
                      </span>
                      <span>
                        {tr("closeBlocked2", { bookkeepingBlocked: owner.bookkeepingBlocked })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{tr("availableCapacity")}</p>
                <Badge variant="outline">{capacityPlanner.openCapacity.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.openCapacity.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    {tr("noLowLoadOwnerFound")}
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
                          {tr("clientsAvgClose", {
                            clientCount: owner.clientCount,
                            averageCloseProgress: owner.averageCloseProgress,
                          })}
                        </p>
                      </div>
                      <Badge variant="outline">{tr("canTakeWork")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {tr("vatDueCloseBlocked", {
                        vatDue28Days: owner.vatDue28Days,
                        bookkeepingBlocked: owner.bookkeepingBlocked,
                      })}
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
                {tr("interventionRadar")}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {tr("prioritizeFilesByDeadlinePressureSource")}
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
                {dashboard?.summary.interventionHigh ?? interventionRadar.high.length} {tr("high")}
              </Badge>
              <Badge variant="secondary">
                {dashboard?.summary.interventionMedium ?? interventionRadar.watchlist.length}{" "}
                {tr("watchlist")}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{tr("escalateToday")}</p>
                <Badge variant={interventionRadar.high.length > 0 ? "destructive" : "outline"}>
                  {interventionRadar.high.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.high.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    {tr("noHighRiskInterventions")}
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
                          {tr("brief")}
                        </Button>
                        <Button size="sm" onClick={() => onOpenBooks(client.companyId)}>
                          {tr("open")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{tr("watchlist2")}</p>
                <Badge variant="secondary">{interventionRadar.watchlist.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.watchlist.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    {tr("noMediumRiskWatchlist")}
                  </div>
                )}
                {interventionRadar.watchlist.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <button
                      key={`intervention-watch-${client.companyId}`}
                      type="button"
                      onClick={() => onOpenBrief(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-start hover:bg-muted/50 transition-colors"
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
                <p className="text-sm font-medium">{tr("collectionExposure")}</p>
                <Badge variant="outline">{interventionRadar.exposure.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.exposure.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    {tr("noOpenExposureInRadar")}
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
                            {tr("overdueInvoices", {
                              overdueInvoiceCount: client.bookkeeping.overdueInvoiceCount,
                            })}
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
                          {tr("brief")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewProfile(client.companyId)}
                        >
                          {tr("profile")}
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
                {tr("serviceLaneForecast")}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {tr("onePortfolioViewForVatCohorts")}
              </p>
            </div>
            <Badge variant="outline">
              {dashboard?.summary.totalClients ?? 0} {tr("clients")}
            </Badge>
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
                        className="w-full rounded-md border bg-background px-3 py-2 text-start transition-colors enabled:hover:bg-muted/50 disabled:cursor-default"
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
                          {row.sample || tr("noActiveClients")}
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
                {tr("actionQueues")}
              </CardTitle>
              <Badge variant="outline">
                {tr("active", { activeQueueItemsCount: activeQueueItems.length })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(getQueueConfig()) as BookkeeperQueueKey[]).map((key) => {
                const Icon = getQueueConfig()[key].icon;
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
                    {getQueueConfig()[key].label}
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </Button>
                );
              })}
            </div>

            <div className="space-y-2">
              {activeQueueItems.length === 0 && (
                <div className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center">
                  <p className="text-sm font-medium">{tr("noActiveQueueItems")}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tr("thisLaneIsClearForNow")}
                  </p>
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
                        {item.blockers.length > 1 && (
                          <span>{tr("blockers", { blockersCount: item.blockers.length })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 sm:shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBrief(item.companyId)}
                      >
                        {tr("brief")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewProfile(item.companyId)}
                      >
                        <ChevronRight className="w-3.5 h-3.5 me-1" />
                        {tr("profile")}
                      </Button>
                      <Button size="sm" onClick={() => onOpenBooks(item.companyId)}>
                        <BookOpen className="w-3.5 h-3.5 me-1" />
                        {tr("open")}
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
                {tr("workloadOwnership")}
              </CardTitle>
              {(dashboard?.workload?.unassignedClients ?? 0) > 0 && (
                <Badge variant="destructive">
                  {tr("unassigned2", { unassignedClients: dashboard?.workload?.unassignedClients })}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {workloadOwners.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("noStaffWorkloadYet")}</p>
            )}
            {workloadOwners.slice(0, 6).map((owner) => (
              <div key={owner.staffId ?? "unassigned"} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{owner.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr("clientsAvgClose", {
                        clientCount: owner.clientCount,
                        averageCloseProgress: owner.averageCloseProgress,
                      })}
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
                      ? tr("critical2", { critical: owner.critical })
                      : tr("attention2", { attention: owner.attention })}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${owner.averageCloseProgress}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                  <span>{tr("vatDue", { vatDue28Days: owner.vatDue28Days })}</span>
                  <span>{tr("ctDue", { corporateTaxDue90Days: owner.corporateTaxDue90Days })}</span>
                  <span>
                    {tr("closeBlocked2", { bookkeepingBlocked: owner.bookkeepingBlocked })}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">{tr("vatProductionBoard")}</CardTitle>
            <Badge variant="outline">
              {dashboard?.summary.totalClients ?? 0} {tr("clients")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            {(dashboard?.vatCohorts ?? []).slice(0, 3).map((cohort, index) => (
              <div key={cohort.key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{tr("group", { value: index + 1 })}</p>
                    <p className="text-xs text-muted-foreground">{cohort.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr("clients2", { clientCount: cohort.clientCount })}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {cohort.dueSoon > 0 && (
                      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
                        {tr("due", { dueSoon: cohort.dueSoon })}
                      </Badge>
                    )}
                    {cohort.blocked > 0 && (
                      <Badge variant="destructive">
                        {tr("blocked", { blocked: cohort.blocked })}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2 min-h-[132px]">
                  {cohort.clients.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-sm text-muted-foreground text-center">
                      {tr("noClientsInThisCohort")}
                    </div>
                  )}
                  {cohort.clients.slice(0, 4).map((client) => (
                    <button
                      key={client.companyId}
                      type="button"
                      onClick={() => onOpenBooks(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-start hover:bg-muted/50 transition-colors"
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
              <AlertTriangle className="w-4 h-4 text-destructive" />
              {tr("priorityQueue")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorityClients.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("noClientsYet")}</p>
            )}
            {priorityClients.map((client) => (
              <button
                key={client.companyId}
                type="button"
                onClick={() => onOpenBooks(client.companyId)}
                className="w-full rounded-md border px-3 py-2 text-start hover:bg-muted/50 transition-colors"
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
              <Calculator className="w-4 h-4 text-info" />
              {tr("corporateTax")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ctClients.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("noCtDeadlinesRequiringAction")}</p>
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
              <TrendingUp className="w-4 h-4 text-warning" />
              {tr("bookkeepingClose")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {closeClients.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("monthlyCloseIsOnTrack")}</p>
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
              <CheckCircle2 className="w-4 h-4 text-success" />
              {tr("accountingReview")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountingClients.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("trialBalancesAreClean")}</p>
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

function RevenueGrowthPanel({ onOpenClient }: { onOpenClient: (companyId: string) => void }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const { data, isLoading } = useQuery<GrowthDashboard>({
    queryKey: ["/api/firm/growth-opportunities"],
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/growth-opportunities/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/growth-opportunities"] });
      toast({ title: tr("revenueOpportunitiesRefreshed") });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotRefreshRevenueOpportunities"),
        description: e?.message,
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
      actionType,
      resolutionNote,
    }: {
      id: string;
      status: GrowthOpportunityStatus;
      actionType: string;
      resolutionNote?: string;
    }) =>
      apiRequest("PATCH", `/api/firm/growth-opportunities/${id}`, {
        status,
        actionType,
        resolutionNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/growth-opportunities"] });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotUpdateOpportunity"),
        description: e?.message,
      }),
  });

  const opportunities = data?.opportunities ?? [];
  const active = opportunities
    .filter((item) => item.status !== "dismissed" && item.status !== "completed")
    .slice(0, 6);
  const summary = data?.summary ?? {
    estimated: 0,
    accepted: 0,
    completed: 0,
    missed: 0,
    openCount: 0,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              {tr("revenueGrowth")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {tr("internalOpportunityQueueForServiceAr")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className="w-4 h-4 me-2" />
            {tr("refreshSignals")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{tr("openPipeline")}</p>
            <p className="text-lg font-semibold">{formatAed(summary.estimated)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{tr("accepted")}</p>
            <p className="text-lg font-semibold">{formatAed(summary.accepted)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{tr("completed")}</p>
            <p className="text-lg font-semibold">{formatAed(summary.completed)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{tr("openCount")}</p>
            <p className="text-lg font-semibold">{summary.openCount}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{tr("loadingRevenueSignals")}</p>
        ) : active.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {tr("noActiveRevenueOpportunitiesYetRefresh")}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((opportunity) => (
              <div key={opportunity.id} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{opportunity.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {opportunity.companyName ?? tr("client")}
                    </p>
                  </div>
                  <Badge variant={opportunity.priority === "critical" ? "destructive" : "outline"}>
                    {opportunity.priority}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{opportunity.reason}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">
                    {formatAed(Number(opportunity.estimatedValue ?? 0))}
                  </span>
                  <span className="text-muted-foreground">
                    {tr("confidence", {
                      round: Math.round(Number(opportunity.confidence ?? 0) * 100),
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenClient(opportunity.companyId)}
                  >
                    {tr("client")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "accepted",
                        actionType: "accept",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    {tr("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "completed",
                        actionType: "complete",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    {tr("complete")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "dismissed",
                        actionType: "dismiss",
                        // i18n-ignore: persisted server-side note, not UI text
                        resolutionNote: "Dismissed from Client Operations.",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    {tr("dismiss")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VatWorkspacePanel({
  dashboard,
  clients,
  onOpenWorkspace,
}: {
  dashboard?: BookkeeperDashboard;
  clients: ClientWithStats[];
  onOpenWorkspace: (companyId: string) => void;
}) {
  const tr = pageMessages.useT();

  const { data } = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ["/api/firm/vat-workpapers"],
  });
  const workpapers = data?.workpapers ?? [];
  const draftCount = workpapers.filter(
    (workpaper) => workpaper.status === "draft" || workpaper.status === "in_review"
  ).length;
  const dueClients = (dashboard?.clients ?? [])
    .filter((client) => hasClientService(client, "vat") && client.vat.status !== "filed")
    .sort((a, b) => (a.vat.daysTilDue ?? 99999) - (b.vat.daysTilDue ?? 99999))
    .slice(0, 6);
  const recentWorkpapers = workpapers.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              {tr("vatSubmissionWorkspace")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {tr("vatOnlyWorkpapersForInvoiceRows")}
            </p>
          </div>
          <Badge variant="outline">{tr("draftReviewWorkpapers", { draftCount })}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{tr("vatQueue")}</p>
            <span className="text-xs text-muted-foreground">
              {dashboard?.summary.vatDue28Days ?? 0} {tr("dueIn28d")}
            </span>
          </div>
          {dueClients.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {tr("noVatQueueItemsNeedAction")}
            </div>
          ) : (
            dueClients.map((client) => (
              <div
                key={client.companyId}
                className="rounded-md border p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{client.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {client.vat.cohortLabel} ·{" "}
                    {formatPeriod(client.vat.periodStart, client.vat.periodEnd)} ·{" "}
                    {formatDays(client.vat.daysTilDue)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenWorkspace(client.companyId)}
                >
                  {tr("workspace")}
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{tr("recentWorkpapers")}</p>
            <span className="text-xs text-muted-foreground">
              {tr("total", { workpapersCount: workpapers.length })}
            </span>
          </div>
          {recentWorkpapers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {tr("noVatWorkpapersYetOpenA")}
            </div>
          ) : (
            recentWorkpapers.map((workpaper) => (
              <div
                key={workpaper.id}
                className="rounded-md border p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{workpaper.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} · {workpaper.status}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenWorkspace(workpaper.companyId)}
                >
                  {tr("open")}
                </Button>
              </div>
            ))
          )}
          {clients.length > 0 && dueClients.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(clients[0].id)}>
              {tr("createForFirstClient")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VatWorkspaceDialog({
  client,
  ops,
  open,
  onOpenChange,
}: {
  client: ClientWithStats | undefined;
  ops: BookkeeperClient | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceInputKey, setEvidenceInputKey] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState("grid");
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowForm, setRowForm] = useState({
    rowCategory: "standard_sale" as VatRowCategory,
    vat201Box: "box1bDubaiAmount",
    invoiceNumber: "",
    documentDate: todayInput(),
    counterpartyName: "",
    counterpartyTrn: "",
    emirate: client?.emirate ?? "dubai",
    taxableAmount: "",
    vatAmount: "",
    adjustmentAmount: "",
    grossAmount: "",
    notes: "",
    auditReason: "",
    status: "approved" as VatWorkpaperRow["status"],
    sourceMethod: "manual" as VatWorkpaperRow["sourceMethod"],
  });
  const [pastedVatRows, setPastedVatRows] = useState("");

  useEffect(() => {
    if (!open || !client) return;
    setPeriodStart(
      inputDate(ops?.vat.periodStart) ||
        format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd")
    );
    setPeriodEnd(
      inputDate(ops?.vat.periodEnd) ||
        format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), "yyyy-MM-dd")
    );
    setDueDate(inputDate(ops?.vat.dueDate));
    setRowForm((form) => ({ ...form, emirate: client.emirate ?? "dubai" }));
  }, [client, open, ops?.vat.dueDate, ops?.vat.periodEnd, ops?.vat.periodStart]);

  const workpapersQuery = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ["/api/firm/vat-workpapers", client?.id],
    queryFn: () => apiRequest("GET", `/api/firm/vat-workpapers?companyId=${client?.id}`),
    enabled: open && !!client,
  });
  const workpapers = workpapersQuery.data?.workpapers ?? [];

  useEffect(() => {
    if (!open) return;
    if (!selectedWorkpaperId && workpapers.length > 0) setSelectedWorkpaperId(workpapers[0].id);
    if (
      selectedWorkpaperId &&
      workpapers.length > 0 &&
      !workpapers.some((workpaper) => workpaper.id === selectedWorkpaperId)
    ) {
      setSelectedWorkpaperId(workpapers[0].id);
    }
  }, [open, selectedWorkpaperId, workpapers]);

  const detailQuery = useQuery<VatWorkpaperDetail>({
    queryKey: ["/api/firm/vat-workpapers/detail", selectedWorkpaperId],
    queryFn: () => apiRequest("GET", `/api/firm/vat-workpapers/${selectedWorkpaperId}`),
    enabled: open && !!selectedWorkpaperId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/firm/vat-workpapers", {
        companyId: client?.id,
        periodStart,
        periodEnd,
        dueDate: dueDate || null,
      }),
    onSuccess: (workpaper: VatWorkpaperSummary) => {
      setSelectedWorkpaperId(workpaper.id);
      queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers", client?.id] });
      toast({ title: tr("vatWorkpaperReady") });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotCreateVatWorkpaper"),
        description: e?.message,
      }),
  });

  const invalidateWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers", client?.id] });
    queryClient.invalidateQueries({
      queryKey: ["/api/firm/vat-workpapers/detail", selectedWorkpaperId],
    });
  };

  // The amount fields double as a calculator: typing e.g. "7800+1850" resolves to
  // 9650 on blur. Only rewrite when the value actually contains an expression so
  // plain numbers and half-typed entries are left alone.
  const normalizeAmountField = (
    field: "taxableAmount" | "vatAmount" | "grossAmount" | "adjustmentAmount"
  ) =>
    setRowForm((form) => {
      const value = String((form as Record<string, unknown>)[field] ?? "");
      if (!/\d\s*[+\-*/]/.test(value)) return form;
      const computed = evaluateAmountExpression(value);
      if (!Number.isFinite(computed) || computed === 0) return form;
      return { ...form, [field]: String(computed) };
    });

  const rowPayload = (overrides?: Partial<Pick<VatWorkpaperRow, "status" | "sourceMethod">>) => ({
    rowCategory: rowForm.rowCategory,
    vat201Box: rowForm.rowCategory === "manual_adjustment" ? rowForm.vat201Box : undefined,
    invoiceNumber: rowForm.invoiceNumber || null,
    documentDate: rowForm.documentDate || null,
    counterpartyName: rowForm.counterpartyName || null,
    counterpartyTrn: rowForm.counterpartyTrn || null,
    emirate: rowForm.emirate || null,
    taxableAmount: evaluateAmountExpression(rowForm.taxableAmount),
    vatAmount: evaluateAmountExpression(rowForm.vatAmount),
    adjustmentAmount: evaluateAmountExpression(rowForm.adjustmentAmount),
    grossAmount: evaluateAmountExpression(rowForm.grossAmount),
    status: overrides?.status ?? rowForm.status,
    sourceMethod: overrides?.sourceMethod ?? rowForm.sourceMethod,
    notes: rowForm.notes || null,
    auditReason: rowForm.auditReason || null,
  });

  const resetRowForm = () => {
    setEditingRowId(null);
    setRowForm((form) => ({
      ...form,
      status: "approved",
      sourceMethod: "manual",
      invoiceNumber: "",
      documentDate: todayInput(),
      counterpartyName: "",
      counterpartyTrn: "",
      taxableAmount: "",
      vatAmount: "",
      adjustmentAmount: "",
      grossAmount: "",
      notes: "",
      auditReason: "",
    }));
  };

  const editVatRow = (row: VatWorkpaperRow) => {
    setEditingRowId(row.id);
    setWorkspaceTab("grid");
    setRowForm({
      rowCategory: row.rowCategory,
      vat201Box: row.vat201Box || "box1bDubaiAmount",
      invoiceNumber: row.invoiceNumber ?? "",
      documentDate: inputDate(row.documentDate),
      counterpartyName: row.counterpartyName ?? "",
      counterpartyTrn: row.counterpartyTrn ?? "",
      emirate: row.emirate ?? client?.emirate ?? "dubai",
      taxableAmount: String(row.taxableAmount ?? ""),
      vatAmount: String(row.vatAmount ?? ""),
      adjustmentAmount: String(row.adjustmentAmount ?? ""),
      grossAmount: String(row.grossAmount ?? ""),
      notes: row.notes ?? "",
      auditReason: row.auditReason ?? "",
      status: row.status,
      sourceMethod: row.sourceMethod,
    });
  };

  const addRowMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`,
        rowPayload({
          status: "approved",
          sourceMethod: "manual",
        })
      ),
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotAddVatRow"), description: e?.message }),
  });

  const saveRowMutation = useMutation({
    mutationFn: () => {
      if (!editingRowId) throw new Error("Choose a VAT row to update first");
      return apiRequest(
        "PATCH",
        `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${editingRowId}`,
        rowPayload()
      );
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      toast({ title: tr("vatRowUpdated") });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotUpdateVatRow"), description: e?.message }),
  });

  const pastePreviewRows = useMemo(
    () => parseVatPasteRows(pastedVatRows, rowForm.emirate),
    [pastedVatRows, rowForm.emirate]
  );

  const importRowsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkpaperId) throw new Error("Create or select a VAT workpaper first");
      const rowsToImport = parseVatPasteRows(pastedVatRows, rowForm.emirate);
      if (rowsToImport.length === 0) throw new Error("Paste at least one VAT row");
      for (const row of rowsToImport) {
        await apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, row);
      }
      return rowsToImport.length;
    },
    onSuccess: (count: number) => {
      invalidateWorkspace();
      setPastedVatRows("");
      toast({
        title: tr("vatRowsImported"),
        description: tr.plural("rowsAddedAsApproved", count),
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotImportVatRows"),
        description: e?.message,
      }),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const uploadedEvidence = evidenceFile
        ? {
            fileDataBase64: await readFileAsBase64(evidenceFile),
            extractedText: await readEvidenceText(evidenceFile),
          }
        : null;

      return apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/scan`, {
        attachment: {
          fileName:
            evidenceFile?.name ||
            (rowForm.invoiceNumber ? `${rowForm.invoiceNumber}.scan` : "vat-evidence.scan"),
          mimeType: evidenceFile?.type || "application/octet-stream",
          fileDataBase64: uploadedEvidence?.fileDataBase64,
          extractedText: rowForm.notes || uploadedEvidence?.extractedText || null,
          extractionJson: {
            source: evidenceFile ? "uploaded_evidence" : "manual_ocr_review",
            originalSize: evidenceFile?.size,
            originalLastModified: evidenceFile
              ? new Date(evidenceFile.lastModified).toISOString()
              : undefined,
          },
        },
        draftRow: rowPayload({
          status: "draft",
          sourceMethod: "ocr",
        }),
      });
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      setEvidenceFile(null);
      setEvidenceInputKey((key) => key + 1);
      toast({ title: tr("ocrDraftRowLoggedForReview") });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotLogOcrDraft"), description: e?.message }),
  });

  const updateRowMutation = useMutation({
    mutationFn: ({ rowId, status }: { rowId: string; status: "approved" | "excluded" }) =>
      apiRequest("PATCH", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`, {
        status,
      }),
    onSuccess: invalidateWorkspace,
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotUpdateVatRow"), description: e?.message }),
  });

  const deleteRowMutation = useMutation({
    mutationFn: (rowId: string) =>
      apiRequest("DELETE", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`),
    onSuccess: (_data, rowId) => {
      invalidateWorkspace();
      if (editingRowId === rowId) resetRowForm();
      toast({ title: tr("vatRowDeleted") });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotDeleteVatRow"), description: e?.message }),
  });

  const postRowMutation = useMutation({
    mutationFn: (rowId: string) =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}/post`),
    onSuccess: () => {
      invalidateWorkspace();
      toast({
        title: tr("postedToLedger"),
        description: tr("thisEntryNowShowsInThe"),
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("couldNotPostToLedger"), description: e?.message }),
  });

  const recalculateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/recalculate`),
    onSuccess: invalidateWorkspace,
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotRecalculateVatWorkpaper"),
        description: e?.message,
      }),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/generate-return`),
    onSuccess: () => {
      invalidateWorkspace();
      toast({
        title: tr("vatReturnGeneratedForReview"),
        description: tr("noFtaSubmissionWasPerformed"),
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotGenerateVatReturn"),
        description: e?.message,
      }),
  });

  const detail = detailQuery.data;
  const rows = detail?.rows ?? [];
  const totals = detail?.totals ?? detail?.workpaper.totalsSnapshot ?? {};
  const draftRows = rows.filter((row) => row.status === "draft");
  const approvedRows = rows.filter((row) => row.status === "approved");
  const excludedRows = rows.filter((row) => row.status === "excluded");
  const sourceBackedRows = approvedRows.filter(
    (row) => row.sourceMethod !== "manual" || row.invoiceNumber || row.counterpartyName
  );
  const outputVat = Number(totals.box8TotalVat ?? 0);
  const inputVat = Number(totals.box11TotalVat ?? 0);
  const payableVat = Number(totals.box14PayableTax ?? 0);
  const attachments = detail?.attachments ?? [];
  const selectedSummary = workpapers.find((workpaper) => workpaper.id === selectedWorkpaperId);

  const downloadAttachment = async (attachment: VatWorkpaperAttachment) => {
    if (!selectedWorkpaperId || !attachment.filePath) {
      toast({
        variant: "destructive",
        title: tr("evidenceFileIsNotDownloadable"),
        description: tr("thisEvidenceRecordWasLoggedBefore"),
      });
      return;
    }

    try {
      const response = await fetch(
        apiUrl(
          `/api/firm/vat-workpapers/${selectedWorkpaperId}/attachments/${attachment.id}/download`
        ),
        {
          credentials: "include",
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("couldNotDownloadEvidence"),
        description: error?.message,
      });
    }
  };

  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const approveAllDraftsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/bulk-status`, {
        to: "approved",
      }),
    onSuccess: (result: { updated: number }) => {
      invalidateWorkspace();
      toast({
        title:
          result.updated > 0
            ? tr("draftRowsApproved", { updated: result.updated })
            : tr("noDraftRowsToApprove"),
        description: result.updated > 0 ? tr("totalsRecalculatedApprovedRowsNowFlow") : undefined,
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: tr("bulkApproveFailed"), description: e?.message }),
  });

  const pullFromBooksMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/pull-from-books`),
    onSuccess: (result: { created: number }) => {
      invalidateWorkspace();
      toast({
        title:
          result.created > 0
            ? tr("draftRowsPulledFromBooks", { created: result.created })
            : tr("booksAlreadyUpToDate"),
        description:
          result.created > 0
            ? tr("issuedInvoicesAndPostedReceiptsFor")
            : tr("everyDocumentInThisPeriodIs"),
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotPullFromBooks"),
        description: e?.message,
      }),
  });

  const importFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileDataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      return apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/import-file`, {
        fileName: file.name,
        fileDataBase64,
        defaultEmirate: rowForm.emirate,
      });
    },
    onSuccess: (result: { created: number }) => {
      invalidateWorkspace();
      toast({ title: tr("rowsImportedFromExcel", { created: result.created }) });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotImportWorkbook"),
        description: e?.message,
      }),
  });

  const downloadTemplate = async () => {
    try {
      const response = await fetch(apiUrl("/api/firm/vat-workpapers/template"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "muhasib-vat-workpaper-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("couldNotDownloadTemplate"),
        description: error?.message,
      });
    }
  };

  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const downloadWorkbook = async () => {
    if (!selectedWorkpaperId) return;
    setExportingWorkbook(true);
    try {
      const response = await fetch(
        apiUrl(`/api/firm/vat-workpapers/${selectedWorkpaperId}/export`),
        {
          credentials: "include",
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "vat-workpaper.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: tr("workpaperExported"),
        description: tr("excelCopySavedGridPlusCopy"),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("couldNotExportWorkpaper"),
        description: error?.message,
      });
    } finally {
      setExportingWorkbook(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client?.name ?? tr("vatSubmissionWorkspace")}</DialogTitle>
          <DialogDescription>{tr("bookkeeperVatWorkbookForInvoiceEntry")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="grid gap-1">
                <Label>{tr("periodStart")}</Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>{tr("periodEnd")}</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>{tr("dueDate")}</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>{tr("workpaper")}</Label>
                <Select value={selectedWorkpaperId ?? ""} onValueChange={setSelectedWorkpaperId}>
                  <SelectTrigger>
                    <SelectValue placeholder={tr("selectWorkpaper")} />
                  </SelectTrigger>
                  <SelectContent>
                    {workpapers.map((workpaper) => (
                      <SelectItem key={workpaper.id} value={workpaper.id}>
                        {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} ·{" "}
                        {workpaper.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!client || !periodStart || !periodEnd || createMutation.isPending}
              >
                <Plus className="w-4 h-4 me-2" />
                {tr("createOpen")}
              </Button>
              <Button
                variant="outline"
                onClick={() => recalculateMutation.mutate()}
                disabled={!selectedWorkpaperId || recalculateMutation.isPending}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => void downloadWorkbook()}
                disabled={!selectedWorkpaperId || exportingWorkbook}
                data-testid="button-export-workpaper"
              >
                <Download className="w-4 h-4 me-2" />
                {exportingWorkbook ? tr("exporting") : "Excel"}
              </Button>
              <Button
                variant="outline"
                onClick={() => pullFromBooksMutation.mutate()}
                disabled={!selectedWorkpaperId || pullFromBooksMutation.isPending}
                data-testid="button-pull-from-books"
              >
                <BookOpen className="w-4 h-4 me-2" />
                {pullFromBooksMutation.isPending ? tr("pulling") : tr("pullFromBooks")}
              </Button>
            </div>
          </div>

          {selectedSummary || detail ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("status")}</p>
                  <p className="font-semibold">
                    {detail?.workpaper.status ?? selectedSummary?.status}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("approvedRows")}</p>
                  <p className="font-semibold">{approvedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("draftExcluded")}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">
                      {draftRows.length} / {excludedRows.length}
                    </p>
                    {draftRows.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => approveAllDraftsMutation.mutate()}
                        disabled={approveAllDraftsMutation.isPending}
                        data-testid="button-approve-all-drafts"
                      >
                        <Check className="w-3 h-3 me-1" />
                        {tr("approveAll")}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("evidenceBacked")}</p>
                  <p className="font-semibold">{sourceBackedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("outputInputVat")}</p>
                  <p className="font-semibold">
                    {formatAed(outputVat)} / {formatAed(inputVat)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{tr("netPayable")}</p>
                  <p className="font-semibold">{formatAed(payableVat)}</p>
                </div>
              </div>

              <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="space-y-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="grid">{tr("entryGrid")}</TabsTrigger>
                  <TabsTrigger value="drafts">{tr("ocrDrafts")}</TabsTrigger>
                  <TabsTrigger value="return">{tr("vat201Review")}</TabsTrigger>
                  <TabsTrigger value="evidence">{tr("evidence")}</TabsTrigger>
                </TabsList>

                <TabsContent value="grid" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)] gap-4">
                    <div className="rounded-md border overflow-hidden">
                      <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">{tr("invoiceAndBillEntryGrid")}</p>
                          <p className="text-xs text-muted-foreground">
                            {tr("editRowsApproveDraftsExcludeMistakes")}
                          </p>
                        </div>
                        <Badge variant="outline">{tr.plural("rowsCount", rows.length)}</Badge>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-28">{tr("source")}</TableHead>
                              <TableHead className="min-w-36">{tr("invoice")}</TableHead>
                              <TableHead className="min-w-36">{tr("date")}</TableHead>
                              <TableHead className="min-w-56">{tr("customerVendor")}</TableHead>
                              <TableHead className="min-w-36">{tr("trn")}</TableHead>
                              <TableHead className="min-w-40">{tr("category")}</TableHead>
                              <TableHead className="min-w-32">{tr("emirate")}</TableHead>
                              <TableHead className="min-w-28 text-end">{tr("taxable")}</TableHead>
                              <TableHead className="min-w-28 text-end">{tr("vat")}</TableHead>
                              <TableHead className="min-w-28 text-end">{tr("gross")}</TableHead>
                              <TableHead className="min-w-32">{tr("status")}</TableHead>
                              <TableHead className="min-w-36 text-end sticky end-0 bg-background z-20 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                                {tr("actions")}
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow className="bg-background">
                              <TableCell>
                                <Badge variant={editingRowId ? "secondary" : "outline"}>
                                  {editingRowId ? tr("editing") : tr("newRow")}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  placeholder="INV-1001"
                                  value={rowForm.invoiceNumber}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      invoiceNumber: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  type="date"
                                  value={rowForm.documentDate}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      documentDate: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-48"
                                  placeholder={tr("customerVendor")}
                                  value={rowForm.counterpartyName}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      counterpartyName: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  placeholder={tr("trn")}
                                  value={rowForm.counterpartyTrn}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      counterpartyTrn: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowForm.rowCategory}
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      rowCategory: value as VatRowCategory,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 min-w-40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {vatRowCategories.map((category) => (
                                      <SelectItem key={category.value} value={category.value}>
                                        {category.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowForm.emirate}
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({ ...form, emirate: value }))
                                  }
                                >
                                  <SelectTrigger className="h-8 min-w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {vatEmirates.map((emirate) => (
                                      <SelectItem key={emirate.value} value={emirate.value}>
                                        {emirate.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-24 text-end"
                                  placeholder="0.00"
                                  value={rowForm.taxableAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      taxableAmount: e.target.value,
                                    }))
                                  }
                                  onBlur={() => normalizeAmountField("taxableAmount")}
                                  title={tr("tipYouCanTypeASum")}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-24 text-end"
                                  placeholder="0.00"
                                  value={rowForm.vatAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({ ...form, vatAmount: e.target.value }))
                                  }
                                  onBlur={() => normalizeAmountField("vatAmount")}
                                  title={tr("tipYouCanTypeASum")}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-24 text-end"
                                  placeholder="0.00"
                                  value={rowForm.grossAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({ ...form, grossAmount: e.target.value }))
                                  }
                                  onBlur={() => normalizeAmountField("grossAmount")}
                                  title={tr("tipYouCanTypeASum")}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowForm.status}
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      status: value as VatWorkpaperRow["status"],
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 min-w-28">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="approved">{tr("approved")}</SelectItem>
                                    <SelectItem value="draft">{tr("draft")}</SelectItem>
                                    <SelectItem value="excluded">{tr("excluded")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-end sticky end-0 bg-background z-10 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                                <div className="flex justify-end gap-1">
                                  {editingRowId ? (
                                    <Button
                                      size="sm"
                                      onClick={() => saveRowMutation.mutate()}
                                      disabled={!selectedWorkpaperId || saveRowMutation.isPending}
                                    >
                                      {tr("save")}
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={() => addRowMutation.mutate()}
                                      disabled={!selectedWorkpaperId || addRowMutation.isPending}
                                    >
                                      {tr("add")}
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={resetRowForm}>
                                    {tr("clear")}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {rows.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={12}
                                  className="text-sm text-muted-foreground text-center py-8"
                                >
                                  {tr("noVatRowsYetAddInvoice")}
                                </TableCell>
                              </TableRow>
                            ) : (
                              rows.map((row) => (
                                <TableRow
                                  key={row.id}
                                  className={editingRowId === row.id ? "bg-primary/5" : undefined}
                                >
                                  <TableCell>
                                    <Badge
                                      variant={row.sourceMethod === "ocr" ? "secondary" : "outline"}
                                    >
                                      {row.sourceMethod}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <p className="font-medium">{row.invoiceNumber || "—"}</p>
                                    <p className="text-xs text-muted-foreground">{row.vat201Box}</p>
                                  </TableCell>
                                  <TableCell>{formatDateShort(row.documentDate)}</TableCell>
                                  <TableCell>
                                    <p className="max-w-56 truncate">
                                      {row.counterpartyName || "—"}
                                    </p>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {row.counterpartyTrn || "—"}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {vatRowCategoryLabel(row.rowCategory)}
                                  </TableCell>
                                  <TableCell className="text-sm">{row.emirate || "—"}</TableCell>
                                  <TableCell className="text-end">
                                    {formatAed(Number(row.taxableAmount ?? 0))}
                                  </TableCell>
                                  <TableCell className="text-end">
                                    {formatAed(Number(row.vatAmount ?? 0))}
                                  </TableCell>
                                  <TableCell className="text-end">
                                    {formatAed(Number(row.grossAmount ?? 0))}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        row.status === "approved"
                                          ? "default"
                                          : row.status === "excluded"
                                            ? "outline"
                                            : "secondary"
                                      }
                                    >
                                      {row.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell
                                    className={`text-end sticky end-0 z-10 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)] ${
                                      editingRowId === row.id ? "bg-primary/5" : "bg-background"
                                    }`}
                                  >
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => editVatRow(row)}
                                      >
                                        {tr("edit")}
                                      </Button>
                                      {row.journalEntryId ? (
                                        <Badge
                                          variant="outline"
                                          className="gap-1 text-success border-success/40"
                                          title={tr("postedToTheGeneralLedger")}
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          {tr("posted")}
                                        </Badge>
                                      ) : row.sourceMethod === "manual" &&
                                        POSTABLE_VAT_CATEGORIES.includes(row.rowCategory) ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          title={tr("postThisSaleToTheLedger")}
                                          disabled={postRowMutation.isPending}
                                          onClick={() => postRowMutation.mutate(row.id)}
                                        >
                                          {tr("post")}
                                        </Button>
                                      ) : null}
                                      {row.status === "draft" ? (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label={tr("approve", {
                                              value: row.invoiceNumber || "draft VAT row",
                                            })}
                                            title={tr("approveDraftVatRow")}
                                            onClick={() =>
                                              updateRowMutation.mutate({
                                                rowId: row.id,
                                                status: "approved",
                                              })
                                            }
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            <span className="sr-only">{tr("approveDraftRow")}</span>
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label={tr("exclude", {
                                              value: row.invoiceNumber || "draft VAT row",
                                            })}
                                            title={tr("excludeDraftVatRow")}
                                            onClick={() =>
                                              updateRowMutation.mutate({
                                                rowId: row.id,
                                                status: "excluded",
                                              })
                                            }
                                          >
                                            <XCircle className="w-3.5 h-3.5" />
                                            <span className="sr-only">{tr("excludeDraftRow")}</span>
                                          </Button>
                                        </>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            updateRowMutation.mutate({
                                              rowId: row.id,
                                              status:
                                                row.status === "approved" ? "excluded" : "approved",
                                            })
                                          }
                                        >
                                          {row.status === "approved"
                                            ? tr("exclude2")
                                            : tr("approve2")}
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        aria-label={tr("delete", {
                                          value: row.invoiceNumber || "VAT row",
                                        })}
                                        title={tr("deleteThisRow")}
                                        disabled={deleteRowMutation.isPending}
                                        onClick={() => {
                                          if (window.confirm(tr("deleteThisVatRowThisRemoves"))) {
                                            deleteRowMutation.mutate(row.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="sr-only">{tr("deleteRow")}</span>
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-md border p-3 space-y-3">
                        <div>
                          <p className="font-medium">{tr("rowNotesAndOverrideReason")}</p>
                          <p className="text-xs text-muted-foreground">
                            {tr("manualAdjustmentsMustExplainTheAudit")}
                          </p>
                        </div>
                        {rowForm.rowCategory === "manual_adjustment" && (
                          <Input
                            placeholder={tr("vat201BoxEGBox9expensesvat")}
                            value={rowForm.vat201Box}
                            onChange={(e) =>
                              setRowForm((form) => ({ ...form, vat201Box: e.target.value }))
                            }
                          />
                        )}
                        <Input
                          placeholder={tr("adjustmentAmount")}
                          value={rowForm.adjustmentAmount}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, adjustmentAmount: e.target.value }))
                          }
                          onBlur={() => normalizeAmountField("adjustmentAmount")}
                          title={tr("tipYouCanTypeASum")}
                        />
                        <Textarea
                          placeholder={tr("notesOcrText")}
                          value={rowForm.notes}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, notes: e.target.value }))
                          }
                          className="min-h-24"
                        />
                        <Textarea
                          placeholder={tr("auditReasonForOverridesOrManual")}
                          value={rowForm.auditReason}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, auditReason: e.target.value }))
                          }
                          className="min-h-20"
                        />
                      </div>

                      <div className="rounded-md border p-3 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium">{tr("pasteRowsFromExcel")}</p>
                            <p className="text-xs text-muted-foreground">
                              {tr("headersAreSupportedCategoryInvoiceNumber")}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {tr("parsed", { pastePreviewRowsCount: pastePreviewRows.length })}
                          </Badge>
                        </div>
                        <Textarea
                          value={pastedVatRows}
                          onChange={(e) => setPastedVatRows(e.target.value)}
                          placeholder={
                            // i18n-ignore: sample rows use the English import column headers the parser recognises
                            "category\tinvoice number\tdate\tcustomer/vendor\tTRN\temirate\ttaxable amount\tVAT amount\tgross amount\tnotes\nstandard_expense\tBILL-1001\t2026-05-18\tSupplier LLC\t100123456700003\tdubai\t1000\t50\t1050\tMay receipt"
                          }
                          className="min-h-36 font-mono text-xs"
                          data-testid="textarea-vat-paste-rows"
                        />
                        {pastePreviewRows.length > 0 && (
                          <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                            {tr("preview")}
                            {pastePreviewRows
                              .slice(0, 3)
                              .map(
                                (row) =>
                                  `${row.invoiceNumber || "No invoice"} ${formatAed(row.taxableAmount)} + VAT ${formatAed(row.vatAmount)}`
                              )
                              .join(" · ")}
                            {pastePreviewRows.length > 3
                              ? tr("more", { value: pastePreviewRows.length - 3 })
                              : ""}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => importRowsMutation.mutate()}
                            disabled={
                              !selectedWorkpaperId ||
                              pastePreviewRows.length === 0 ||
                              importRowsMutation.isPending
                            }
                          >
                            <Upload className="w-4 h-4 me-2" />
                            {tr("addPastedRows")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadTemplate()}
                            data-testid="button-vat-template"
                          >
                            <Download className="w-4 h-4 me-2" />
                            {tr("excelTemplate")}
                          </Button>
                          <input
                            ref={importFileInputRef}
                            type="file"
                            accept=".xlsx"
                            className="hidden"
                            data-testid="input-vat-import-file"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) importFileMutation.mutate(file);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => importFileInputRef.current?.click()}
                            disabled={!selectedWorkpaperId || importFileMutation.isPending}
                            data-testid="button-vat-import-file"
                          >
                            <Upload className="w-4 h-4 me-2" />
                            {importFileMutation.isPending ? tr("importing") : tr("importXlsx")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="drafts" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
                    <div className="rounded-md border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{tr("uploadInvoiceOrReceiptEvidence")}</p>
                          <p className="text-xs text-muted-foreground">
                            {tr("uploadedFilesCreateDraftOcrRows")}
                          </p>
                        </div>
                        {evidenceFile ? (
                          <Badge variant="secondary">
                            {(evidenceFile.size / 1024).toFixed(1)} KB
                          </Badge>
                        ) : null}
                      </div>
                      <Input
                        key={evidenceInputKey}
                        id="vat-evidence-upload"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,application/json"
                        onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
                        data-testid="input-vat-evidence-upload"
                      />
                      {evidenceFile ? (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                          <span className="truncate">{evidenceFile.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEvidenceFile(null);
                              setEvidenceInputKey((key) => key + 1);
                            }}
                          >
                            {tr("remove")}
                          </Button>
                        </div>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => scanMutation.mutate()}
                        disabled={!selectedWorkpaperId || scanMutation.isPending}
                      >
                        <ScanLine className="w-4 h-4 me-2" />
                        {tr("logOcrDraft")}
                      </Button>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="border-b bg-muted/30 px-3 py-2">
                        <p className="font-medium">{tr("draftReviewQueue")}</p>
                        <p className="text-xs text-muted-foreground">
                          {tr("approveOnlyAfterTheBookkeeperHas")}
                        </p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("invoice")}</TableHead>
                            <TableHead>{tr("counterparty")}</TableHead>
                            <TableHead>{tr("category")}</TableHead>
                            <TableHead className="text-end">{tr("vat")}</TableHead>
                            <TableHead className="text-end">{tr("review")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draftRows.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-sm text-muted-foreground text-center py-8"
                              >
                                {tr("noOcrDraftsWaitingForReview")}
                              </TableCell>
                            </TableRow>
                          ) : (
                            draftRows.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>{row.invoiceNumber || "—"}</TableCell>
                                <TableCell>{row.counterpartyName || "—"}</TableCell>
                                <TableCell>{vatRowCategoryLabel(row.rowCategory)}</TableCell>
                                <TableCell className="text-end">
                                  {formatAed(Number(row.vatAmount ?? 0))}
                                </TableCell>
                                <TableCell className="text-end">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => editVatRow(row)}
                                    >
                                      {tr("edit")}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        updateRowMutation.mutate({
                                          rowId: row.id,
                                          status: "approved",
                                        })
                                      }
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        updateRowMutation.mutate({
                                          rowId: row.id,
                                          status: "excluded",
                                        })
                                      }
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      aria-label={tr("delete", {
                                        value: row.invoiceNumber || "draft VAT row",
                                      })}
                                      title={tr("deleteThisDraftRow")}
                                      disabled={deleteRowMutation.isPending}
                                      onClick={() => {
                                        if (window.confirm(tr("deleteThisDraftRowThisRemoves"))) {
                                          deleteRowMutation.mutate(row.id);
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="return" className="space-y-4 mt-0">
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">{tr("ftaVat201CopyFields")}</p>
                        <p className="text-xs text-muted-foreground">
                          {tr("approvedRowsAreAggregatedBelowCopy")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => recalculateMutation.mutate()}
                          disabled={!selectedWorkpaperId || recalculateMutation.isPending}
                        >
                          <RefreshCw className="w-4 h-4 me-2" />
                          {tr("recalculate")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => generateMutation.mutate()}
                          disabled={!selectedWorkpaperId || generateMutation.isPending}
                        >
                          <FileText className="w-4 h-4 me-2" />
                          {tr("generateReturn")}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      {vat201CopyGroups.map((group) => (
                        <div key={group.title} className="rounded-md border bg-background p-3">
                          <p className="text-sm font-semibold mb-2">{group.title}</p>
                          <div className="grid gap-2">
                            {group.fields.map(([key, label]) => {
                              const value = Number(totals[key] ?? 0).toFixed(2);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => copyText(value)}
                                  className="rounded-md border p-2 text-start hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{label}</span>
                                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                                  </div>
                                  <p className="font-semibold mt-1">{value}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="evidence" className="space-y-4 mt-0">
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{tr("evidenceFiles")}</p>
                        <p className="text-xs text-muted-foreground">
                          {tr("uploadedInvoicesAndReceiptsStayLinked")}
                        </p>
                      </div>
                      <Badge variant="outline">{tr.plural("filesCount", attachments.length)}</Badge>
                    </div>
                    {attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {tr("noInvoiceEvidenceUploadedYet")}
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {attachment.mimeType || tr("file")} ·{" "}
                                {formatDateShort(attachment.createdAt)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void downloadAttachment(attachment)}
                              disabled={!attachment.filePath}
                            >
                              {tr("download")}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              {tr("createAVatWorkpaperToStart")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VatStatusBadge({ vatStatus }: { vatStatus: ClientWithStats["vatStatus"] }) {
  const tr = pageMessages.useT();

  if (!vatStatus) return <Badge variant="outline">{tr("noVat")}</Badge>;
  const due = new Date(vatStatus.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (vatStatus.status === "filed" || vatStatus.status === "submitted") {
    return (
      <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
        {tr("filed")}
      </Badge>
    );
  }
  if (daysUntilDue < 0) {
    return <Badge variant="destructive">{tr("overdue")}</Badge>;
  }
  if (daysUntilDue <= 14) {
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
        {tr("due2", { format: format(due, "MMM d") })}
      </Badge>
    );
  }
  return <Badge variant="outline">{tr("due2", { format: format(due, "MMM d") })}</Badge>;
}

function StatusBadge({ active }: { active: boolean }) {
  const tr = pageMessages.useT();

  return active ? (
    <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30">
      {tr("active2")}
    </Badge>
  ) : (
    <Badge variant="secondary">{tr("inactive")}</Badge>
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
  serviceScope: ClientServiceCode[];
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
  vatPeriodStartMonth: "auto",
  fiscalYearStartMonth: "1",
  corporateTaxId: "",
  serviceScope: [...DEFAULT_CLIENT_SERVICE_CODES],
};

type QuickFilter =
  | "all"
  | "critical"
  | "attention"
  | "vat-due"
  | "vat-group-1"
  | "vat-group-2"
  | "vat-group-3"
  | "close-blocked"
  | "unassigned"
  | "no-docs";

const getVatGroupFilters = (): Array<{
  filter: QuickFilter;
  cohortKey: string;
  periodStartMonth: number;
  label: string;
}> => [
  {
    filter: "vat-group-1",
    cohortKey: "jan_apr_jul_oct",
    periodStartMonth: 1,
    label: pageMessages.t("group1"),
  },
  {
    filter: "vat-group-2",
    cohortKey: "feb_may_aug_nov",
    periodStartMonth: 2,
    label: pageMessages.t("group2"),
  },
  {
    filter: "vat-group-3",
    cohortKey: "mar_jun_sep_dec",
    periodStartMonth: 3,
    label: pageMessages.t("group3"),
  },
];

const vatGroupFilterByQuickFilter = new Map(
  getVatGroupFilters().map((filter) => [filter.filter, filter])
);

export default function ClientPortfolio() {
  const tr = pageMessages.useT();

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
  const [vatWorkspaceClientId, setVatWorkspaceClientId] = useState<string | null>(null);
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

  const vatWorkspaceClient = useMemo(() => {
    return vatWorkspaceClientId
      ? clients.find((client) => client.id === vatWorkspaceClientId)
      : undefined;
  }, [clients, vatWorkspaceClientId]);

  const vatWorkspaceOps = useMemo(() => {
    return vatWorkspaceClientId ? bookkeeperByClientId.get(vatWorkspaceClientId) : undefined;
  }, [bookkeeperByClientId, vatWorkspaceClientId]);

  const createMutation = useMutation({
    mutationFn: (data: AddClientFormData) => apiRequest("POST", "/api/firm/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: tr("clientCreatedSuccessfully") });
      setAddOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: tr("failedToCreateClient"), description: e?.message });
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
        title: tr("couldNotOpenClientBooks"),
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
        title: tr("importedClients", { createdCount: result.created.length }),
        description:
          result.errors.length > 0
            ? tr("errorsSeeDetails", { errorsCount: result.errors.length })
            : undefined,
      });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: tr("importFailed"), description: e?.message });
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
            ? hasClientService(ops, "vat") &&
                ops.vat.status !== "filed" &&
                ops.vat.daysTilDue !== null &&
                ops.vat.daysTilDue <= 28
            : hasClientService(c, "vat") && vatDueSoon(c);
        case "vat-group-1":
        case "vat-group-2":
        case "vat-group-3": {
          const groupFilter = vatGroupFilterByQuickFilter.get(quickFilter);
          if (!groupFilter) return true;
          return ops
            ? hasClientService(ops, "vat") && ops.vat.cohortKey === groupFilter.cohortKey
            : hasClientService(c, "vat") && c.vatPeriodStartMonth === groupFilter.periodStartMonth;
        }
        case "close-blocked":
          return ops
            ? hasClientService(ops, "bookkeeping") && ops.bookkeeping.status !== "on_track"
            : false;
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
        <div className="text-muted-foreground">{tr("loadingClientPortfolio")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{tr("clientPortfolio")}</h1>
          <p className="text-muted-foreground mt-1">
            {tr.plural("clientsManagedByNra", clients.length)}
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
            <Upload className="w-4 h-4 me-2" />
            {tr("importClients")}
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-client">
            <Plus className="w-4 h-4 me-2" />
            {tr("addClient")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-total-clients">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("totalClients")}
              </p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold mt-1">{overview?.totalClients ?? clients.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-vat-due">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("vatDue30d")}
              </p>
              <Calendar className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{overview?.vatDueThisMonth ?? 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-overdue-ar">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("overdueAr")}
              </p>
              <Receipt className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-2xl font-bold mt-1">{formatAed(overview?.overdueAr ?? 0)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-attention">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {tr("needsAttention")}
              </p>
              <AlertTriangle className="w-4 h-4 text-warning" />
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

      <RevenueGrowthPanel onOpenClient={handleViewProfile} />

      <VatWorkspacePanel
        dashboard={bookkeeperDashboard}
        clients={clients}
        onOpenWorkspace={setVatWorkspaceClientId}
      />

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={quickFilter === "all" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("all")}
        >
          {tr("all", { clientsCount: clients.length })}
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "critical" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("critical")}
          data-testid="filter-critical"
        >
          <AlertTriangle className="w-3.5 h-3.5 me-1.5" />
          {tr("critical3")}
          {bookkeeperDashboard?.summary.critical ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "attention" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("attention")}
          data-testid="filter-attention"
        >
          <AlertTriangle className="w-3.5 h-3.5 me-1.5" />
          {tr("needsAttention2")}
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
          <Calendar className="w-3.5 h-3.5 me-1.5" />
          {tr("vatDueSoon")}
          {bookkeeperDashboard?.summary.vatDue28Days ?? 0})
        </Button>
        {getVatGroupFilters().map((group) => {
          const cohort = bookkeeperDashboard?.vatCohorts?.find(
            (candidate) => candidate.key === group.cohortKey
          );
          return (
            <Button
              key={group.filter}
              size="sm"
              variant={quickFilter === group.filter ? "secondary" : "outline"}
              onClick={() => setQuickFilter(group.filter)}
              data-testid={`filter-${group.filter}`}
            >
              <Calendar className="w-3.5 h-3.5 me-1.5" />
              {group.label} ({cohort?.clientCount ?? 0})
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={quickFilter === "close-blocked" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("close-blocked")}
          data-testid="filter-close-blocked"
        >
          <TrendingUp className="w-3.5 h-3.5 me-1.5" />
          {tr("closeBlocked3")}
          {bookkeeperDashboard?.summary.bookkeepingBlocked ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "unassigned" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("unassigned")}
          data-testid="filter-unassigned"
        >
          <UserCheck className="w-3.5 h-3.5 me-1.5" />
          {tr("unassigned3")}
          {bookkeeperDashboard?.workload?.unassignedClients ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "no-docs" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("no-docs")}
          data-testid="filter-no-docs"
        >
          <FolderOpen className="w-3.5 h-3.5 me-1.5" />
          {tr("missingDocuments")}
        </Button>
      </div>

      {/* Search & view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={tr("searchByNameOrTrn")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
            data-testid="input-client-search"
          />
        </div>
        <div className="flex border rounded-md ms-auto">
          <Button
            variant={view === "card" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-e-none"
            onClick={() => setView("card")}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-s-none"
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
            {clients.length === 0 ? tr("noClientsYet2") : tr("noClientsMatchYourFilters")}
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? tr("addYourFirstClientCompanyTo")
              : tr("tryAdjustingYourSearchOrQuick")}
          </p>
          {clients.length === 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 me-2" />
              {tr("addFirstClient")}
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
                {tr("portfolioProductionMatrix")}
              </CardTitle>
              <Badge variant="outline">{tr("shown", { filteredCount: filtered.length })}</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("client")}</TableHead>
                  <TableHead>{tr("owner")}</TableHead>
                  <TableHead>{tr("services")}</TableHead>
                  <TableHead>{tr("priority")}</TableHead>
                  <TableHead>{tr("vat")}</TableHead>
                  <TableHead>{tr("corporateTax")}</TableHead>
                  <TableHead>{tr("close")}</TableHead>
                  <TableHead>{tr("nextAction")}</TableHead>
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
                          className="font-medium text-start hover:underline"
                        >
                          {client.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {client.trnVatNumber || tr("noTrn")}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops
                          ? ownerPreview(ops.assignedStaff.map((staff) => staff.name))
                          : ownerPreview(client.assignedStaff.map((staff) => staff.name))}
                      </TableCell>
                      <TableCell>
                        <ServiceScopeBadges
                          services={ops?.serviceScope ?? client.serviceScope}
                          compact
                        />
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
                        {ops && hasClientService(ops, "vat") ? (
                          <div>
                            <span>
                              {formatDateShort(ops.vat.dueDate)} · {formatDays(ops.vat.daysTilDue)}
                            </span>
                            <p className="text-xs text-muted-foreground">{ops.vat.cohortLabel}</p>
                          </div>
                        ) : (
                          <Badge variant="outline">{tr("notScoped")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops && hasClientService(ops, "corporate_tax")
                          ? `${formatDateShort(ops.corporateTax.dueDate)} · ${formatDays(ops.corporateTax.daysTilDue)}`
                          : tr("notScoped")}
                      </TableCell>
                      <TableCell>
                        {ops && hasClientService(ops, "bookkeeping") ? (
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
                          tr("notScoped")
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2 min-w-64">
                          <p className="text-sm text-muted-foreground truncate">
                            {ops?.nextBestAction ?? tr("openClientProfile")}
                          </p>
                          <div className="flex gap-1">
                            {ops && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setBriefClientId(client.id)}
                              >
                                {tr("brief")}
                              </Button>
                            )}
                            {(!ops || hasClientService(ops, "vat")) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setVatWorkspaceClientId(client.id)}
                              >
                                {tr("vat")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenBooks(client.id)}
                              disabled={switchMutation.isPending}
                            >
                              <BookOpen className="w-3.5 h-3.5 me-1" />
                              {tr("open")}
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
                {tr("showingTheFirst12ClientsFor")}
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
                        {client.trnVatNumber
                          ? tr("trn2", { trnVatNumber: client.trnVatNumber })
                          : tr("noTrnRegistered")}
                      </p>
                      <div className="mt-2">
                        <ServiceScopeBadges
                          services={ops?.serviceScope ?? client.serviceScope}
                          compact
                        />
                      </div>
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
                          <p className="text-xs text-muted-foreground">{tr("nextAction2")}</p>
                          <p className="text-sm font-medium truncate">{ops.nextBestAction}</p>
                        </div>
                        <span className="text-xs font-medium shrink-0">
                          {tr("close2", { closeProgress: ops.bookkeeping.closeProgress })}
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
                      <p className="text-xs text-muted-foreground">{tr("outstandingAr")}</p>
                      <p className="font-semibold text-sm mt-0.5">
                        {formatAed(client.outstandingAr)}
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">{tr("invoices")}</p>
                      <p className="font-semibold text-sm mt-0.5">{client.invoiceCount}</p>
                    </div>
                  </div>

                  {/* VAT status */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {tr("vatStatus")}
                    </span>
                    {ops && hasClientService(ops, "vat") ? (
                      <PriorityBadge priority={ops.vat.status} />
                    ) : (
                      <Badge variant="outline">{tr("notScoped")}</Badge>
                    )}
                  </div>

                  {ops && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>
                        {hasClientService(ops, "vat")
                          ? `${ops.vat.cohortLabel} · ${formatDays(ops.vat.daysTilDue)}`
                          : tr("vatNotScoped")}
                      </span>
                      <span>
                        {hasClientService(ops, "corporate_tax")
                          ? tr("ct3", { formatDays: formatDays(ops.corporateTax.daysTilDue) })
                          : tr("ctNotScoped")}
                      </span>
                    </div>
                  )}

                  {/* Last activity */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{tr("lastReceipt")}</span>
                    <span>
                      {client.lastReceiptDate
                        ? format(new Date(client.lastReceiptDate), "MMM d, yyyy")
                        : tr("never")}
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
                        {tr("brief")}
                      </Button>
                    )}
                    {(!ops || hasClientService(ops, "vat")) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVatWorkspaceClientId(client.id)}
                      >
                        {tr("vat")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenBooks(client.id)}
                      disabled={switchMutation.isPending}
                      data-testid={`button-open-books-${client.id}`}
                    >
                      <BookOpen className="w-3.5 h-3.5 me-1.5" />
                      {tr("openBooks")}
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
                <TableHead>{tr("client")}</TableHead>
                <TableHead>{tr("services")}</TableHead>
                <TableHead>{tr("trn")}</TableHead>
                <TableHead>{tr("outstandingAr")}</TableHead>
                <TableHead>{tr("invoices")}</TableHead>
                <TableHead>{tr("vatStatus")}</TableHead>
                <TableHead>{tr("close")}</TableHead>
                <TableHead>{tr("owner")}</TableHead>
                <TableHead className="text-end">{tr("actions")}</TableHead>
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
                          {ops?.nextBestAction ?? client.industry ?? tr("openProfileForDetails")}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ServiceScopeBadges
                        services={ops?.serviceScope ?? client.serviceScope}
                        compact
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.trnVatNumber || "—"}
                    </TableCell>
                    <TableCell className="font-medium">{formatAed(client.outstandingAr)}</TableCell>
                    <TableCell>{client.invoiceCount}</TableCell>
                    <TableCell>
                      {ops && hasClientService(ops, "vat") ? (
                        <div className="space-y-1">
                          <PriorityBadge priority={ops.vat.status} />
                          <p className="text-xs text-muted-foreground">{ops.vat.cohortLabel}</p>
                        </div>
                      ) : (
                        <Badge variant="outline">{tr("notScoped")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ops && hasClientService(ops, "bookkeeping")
                        ? tr("close2", { closeProgress: ops.bookkeeping.closeProgress })
                        : !ops && client.lastReceiptDate
                          ? format(new Date(client.lastReceiptDate), "MMM d, yyyy")
                          : tr("notScoped")}
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
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {ops && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setBriefClientId(client.id)}
                          >
                            {tr("brief")}
                          </Button>
                        )}
                        {(!ops || hasClientService(ops, "vat")) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVatWorkspaceClientId(client.id)}
                          >
                            {tr("vat")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleOpenBooks(client.id)}
                          disabled={switchMutation.isPending}
                        >
                          <BookOpen className="w-3.5 h-3.5 me-1" />
                          {tr("open")}
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
            <DialogTitle>{tr("addNewClient")}</DialogTitle>
            <DialogDescription>{tr("createANewClientCompanyA")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">{tr("companyName")}</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={tr("alMajidTradingLlc")}
              />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <Label>{tr("nrServicesForThisClient")}</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr("chooseOnlyTheServicesNraIs")}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CLIENT_SERVICE_OPTIONS.map((option) => (
                  <label
                    key={option.code}
                    className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={form.serviceScope.includes(option.code)}
                      onCheckedChange={(checked) => {
                        setForm((current) => {
                          const serviceScope = checked
                            ? Array.from(new Set([...current.serviceScope, option.code]))
                            : current.serviceScope.filter((service) => service !== option.code);
                          return {
                            ...current,
                            serviceScope:
                              serviceScope.length > 0 ? serviceScope : current.serviceScope,
                          };
                        });
                      }}
                    />
                    <span>
                      <span className="font-medium block">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trn">{tr("trnVatNumber")}</Label>
                <Input
                  id="trn"
                  value={form.trnVatNumber}
                  onChange={(e) => setForm((f) => ({ ...f, trnVatNumber: e.target.value }))}
                  placeholder="100234567890003"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="emirate">{tr("emirate")}</Label>
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
                <Label htmlFor="legalStructure">{tr("legalStructure")}</Label>
                <Select
                  value={form.legalStructure}
                  onValueChange={(v) => setForm((f) => ({ ...f, legalStructure: v }))}
                >
                  <SelectTrigger id="legalStructure">
                    <SelectValue placeholder={tr("select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="Sole Proprietorship">{tr("soleProprietorship")}</SelectItem>
                    <SelectItem value="Partnership">{tr("partnership")}</SelectItem>
                    <SelectItem value="Corporation">{tr("corporation")}</SelectItem>
                    <SelectItem value="Free Zone">{tr("freeZone")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="vatFrequency">{tr("vatFrequency")}</Label>
                <Select
                  value={form.vatFilingFrequency}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatFilingFrequency: v }))}
                >
                  <SelectTrigger id="vatFrequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{tr("monthly")}</SelectItem>
                    <SelectItem value="quarterly">{tr("quarterly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="vatCloseGroup">{tr("vatCloseGroup")}</Label>
                <Select
                  value={form.vatPeriodStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatPeriodStartMonth: v }))}
                >
                  <SelectTrigger id="vatCloseGroup">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{tr("autoFromNrClientGroup")}</SelectItem>
                    <SelectItem value="11">{tr("janAprJulOct")}</SelectItem>
                    <SelectItem value="12">{tr("febMayAugNov")}</SelectItem>
                    <SelectItem value="1">{tr("marJunSepDec")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fiscalYearStart">{tr("financialYearStart")}</Label>
                <Select
                  value={form.fiscalYearStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, fiscalYearStartMonth: v }))}
                >
                  <SelectTrigger id="fiscalYearStart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{tr("january")}</SelectItem>
                    <SelectItem value="2">{tr("february")}</SelectItem>
                    <SelectItem value="3">{tr("march")}</SelectItem>
                    <SelectItem value="4">{tr("april")}</SelectItem>
                    <SelectItem value="5">{tr("may")}</SelectItem>
                    <SelectItem value="6">{tr("june")}</SelectItem>
                    <SelectItem value="7">{tr("july")}</SelectItem>
                    <SelectItem value="8">{tr("august")}</SelectItem>
                    <SelectItem value="9">{tr("september")}</SelectItem>
                    <SelectItem value="10">{tr("october")}</SelectItem>
                    <SelectItem value="11">{tr("november")}</SelectItem>
                    <SelectItem value="12">{tr("december")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="industry">{tr("industry")}</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                placeholder={tr("tradingConstructionRetail")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="corporateTaxId">{tr("corporateTaxRegistration")}</Label>
              <Input
                id="corporateTaxId"
                value={form.corporateTaxId}
                onChange={(e) => setForm((f) => ({ ...f, corporateTaxId: e.target.value }))}
                placeholder="CT-1002345678"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="contactEmail">{tr("email")}</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="info@company.ae"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactPhone">{tr("phone")}</Label>
                <Input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+971 4 123 4567"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessAddress">{tr("businessAddress")}</Label>
              <Input
                id="businessAddress"
                value={form.businessAddress}
                onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))}
                placeholder={tr("office301BusinessBayDubai")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-create-client"
            >
              {createMutation.isPending ? tr("creating") : tr("createClient")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Clients Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("importClients")}</DialogTitle>
            <DialogDescription>{tr("uploadACsvOrExcelFile")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">{tr("csvXlsxFile")}</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null);
                  setImportResult(null);
                }}
              />
              <p className="text-xs text-muted-foreground">{tr("upTo500RowsPerUpload")}</p>
            </div>
            {importResult && (
              <div className="rounded border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{tr("imported")}</span>
                  <span className="text-success">{importResult.created.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{tr("errors")}</span>
                  <span className={importResult.errors.length > 0 ? "text-destructive" : ""}>
                    {importResult.errors.length}
                  </span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-auto text-xs text-muted-foreground space-y-1">
                    {importResult.errors.slice(0, 20).map((e, i) => (
                      <div key={i}>
                        {tr("row", { row: e.row })}
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
              {tr("close")}
            </Button>
            <Button
              onClick={() => importFile && importMutation.mutate(importFile)}
              disabled={!importFile || importMutation.isPending}
              data-testid="button-import-clients"
            >
              <Upload className="w-4 h-4 me-2" />
              {importMutation.isPending ? tr("importing2") : tr("import")}
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
      <VatWorkspaceDialog
        client={vatWorkspaceClient}
        ops={vatWorkspaceOps}
        open={!!vatWorkspaceClientId}
        onOpenChange={(open) => !open && setVatWorkspaceClientId(null)}
      />
    </div>
  );
}
