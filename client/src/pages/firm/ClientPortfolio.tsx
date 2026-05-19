import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Building2, Plus, Search, LayoutGrid, List,
  ChevronRight, Users, Calendar,
  BookOpen, Upload, AlertTriangle, Receipt, FolderOpen,
  Calculator, CheckCircle2, Clock, FileText, TrendingUp,
  UserCheck, Target, RefreshCw, Copy, ScanLine, Check, XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/api';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  parseVatPasteRows,
  vat201CopyGroups,
  vatEmirates,
  vatRowCategories,
  vatRowCategoryLabel,
  type VatRowCategory,
} from '@/lib/vat-workpaper-grid';
import { format } from 'date-fns';
import type { Company } from '@shared/schema';
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  clientHasService,
  serviceLabels,
  type ClientServiceCode,
  type ClientServicePlan,
} from '@shared/client-services';
import { useActiveCompany } from '@/components/ActiveCompanyProvider';

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

type ClientWithStats = Company & ClientStats & {
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

type BookkeeperPriority = 'on_track' | 'attention' | 'critical';
type BookkeeperInterventionLevel = 'low' | 'medium' | 'high';

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
    status: BookkeeperPriority | 'filed';
    payableTax: number | null;
    blockers: string[];
  };
  corporateTax: {
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | 'filed';
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
    status: BookkeeperPriority | 'filed';
    blockers: string[];
    nextBestAction: string;
  }[];
}

type BookkeeperQueueKey = 'vat' | 'corporateTax' | 'bookkeeping' | 'accounting';

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

type GrowthOpportunityStatus = 'open' | 'accepted' | 'snoozed' | 'dismissed' | 'completed';

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
  priority: 'critical' | 'high' | 'medium' | 'low';
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
  status: 'draft' | 'approved' | 'excluded';
  sourceMethod: 'manual' | 'ocr' | 'import' | 'generated';
  notes: string | null;
  auditReason: string | null;
}

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
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateShort(date: string | null | undefined) {
  if (!date) return '—';
  return format(new Date(date), 'MMM d');
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return 'No period';
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function formatDays(days: number | null | undefined) {
  if (days === null || days === undefined) return 'No date';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

function inputDate(date: string | null | undefined) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return format(parsed, 'yyyy-MM-dd');
}

function copyText(value: unknown) {
  void navigator.clipboard?.writeText(String(value ?? '0'));
}

async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read evidence file'));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(',')[1] ?? '';
}

async function readEvidenceText(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const isTextLike = type.startsWith('text/') || name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.json');
  if (!isTextLike || file.size > 500_000) return '';
  return file.text();
}

function priorityClass(priority: BookkeeperPriority | 'filed') {
  if (priority === 'filed' || priority === 'on_track') return 'bg-green-100 text-green-800 border-green-200';
  if (priority === 'critical') return 'bg-red-100 text-red-800 border-red-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
}

function priorityLabel(priority: BookkeeperPriority | 'filed') {
  if (priority === 'on_track') return 'On track';
  if (priority === 'attention') return 'Attention';
  if (priority === 'critical') return 'Critical';
  return 'Filed';
}

function priorityScore(priority: BookkeeperPriority | 'filed') {
  if (priority === 'critical') return 3;
  if (priority === 'attention') return 2;
  return 1;
}

function PriorityBadge({ priority }: { priority: BookkeeperPriority | 'filed' }) {
  return <Badge className={priorityClass(priority)}>{priorityLabel(priority)}</Badge>;
}

function servicesForClient(client: Pick<BookkeeperClient, 'serviceScope'> | Pick<ClientWithStats, 'serviceScope'>): ClientServiceCode[] {
  return client.serviceScope?.length ? client.serviceScope : DEFAULT_CLIENT_SERVICE_CODES;
}

function hasClientService(
  client: Pick<BookkeeperClient, 'serviceScope'> | Pick<ClientWithStats, 'serviceScope'>,
  service: ClientServiceCode,
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
  const labels = compact ? serviceLabels(activeServices) : activeServices.map(service => (
    CLIENT_SERVICE_OPTIONS.find(option => option.code === service)?.label ?? service
  ));

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map(label => (
        <Badge key={label} variant="outline" className="text-[11px]">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function interventionClass(level: BookkeeperInterventionLevel) {
  if (level === 'high') return 'bg-red-100 text-red-800 border-red-200';
  if (level === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-green-100 text-green-800 border-green-200';
}

function fallbackIntervention(client: BookkeeperClient): NonNullable<BookkeeperClient['intervention']> {
  const score = Math.min(
    100,
    priorityScore(client.priority) * 18
      + (client.assignedStaff.length === 0 ? 12 : 0)
      + (client.bookkeeping.status !== 'on_track' ? 12 : 0)
      + (client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28 ? 10 : 0)
      + (client.corporateTax.daysTilDue !== null && client.corporateTax.daysTilDue <= 90 ? 6 : 0),
  );
  const level: BookkeeperInterventionLevel = score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';
  const reasons = [
    client.assignedStaff.length === 0 ? 'No owner assigned' : '',
    ...client.vat.blockers,
    ...client.corporateTax.blockers,
    ...client.bookkeeping.blockers,
    ...client.accounting.blockers,
  ].filter(Boolean);
  return {
    score,
    level,
    title: client.nextBestAction,
    reasons: (reasons.length > 0 ? reasons : ['No active intervention signals']).slice(0, 5),
    ownerAction: client.nextBestAction,
    deadlineLabel: primaryDeadline(client).label,
    exposureAed: Math.round(Math.max(0, client.bookkeeping.openAr)),
  };
}

function clientIntervention(client: BookkeeperClient) {
  return client.intervention ?? fallbackIntervention(client);
}

function blockerPreview(blockers: string[]) {
  if (blockers.length === 0) return 'No blockers';
  if (blockers.length === 1) return blockers[0];
  return `${blockers[0]} +${blockers.length - 1}`;
}

const queueConfig: Record<BookkeeperQueueKey, { label: string; icon: typeof Calendar }> = {
  vat: { label: 'VAT', icon: Calendar },
  corporateTax: { label: 'Corporate Tax', icon: Calculator },
  bookkeeping: { label: 'Bookkeeping', icon: TrendingUp },
  accounting: { label: 'Accounting', icon: CheckCircle2 },
};

function ownerPreview(names: string[]) {
  if (names.length === 0) return 'Unassigned';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

function primaryDeadline(client: BookkeeperClient) {
  const candidates = [
    hasClientService(client, 'vat') && client.vat.status !== 'filed'
      ? {
          label: 'VAT',
          dueDate: client.vat.dueDate,
          daysTilDue: client.vat.daysTilDue,
          metric: client.vat.payableTax !== null ? formatAed(client.vat.payableTax) : client.vat.cohortLabel,
        }
      : null,
    hasClientService(client, 'corporate_tax') && client.corporateTax.status !== 'filed'
      ? {
          label: 'CT',
          dueDate: client.corporateTax.dueDate,
          daysTilDue: client.corporateTax.daysTilDue,
          metric: client.corporateTax.taxPayable !== null ? formatAed(client.corporateTax.taxPayable) : 'Readiness',
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; dueDate: string | null; daysTilDue: number | null; metric: string }>;

  candidates.sort((a, b) => (a.daysTilDue ?? 99999) - (b.daysTilDue ?? 99999));
  const fallbackLabel = hasClientService(client, 'bookkeeping') ? 'Close' : hasClientService(client, 'accounting') ? 'Accounting' : 'Profile';
  return candidates[0] ?? {
    label: fallbackLabel,
    dueDate: client.vat.dueDate,
    daysTilDue: client.vat.daysTilDue,
    metric: `${client.bookkeeping.closeProgress}% close-ready`,
  };
}

function productionItem(client: BookkeeperClient, labelOverride?: string) {
  const deadline = primaryDeadline(client);
  return {
    client,
    label: labelOverride ?? deadline.label,
    dueDate: deadline.dueDate,
    daysTilDue: deadline.daysTilDue,
    metric: labelOverride === 'Close' ? `${client.bookkeeping.closeProgress}% close-ready` : deadline.metric,
  };
}

function sortProductionItems(items: ReturnType<typeof productionItem>[]) {
  return items.sort((a, b) => {
    const priorityDelta =
      (b.client.priority === 'critical' ? 3 : b.client.priority === 'attention' ? 2 : 1)
      - (a.client.priority === 'critical' ? 3 : a.client.priority === 'attention' ? 2 : 1);
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
  const lanes = client ? [
    {
      key: 'vat',
      service: 'vat' as const,
      title: 'VAT',
      icon: Calendar,
      status: client.vat.status,
      due: `${formatDateShort(client.vat.dueDate)} · ${formatDays(client.vat.daysTilDue)}`,
      period: formatPeriod(client.vat.periodStart, client.vat.periodEnd),
      metric: client.vat.payableTax !== null ? formatAed(client.vat.payableTax) : client.vat.cohortLabel,
      blockers: client.vat.blockers,
    },
    {
      key: 'corporate-tax',
      service: 'corporate_tax' as const,
      title: 'Corporate Tax',
      icon: Calculator,
      status: client.corporateTax.status,
      due: `${formatDateShort(client.corporateTax.dueDate)} · ${formatDays(client.corporateTax.daysTilDue)}`,
      period: formatPeriod(client.corporateTax.periodStart, client.corporateTax.periodEnd),
      metric: client.corporateTax.taxPayable !== null ? formatAed(client.corporateTax.taxPayable) : 'Readiness',
      blockers: client.corporateTax.blockers,
    },
    {
      key: 'bookkeeping',
      service: 'bookkeeping' as const,
      title: 'Bookkeeping',
      icon: TrendingUp,
      status: client.bookkeeping.status,
      due: `${client.bookkeeping.closeProgress}% close-ready`,
      period: client.bookkeeping.daysSinceActivity === null ? 'No activity date' : `${client.bookkeeping.daysSinceActivity}d since activity`,
      metric: `${client.bookkeeping.unpostedReceiptCount} receipts · ${client.bookkeeping.unreconciledBankCount} bank lines`,
      blockers: client.bookkeeping.blockers,
    },
    {
      key: 'accounting',
      service: 'accounting' as const,
      title: 'Accounting',
      icon: CheckCircle2,
      status: client.accounting.status,
      due: client.accounting.trialBalanceBalanced ? 'Balanced' : 'Needs review',
      period: client.accounting.discrepancy > 0 ? formatAed(client.accounting.discrepancy) : 'No variance',
      metric: client.accounting.trialBalanceBalanced ? 'Trial balance clean' : 'Trial balance variance',
      blockers: client.accounting.blockers,
    },
  ].filter(lane => hasClientService(client, lane.service)) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{client?.companyName ?? 'Client Operations Brief'}</DialogTitle>
          <DialogDescription>
            {client ? `${ownerPreview(client.assignedStaff.map(staff => staff.name))} · ${client.nextBestAction}` : 'Operational status'}
          </DialogDescription>
        </DialogHeader>

        {client && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Priority</p>
                <div className="mt-1"><PriorityBadge priority={client.priority} /></div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="text-sm font-medium mt-1 truncate">{ownerPreview(client.assignedStaff.map(staff => staff.name))}</p>
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
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground mb-2">NR services for this client</p>
              <ServiceScopeBadges services={client.serviceScope} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lanes.map(lane => {
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
                        lane.blockers.slice(0, 4).map(blocker => (
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
          <Button variant="outline" onClick={() => client && onViewProfile(client.companyId)} disabled={!client}>
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
  const [activeQueue, setActiveQueue] = useState<BookkeeperQueueKey>('vat');
  const dashboardClients = useMemo(() => dashboard?.clients ?? [], [dashboard?.clients]);
  const workloadOwners = useMemo(() => dashboard?.workload?.owners ?? [], [dashboard?.workload?.owners]);
  const priorityClients = dashboardClients.slice(0, 5);
  const activeQueueItems = dashboard?.queues?.[activeQueue] ?? [];
  const productionBuckets = useMemo(() => {
    const deadlineItems = sortProductionItems(dashboardClients.map(client => productionItem(client)));
    return [
      {
        key: 'overdue',
        title: 'Overdue / Due Now',
        icon: AlertTriangle,
        items: deadlineItems.filter(item => item.daysTilDue !== null && item.daysTilDue <= 0).slice(0, 5),
      },
      {
        key: 'week',
        title: 'This Week',
        icon: Clock,
        items: deadlineItems.filter(item => item.daysTilDue !== null && item.daysTilDue > 0 && item.daysTilDue <= 7).slice(0, 5),
      },
      {
        key: 'month',
        title: 'Next 28 Days',
        icon: Calendar,
        items: deadlineItems.filter(item => item.daysTilDue !== null && item.daysTilDue > 7 && item.daysTilDue <= 28).slice(0, 5),
      },
      {
        key: 'blocked',
        title: 'Close Blockers',
        icon: TrendingUp,
        items: sortProductionItems(
          dashboardClients
            .filter(client => client.bookkeeping.status !== 'on_track')
            .map(client => productionItem(client, 'Close')),
        ).slice(0, 5),
      },
      {
        key: 'unassigned',
        title: 'Unassigned',
        icon: UserCheck,
        items: deadlineItems.filter(item => item.client.assignedStaff.length === 0).slice(0, 5),
      },
    ];
  }, [dashboardClients]);
  const capacityPlanner = useMemo(() => {
    const unassigned = dashboardClients
      .filter(client => client.assignedStaff.length === 0)
      .sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority))
      .slice(0, 5);
    const overloaded = workloadOwners
      .filter(owner => owner.staffId !== null && (owner.critical >= 3 || owner.clientCount >= 15 || owner.averageCloseProgress < 60))
      .slice(0, 5);
    const openCapacity = workloadOwners
      .filter(owner => owner.staffId !== null && owner.clientCount < 10 && owner.critical === 0 && owner.averageCloseProgress >= 70)
      .sort((a, b) => a.clientCount - b.clientCount || b.averageCloseProgress - a.averageCloseProgress)
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
      high: rankedClients.filter(client => clientIntervention(client).level === 'high').slice(0, 4),
      watchlist: rankedClients.filter(client => clientIntervention(client).level === 'medium').slice(0, 4),
      exposure: rankedClients
        .filter(client => clientIntervention(client).exposureAed > 0)
        .sort((a, b) => clientIntervention(b).exposureAed - clientIntervention(a).exposureAed)
        .slice(0, 4),
    };
  }, [dashboardClients]);
  const serviceLaneForecast = useMemo(() => {
    const clients = dashboardClients;
    const corporateTaxClients = clients.filter(client => hasClientService(client, 'corporate_tax'));
    const bookkeepingClients = clients.filter(client => hasClientService(client, 'bookkeeping'));
    const accountingClients = clients.filter(client => hasClientService(client, 'accounting'));
    const makeRow = (
      label: string,
      rowClients: BookkeeperClient[],
      metric: string,
      action: string,
      risk: BookkeeperPriority | 'filed' = 'on_track',
    ) => ({
      label,
      count: rowClients.length,
      metric,
      action,
      risk,
      primaryCompanyId: rowClients[0]?.companyId,
      sample: rowClients.slice(0, 2).map(client => client.companyName).join(', '),
    });
    const sortedByIntervention = (rowClients: BookkeeperClient[]) =>
      [...rowClients].sort((a, b) => clientIntervention(b).score - clientIntervention(a).score);
    const ctOpen = corporateTaxClients.filter(client => client.corporateTax.status !== 'filed');
    const bookkeepingBlocked = sortedByIntervention(bookkeepingClients.filter(client => client.bookkeeping.status === 'critical'));
    const bookkeepingAttention = sortedByIntervention(bookkeepingClients.filter(client => client.bookkeeping.status === 'attention'));
    const bookkeepingReady = bookkeepingClients
      .filter(client => client.bookkeeping.status === 'on_track' && client.bookkeeping.closeProgress >= 90)
      .sort((a, b) => b.bookkeeping.closeProgress - a.bookkeeping.closeProgress);
    const accountingVariance = sortedByIntervention(accountingClients.filter(client => client.accounting.status === 'critical'));
    const accountingReview = sortedByIntervention(accountingClients.filter(client => client.accounting.status === 'attention'));
    const accountingClean = accountingClients.filter(client => client.accounting.status === 'on_track');

    return [
      {
        key: 'vat',
        title: 'VAT Cohorts',
        icon: Calendar,
        rows: (dashboard?.vatCohorts ?? []).slice(0, 3).map(cohort => ({
          label: cohort.label,
          count: cohort.clientCount,
          metric: `${cohort.dueSoon} due · ${cohort.blocked} blocked`,
          action: cohort.blocked > 0 ? 'Clear blockers' : cohort.dueSoon > 0 ? 'Prepare returns' : 'Monitor cohort',
          risk: cohort.blocked > 0 ? 'critical' as const : cohort.dueSoon > 0 ? 'attention' as const : 'on_track' as const,
          primaryCompanyId: cohort.clients[0]?.companyId,
          sample: cohort.clients.slice(0, 2).map(client => client.companyName).join(', '),
        })),
      },
      {
        key: 'ct',
        title: 'Corporate Tax',
        icon: Calculator,
        rows: [
          makeRow('Due in 30d', sortedByIntervention(ctOpen.filter(client => (client.corporateTax.daysTilDue ?? 9999) <= 30)), 'urgent filings', 'Lock filing plan', 'critical'),
          makeRow('Due in 90d', sortedByIntervention(ctOpen.filter(client => {
            const days = client.corporateTax.daysTilDue ?? 9999;
            return days > 30 && days <= 90;
          })), 'preparation window', 'Start readiness review', 'attention'),
          makeRow('Future / parked', sortedByIntervention(ctOpen.filter(client => (client.corporateTax.daysTilDue ?? 9999) > 90)), 'future filings', 'Monitor readiness'),
        ],
      },
      {
        key: 'bookkeeping',
        title: 'Bookkeeping Close',
        icon: TrendingUp,
        rows: [
          makeRow('Blocked', bookkeepingBlocked, 'source docs / bank gaps', 'Clear blockers', 'critical'),
          makeRow('In progress', bookkeepingAttention, 'needs staff push', 'Finish close work', 'attention'),
          makeRow('Review-ready', bookkeepingReady, '90%+ close-ready', 'Manager review'),
        ],
      },
      {
        key: 'accounting',
        title: 'Accounting Review',
        icon: CheckCircle2,
        rows: [
          makeRow('TB variance', accountingVariance, 'requires correction', 'Review journals', 'critical'),
          makeRow('Needs journals', accountingReview, 'posting required', 'Post activity', 'attention'),
          makeRow('Clean files', accountingClean, 'balanced ledgers', 'Keep cadence'),
        ],
      },
    ];
  }, [dashboardClients, dashboard?.vatCohorts]);
  const ctClients = dashboardClients
    .filter(client => hasClientService(client, 'corporate_tax') && client.corporateTax.status !== 'filed')
    .sort((a, b) => (a.corporateTax.daysTilDue ?? 9999) - (b.corporateTax.daysTilDue ?? 9999))
    .slice(0, 4);
  const closeClients = dashboardClients
    .filter(client => hasClientService(client, 'bookkeeping') && client.bookkeeping.status !== 'on_track')
    .slice(0, 4);
  const accountingClients = dashboardClients
    .filter(client => hasClientService(client, 'accounting') && client.accounting.status !== 'on_track')
    .slice(0, 4);

  return (
    <section className="space-y-4" data-testid="bookkeeper-command-center">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">NR Bookkeeper Command Center</h2>
          <p className="text-sm text-muted-foreground">
            VAT cohorts, corporate tax deadlines, monthly close blockers, and accounting review across the client portfolio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
            <Clock className="w-3.5 h-3.5" />
            {dashboard?.generatedAt ? `Updated ${format(new Date(dashboard.generatedAt), 'MMM d, HH:mm')}` : 'Loading'}
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
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.corporateTaxDue90Days ?? 0}</p>
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
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Client Service Matrix
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Scope every client by service before planning VAT, corporate tax, bookkeeping, or accounting work.
              </p>
            </div>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(dashboard?.serviceMatrix ?? CLIENT_SERVICE_OPTIONS.map(option => ({
              code: option.code,
              label: option.label,
              shortLabel: option.shortLabel,
              clientCount: 0,
              critical: 0,
              attention: 0,
            }))).map(service => (
              <div key={service.code} className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">{service.label}</p>
                <p className="text-2xl font-bold mt-1">{service.clientCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {service.critical} critical · {service.attention} attention
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
              Production Planner
            </CardTitle>
            <Badge variant="outline">
              {productionBuckets.reduce((total, bucket) => total + bucket.items.length, 0)} visible items
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {productionBuckets.map(bucket => {
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
                    {bucket.items.map(item => (
                      <button
                        key={`${bucket.key}-${item.client.companyId}`}
                        type="button"
                        onClick={() => onOpenBrief(item.client.companyId)}
                        className="w-full rounded-md border bg-background px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.client.companyName}</p>
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
                <Badge variant={capacityPlanner.unassigned.length > 0 ? 'destructive' : 'outline'}>
                  {capacityPlanner.unassigned.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.unassigned.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    No unassigned clients
                  </div>
                )}
                {capacityPlanner.unassigned.map(client => (
                  <div key={`unassigned-${client.companyId}`} className="rounded-md border bg-background px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">{client.nextBestAction}</p>
                      </div>
                      <PriorityBadge priority={client.priority} />
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button size="sm" variant="outline" onClick={() => onOpenBrief(client.companyId)}>
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
                <Badge variant={capacityPlanner.overloaded.length > 0 ? 'secondary' : 'outline'}>
                  {capacityPlanner.overloaded.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.overloaded.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    No capacity pressure
                  </div>
                )}
                {capacityPlanner.overloaded.map(owner => (
                  <div key={`overloaded-${owner.staffId}`} className="rounded-md border bg-background px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{owner.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                        </p>
                      </div>
                      <Badge variant={owner.critical > 0 ? 'destructive' : 'secondary'}>{owner.critical} critical</Badge>
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
                {capacityPlanner.openCapacity.map(owner => (
                  <div key={`capacity-${owner.staffId}`} className="rounded-md border bg-background px-3 py-2">
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
                Prioritize files by deadline pressure, source-document gaps, owner gaps, and collection exposure.
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant={(dashboard?.summary.interventionHigh ?? interventionRadar.high.length) > 0 ? 'destructive' : 'outline'}>
                {dashboard?.summary.interventionHigh ?? interventionRadar.high.length} high
              </Badge>
              <Badge variant="secondary">
                {dashboard?.summary.interventionMedium ?? interventionRadar.watchlist.length} watchlist
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Escalate Today</p>
                <Badge variant={interventionRadar.high.length > 0 ? 'destructive' : 'outline'}>{interventionRadar.high.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.high.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    No high-risk interventions
                  </div>
                )}
                {interventionRadar.high.map(client => {
                  const intervention = clientIntervention(client);
                  return (
                    <div key={`intervention-high-${client.companyId}`} className="rounded-md border bg-background px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground truncate">{intervention.title}</p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>{intervention.score}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{intervention.deadlineLabel}</p>
                      <p className="text-xs font-medium mt-1">{intervention.ownerAction}</p>
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" variant="outline" onClick={() => onOpenBrief(client.companyId)}>
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
                {interventionRadar.watchlist.map(client => {
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
                          <p className="text-xs text-muted-foreground truncate">{intervention.ownerAction}</p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>{intervention.score}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {intervention.reasons.slice(0, 2).join(' · ')}
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
                {interventionRadar.exposure.map(client => {
                  const intervention = clientIntervention(client);
                  return (
                    <div key={`intervention-exposure-${client.companyId}`} className="rounded-md border bg-background px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground">{client.bookkeeping.overdueInvoiceCount} overdue invoices</p>
                        </div>
                        <Badge variant="outline">{formatAed(intervention.exposureAed)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">{intervention.ownerAction}</p>
                      <div className="flex gap-1 mt-2">
                        <Button size="sm" variant="outline" onClick={() => onOpenBrief(client.companyId)}>
                          Brief
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onViewProfile(client.companyId)}>
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
                One portfolio view for VAT cohorts, corporate tax, bookkeeping close, and accounting review cadence.
              </p>
            </div>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {serviceLaneForecast.map(lane => {
              const Icon = lane.icon;
              return (
                <div key={lane.key} className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    {lane.title}
                  </p>
                  <div className="mt-3 space-y-2">
                    {lane.rows.map(row => (
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
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">{row.sample || 'No active clients'}</p>
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
              {(Object.keys(queueConfig) as BookkeeperQueueKey[]).map(key => {
                const Icon = queueConfig[key].icon;
                const count = dashboard?.queues?.[key]?.length ?? 0;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={activeQueue === key ? 'secondary' : 'outline'}
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
              {activeQueueItems.slice(0, 6).map(item => (
                <div key={`${activeQueue}-${item.companyId}`} className="rounded-md border px-3 py-2.5">
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
                        <span>{formatDateShort(item.dueDate)} · {formatDays(item.daysTilDue)}</span>
                        {item.blockers.length > 1 && <span>{item.blockers.length} blockers</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 sm:shrink-0">
                      <Button size="sm" variant="outline" onClick={() => onOpenBrief(item.companyId)}>
                        Brief
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onViewProfile(item.companyId)}>
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
                <Badge variant="destructive">{dashboard?.workload?.unassignedClients} unassigned</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {workloadOwners.length === 0 && <p className="text-sm text-muted-foreground">No staff workload yet.</p>}
            {workloadOwners.slice(0, 6).map(owner => (
              <div key={owner.staffId ?? 'unassigned'} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{owner.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                    </p>
                  </div>
                  <Badge variant={owner.critical > 0 ? 'destructive' : owner.attention > 0 ? 'secondary' : 'outline'}>
                    {owner.critical > 0 ? `${owner.critical} critical` : `${owner.attention} attention`}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${owner.averageCloseProgress}%` }} />
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
            {(dashboard?.vatCohorts ?? []).slice(0, 3).map(cohort => (
              <div key={cohort.key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{cohort.label}</p>
                    <p className="text-xs text-muted-foreground">{cohort.clientCount} clients</p>
                  </div>
                  <div className="flex gap-1">
                    {cohort.dueSoon > 0 && <Badge className="bg-amber-100 text-amber-800 border-amber-200">{cohort.dueSoon} due</Badge>}
                    {cohort.blocked > 0 && <Badge variant="destructive">{cohort.blocked} blocked</Badge>}
                  </div>
                </div>
                <div className="space-y-2 min-h-[132px]">
                  {cohort.clients.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-sm text-muted-foreground text-center">
                      No clients in this cohort
                    </div>
                  )}
                  {cohort.clients.slice(0, 4).map(client => (
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
                      <p className="text-xs text-muted-foreground mt-1 truncate">{blockerPreview(client.blockers)}</p>
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
            {priorityClients.length === 0 && <p className="text-sm text-muted-foreground">No clients yet.</p>}
            {priorityClients.map(client => (
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
                <p className="text-xs text-muted-foreground mt-1 truncate">{client.nextBestAction}</p>
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
            {ctClients.length === 0 && <p className="text-sm text-muted-foreground">No CT deadlines requiring action.</p>}
            {ctClients.map(client => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs text-muted-foreground">{formatDays(client.corporateTax.daysTilDue)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{blockerPreview(client.corporateTax.blockers)}</p>
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
            {closeClients.length === 0 && <p className="text-sm text-muted-foreground">Monthly close is on track.</p>}
            {closeClients.map(client => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs font-medium">{client.bookkeeping.closeProgress}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${client.bookkeeping.closeProgress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{blockerPreview(client.bookkeeping.blockers)}</p>
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
            {accountingClients.length === 0 && <p className="text-sm text-muted-foreground">Trial balances are clean.</p>}
            {accountingClients.map(client => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <PriorityBadge priority={client.accounting.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{blockerPreview(client.accounting.blockers)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function RevenueGrowthPanel({ onOpenClient }: { onOpenClient: (companyId: string) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<GrowthDashboard>({
    queryKey: ['/api/firm/growth-opportunities'],
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/firm/growth-opportunities/refresh'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/growth-opportunities'] });
      toast({ title: 'Revenue opportunities refreshed' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not refresh revenue opportunities', description: e?.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, actionType, resolutionNote }: { id: string; status: GrowthOpportunityStatus; actionType: string; resolutionNote?: string }) =>
      apiRequest('PATCH', `/api/firm/growth-opportunities/${id}`, { status, actionType, resolutionNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/growth-opportunities'] });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not update opportunity', description: e?.message }),
  });

  const opportunities = data?.opportunities ?? [];
  const active = opportunities
    .filter(item => item.status !== 'dismissed' && item.status !== 'completed')
    .slice(0, 6);
  const summary = data?.summary ?? { estimated: 0, accepted: 0, completed: 0, missed: 0, openCount: 0 };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Revenue Growth
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Internal opportunity queue for service AR, cleanup work, advisory packs, and compliance extras.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Signals
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Open pipeline</p>
            <p className="text-lg font-semibold">{formatAed(summary.estimated)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Accepted</p>
            <p className="text-lg font-semibold">{formatAed(summary.accepted)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-lg font-semibold">{formatAed(summary.completed)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Open count</p>
            <p className="text-lg font-semibold">{summary.openCount}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading revenue signals...</p>
        ) : active.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No active revenue opportunities yet. Refresh signals after new AR, cleanup, or compliance data lands.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map(opportunity => (
              <div key={opportunity.id} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{opportunity.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{opportunity.companyName ?? 'Client'}</p>
                  </div>
                  <Badge variant={opportunity.priority === 'critical' ? 'destructive' : 'outline'}>
                    {opportunity.priority}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{opportunity.reason}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{formatAed(Number(opportunity.estimatedValue ?? 0))}</span>
                  <span className="text-muted-foreground">{Math.round(Number(opportunity.confidence ?? 0) * 100)}% confidence</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenClient(opportunity.companyId)}
                  >
                    Client
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateMutation.mutate({ id: opportunity.id, status: 'accepted', actionType: 'accept' })}
                    disabled={updateMutation.isPending}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: opportunity.id, status: 'completed', actionType: 'complete' })}
                    disabled={updateMutation.isPending}
                  >
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateMutation.mutate({
                      id: opportunity.id,
                      status: 'dismissed',
                      actionType: 'dismiss',
                      resolutionNote: 'Dismissed from Client Operations.',
                    })}
                    disabled={updateMutation.isPending}
                  >
                    Dismiss
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
  const { data } = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ['/api/firm/vat-workpapers'],
  });
  const workpapers = data?.workpapers ?? [];
  const draftCount = workpapers.filter(workpaper => workpaper.status === 'draft' || workpaper.status === 'in_review').length;
  const dueClients = (dashboard?.clients ?? [])
    .filter(client => hasClientService(client, 'vat') && client.vat.status !== 'filed')
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
              VAT Submission Workspace
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              VAT-only workpapers for invoice rows, OCR drafts, evidence, and copy-ready VAT 201 figures.
            </p>
          </div>
          <Badge variant="outline">{draftCount} draft/review workpapers</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">VAT queue</p>
            <span className="text-xs text-muted-foreground">{dashboard?.summary.vatDue28Days ?? 0} due in 28d</span>
          </div>
          {dueClients.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No VAT queue items need action.</div>
          ) : (
            dueClients.map(client => (
              <div key={client.companyId} className="rounded-md border p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{client.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {client.vat.cohortLabel} · {formatPeriod(client.vat.periodStart, client.vat.periodEnd)} · {formatDays(client.vat.daysTilDue)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(client.companyId)}>
                  Workspace
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Recent workpapers</p>
            <span className="text-xs text-muted-foreground">{workpapers.length} total</span>
          </div>
          {recentWorkpapers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No VAT workpapers yet. Open a client from the VAT queue to create one.
            </div>
          ) : (
            recentWorkpapers.map(workpaper => (
              <div key={workpaper.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{workpaper.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} · {workpaper.status}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(workpaper.companyId)}>
                  Open
                </Button>
              </div>
            ))
          )}
          {clients.length > 0 && dueClients.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(clients[0].id)}>
              Create for first client
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
  const { toast } = useToast();
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceInputKey, setEvidenceInputKey] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState('grid');
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowForm, setRowForm] = useState({
    rowCategory: 'standard_sale' as VatRowCategory,
    vat201Box: 'box1bDubaiAmount',
    invoiceNumber: '',
    documentDate: '',
    counterpartyName: '',
    counterpartyTrn: '',
    emirate: client?.emirate ?? 'dubai',
    taxableAmount: '',
    vatAmount: '',
    adjustmentAmount: '',
    grossAmount: '',
    notes: '',
    auditReason: '',
    status: 'approved' as VatWorkpaperRow['status'],
    sourceMethod: 'manual' as VatWorkpaperRow['sourceMethod'],
  });
  const [pastedVatRows, setPastedVatRows] = useState('');

  useEffect(() => {
    if (!open || !client) return;
    setPeriodStart(inputDate(ops?.vat.periodStart) || format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
    setPeriodEnd(inputDate(ops?.vat.periodEnd) || format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));
    setDueDate(inputDate(ops?.vat.dueDate));
    setRowForm(form => ({ ...form, emirate: client.emirate ?? 'dubai' }));
  }, [client, open, ops?.vat.dueDate, ops?.vat.periodEnd, ops?.vat.periodStart]);

  const workpapersQuery = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ['/api/firm/vat-workpapers', client?.id],
    queryFn: () => apiRequest('GET', `/api/firm/vat-workpapers?companyId=${client?.id}`),
    enabled: open && !!client,
  });
  const workpapers = workpapersQuery.data?.workpapers ?? [];

  useEffect(() => {
    if (!open) return;
    if (!selectedWorkpaperId && workpapers.length > 0) setSelectedWorkpaperId(workpapers[0].id);
    if (selectedWorkpaperId && workpapers.length > 0 && !workpapers.some(workpaper => workpaper.id === selectedWorkpaperId)) {
      setSelectedWorkpaperId(workpapers[0].id);
    }
  }, [open, selectedWorkpaperId, workpapers]);

  const detailQuery = useQuery<VatWorkpaperDetail>({
    queryKey: ['/api/firm/vat-workpapers/detail', selectedWorkpaperId],
    queryFn: () => apiRequest('GET', `/api/firm/vat-workpapers/${selectedWorkpaperId}`),
    enabled: open && !!selectedWorkpaperId,
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/firm/vat-workpapers', {
      companyId: client?.id,
      periodStart,
      periodEnd,
      dueDate: dueDate || null,
    }),
    onSuccess: (workpaper: VatWorkpaperSummary) => {
      setSelectedWorkpaperId(workpaper.id);
      queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers', client?.id] });
      toast({ title: 'VAT workpaper ready' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not create VAT workpaper', description: e?.message }),
  });

  const invalidateWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers', client?.id] });
    queryClient.invalidateQueries({ queryKey: ['/api/firm/vat-workpapers/detail', selectedWorkpaperId] });
  };

  const rowPayload = (overrides?: Partial<Pick<VatWorkpaperRow, 'status' | 'sourceMethod'>>) => ({
    rowCategory: rowForm.rowCategory,
    vat201Box: rowForm.rowCategory === 'manual_adjustment' ? rowForm.vat201Box : undefined,
    invoiceNumber: rowForm.invoiceNumber || null,
    documentDate: rowForm.documentDate || null,
    counterpartyName: rowForm.counterpartyName || null,
    counterpartyTrn: rowForm.counterpartyTrn || null,
    emirate: rowForm.emirate || null,
    taxableAmount: Number(rowForm.taxableAmount || 0),
    vatAmount: Number(rowForm.vatAmount || 0),
    adjustmentAmount: Number(rowForm.adjustmentAmount || 0),
    grossAmount: Number(rowForm.grossAmount || 0),
    status: overrides?.status ?? rowForm.status,
    sourceMethod: overrides?.sourceMethod ?? rowForm.sourceMethod,
    notes: rowForm.notes || null,
    auditReason: rowForm.auditReason || null,
  });

  const resetRowForm = () => {
    setEditingRowId(null);
    setRowForm(form => ({
      ...form,
      status: 'approved',
      sourceMethod: 'manual',
      invoiceNumber: '',
      documentDate: '',
      counterpartyName: '',
      counterpartyTrn: '',
      taxableAmount: '',
      vatAmount: '',
      adjustmentAmount: '',
      grossAmount: '',
      notes: '',
      auditReason: '',
    }));
  };

  const editVatRow = (row: VatWorkpaperRow) => {
    setEditingRowId(row.id);
    setWorkspaceTab('grid');
    setRowForm({
      rowCategory: row.rowCategory,
      vat201Box: row.vat201Box || 'box1bDubaiAmount',
      invoiceNumber: row.invoiceNumber ?? '',
      documentDate: inputDate(row.documentDate),
      counterpartyName: row.counterpartyName ?? '',
      counterpartyTrn: row.counterpartyTrn ?? '',
      emirate: row.emirate ?? client?.emirate ?? 'dubai',
      taxableAmount: String(row.taxableAmount ?? ''),
      vatAmount: String(row.vatAmount ?? ''),
      adjustmentAmount: String(row.adjustmentAmount ?? ''),
      grossAmount: String(row.grossAmount ?? ''),
      notes: row.notes ?? '',
      auditReason: row.auditReason ?? '',
      status: row.status,
      sourceMethod: row.sourceMethod,
    });
  };

  const addRowMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, rowPayload({
      status: 'approved',
      sourceMethod: 'manual',
    })),
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not add VAT row', description: e?.message }),
  });

  const saveRowMutation = useMutation({
    mutationFn: () => {
      if (!editingRowId) throw new Error('Choose a VAT row to update first');
      return apiRequest('PATCH', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${editingRowId}`, rowPayload());
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      toast({ title: 'VAT row updated' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not update VAT row', description: e?.message }),
  });

  const pastePreviewRows = useMemo(
    () => parseVatPasteRows(pastedVatRows, rowForm.emirate),
    [pastedVatRows, rowForm.emirate],
  );

  const importRowsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkpaperId) throw new Error('Create or select a VAT workpaper first');
      const rowsToImport = parseVatPasteRows(pastedVatRows, rowForm.emirate);
      if (rowsToImport.length === 0) throw new Error('Paste at least one VAT row');
      for (const row of rowsToImport) {
        await apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, row);
      }
      return rowsToImport.length;
    },
    onSuccess: (count: number) => {
      invalidateWorkspace();
      setPastedVatRows('');
      toast({ title: 'VAT rows imported', description: `${count} row${count === 1 ? '' : 's'} added as approved import rows.` });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not import VAT rows', description: e?.message }),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const uploadedEvidence = evidenceFile
        ? {
            fileDataBase64: await readFileAsBase64(evidenceFile),
            extractedText: await readEvidenceText(evidenceFile),
          }
        : null;

      return apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/scan`, {
        attachment: {
          fileName: evidenceFile?.name || (rowForm.invoiceNumber ? `${rowForm.invoiceNumber}.scan` : 'vat-evidence.scan'),
          mimeType: evidenceFile?.type || 'application/octet-stream',
          fileDataBase64: uploadedEvidence?.fileDataBase64,
          extractedText: rowForm.notes || uploadedEvidence?.extractedText || null,
          extractionJson: {
            source: evidenceFile ? 'uploaded_evidence' : 'manual_ocr_review',
            originalSize: evidenceFile?.size,
            originalLastModified: evidenceFile ? new Date(evidenceFile.lastModified).toISOString() : undefined,
          },
        },
        draftRow: rowPayload({
          status: 'draft',
          sourceMethod: 'ocr',
        }),
      });
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      setEvidenceFile(null);
      setEvidenceInputKey(key => key + 1);
      toast({ title: 'OCR draft row logged for review' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not log OCR draft', description: e?.message }),
  });

  const updateRowMutation = useMutation({
    mutationFn: ({ rowId, status }: { rowId: string; status: 'approved' | 'excluded' }) =>
      apiRequest('PATCH', `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`, { status }),
    onSuccess: invalidateWorkspace,
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not update VAT row', description: e?.message }),
  });

  const recalculateMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/recalculate`),
    onSuccess: invalidateWorkspace,
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not recalculate VAT workpaper', description: e?.message }),
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/vat-workpapers/${selectedWorkpaperId}/generate-return`),
    onSuccess: () => {
      invalidateWorkspace();
      toast({ title: 'VAT return generated for review', description: 'No FTA submission was performed.' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Could not generate VAT return', description: e?.message }),
  });

  const detail = detailQuery.data;
  const rows = detail?.rows ?? [];
  const totals = detail?.totals ?? detail?.workpaper.totalsSnapshot ?? {};
  const draftRows = rows.filter(row => row.status === 'draft');
  const approvedRows = rows.filter(row => row.status === 'approved');
  const excludedRows = rows.filter(row => row.status === 'excluded');
  const sourceBackedRows = approvedRows.filter(row => row.sourceMethod !== 'manual' || row.invoiceNumber || row.counterpartyName);
  const outputVat = Number(totals.box8TotalVat ?? 0);
  const inputVat = Number(totals.box11TotalVat ?? 0);
  const payableVat = Number(totals.box14PayableTax ?? 0);
  const attachments = detail?.attachments ?? [];
  const selectedSummary = workpapers.find(workpaper => workpaper.id === selectedWorkpaperId);

  const downloadAttachment = async (attachment: VatWorkpaperAttachment) => {
    if (!selectedWorkpaperId || !attachment.filePath) {
      toast({
        variant: 'destructive',
        title: 'Evidence file is not downloadable',
        description: 'This evidence record was logged before file storage was enabled.',
      });
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/firm/vat-workpapers/${selectedWorkpaperId}/attachments/${attachment.id}/download`), {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Could not download evidence', description: error?.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client?.name ?? 'VAT Submission Workspace'}</DialogTitle>
          <DialogDescription>
            Bookkeeper VAT workbook for invoice entry, scanned evidence, draft OCR review, VAT 201 totals, and copy-paste FTA filing figures. No FTA submission happens here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="grid gap-1">
                <Label>Period start</Label>
                <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Period end</Label>
                <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Due date</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Workpaper</Label>
                <Select value={selectedWorkpaperId ?? ''} onValueChange={setSelectedWorkpaperId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select workpaper" />
                  </SelectTrigger>
                  <SelectContent>
                    {workpapers.map(workpaper => (
                      <SelectItem key={workpaper.id} value={workpaper.id}>
                        {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} · {workpaper.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => createMutation.mutate()} disabled={!client || !periodStart || !periodEnd || createMutation.isPending}>
                <Plus className="w-4 h-4 mr-2" />
                Create/Open
              </Button>
              <Button variant="outline" onClick={() => recalculateMutation.mutate()} disabled={!selectedWorkpaperId || recalculateMutation.isPending}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {selectedSummary || detail ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-semibold">{detail?.workpaper.status ?? selectedSummary?.status}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Approved rows</p>
                  <p className="font-semibold">{approvedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Draft / excluded</p>
                  <p className="font-semibold">{draftRows.length} / {excludedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Evidence-backed</p>
                  <p className="font-semibold">{sourceBackedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Output / input VAT</p>
                  <p className="font-semibold">{formatAed(outputVat)} / {formatAed(inputVat)}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Net payable</p>
                  <p className="font-semibold">{formatAed(payableVat)}</p>
                </div>
              </div>

              <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="space-y-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="grid">Entry Grid</TabsTrigger>
                  <TabsTrigger value="drafts">OCR Drafts</TabsTrigger>
                  <TabsTrigger value="return">VAT 201 Review</TabsTrigger>
                  <TabsTrigger value="evidence">Evidence</TabsTrigger>
                </TabsList>

                <TabsContent value="grid" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)] gap-4">
                    <div className="rounded-md border overflow-hidden">
                      <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">Invoice and bill entry grid</p>
                          <p className="text-xs text-muted-foreground">Edit rows, approve drafts, exclude mistakes, then review totals in VAT 201 Review.</p>
                        </div>
                        <Badge variant="outline">{rows.length} row{rows.length === 1 ? '' : 's'}</Badge>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-28">Source</TableHead>
                              <TableHead className="min-w-36">Invoice</TableHead>
                              <TableHead className="min-w-36">Date</TableHead>
                              <TableHead className="min-w-56">Customer / vendor</TableHead>
                              <TableHead className="min-w-36">TRN</TableHead>
                              <TableHead className="min-w-40">Category</TableHead>
                              <TableHead className="min-w-32">Emirate</TableHead>
                              <TableHead className="min-w-28 text-right">Taxable</TableHead>
                              <TableHead className="min-w-28 text-right">VAT</TableHead>
                              <TableHead className="min-w-28 text-right">Gross</TableHead>
                              <TableHead className="min-w-32">Status</TableHead>
                              <TableHead className="min-w-36 text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow className="bg-background">
                              <TableCell>
                                <Badge variant={editingRowId ? 'secondary' : 'outline'}>{editingRowId ? 'editing' : 'new row'}</Badge>
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-32" placeholder="INV-1001" value={rowForm.invoiceNumber} onChange={e => setRowForm(form => ({ ...form, invoiceNumber: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-32" type="date" value={rowForm.documentDate} onChange={e => setRowForm(form => ({ ...form, documentDate: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-48" placeholder="Customer / vendor" value={rowForm.counterpartyName} onChange={e => setRowForm(form => ({ ...form, counterpartyName: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-32" placeholder="TRN" value={rowForm.counterpartyTrn} onChange={e => setRowForm(form => ({ ...form, counterpartyTrn: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Select value={rowForm.rowCategory} onValueChange={value => setRowForm(form => ({ ...form, rowCategory: value as VatRowCategory }))}>
                                  <SelectTrigger className="h-8 min-w-40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {vatRowCategories.map(category => (
                                      <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select value={rowForm.emirate} onValueChange={value => setRowForm(form => ({ ...form, emirate: value }))}>
                                  <SelectTrigger className="h-8 min-w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {vatEmirates.map(emirate => (
                                      <SelectItem key={emirate.value} value={emirate.value}>{emirate.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-24 text-right" placeholder="0.00" value={rowForm.taxableAmount} onChange={e => setRowForm(form => ({ ...form, taxableAmount: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-24 text-right" placeholder="0.00" value={rowForm.vatAmount} onChange={e => setRowForm(form => ({ ...form, vatAmount: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Input className="h-8 min-w-24 text-right" placeholder="0.00" value={rowForm.grossAmount} onChange={e => setRowForm(form => ({ ...form, grossAmount: e.target.value }))} />
                              </TableCell>
                              <TableCell>
                                <Select value={rowForm.status} onValueChange={value => setRowForm(form => ({ ...form, status: value as VatWorkpaperRow['status'] }))}>
                                  <SelectTrigger className="h-8 min-w-28">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="approved">Approved</SelectItem>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="excluded">Excluded</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {editingRowId ? (
                                    <Button size="sm" onClick={() => saveRowMutation.mutate()} disabled={!selectedWorkpaperId || saveRowMutation.isPending}>
                                      Save
                                    </Button>
                                  ) : (
                                    <Button size="sm" onClick={() => addRowMutation.mutate()} disabled={!selectedWorkpaperId || addRowMutation.isPending}>
                                      Add
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={resetRowForm}>
                                    Clear
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {rows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={12} className="text-sm text-muted-foreground text-center py-8">
                                  No VAT rows yet. Add invoice lines manually, paste rows from Excel, or upload evidence as OCR drafts.
                                </TableCell>
                              </TableRow>
                            ) : (
                              rows.map(row => (
                                <TableRow key={row.id} className={editingRowId === row.id ? 'bg-primary/5' : undefined}>
                                  <TableCell>
                                    <Badge variant={row.sourceMethod === 'ocr' ? 'secondary' : 'outline'}>{row.sourceMethod}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <p className="font-medium">{row.invoiceNumber || '—'}</p>
                                    <p className="text-xs text-muted-foreground">{row.vat201Box}</p>
                                  </TableCell>
                                  <TableCell>{formatDateShort(row.documentDate)}</TableCell>
                                  <TableCell>
                                    <p className="max-w-56 truncate">{row.counterpartyName || '—'}</p>
                                  </TableCell>
                                  <TableCell className="text-xs">{row.counterpartyTrn || '—'}</TableCell>
                                  <TableCell className="text-sm">{vatRowCategoryLabel(row.rowCategory)}</TableCell>
                                  <TableCell className="text-sm">{row.emirate || '—'}</TableCell>
                                  <TableCell className="text-right">{formatAed(Number(row.taxableAmount ?? 0))}</TableCell>
                                  <TableCell className="text-right">{formatAed(Number(row.vatAmount ?? 0))}</TableCell>
                                  <TableCell className="text-right">{formatAed(Number(row.grossAmount ?? 0))}</TableCell>
                                  <TableCell>
                                    <Badge variant={row.status === 'approved' ? 'default' : row.status === 'excluded' ? 'outline' : 'secondary'}>
                                      {row.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button size="sm" variant="outline" onClick={() => editVatRow(row)}>
                                        Edit
                                      </Button>
                                      {row.status === 'draft' ? (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label={`Approve ${row.invoiceNumber || 'draft VAT row'}`}
                                            title="Approve draft VAT row"
                                            onClick={() => updateRowMutation.mutate({ rowId: row.id, status: 'approved' })}
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            <span className="sr-only">Approve draft row</span>
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label={`Exclude ${row.invoiceNumber || 'draft VAT row'}`}
                                            title="Exclude draft VAT row"
                                            onClick={() => updateRowMutation.mutate({ rowId: row.id, status: 'excluded' })}
                                          >
                                            <XCircle className="w-3.5 h-3.5" />
                                            <span className="sr-only">Exclude draft row</span>
                                          </Button>
                                        </>
                                      ) : (
                                        <Button size="sm" variant="ghost" onClick={() => updateRowMutation.mutate({ rowId: row.id, status: row.status === 'approved' ? 'excluded' : 'approved' })}>
                                          {row.status === 'approved' ? 'Exclude' : 'Approve'}
                                        </Button>
                                      )}
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
                          <p className="font-medium">Row notes and override reason</p>
                          <p className="text-xs text-muted-foreground">Manual adjustments must explain the audit reason before they can be saved.</p>
                        </div>
                        {rowForm.rowCategory === 'manual_adjustment' && (
                          <Input placeholder="VAT 201 box, e.g. box9ExpensesVat" value={rowForm.vat201Box} onChange={e => setRowForm(form => ({ ...form, vat201Box: e.target.value }))} />
                        )}
                        <Input placeholder="Adjustment amount" value={rowForm.adjustmentAmount} onChange={e => setRowForm(form => ({ ...form, adjustmentAmount: e.target.value }))} />
                        <Textarea placeholder="Notes / OCR text" value={rowForm.notes} onChange={e => setRowForm(form => ({ ...form, notes: e.target.value }))} className="min-h-24" />
                        <Textarea placeholder="Audit reason for overrides or manual adjustments" value={rowForm.auditReason} onChange={e => setRowForm(form => ({ ...form, auditReason: e.target.value }))} className="min-h-20" />
                      </div>

                      <div className="rounded-md border p-3 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium">Paste rows from Excel</p>
                            <p className="text-xs text-muted-foreground">
                              Headers are supported: category, invoice number, date, customer/vendor, TRN, emirate, taxable amount, VAT amount, gross amount, notes.
                            </p>
                          </div>
                          <Badge variant="outline">{pastePreviewRows.length} parsed</Badge>
                        </div>
                        <Textarea
                          value={pastedVatRows}
                          onChange={e => setPastedVatRows(e.target.value)}
                          placeholder={'category\tinvoice number\tdate\tcustomer/vendor\tTRN\temirate\ttaxable amount\tVAT amount\tgross amount\tnotes\nstandard_expense\tBILL-1001\t2026-05-18\tSupplier LLC\t100123456700003\tdubai\t1000\t50\t1050\tMay receipt'}
                          className="min-h-36 font-mono text-xs"
                          data-testid="textarea-vat-paste-rows"
                        />
                        {pastePreviewRows.length > 0 && (
                          <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                            Preview: {pastePreviewRows.slice(0, 3).map(row => `${row.invoiceNumber || 'No invoice'} ${formatAed(row.taxableAmount)} + VAT ${formatAed(row.vatAmount)}`).join(' · ')}
                            {pastePreviewRows.length > 3 ? ` · +${pastePreviewRows.length - 3} more` : ''}
                          </div>
                        )}
                        <Button
                          size="sm"
                          onClick={() => importRowsMutation.mutate()}
                          disabled={!selectedWorkpaperId || pastePreviewRows.length === 0 || importRowsMutation.isPending}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Add pasted rows
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="drafts" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
                    <div className="rounded-md border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">Upload invoice or receipt evidence</p>
                          <p className="text-xs text-muted-foreground">Uploaded files create draft OCR rows. They do not count until approved.</p>
                        </div>
                        {evidenceFile ? (
                          <Badge variant="secondary">{(evidenceFile.size / 1024).toFixed(1)} KB</Badge>
                        ) : null}
                      </div>
                      <Input
                        key={evidenceInputKey}
                        id="vat-evidence-upload"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,application/json"
                        onChange={event => setEvidenceFile(event.target.files?.[0] ?? null)}
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
                              setEvidenceInputKey(key => key + 1);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => scanMutation.mutate()} disabled={!selectedWorkpaperId || scanMutation.isPending}>
                        <ScanLine className="w-4 h-4 mr-2" />
                        Log OCR Draft
                      </Button>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="border-b bg-muted/30 px-3 py-2">
                        <p className="font-medium">Draft review queue</p>
                        <p className="text-xs text-muted-foreground">Approve only after the bookkeeper has checked the scanned values against evidence.</p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Counterparty</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">VAT</TableHead>
                            <TableHead className="text-right">Review</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draftRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-sm text-muted-foreground text-center py-8">No OCR drafts waiting for review.</TableCell>
                            </TableRow>
                          ) : (
                            draftRows.map(row => (
                              <TableRow key={row.id}>
                                <TableCell>{row.invoiceNumber || '—'}</TableCell>
                                <TableCell>{row.counterpartyName || '—'}</TableCell>
                                <TableCell>{vatRowCategoryLabel(row.rowCategory)}</TableCell>
                                <TableCell className="text-right">{formatAed(Number(row.vatAmount ?? 0))}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button size="sm" variant="outline" onClick={() => editVatRow(row)}>Edit</Button>
                                    <Button size="sm" variant="outline" onClick={() => updateRowMutation.mutate({ rowId: row.id, status: 'approved' })}>
                                      <Check className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => updateRowMutation.mutate({ rowId: row.id, status: 'excluded' })}>
                                      <XCircle className="w-3.5 h-3.5" />
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
                        <p className="font-medium">FTA VAT 201 copy fields</p>
                        <p className="text-xs text-muted-foreground">Approved rows are aggregated below. Copy each value into the FTA portal manually; this does not submit to FTA.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => recalculateMutation.mutate()} disabled={!selectedWorkpaperId || recalculateMutation.isPending}>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Recalculate
                        </Button>
                        <Button size="sm" onClick={() => generateMutation.mutate()} disabled={!selectedWorkpaperId || generateMutation.isPending}>
                          <FileText className="w-4 h-4 mr-2" />
                          Generate Return
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      {vat201CopyGroups.map(group => (
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
                                  className="rounded-md border p-2 text-left hover:bg-muted/50 transition-colors"
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
                        <p className="font-medium">Evidence files</p>
                        <p className="text-xs text-muted-foreground">Uploaded invoices and receipts stay linked to VAT rows for refund support and later review.</p>
                      </div>
                      <Badge variant="outline">{attachments.length} file{attachments.length === 1 ? '' : 's'}</Badge>
                    </div>
                    {attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No invoice evidence uploaded yet.</p>
                    ) : (
                      <div className="grid gap-2">
                        {attachments.map(attachment => (
                          <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                              <p className="text-xs text-muted-foreground">{attachment.mimeType || 'file'} · {formatDateShort(attachment.createdAt)}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void downloadAttachment(attachment)}
                              disabled={!attachment.filePath}
                            >
                              Download
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
              Create a VAT workpaper to start entering VAT rows and reviewing OCR drafts.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VatStatusBadge({ vatStatus }: { vatStatus: ClientWithStats['vatStatus'] }) {
  if (!vatStatus) return <Badge variant="outline">No VAT</Badge>;
  const due = new Date(vatStatus.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (vatStatus.status === 'filed' || vatStatus.status === 'submitted') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Filed</Badge>;
  }
  if (daysUntilDue < 0) {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  if (daysUntilDue <= 14) {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Due {format(due, 'MMM d')}</Badge>;
  }
  return <Badge variant="outline">Due {format(due, 'MMM d')}</Badge>;
}

function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
    : <Badge variant="secondary">Inactive</Badge>;
}

function clientNeedsAttention(c: ClientWithStats): boolean {
  // Mirror /api/firm/overview: a client needs attention if AR is outstanding
  // OR the latest VAT return is past its due date and not yet filed/submitted.
  // The list endpoint doesn't expose per-invoice due dates, so outstandingAr>0
  // is used as the AR proxy (slightly broader than server's overdue-only count).
  if (c.outstandingAr > 0) return true;
  if (c.vatStatus && c.vatStatus.status !== 'filed' && c.vatStatus.status !== 'submitted') {
    const due = new Date(c.vatStatus.dueDate);
    if (due < new Date()) return true;
  }
  return false;
}

function vatDueSoon(c: ClientWithStats): boolean {
  if (!c.vatStatus) return false;
  if (c.vatStatus.status === 'filed' || c.vatStatus.status === 'submitted') return false;
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
  name: '',
  trnVatNumber: '',
  industry: '',
  legalStructure: '',
  contactEmail: '',
  contactPhone: '',
  businessAddress: '',
  emirate: 'dubai',
  vatFilingFrequency: 'quarterly',
  vatPeriodStartMonth: '1',
  fiscalYearStartMonth: '1',
  corporateTaxId: '',
  serviceScope: [...DEFAULT_CLIENT_SERVICE_CODES],
};

type QuickFilter = 'all' | 'critical' | 'attention' | 'vat-due' | 'close-blocked' | 'unassigned' | 'no-docs';

export default function ClientPortfolio() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setActiveClientCompany } = useActiveCompany();
  const [view, setView] = useState<'card' | 'table'>('card');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [briefClientId, setBriefClientId] = useState<string | null>(null);
  const [vatWorkspaceClientId, setVatWorkspaceClientId] = useState<string | null>(null);
  const [form, setForm] = useState<AddClientFormData>(emptyForm);

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ['/api/firm/clients'],
  });

  const { data: overview } = useQuery<FirmOverview>({
    queryKey: ['/api/firm/overview'],
  });

  const { data: bookkeeperDashboard } = useQuery<BookkeeperDashboard>({
    queryKey: ['/api/firm/bookkeeper-dashboard'],
  });

  const bookkeeperByClientId = useMemo(() => {
    return new Map((bookkeeperDashboard?.clients ?? []).map(client => [client.companyId, client]));
  }, [bookkeeperDashboard]);

  const briefClient = useMemo(() => {
    return briefClientId ? bookkeeperByClientId.get(briefClientId) : undefined;
  }, [bookkeeperByClientId, briefClientId]);

  const vatWorkspaceClient = useMemo(() => {
    return vatWorkspaceClientId ? clients.find(client => client.id === vatWorkspaceClientId) : undefined;
  }, [clients, vatWorkspaceClientId]);

  const vatWorkspaceOps = useMemo(() => {
    return vatWorkspaceClientId ? bookkeeperByClientId.get(vatWorkspaceClientId) : undefined;
  }, [bookkeeperByClientId, vatWorkspaceClientId]);

  const createMutation = useMutation({
    mutationFn: (data: AddClientFormData) => apiRequest('POST', '/api/firm/clients', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/overview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/bookkeeper-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({ title: 'Client created successfully' });
      setAddOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Failed to create client', description: e?.message });
    },
  });

  const switchMutation = useMutation({
    mutationFn: (companyId: string) => apiRequest('POST', `/api/firm/clients/${companyId}/switch`),
    onSuccess: (_, companyId) => {
      setActiveClientCompany(companyId);
      // Force a refetch of /api/companies so the active company is in cache.
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      navigate('/dashboard');
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Could not open client books', description: e?.message });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Build base64 in chunks to avoid call-stack overflow on bigger files.
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const fileData = btoa(binary);
      return apiRequest('POST', '/api/firm/clients/import', { fileData }) as Promise<ImportResult>;
    },
    onSuccess: result => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['/api/firm/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/overview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/bookkeeper-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({
        title: `Imported ${result.created.length} clients`,
        description: result.errors.length > 0 ? `${result.errors.length} errors — see details.` : undefined,
      });
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Import failed', description: e?.message });
    },
  });

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const ops = bookkeeperByClientId.get(c.id);
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.trnVatNumber || '').toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      switch (quickFilter) {
        case 'critical':
          return ops?.priority === 'critical';
        case 'attention':
          return ops ? ops.priority === 'attention' || ops.priority === 'critical' : clientNeedsAttention(c);
        case 'vat-due':
          return ops
            ? hasClientService(ops, 'vat') && ops.vat.status !== 'filed' && ops.vat.daysTilDue !== null && ops.vat.daysTilDue <= 28
            : hasClientService(c, 'vat') && vatDueSoon(c);
        case 'close-blocked':
          return ops ? hasClientService(ops, 'bookkeeping') && ops.bookkeeping.status !== 'on_track' : false;
        case 'unassigned':
          return ops ? ops.assignedStaff.length === 0 : c.assignedStaff.length === 0;
        case 'no-docs':
          return c.invoiceCount === 0 && !c.lastReceiptDate;
        case 'all':
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
            {clients.length} client{clients.length !== 1 ? 's' : ''} managed by NRA
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setImportResult(null); setImportFile(null); setImportOpen(true); }}>
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
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Needs Attention</p>
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
        onManageStaff={() => navigate('/firm/staff')}
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
          variant={quickFilter === 'all' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('all')}
        >
          All ({clients.length})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'critical' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('critical')}
          data-testid="filter-critical"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Critical ({bookkeeperDashboard?.summary.critical ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'attention' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('attention')}
          data-testid="filter-attention"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Needs Attention ({(bookkeeperDashboard?.summary.critical ?? 0) + (bookkeeperDashboard?.summary.attention ?? 0)})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'vat-due' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('vat-due')}
          data-testid="filter-vat-due"
        >
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          VAT Due Soon ({bookkeeperDashboard?.summary.vatDue28Days ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'close-blocked' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('close-blocked')}
          data-testid="filter-close-blocked"
        >
          <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
          Close Blocked ({bookkeeperDashboard?.summary.bookkeepingBlocked ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'unassigned' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('unassigned')}
          data-testid="filter-unassigned"
        >
          <UserCheck className="w-3.5 h-3.5 mr-1.5" />
          Unassigned ({bookkeeperDashboard?.workload?.unassignedClients ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === 'no-docs' ? 'secondary' : 'outline'}
          onClick={() => setQuickFilter('no-docs')}
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
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-client-search"
          />
        </div>
        <div className="flex border rounded-md ml-auto">
          <Button
            variant={view === 'card' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-r-none"
            onClick={() => setView('card')}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-l-none"
            onClick={() => setView('table')}
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
            {clients.length === 0 ? 'No clients yet' : 'No clients match your filters'}
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? 'Add your first client company to get started.'
              : 'Try adjusting your search or quick filter.'}
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
                  <TableHead>Services</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>Corporate Tax</TableHead>
                  <TableHead>Close</TableHead>
                  <TableHead>Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 12).map(client => {
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
                        <p className="text-xs text-muted-foreground">{client.trnVatNumber || 'No TRN'}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops ? ownerPreview(ops.assignedStaff.map(staff => staff.name)) : ownerPreview(client.assignedStaff.map(staff => staff.name))}
                      </TableCell>
                      <TableCell>
                        <ServiceScopeBadges services={ops?.serviceScope ?? client.serviceScope} compact />
                      </TableCell>
                      <TableCell>{ops ? <PriorityBadge priority={ops.priority} /> : <StatusBadge active={client.invoiceCount > 0 || !!client.lastReceiptDate} />}</TableCell>
                      <TableCell className="text-sm">
                        {ops && hasClientService(ops, 'vat') ? (
                          <span>{formatDateShort(ops.vat.dueDate)} · {formatDays(ops.vat.daysTilDue)}</span>
                        ) : (
                          <Badge variant="outline">Not scoped</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops && hasClientService(ops, 'corporate_tax')
                          ? `${formatDateShort(ops.corporateTax.dueDate)} · ${formatDays(ops.corporateTax.daysTilDue)}`
                          : 'Not scoped'}
                      </TableCell>
                      <TableCell>
                        {ops && hasClientService(ops, 'bookkeeping') ? (
                          <div className="min-w-28">
                            <div className="flex items-center justify-between text-xs">
                              <span>{ops.bookkeeping.closeProgress}%</span>
                              <span className="text-muted-foreground">{priorityLabel(ops.bookkeeping.status)}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${ops.bookkeeping.closeProgress}%` }} />
                            </div>
                          </div>
                        ) : 'Not scoped'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2 min-w-64">
                          <p className="text-sm text-muted-foreground truncate">{ops?.nextBestAction ?? 'Open client profile'}</p>
                          <div className="flex gap-1">
                            {ops && (
                              <Button size="sm" variant="outline" onClick={() => setBriefClientId(client.id)}>
                                Brief
                              </Button>
                            )}
                            {(!ops || hasClientService(ops, 'vat')) && (
                              <Button size="sm" variant="outline" onClick={() => setVatWorkspaceClientId(client.id)}>
                                VAT
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => handleOpenBooks(client.id)} disabled={switchMutation.isPending}>
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
                Showing the first 12 clients for the selected filter. Use search or table view for the full list.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card view */}
      {view === 'card' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(client => {
            const ops = bookkeeperByClientId.get(client.id);
            return (
              <Card key={client.id} className="hover:shadow-md transition-shadow" data-testid={`client-card-${client.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{client.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {client.trnVatNumber ? `TRN: ${client.trnVatNumber}` : 'No TRN registered'}
                      </p>
                      <div className="mt-2">
                        <ServiceScopeBadges services={ops?.serviceScope ?? client.serviceScope} compact />
                      </div>
                    </div>
                    {ops ? <PriorityBadge priority={ops.priority} /> : <StatusBadge active={client.invoiceCount > 0 || !!client.lastReceiptDate} />}
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
                        <span className="text-xs font-medium shrink-0">{ops.bookkeeping.closeProgress}% close</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${ops.bookkeeping.closeProgress}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">Outstanding AR</p>
                      <p className="font-semibold text-sm mt-0.5">{formatAed(client.outstandingAr)}</p>
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
                    {ops && hasClientService(ops, 'vat')
                      ? <PriorityBadge priority={ops.vat.status} />
                      : <Badge variant="outline">Not scoped</Badge>}
                  </div>

                  {ops && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>{hasClientService(ops, 'vat') ? `VAT ${formatDays(ops.vat.daysTilDue)}` : 'VAT not scoped'}</span>
                      <span>{hasClientService(ops, 'corporate_tax') ? `CT ${formatDays(ops.corporateTax.daysTilDue)}` : 'CT not scoped'}</span>
                    </div>
                  )}

                  {/* Last activity */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Last receipt</span>
                    <span>
                      {client.lastReceiptDate
                        ? format(new Date(client.lastReceiptDate), 'MMM d, yyyy')
                        : 'Never'}
                    </span>
                  </div>

                  {/* Staff */}
                  {(ops?.assignedStaff.length ?? client.assignedStaff.length) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3.5 h-3.5" />
                      {ops ? ops.assignedStaff.map(s => s.name).join(', ') : client.assignedStaff.map(s => s.name).join(', ')}
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
                    {(!ops || hasClientService(ops, 'vat')) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVatWorkspaceClientId(client.id)}
                      >
                        VAT
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
      {view === 'table' && filtered.length > 0 && (
        <div className="border rounded-lg overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Services</TableHead>
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
              {filtered.map(client => {
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
                          {ops?.nextBestAction ?? client.industry ?? 'Open profile for details'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ServiceScopeBadges services={ops?.serviceScope ?? client.serviceScope} compact />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.trnVatNumber || '—'}
                    </TableCell>
                    <TableCell className="font-medium">{formatAed(client.outstandingAr)}</TableCell>
                    <TableCell>{client.invoiceCount}</TableCell>
                    <TableCell>
                      {ops && hasClientService(ops, 'vat')
                        ? <PriorityBadge priority={ops.vat.status} />
                        : <Badge variant="outline">Not scoped</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ops && hasClientService(ops, 'bookkeeping')
                        ? `${ops.bookkeeping.closeProgress}% close`
                        : !ops && client.lastReceiptDate
                          ? format(new Date(client.lastReceiptDate), 'MMM d, yyyy')
                          : 'Not scoped'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm">
                          {ops ? ownerPreview(ops.assignedStaff.map(staff => staff.name)) : client.assignedStaff.length}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {ops && (
                          <Button size="sm" variant="outline" onClick={() => setBriefClientId(client.id)}>
                            Brief
                          </Button>
                        )}
                        {(!ops || hasClientService(ops, 'vat')) && (
                          <Button size="sm" variant="outline" onClick={() => setVatWorkspaceClientId(client.id)}>
                            VAT
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
                        <Button size="sm" variant="outline" onClick={() => handleViewProfile(client.id)}>
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
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Al Majid Trading LLC"
              />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <Label>NR services for this client</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose only the services NRA is contracted to deliver for this client.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CLIENT_SERVICE_OPTIONS.map(option => (
                  <label
                    key={option.code}
                    className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={form.serviceScope.includes(option.code)}
                      onCheckedChange={checked => {
                        setForm(current => {
                          const serviceScope = checked
                            ? Array.from(new Set([...current.serviceScope, option.code]))
                            : current.serviceScope.filter(service => service !== option.code);
                          return {
                            ...current,
                            serviceScope: serviceScope.length > 0 ? serviceScope : current.serviceScope,
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
                <Label htmlFor="trn">TRN / VAT Number</Label>
                <Input
                  id="trn"
                  value={form.trnVatNumber}
                  onChange={e => setForm(f => ({ ...f, trnVatNumber: e.target.value }))}
                  placeholder="100234567890003"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="emirate">Emirate</Label>
                <Select value={form.emirate} onValueChange={v => setForm(f => ({ ...f, emirate: v }))}>
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
                  onValueChange={v => setForm(f => ({ ...f, legalStructure: v }))}
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
                  onValueChange={v => setForm(f => ({ ...f, vatFilingFrequency: v }))}
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
                  onValueChange={v => setForm(f => ({ ...f, vatPeriodStartMonth: v }))}
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
                  onValueChange={v => setForm(f => ({ ...f, fiscalYearStartMonth: v }))}
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
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="Trading, Construction, Retail..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="corporateTaxId">Corporate Tax Registration</Label>
              <Input
                id="corporateTaxId"
                value={form.corporateTaxId}
                onChange={e => setForm(f => ({ ...f, corporateTaxId: e.target.value }))}
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
                  onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="info@company.ae"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+971 4 123 4567"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessAddress">Business Address</Label>
              <Input
                id="businessAddress"
                value={form.businessAddress}
                onChange={e => setForm(f => ({ ...f, businessAddress: e.target.value }))}
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
              {createMutation.isPending ? 'Creating...' : 'Create Client'}
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
              accounts. Recognised columns: name, TRN, email, phone, industry, address, emirate,
              VAT filing, VAT close group, financial year start, corporate tax ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">CSV / XLSX file</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={e => {
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
                  <span className={importResult.errors.length > 0 ? 'text-red-700' : ''}>
                    {importResult.errors.length}
                  </span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-auto text-xs text-muted-foreground space-y-1">
                    {importResult.errors.slice(0, 20).map((e, i) => (
                      <div key={i}>
                        Row {e.row}{e.name ? ` (${e.name})` : ''}: {e.error}
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
              {importMutation.isPending ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationsBriefDialog
        client={briefClient}
        open={!!briefClientId}
        onOpenChange={open => !open && setBriefClientId(null)}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
      />
      <VatWorkspaceDialog
        client={vatWorkspaceClient}
        ops={vatWorkspaceOps}
        open={!!vatWorkspaceClientId}
        onOpenChange={open => !open && setVatWorkspaceClientId(null)}
      />
    </div>
  );
}
