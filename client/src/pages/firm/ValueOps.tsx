import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { anomalyRuleLabel } from "@/lib/anomaly-rules";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { valueOpsMessage } from "@/lib/server-message";
import { useFirmText } from "./portfolio/text";
import { PracticeNav } from "@/components/firm/PracticeNav";
import { T } from "@/components/layout/T";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  FileArchive,
  Gauge,
  PackageOpen,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { CopyDescriptor } from "@shared/server-copy";

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
  rule?: string | null;
  message?: CopyDescriptor | null;
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

const LANES: ValueLane[] = [
  "audit_defense",
  "bank_close",
  "penalty_prevention",
  "cash_recovery",
  "nra_profitability",
  "compliance_risk",
  "ai_review",
  "whatsapp_cockpit",
  "monthly_cfo_pack",
  "migration_concierge",
];

const laneKey = (lane: ValueLane) => `firmOps.lane_${lane}`;
const reviewKindKey = (kind: ReviewItemKind) => `firmOps.reviewKind_${kind}`;

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

// Spec 2.3/3.17: subtle pills, translated label (never the raw enum).
function priorityClass(priority: Priority): string {
  switch (priority) {
    case "critical":
    case "high":
      return "border-transparent bg-danger-subtle text-danger-subtle-foreground";
    case "medium":
      return "border-transparent bg-warning-subtle text-warning-subtle-foreground";
    default:
      return "border-transparent bg-neutral-subtle text-neutral-subtle-foreground";
  }
}

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "firmOps.priorityCritical",
  high: "firmOps.priorityHigh",
  medium: "firmOps.priorityMedium",
  low: "firmOps.priorityLow",
};

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

/** Everything the page needs to turn a server sentence into the reader's language. */
function useValueOpsText() {
  const { t, locale } = useTranslation();
  const { status } = useFirmText();
  return {
    t,
    locale,
    /** Action / review / audit-pack sentence from the API. */
    vo: (text: string | null | undefined) => valueOpsMessage(text, t, locale, status),
    date: (value: string | null | undefined) => (value ? formatDisplayDate(value, locale) : "—"),
    client: (name: string) => (name === "Unknown client" ? t["firmOps.unassigned"] : name),
  };
}

export default function ValueOps() {
  const { t, locale, vo, date, client: clientName } = useValueOpsText();
  const [location, navigate] = useLocation();
  const [tab, setTab] = useState("programmes");
  const [lane, setLane] = useState<ValueLane | null>(null);
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

  // Open the audit pack for a `?client=` deep link whenever the location changes.
  const [packLocation, setPackLocation] = useState<string | null>(null);
  if (packLocation !== location) {
    setPackLocation(location);
    const [, queryString] = location.split("?");
    const client = new URLSearchParams(queryString ?? "").get("client");
    if (client) setSelectedPack({ companyId: client, type: "audit" });
  }

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
        <T k="pages.loadingValueOperations" />
      </div>
    );
  }

  if (dashboardQuery.isError || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-danger-subtle p-6 text-sm text-danger-subtle-foreground">
        <T k="pages.valueOperationsCouldNotBeLoaded" />
      </div>
    );
  }

  // A programme row opens its open actions; the server sends one opportunity row per lane.
  const programmes = LANES.map((id) => data.opportunities.find((o) => o.lane === id)).filter(
    (o): o is ValueOpsOpportunity => !!o
  );
  const visibleActions = lane ? data.actions.filter((a) => a.lane === lane) : data.actions;
  const openProgramme = (id: ValueLane) => {
    setLane(id);
    setTab("actions");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["firm.firmLabel"]}
        title={t["firm.valueOpsTitle"]}
        description={t["firm.valueOpsDescription"]}
        actions={
          <Button variant="outline" onClick={() => dashboardQuery.refetch()}>
            <Gauge className="me-2 h-4 w-4" />
            <T k="pages.refresh" />
          </Button>
        }
      />
      <PracticeNav />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t["firm.valueOpsCashAtRisk"]}
          value={<Money amount={data.summary.cashAtRisk} currency="AED" />}
        />
        <StatCard
          label={t["firm.valueOpsPenaltyRiskClients"]}
          value={data.summary.penaltyRiskClients}
        />
        <StatCard label={t["firm.valueOpsReviewerQueue"]} value={data.summary.reviewerQueueItems} />
        <StatCard
          label={t["firm.valueOpsServiceAr"]}
          value={<Money amount={data.summary.nraServiceAr} currency="AED" />}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="programmes">{t["firmOps.tabProgrammes"]}</TabsTrigger>
          <TabsTrigger value="review">
            <T k="pages.aiReview" />
          </TabsTrigger>
          <TabsTrigger value="actions">
            <T k="pages.actions" />
          </TabsTrigger>
          <TabsTrigger value="clients">
            <T k="pages.clients" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="programmes">
          <Card>
            <CardHeader>
              <CardDescription>{t["firmOps.programmesHint"]}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table data-testid="value-ops-programmes">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["firmOps.colProgramme"]}</TableHead>
                    <TableHead data-numeric>{t["firmOps.colOpenItems"]}</TableHead>
                    <TableHead data-numeric>{t["firmOps.colValueAtStake"]}</TableHead>
                    <TableHead>{t["firmOps.colNextClient"]}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {programmes.map((programme) => (
                    <TableRow
                      key={programme.lane}
                      className="cursor-pointer"
                      onClick={() => openProgramme(programme.lane)}
                      data-testid={`value-ops-programme-${programme.lane}`}
                    >
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProgramme(programme.lane);
                          }}
                        >
                          {t[laneKey(programme.lane)]}
                        </button>
                      </TableCell>
                      <TableCell data-numeric>{programme.count}</TableCell>
                      <TableCell data-numeric>
                        {programme.impactAed > 0 ? (
                          <Money amount={programme.impactAed} currency="AED" />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {programme.topClient ? (
                          <span translate="no">{programme.topClient}</span>
                        ) : (
                          t["firmOps.unassigned"]
                        )}
                      </TableCell>
                      <TableCell data-numeric>
                        <ArrowRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pages.aiReviewerQueue" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.priority" />
                    </TableHead>
                    <TableHead>{t["firmOps.colType"]}</TableHead>
                    <TableHead>
                      <T k="pages.client" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.whyItNeedsReview" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.confidence" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.amount" />
                    </TableHead>
                    <TableHead>{t["firmOps.colDue"]}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reviewQueueQuery.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Badge className={priorityClass(item.priority)}>
                          <T k={PRIORITY_LABEL[item.priority] ?? PRIORITY_LABEL.low} />
                        </Badge>
                      </TableCell>
                      <TableCell>{t[reviewKindKey(item.kind)]}</TableCell>
                      <TableCell className="font-medium">
                        <span translate="no">{clientName(item.companyName)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {item.kind === "anomaly" && item.rule
                            ? anomalyRuleLabel(item.rule, locale)
                            : vo(item.title)}
                        </div>
                        <div className="text-xs text-muted-foreground">{vo(item.explanation)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {vo(item.suggestedAction)}
                        </div>
                      </TableCell>
                      <TableCell data-numeric>{formatPercent(item.confidence)}</TableCell>
                      <TableCell data-numeric>
                        {item.amountAed > 0 ? (
                          <Money amount={item.amountAed} currency="AED" />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{date(item.dueDate)}</TableCell>
                      <TableCell data-numeric>
                        <Button variant="ghost" size="sm" onClick={() => navigate(item.href)}>
                          <T k="pages.review" />{" "}
                          <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:rotate-180" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(reviewQueueQuery.data ?? []).length === 0 && !reviewQueueQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        <T k="pages.noReviewerExceptionsRightNow" />
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
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">
                <T k="pages.priorityActions" />
              </CardTitle>
              {lane && (
                <Button variant="outline" size="sm" onClick={() => setLane(null)}>
                  {formatMessage(t["firmOps.programmeFilter"], { name: t[laneKey(lane)] })}
                  <X className="ms-2 h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.priority" />
                    </TableHead>
                    <TableHead>{t["firmOps.colProgramme"]}</TableHead>
                    <TableHead>
                      <T k="pages.client" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.action" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.aedImpact" />
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleActions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>
                        <Badge className={priorityClass(action.priority)}>
                          <T k={PRIORITY_LABEL[action.priority] ?? PRIORITY_LABEL.low} />
                        </Badge>
                      </TableCell>
                      <TableCell>{t[laneKey(action.lane)]}</TableCell>
                      <TableCell className="font-medium">
                        <span translate="no">{clientName(action.companyName)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{vo(action.title)}</div>
                        <div className="text-xs text-muted-foreground">{vo(action.detail)}</div>
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={action.impactAed} currency="AED" />
                      </TableCell>
                      <TableCell data-numeric>
                        <Button variant="ghost" size="sm" onClick={() => navigate(action.href)}>
                          <T k="pages.open" />
                          <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:rotate-180" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleActions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        <T k="pages.noPriorityActions" />
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
              <CardTitle className="text-base">
                <T k="pages.clientValueScorecards" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.client" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.audit" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.close" />
                    </TableHead>
                    <TableHead>{t["firmOps.colRisk"]}</TableHead>
                    <TableHead data-numeric>
                      <T k="pages.overdueAr" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.reviewItems" />
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clients.map((client) => (
                    <TableRow key={client.companyId}>
                      <TableCell>
                        <div className="font-medium" translate="no">
                          {client.companyName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {client.trn ?? t["firm.valueOpsNoTrn"]}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar
                          label={t["firm.valueOpsScoreDefense"]}
                          value={client.scores.auditDefense}
                          inverse
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar
                          label={t["components.srv.firm.label.readiness"]}
                          value={client.scores.closeReadiness}
                          inverse
                        />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar
                          label={t["pageLabels.compliance"]}
                          value={client.scores.complianceRisk}
                        />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={client.money.overdueAr} currency="AED" />
                      </TableCell>
                      <TableCell data-numeric>{client.workload.reviewerQueueItems}</TableCell>
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
                            <T k="pages.audit" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedPack({ companyId: client.companyId, type: "cfo" })
                            }
                          >
                            <PackageOpen className="me-1 h-4 w-4" />
                            {t["firmOps.cfoPackShort"]}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.clients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        <T k="pages.noManagedClients" />
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
              {selectedPack?.type === "audit"
                ? t["firm.valueOpsAuditPack"]
                : t["firm.valueOpsCfoPack"]}
              {selectedClient ? " · " : ""}
              {selectedClient ? <span translate="no">{selectedClient.companyName}</span> : null}
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

const EVIDENCE_LABEL: Record<ClientAuditPack["evidence"][number]["status"], string> = {
  ready: "firmOps.evidenceReady",
  attention: "firmOps.evidenceAttention",
  missing: "firmOps.evidenceMissing",
};

function AuditPackView({ pack, loading }: { pack?: ClientAuditPack; loading: boolean }) {
  const { t, vo, date } = useValueOpsText();
  const { status } = useFirmText();
  if (loading)
    return (
      <div className="py-10 text-center text-muted-foreground">
        <T k="pages.loadingPack" />
      </div>
    );
  if (!pack)
    return (
      <div className="py-10 text-center text-muted-foreground">
        <T k="pages.noPackAvailable" />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">
            <T k="pages.vatStatus" />
          </div>
          <div className="font-medium">
            {pack.vatReturn ? status(pack.vatReturn.status) : t["firm.valueOpsNoReturn"]}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">
            <T k="pages.dueDate2" />
          </div>
          <div className="font-medium">{date(pack.vatReturn?.dueDate)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">
            <T k="pages.payableTax" />
          </div>
          <div className="font-medium">
            <Money amount={pack.vatReturn?.payableTax ?? 0} currency="AED" />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {pack.evidence.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div>
              <div className="font-medium">{vo(item.label)}</div>
              <div className="text-sm text-muted-foreground">{vo(item.detail)}</div>
            </div>
            <Badge className={evidenceClass(item.status)}>
              {t[EVIDENCE_LABEL[item.status]]} · {item.count}
            </Badge>
          </div>
        ))}
      </div>

      {pack.reviewerNotes.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-subtle p-3">
          <div className="mb-2 font-medium text-warning-subtle-foreground">
            <T k="pages.reviewerNotes" />
          </div>
          <ul className="space-y-1 text-sm text-warning-subtle-foreground">
            {pack.reviewerNotes.map((note) => {
              // "<label>: <detail>" as the server composes it; each half has its own sentence.
              const at = note.indexOf(": ");
              const text =
                at > 0 ? `${vo(note.slice(0, at))}: ${vo(note.slice(at + 2))}` : vo(note);
              return <li key={note}>{text}</li>;
            })}
          </ul>
        </div>
      )}
      {pack.reviewerNotes.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success-subtle p-3 text-sm text-success-subtle-foreground">
          <CheckCircle2 className="h-4 w-4" />
          <T k="pages.evidencePackIsReadyForReviewerSignOff" />
        </div>
      )}
    </div>
  );
}

function CfoPackView({ pack, loading }: { pack?: ClientCfoPack; loading: boolean }) {
  const { t, vo } = useValueOpsText();
  if (loading)
    return (
      <div className="py-10 text-center text-muted-foreground">
        <T k="pages.loadingPack" />
      </div>
    );
  if (!pack)
    return (
      <div className="py-10 text-center text-muted-foreground">
        <T k="pages.noPackAvailable" />
      </div>
    );

  const metric = (label: string, amount: number) => (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">
        <Money amount={amount} currency="AED" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {metric(t["pages.revenue"], pack.metrics.revenue)}
        {metric(t["pages.expenses"], pack.metrics.expenses)}
        {metric(t["firmOps.net"], pack.metrics.net)}
        {metric(t["pages.openAr"], pack.metrics.openAr)}
        {metric(t["pages.overdueAr"], pack.metrics.overdueAr)}
        {metric(t["pages.vatPayable2"], pack.metrics.vatPayable)}
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <TrendingUp className="h-4 w-4" />
          <T k="pages.narrative" />
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {pack.narrative.map((line) => (
            <li key={line}>{vo(line)}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 font-medium">
          <T k="pages.nextActions" />
        </div>
        {pack.nextActions.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {pack.nextActions.map((line) => (
              <li key={line}>{vo(line)}</li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">
            <T k="pages.noImmediateActions" />
          </div>
        )}
      </div>
    </div>
  );
}
