import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
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
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/queryClient';

type Priority = 'critical' | 'high' | 'medium' | 'low';
type ValueLane =
  | 'audit_defense'
  | 'bank_close'
  | 'penalty_prevention'
  | 'cash_recovery'
  | 'nra_profitability'
  | 'compliance_risk'
  | 'ai_review'
  | 'whatsapp_cockpit'
  | 'monthly_cfo_pack'
  | 'migration_concierge';
type ReviewItemKind =
  | 'bank_match'
  | 'receipt_posting'
  | 'anomaly'
  | 'vat_review'
  | 'trial_balance'
  | 'document_request';

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
    status: 'ready' | 'attention' | 'missing';
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

const laneConfig: Record<ValueLane, { label: string; icon: typeof ShieldCheck }> = {
  audit_defense: { label: 'Audit defense', icon: ShieldCheck },
  bank_close: { label: 'Bank close', icon: Landmark },
  penalty_prevention: { label: 'Penalty prevention', icon: AlertTriangle },
  cash_recovery: { label: 'Cash recovery', icon: Banknote },
  nra_profitability: { label: 'NRA profitability', icon: BriefcaseBusiness },
  compliance_risk: { label: 'Compliance risk', icon: ClipboardCheck },
  ai_review: { label: 'AI review', icon: Bot },
  whatsapp_cockpit: { label: 'WhatsApp cockpit', icon: MessageCircle },
  monthly_cfo_pack: { label: 'CFO pack', icon: FileText },
  migration_concierge: { label: 'Migration concierge', icon: UploadCloud },
};

const reviewKindConfig: Record<ReviewItemKind, { label: string; icon: typeof ShieldCheck }> = {
  bank_match: { label: 'Bank match', icon: Landmark },
  receipt_posting: { label: 'Receipt posting', icon: FileText },
  anomaly: { label: 'Anomaly', icon: AlertTriangle },
  vat_review: { label: 'VAT review', icon: ClipboardCheck },
  trial_balance: { label: 'Trial balance', icon: Gauge },
  document_request: { label: 'Document request', icon: MessageCircle },
};

function formatAed(value: number): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AE', { dateStyle: 'medium' }).format(new Date(value));
}

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function priorityClass(priority: Priority): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'high':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'medium':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'low':
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

function evidenceClass(status: ClientAuditPack['evidence'][number]['status']): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'attention':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'missing':
      return 'bg-red-100 text-red-800 border-red-200';
  }
}

function ScoreBar({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const risk = inverse ? 100 - value : value;
  const color =
    risk >= 75
      ? 'text-red-600'
      : risk >= 50
        ? 'text-amber-600'
        : 'text-emerald-600';
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

function MetricCard({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Gauge }) {
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
  const [location, navigate] = useLocation();
  const [selectedPack, setSelectedPack] = useState<{ companyId: string; type: 'audit' | 'cfo' } | null>(null);

  const dashboardQuery = useQuery<ValueOpsDashboard>({
    queryKey: ['/api/firm/value-ops'],
  });

  const reviewQueueQuery = useQuery<FirmReviewItem[]>({
    queryKey: ['/api/firm/value-ops/review-queue'],
  });

  useEffect(() => {
    const [, queryString] = location.split('?');
    const client = new URLSearchParams(queryString ?? '').get('client');
    if (client) setSelectedPack({ companyId: client, type: 'audit' });
  }, [location]);

  const selectedClient = useMemo(
    () => dashboardQuery.data?.clients.find((client) => client.companyId === selectedPack?.companyId) ?? null,
    [dashboardQuery.data?.clients, selectedPack?.companyId],
  );

  const auditPackQuery = useQuery<ClientAuditPack>({
    queryKey: ['/api/firm/value-ops/audit-pack', selectedPack?.companyId],
    queryFn: () => apiRequest('GET', `/api/firm/value-ops/clients/${selectedPack?.companyId}/audit-pack`),
    enabled: selectedPack?.type === 'audit' && !!selectedPack.companyId,
  });

  const cfoPackQuery = useQuery<ClientCfoPack>({
    queryKey: ['/api/firm/value-ops/cfo-pack', selectedPack?.companyId],
    queryFn: () => apiRequest('GET', `/api/firm/value-ops/clients/${selectedPack?.companyId}/cfo-pack`),
    enabled: selectedPack?.type === 'cfo' && !!selectedPack.companyId,
  });

  const data = dashboardQuery.data;

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Sparkles className="mr-2 h-5 w-5 animate-pulse" />
        Loading value operations...
      </div>
    );
  }

  if (dashboardQuery.isError || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        Value operations could not be loaded.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Value Ops</h1>
          <p className="text-muted-foreground">NRA-wide cash, compliance, close, review, and client reporting queue.</p>
        </div>
        <Button variant="outline" onClick={() => dashboardQuery.refetch()}>
          <Gauge className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Cash at risk" value={formatAed(data.summary.cashAtRisk)} icon={Banknote} />
        <MetricCard title="Penalty-risk clients" value={`${data.summary.penaltyRiskClients}`} icon={AlertTriangle} />
        <MetricCard title="Reviewer queue" value={`${data.summary.reviewerQueueItems}`} icon={Bot} />
        <MetricCard title="NRA service AR" value={formatAed(data.summary.nraServiceAr)} icon={BriefcaseBusiness} />
      </div>

      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="review">AI review</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {data.opportunities.map((opportunity) => {
              const Icon = laneConfig[opportunity.lane].icon;
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
                      <span>{opportunity.count} open</span>
                      <span>{formatAed(opportunity.impactAed)}</span>
                    </div>
                    <div className="min-h-5 truncate text-xs text-muted-foreground">
                      {opportunity.topClient ?? 'No priority client'}
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
              <CardTitle className="text-base">AI Reviewer Queue</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Priority</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Why it needs review</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reviewQueueQuery.data ?? []).map((item) => {
                    const config = reviewKindConfig[item.kind];
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
                          <div className="mt-1 text-xs text-muted-foreground">{item.suggestedAction}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatPercent(item.confidence)}</TableCell>
                        <TableCell className="text-right">{item.amountAed > 0 ? formatAed(item.amountAed) : '—'}</TableCell>
                        <TableCell>{formatDate(item.dueDate)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => navigate(item.href)}>
                            Review <ArrowRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(reviewQueueQuery.data ?? []).length === 0 && !reviewQueueQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        No reviewer exceptions right now.
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
              <CardTitle className="text-base">Priority Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Priority</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">AED impact</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>
                        <Badge className={priorityClass(action.priority)}>{action.priority}</Badge>
                      </TableCell>
                      <TableCell>{laneConfig[action.lane].label}</TableCell>
                      <TableCell className="font-medium">{action.companyName}</TableCell>
                      <TableCell>
                        <div className="font-medium">{action.title}</div>
                        <div className="text-xs text-muted-foreground">{action.detail}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatAed(action.impactAed)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => navigate(action.href)}>
                          Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.actions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No priority actions.
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
              <CardTitle className="text-base">Client Value Scorecards</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Audit</TableHead>
                    <TableHead>Close</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead className="text-right">Overdue AR</TableHead>
                    <TableHead className="text-right">Review items</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clients.map((client) => (
                    <TableRow key={client.companyId}>
                      <TableCell>
                        <div className="font-medium">{client.companyName}</div>
                        <div className="text-xs text-muted-foreground">{client.trn ?? 'No TRN'}</div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar label="Defense" value={client.scores.auditDefense} inverse />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar label="Readiness" value={client.scores.closeReadiness} inverse />
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <ScoreBar label="Compliance" value={client.scores.complianceRisk} />
                      </TableCell>
                      <TableCell className="text-right">{formatAed(client.money.overdueAr)}</TableCell>
                      <TableCell className="text-right">{client.workload.reviewerQueueItems}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPack({ companyId: client.companyId, type: 'audit' })}
                          >
                            <FileArchive className="mr-1 h-4 w-4" />
                            Audit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPack({ companyId: client.companyId, type: 'cfo' })}
                          >
                            <PackageOpen className="mr-1 h-4 w-4" />
                            CFO
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.clients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No managed clients.
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
              {selectedPack?.type === 'audit' ? 'Audit Defense Pack' : 'Monthly CFO Pack'}
              {selectedClient ? ` · ${selectedClient.companyName}` : ''}
            </DialogTitle>
          </DialogHeader>

          {selectedPack?.type === 'audit' && (
            <AuditPackView pack={auditPackQuery.data} loading={auditPackQuery.isLoading} />
          )}
          {selectedPack?.type === 'cfo' && (
            <CfoPackView pack={cfoPackQuery.data} loading={cfoPackQuery.isLoading} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditPackView({ pack, loading }: { pack?: ClientAuditPack; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-muted-foreground">Loading pack...</div>;
  if (!pack) return <div className="py-10 text-center text-muted-foreground">No pack available.</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">VAT status</div>
          <div className="font-medium">{pack.vatReturn?.status ?? 'No return'}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Due date</div>
          <div className="font-medium">{formatDate(pack.vatReturn?.dueDate)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Payable tax</div>
          <div className="font-medium">{formatAed(pack.vatReturn?.payableTax ?? 0)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {pack.evidence.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3 rounded-md border p-3">
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
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 font-medium text-amber-900">Reviewer notes</div>
          <ul className="space-y-1 text-sm text-amber-900">
            {pack.reviewerNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {pack.reviewerNotes.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          Evidence pack is ready for reviewer sign-off.
        </div>
      )}
    </div>
  );
}

function CfoPackView({ pack, loading }: { pack?: ClientCfoPack; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-muted-foreground">Loading pack...</div>;
  if (!pack) return <div className="py-10 text-center text-muted-foreground">No pack available.</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Revenue</div>
          <div className="font-medium">{formatAed(pack.metrics.revenue)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Expenses</div>
          <div className="font-medium">{formatAed(pack.metrics.expenses)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Net</div>
          <div className="font-medium">{formatAed(pack.metrics.net)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Open AR</div>
          <div className="font-medium">{formatAed(pack.metrics.openAr)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">Overdue AR</div>
          <div className="font-medium">{formatAed(pack.metrics.overdueAr)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">VAT payable</div>
          <div className="font-medium">{formatAed(pack.metrics.vatPayable)}</div>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <TrendingUp className="h-4 w-4" />
          Narrative
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {pack.narrative.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 font-medium">Next actions</div>
        {pack.nextActions.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {pack.nextActions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">No immediate actions.</div>
        )}
      </div>
    </div>
  );
}
