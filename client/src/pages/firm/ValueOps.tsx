import { PageHeader } from "@/components/ui/page-header";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileArchive,
  FileText,
  Gauge,
  Landmark,
  MessageCircle,
  PackageOpen,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UploadCloud,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { messages as pageMessages } from "./ValueOps.i18n";

type Priority = "critical" | "high" | "medium" | "low";
type ValueLane =
  | "audit_defense"
  | "bank_close"
  | "penalty_prevention"
  | "cash_recovery"
  | "nra_profitability"
  | "compliance_risk"
  | "ai_review"
  | "whatsapp_cockpit"
  | "monthly_cfo_pack"
  | "migration_concierge";
type ReviewItemKind =
  | "bank_match"
  | "receipt_posting"
  | "anomaly"
  | "vat_review"
  | "trial_balance"
  | "document_request";

interface ValueOpsClient {
  companyId: string;
  companyName: string;
  trn: string | null;
  scores: {
    auditDefense: number;
    closeReadiness: number;
    penaltyRisk: number;
    complianceRisk: number;
    migrationReadiness: number;
  };
  money: {
    revenue90d: number;
    expenses90d: number;
    net90d: number;
    overdueAr: number;
    openAr: number;
    vatPayable: number;
    nraMonthlyFee: number;
    nraServiceAr: number;
  };
  workload: {
    missingDocuments: number;
    overdueDocuments: number;
    unpostedReceipts: number;
    unreconciledBankTransactions: number;
    anomalyCount: number;
    reviewerQueueItems: number;
    whatsappQueueItems: number;
  };
  status: {
    latestVatStatus: string | null;
    vatDueDate: string | null;
    daysToVatDue: number | null;
    hasBankFeedData: boolean;
    hasArchivedReturn: boolean;
    onboardingCompleted: boolean;
  };
}

interface ValueOpsOpportunity {
  lane: ValueLane;
  title: string;
  valueMetric: string;
  count: number;
  impactAed: number;
  topClient: string | null;
}

interface ValueOpsAction {
  id: string;
  lane: ValueLane;
  priority: Priority;
  companyId: string;
  companyName: string;
  title: string;
  detail: string;
  impactAed: number;
  href: string;
}

interface FirmReviewItem {
  id: string;
  kind: ReviewItemKind;
  priority: Priority;
  companyId: string;
  companyName: string;
  entityId: string;
  entityType: string;
  title: string;
  explanation: string;
  suggestedAction: string;
  confidence: number;
  amountAed: number;
  dueDate: string | null;
  href: string;
}

interface ValueOpsDashboard {
  summary: {
    totalClients: number;
    cashAtRisk: number;
    penaltyRiskClients: number;
    auditPacksReady: number;
    closeReadyClients: number;
    reviewerQueueItems: number;
    whatsappQueueItems: number;
    projectedNraMonthlyRevenue: number;
    nraServiceAr: number;
    migrationBlockers: number;
  };
  opportunities: ValueOpsOpportunity[];
  actions: ValueOpsAction[];
  clients: ValueOpsClient[];
}

interface ClientAuditPack {
  company: { id: string; name: string; trn: string | null };
  vatReturn: {
    status: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    payableTax: number;
    ftaReferenceNumber: string | null;
  } | null;
  evidence: Array<{
    label: string;
    status: "ready" | "attention" | "missing";
    count: number;
    detail: string;
  }>;
  reviewerNotes: string[];
}

interface ClientCfoPack {
  company: { id: string; name: string; trn: string | null };
  period: { start: string; end: string };
  metrics: {
    revenue: number;
    expenses: number;
    net: number;
    openAr: number;
    overdueAr: number;
    vatPayable: number;
  };
  narrative: string[];
  nextActions: string[];
}

const getLaneConfig = (): Record<ValueLane, { label: string; icon: typeof ShieldCheck }> => ({
  audit_defense: { label: pageMessages.t("auditDefense"), icon: ShieldCheck },
  bank_close: { label: pageMessages.t("bankClose"), icon: Landmark },
  penalty_prevention: { label: pageMessages.t("penaltyPrevention"), icon: AlertTriangle },
  cash_recovery: { label: pageMessages.t("cashRecovery"), icon: Banknote },
  nra_profitability: { label: pageMessages.t("nraProfitability"), icon: BriefcaseBusiness },
  compliance_risk: { label: pageMessages.t("complianceRisk"), icon: ClipboardCheck },
  ai_review: { label: pageMessages.t("aiReview"), icon: Bot },
  whatsapp_cockpit: { label: pageMessages.t("whatsappCockpit"), icon: MessageCircle },
  monthly_cfo_pack: { label: pageMessages.t("cfoPack"), icon: FileText },
  migration_concierge: { label: pageMessages.t("migrationConcierge"), icon: UploadCloud },
});

const getReviewKindConfig = (): Record<
  ReviewItemKind,
  { label: string; icon: typeof ShieldCheck }
> => ({
  bank_match: { label: pageMessages.t("bankMatch"), icon: Landmark },
  receipt_posting: { label: pageMessages.t("receiptPosting"), icon: FileText },
  anomaly: { label: pageMessages.t("anomaly"), icon: AlertTriangle },
  vat_review: { label: pageMessages.t("vatReview"), icon: ClipboardCheck },
  trial_balance: { label: pageMessages.t("trialBalance"), icon: Gauge },
  document_request: { label: pageMessages.t("documentRequest"), icon: MessageCircle },
});

function formatAed(value: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-AE", { dateStyle: "medium" }).format(new Date(value));
}

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function priorityClass(priority: Priority): string {
  switch (priority) {
    case "critical":
      return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
    case "high":
      return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
    case "medium":
      return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
    case "low":
      return "bg-muted text-foreground border-border";
  }
}

function evidenceClass(status: ClientAuditPack["evidence"][number]["status"]): string {
  switch (status) {
    case "ready":
      return "bg-success-subtle text-success-subtle-foreground border-success/30";
    case "attention":
      return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
    case "missing":
      return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
  }
}

function ScoreBar({
  label,
  value,
  inverse = false,
}: {
  label: string;
  value: number;
  inverse?: boolean;
}) {
  const risk = inverse ? 100 - value : value;
  const color = risk >= 75 ? "text-destructive" : risk >= 50 ? "text-warning" : "text-success";
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${color}`}>{value}</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: typeof Gauge;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function ValueOps() {
  const tr = pageMessages.useT();

  const [location, navigate] = useLocation();
  const [selectedPack, setSelectedPack] = useState<{
    companyId: string;
    type: "audit" | "cfo";
  } | null>(null);

  const dashboardQuery = useQuery<ValueOpsDashboard>({
    queryKey: ["/api/firm/value-ops"],
  });

  const reviewQueueQuery = useQuery<FirmReviewItem[]>({
    queryKey: ["/api/firm/value-ops/review-queue"],
  });

  useEffect(() => {
    const [, queryString] = location.split("?");
    const client = new URLSearchParams(queryString ?? "").get("client");
    if (client) setSelectedPack({ companyId: client, type: "audit" });
  }, [location]);

  const selectedClient = useMemo(
    () =>
      dashboardQuery.data?.clients.find((client) => client.companyId === selectedPack?.companyId) ??
      null,
    [dashboardQuery.data?.clients, selectedPack?.companyId]
  );

  const auditPackQuery = useQuery<ClientAuditPack>({
    queryKey: ["/api/firm/value-ops/audit-pack", selectedPack?.companyId],
    queryFn: () =>
      apiRequest("GET", `/api/firm/value-ops/clients/${selectedPack?.companyId}/audit-pack`),
    enabled: selectedPack?.type === "audit" && !!selectedPack.companyId,
  });

  const cfoPackQuery = useQuery<ClientCfoPack>({
    queryKey: ["/api/firm/value-ops/cfo-pack", selectedPack?.companyId],
    queryFn: () =>
      apiRequest("GET", `/api/firm/value-ops/clients/${selectedPack?.companyId}/cfo-pack`),
    enabled: selectedPack?.type === "cfo" && !!selectedPack.companyId,
  });

  const data = dashboardQuery.data;

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Sparkles className="me-2 h-5 w-5 animate-pulse" />
        {tr("loadingValueOperations")}
      </div>
    );
  }

  if (dashboardQuery.isError || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-danger-subtle p-6 text-sm text-danger-subtle-foreground">
        {tr("valueOperationsCouldNotBeLoaded")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("firm")}
        title={tr("valueOps")}
        description={tr("nraWideCashComplianceCloseReview")}
        actions={
          <Button variant="outline" onClick={() => dashboardQuery.refetch()}>
            <Gauge className="me-2 h-4 w-4" />
            {tr("refresh")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={tr("cashAtRisk")}
          value={formatAed(data.summary.cashAtRisk)}
          icon={Banknote}
        />
        <MetricCard
          title={tr("penaltyRiskClients")}
          value={`${data.summary.penaltyRiskClients}`}
          icon={AlertTriangle}
        />
        <MetricCard
          title={tr("reviewerQueue")}
          value={`${data.summary.reviewerQueueItems}`}
          icon={Bot}
        />
        <MetricCard
          title={tr("nraServiceAr")}
          value={formatAed(data.summary.nraServiceAr)}
          icon={BriefcaseBusiness}
        />
      </div>

      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">{tr("board")}</TabsTrigger>
          <TabsTrigger value="review">{tr("aiReview")}</TabsTrigger>
          <TabsTrigger value="actions">{tr("actions")}</TabsTrigger>
          <TabsTrigger value="clients">{tr("clients")}</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {data.opportunities.map((opportunity) => {
              const Icon = getLaneConfig()[opportunity.lane].icon;
              return (
                <Card key={opportunity.lane}>
                  <CardHeader className="space-y-0 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm leading-snug">{opportunity.title}</CardTitle>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-semibold">{opportunity.valueMetric}</div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{tr("open", { count: opportunity.count })}</span>
                      <span>{formatAed(opportunity.impactAed)}</span>
                    </div>
                    <div className="min-h-5 truncate text-xs text-muted-foreground">
                      {opportunity.topClient ?? tr("noPriorityClient")}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("aiReviewerQueue")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("priority")}</TableHead>
                    <TableHead>{tr("type")}</TableHead>
                    <TableHead>{tr("client")}</TableHead>
                    <TableHead>{tr("whyItNeedsReview")}</TableHead>
                    <TableHead className="text-end">{tr("confidence")}</TableHead>
                    <TableHead className="text-end">{tr("amount")}</TableHead>
                    <TableHead>{tr("due")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reviewQueueQuery.data ?? []).map((item) => {
                    const config = getReviewKindConfig()[item.kind];
                    const Icon = config.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Badge className={priorityClass(item.priority)}>{item.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span>{config.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{item.companyName}</TableCell>
                        <TableCell>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-xs text-muted-foreground">{item.explanation}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.suggestedAction}
                          </div>
                        </TableCell>
                        <TableCell className="text-end">{formatPercent(item.confidence)}</TableCell>
                        <TableCell className="text-end">
                          {item.amountAed > 0 ? formatAed(item.amountAed) : "—"}
                        </TableCell>
                        <TableCell>{formatDate(item.dueDate)}</TableCell>
                        <TableCell className="text-end">
                          <Button variant="ghost" size="sm" onClick={() => navigate(item.href)}>
                            {tr("review")} <ArrowRight className="ms-1 h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(reviewQueueQuery.data ?? []).length === 0 && !reviewQueueQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        {tr("noReviewerExceptionsRightNow")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("priorityActions")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("priority")}</TableHead>
                    <TableHead>{tr("lane")}</TableHead>
                    <TableHead>{tr("client")}</TableHead>
                    <TableHead>{tr("action")}</TableHead>
                    <TableHead className="text-end">{tr("aedImpact")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>
                        <Badge className={priorityClass(action.priority)}>{action.priority}</Badge>
                      </TableCell>
                      <TableCell>{getLaneConfig()[action.lane].label}</TableCell>
                      <TableCell className="font-medium">{action.companyName}</TableCell>
                      <TableCell>
                        <div className="font-medium">{action.title}</div>
                        <div className="text-xs text-muted-foreground">{action.detail}</div>
                      </TableCell>
                      <TableCell className="text-end">{formatAed(action.impactAed)}</TableCell>
                      <TableCell className="text-end">
                        <Button variant="ghost" size="sm" onClick={() => navigate(action.href)}>
                          {tr("open2")} <ArrowRight className="ms-1 h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.actions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {tr("noPriorityActions")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("clientValueScorecards")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("client")}</TableHead>
                    <TableHead>{tr("audit")}</TableHead>
                    <TableHead>{tr("close")}</TableHead>
                    <TableHead>{tr("risk")}</TableHead>
                    <TableHead className="text-end">{tr("overdueAr")}</TableHead>
                    <TableHead className="text-end">{tr("reviewItems")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clients.map((client) => (
                    <TableRow key={client.companyId}>
                      <TableCell>
                        <div className="font-medium">{client.companyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {client.trn ?? tr("noTrn")}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar
                          label={tr("defense")}
                          value={client.scores.auditDefense}
                          inverse
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar
                          label={tr("readiness")}
                          value={client.scores.closeReadiness}
                          inverse
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar label={tr("compliance")} value={client.scores.complianceRisk} />
                      </TableCell>
                      <TableCell className="text-end">
                        {formatAed(client.money.overdueAr)}
                      </TableCell>
                      <TableCell className="text-end">
                        {client.workload.reviewerQueueItems}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedPack({ companyId: client.companyId, type: "audit" })
                            }
                          >
                            <FileArchive className="me-1 h-4 w-4" />
                            {tr("audit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedPack({ companyId: client.companyId, type: "cfo" })
                            }
                          >
                            <PackageOpen className="me-1 h-4 w-4" />
                            {tr("cfo")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.clients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        {tr("noManagedClients")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedPack} onOpenChange={(open) => !open && setSelectedPack(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedPack?.type === "audit" ? tr("auditDefensePack") : tr("monthlyCfoPack")}
              {selectedClient ? ` · ${selectedClient.companyName}` : ""}
            </DialogTitle>
          </DialogHeader>

          {selectedPack?.type === "audit" && (
            <AuditPackView pack={auditPackQuery.data} loading={auditPackQuery.isLoading} />
          )}
          {selectedPack?.type === "cfo" && (
            <CfoPackView pack={cfoPackQuery.data} loading={cfoPackQuery.isLoading} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditPackView({ pack, loading }: { pack?: ClientAuditPack; loading: boolean }) {
  const tr = pageMessages.useT();

  if (loading)
    return <div className="py-10 text-center text-muted-foreground">{tr("loadingPack")}</div>;
  if (!pack)
    return <div className="py-10 text-center text-muted-foreground">{tr("noPackAvailable")}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("vatStatus")}</div>
          <div className="font-medium">{pack.vatReturn?.status ?? tr("noReturn")}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("dueDate")}</div>
          <div className="font-medium">{formatDate(pack.vatReturn?.dueDate)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("payableTax")}</div>
          <div className="font-medium">{formatAed(pack.vatReturn?.payableTax ?? 0)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {pack.evidence.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div>
              <div className="font-medium">{item.label}</div>
              <div className="text-sm text-muted-foreground">{item.detail}</div>
            </div>
            <Badge className={evidenceClass(item.status)}>
              {item.status} · {item.count}
            </Badge>
          </div>
        ))}
      </div>

      {pack.reviewerNotes.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-subtle p-3">
          <div className="mb-2 font-medium text-warning-subtle-foreground">
            {tr("reviewerNotes")}
          </div>
          <ul className="space-y-1 text-sm text-warning-subtle-foreground">
            {pack.reviewerNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {pack.reviewerNotes.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success-subtle p-3 text-sm text-success-subtle-foreground">
          <CheckCircle2 className="h-4 w-4" />
          {tr("evidencePackIsReadyForReviewer")}
        </div>
      )}
    </div>
  );
}

function CfoPackView({ pack, loading }: { pack?: ClientCfoPack; loading: boolean }) {
  const tr = pageMessages.useT();

  if (loading)
    return <div className="py-10 text-center text-muted-foreground">{tr("loadingPack")}</div>;
  if (!pack)
    return <div className="py-10 text-center text-muted-foreground">{tr("noPackAvailable")}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("revenue")}</div>
          <div className="font-medium">{formatAed(pack.metrics.revenue)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("expenses")}</div>
          <div className="font-medium">{formatAed(pack.metrics.expenses)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("net")}</div>
          <div className="font-medium">{formatAed(pack.metrics.net)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("openAr")}</div>
          <div className="font-medium">{formatAed(pack.metrics.openAr)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("overdueAr")}</div>
          <div className="font-medium">{formatAed(pack.metrics.overdueAr)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{tr("vatPayable")}</div>
          <div className="font-medium">{formatAed(pack.metrics.vatPayable)}</div>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <TrendingUp className="h-4 w-4" />
          {tr("narrative")}
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {pack.narrative.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 font-medium">{tr("nextActions")}</div>
        {pack.nextActions.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {pack.nextActions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">{tr("noImmediateActions")}</div>
        )}
      </div>
    </div>
  );
}
