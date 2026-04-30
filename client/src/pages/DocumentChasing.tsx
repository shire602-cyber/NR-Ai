import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format, parseISO, differenceInDays } from 'date-fns';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';

import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DOCUMENT_TYPES, COMPLIANCE_EVENT_TYPES } from '@shared/schema';

// ── Types echoed from server response shape ───────────────────────────
interface Requirement {
  id: string;
  companyId: string;
  documentType: string;
  description: string | null;
  dueDate: string;
  isRecurring: boolean;
  recurringIntervalDays: number | null;
  status: string;
  receivedAt: string | null;
  notes: string | null;
}

interface ChaseQueueItem {
  requirement: Requirement;
  nextLevel: 'friendly' | 'follow_up' | 'urgent' | 'final';
  message: string;
  whatsappLink: string | null;
  daysOverdue: number;
}

interface ComplianceEvent {
  id: string;
  eventType: string;
  description: string;
  eventDate: string;
  reminderDays: string;
  status: string;
}

interface Effectiveness {
  totalChased: number;
  totalReceived: number;
  responseRate: number;
  avgDaysToUpload: number | null;
}

function humanize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function levelBadgeColor(level: string) {
  switch (level) {
    case 'friendly':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    case 'follow_up':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300';
    case 'urgent':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
    case 'final':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function DocumentChasing() {
  const { toast } = useToast();
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const [showAddRequirement, setShowAddRequirement] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [previewItem, setPreviewItem] = useState<ChaseQueueItem | null>(null);

  const requirementsQuery = useQuery<Requirement[]>({
    queryKey: ['/api/companies', companyId, 'document-requirements'],
    enabled: !!companyId,
  });

  const queueQuery = useQuery<ChaseQueueItem[]>({
    queryKey: ['/api/companies', companyId, 'document-chases', 'queue'],
    enabled: !!companyId,
  });

  const eventsQuery = useQuery<ComplianceEvent[]>({
    queryKey: ['/api/companies', companyId, 'compliance-calendar'],
    enabled: !!companyId,
  });

  const effectivenessQuery = useQuery<Effectiveness>({
    queryKey: ['/api/companies', companyId, 'document-chases', 'effectiveness'],
    enabled: !!companyId,
  });

  const sendChaseMutation = useMutation({
    mutationFn: (input: { requirementId: string; overrideMessage?: string; channel?: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/document-chases/send/${input.requirementId}`, {
        overrideMessage: input.overrideMessage,
        channel: input.channel ?? 'whatsapp',
      }),
    onSuccess: (data: { whatsappLink?: string | null }) => {
      toast({ title: 'Chase recorded', description: 'Marked as sent.' });
      if (data?.whatsappLink) window.open(data.whatsappLink, '_blank', 'noopener,noreferrer');
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-chases', 'queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-chases', 'effectiveness'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-requirements'] });
      setPreviewItem(null);
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message ?? 'Send failed', variant: 'destructive' }),
  });

  const bulkSendMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/companies/${companyId}/document-chases/bulk-send`, {}),
    onSuccess: (data: { sentCount: number }) => {
      toast({ title: 'Bulk chase complete', description: `Sent ${data.sentCount} reminders.` });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-chases', 'queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-chases', 'effectiveness'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('PATCH', `/api/companies/${companyId}/document-requirements/${id}`, { status: 'received' }),
    onSuccess: () => {
      toast({ title: 'Marked received' });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-requirements'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'document-chases', 'queue'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const requirements = requirementsQuery.data ?? [];
  const queue = queueQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  const missingDocs = useMemo(
    () => requirements.filter((r) => r.status !== 'received' && r.status !== 'waived'),
    [requirements],
  );

  const stats = useMemo(() => {
    const overdue = missingDocs.filter((r) => differenceInDays(new Date(), parseISO(r.dueDate)) > 0).length;
    const dueSoon = missingDocs.filter((r) => {
      const d = differenceInDays(parseISO(r.dueDate), new Date());
      return d >= 0 && d <= 14;
    }).length;
    return { overdue, dueSoon, total: missingDocs.length };
  }, [missingDocs]);

  if (companyLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-6" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6 text-muted-foreground" data-testid="document-chasing-no-company">
        No company selected.
      </div>
    );
  }

  if (requirementsQuery.isError || queueQuery.isError) {
    const err = requirementsQuery.error ?? queueQuery.error;
    return (
      <div
        role="alert"
        className="m-6 rounded-md border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900 p-6 text-sm"
        data-testid="document-chasing-error"
      >
        <div className="font-medium mb-1">Failed to load document chasing data.</div>
        <div className="text-muted-foreground">
          {err instanceof Error ? err.message : 'An unexpected error occurred.'}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            requirementsQuery.refetch();
            queueQuery.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-document-chasing">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Document Chasing Autopilot</h1>
          <p className="text-muted-foreground mt-1">
            Track missing UAE compliance documents, escalate chase reminders, and keep deadlines visible.
          </p>
        </div>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="default"
                disabled={queue.length === 0 || bulkSendMutation.isPending}
                data-testid="btn-bulk-send"
              >
                <Send className="w-4 h-4 mr-2" />
                Send all ({queue.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send {queue.length} chase reminder{queue.length === 1 ? '' : 's'}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will record a chase event for every queued requirement and may
                  trigger outbound WhatsApp/email messages depending on your channel
                  configuration. This action can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => bulkSendMutation.mutate()}>
                  Send all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Missing Documents"
          value={stats.total}
          icon={<FileText className="w-5 h-5 text-blue-500" />}
        />
        <StatCard
          title="Overdue"
          value={stats.overdue}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          tone={stats.overdue > 0 ? 'danger' : 'normal'}
        />
        <StatCard
          title="Due in 14 days"
          value={stats.dueSoon}
          icon={<CalendarDays className="w-5 h-5 text-amber-500" />}
          tone={stats.dueSoon > 0 ? 'warning' : 'normal'}
        />
        <StatCard
          title="Response Rate"
          value={
            effectivenessQuery.data
              ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
              : '—'
          }
          icon={<Sparkles className="w-5 h-5 text-green-500" />}
        />
      </div>

      <Tabs defaultValue="missing" className="w-full">
        <TabsList>
          <TabsTrigger value="missing">Missing</TabsTrigger>
          <TabsTrigger value="queue">Chase queue ({queue.length})</TabsTrigger>
          <TabsTrigger value="calendar">Compliance calendar</TabsTrigger>
          <TabsTrigger value="metrics">Effectiveness</TabsTrigger>
        </TabsList>

        {/* Missing documents */}
        <TabsContent value="missing">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Missing Documents</CardTitle>
                <CardDescription>What this client still owes you.</CardDescription>
              </div>
              <Button onClick={() => setShowAddRequirement(true)} data-testid="btn-add-requirement">
                <Plus className="w-4 h-4 mr-2" /> Add requirement
              </Button>
            </CardHeader>
            <CardContent>
              {requirementsQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : missingDocs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  Nothing missing — all caught up.
                </div>
              ) : (
                <div className="divide-y">
                  {missingDocs.map((r) => {
                    const due = parseISO(r.dueDate);
                    const daysFromDue = differenceInDays(new Date(), due);
                    const isOverdue = daysFromDue > 0;
                    return (
                      <div
                        key={r.id}
                        className="py-3 flex items-center gap-4 flex-wrap"
                        data-testid="row-missing-doc"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{humanize(r.documentType)}</div>
                          {r.description && (
                            <div className="text-sm text-muted-foreground line-clamp-1">{r.description}</div>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Due {format(due, 'PP')}
                        </div>
                        {isOverdue ? (
                          <Badge variant="destructive">{daysFromDue}d overdue</Badge>
                        ) : (
                          <Badge variant="secondary">in {Math.abs(daysFromDue)}d</Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markReceivedMutation.mutate(r.id)}
                          data-testid="btn-mark-received"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Received
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chase queue */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle>Chase Queue</CardTitle>
              <CardDescription>
                Auto-built from due dates and recent send history. Preview a message before sending.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {queueQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : queue.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No pending chases right now.
                </div>
              ) : (
                <div className="space-y-3">
                  {queue.map((item) => (
                    <div
                      key={item.requirement.id}
                      className="border rounded-lg p-4 flex items-center gap-4 flex-wrap"
                      data-testid="row-queue-item"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{humanize(item.requirement.documentType)}</div>
                        <div className="text-sm text-muted-foreground">
                          Due {format(parseISO(item.requirement.dueDate), 'PP')} ·{' '}
                          {item.daysOverdue > 0 ? `${item.daysOverdue}d overdue` : 'due now'}
                        </div>
                      </div>
                      <Badge className={levelBadgeColor(item.nextLevel)}>{humanize(item.nextLevel)}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewItem(item)}
                        data-testid="btn-preview-chase"
                      >
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          sendChaseMutation.mutate({ requirementId: item.requirement.id, channel: 'whatsapp' })
                        }
                        disabled={sendChaseMutation.isPending}
                        data-testid="btn-send-chase"
                      >
                        <SiWhatsapp className="w-4 h-4 mr-2" /> Send
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance calendar */}
        <TabsContent value="calendar">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Compliance Calendar</CardTitle>
                <CardDescription>UAE deadlines (trade licence, visas, FTA filings, ESR).</CardDescription>
              </div>
              <Button onClick={() => setShowAddEvent(true)} data-testid="btn-add-event">
                <Plus className="w-4 h-4 mr-2" /> Add deadline
              </Button>
            </CardHeader>
            <CardContent>
              {eventsQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : events.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No deadlines tracked yet.
                </div>
              ) : (
                <div className="divide-y">
                  {events.map((e) => {
                    const ed = parseISO(e.eventDate);
                    const dUntil = differenceInDays(ed, new Date());
                    return (
                      <div key={e.id} className="py-3 flex items-center gap-4 flex-wrap" data-testid="row-event">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{humanize(e.eventType)}</div>
                          <div className="text-sm text-muted-foreground line-clamp-1">{e.description}</div>
                        </div>
                        <div className="text-sm text-muted-foreground">{format(ed, 'PP')}</div>
                        {dUntil < 0 ? (
                          <Badge variant="destructive">{Math.abs(dUntil)}d overdue</Badge>
                        ) : dUntil <= 30 ? (
                          <Badge className="bg-amber-100 text-amber-800">in {dUntil}d</Badge>
                        ) : (
                          <Badge variant="secondary">in {dUntil}d</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Effectiveness */}
        <TabsContent value="metrics">
          <Card>
            <CardHeader>
              <CardTitle>Effectiveness</CardTitle>
              <CardDescription>How well is the chase pipeline performing?</CardDescription>
            </CardHeader>
            <CardContent>
              {effectivenessQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Metric label="Total chased" value={effectivenessQuery.data?.totalChased ?? 0} />
                  <Metric label="Total received" value={effectivenessQuery.data?.totalReceived ?? 0} />
                  <Metric
                    label="Response rate"
                    value={
                      effectivenessQuery.data
                        ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
                        : '—'
                    }
                  />
                  <Metric
                    label="Avg time to upload"
                    value={
                      effectivenessQuery.data?.avgDaysToUpload != null
                        ? `${effectivenessQuery.data.avgDaysToUpload.toFixed(1)} days`
                        : '—'
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview dialog */}
      <Dialog open={!!previewItem} onOpenChange={(o) => !o && setPreviewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Preview chase message</DialogTitle>
            <DialogDescription>
              Edit the message if you like. Sending opens WhatsApp and records the chase.
            </DialogDescription>
          </DialogHeader>
          {previewItem && (
            <PreviewBody
              item={previewItem}
              onCancel={() => setPreviewItem(null)}
              onSend={(msg) =>
                sendChaseMutation.mutate({
                  requirementId: previewItem.requirement.id,
                  overrideMessage: msg,
                })
              }
              sending={sendChaseMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Add requirement dialog */}
      <AddRequirementDialog
        open={showAddRequirement}
        onClose={() => setShowAddRequirement(false)}
        companyId={companyId}
      />

      {/* Add compliance event dialog */}
      <AddComplianceEventDialog
        open={showAddEvent}
        onClose={() => setShowAddEvent(false)}
        companyId={companyId}
      />
    </div>
  );
}

function StatCard(props: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'normal' | 'warning' | 'danger';
}) {
  const ringClass =
    props.tone === 'danger'
      ? 'border-red-200 dark:border-red-900'
      : props.tone === 'warning'
      ? 'border-amber-200 dark:border-amber-900'
      : '';
  return (
    <Card className={ringClass}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{props.title}</div>
            <div className="text-2xl font-bold">{props.value}</div>
          </div>
          {props.icon}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border rounded-md p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function PreviewBody(props: {
  item: ChaseQueueItem;
  onCancel: () => void;
  onSend: (msg: string) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState(props.item.message);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge className={levelBadgeColor(props.item.nextLevel)}>{humanize(props.item.nextLevel)}</Badge>
        <span className="text-sm text-muted-foreground">
          {humanize(props.item.requirement.documentType)} · due{' '}
          {format(parseISO(props.item.requirement.dueDate), 'PP')}
        </span>
      </div>
      <Label>Message</Label>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button onClick={() => props.onSend(draft)} disabled={props.sending}>
          <SiWhatsapp className="w-4 h-4 mr-2" /> Send via WhatsApp
        </Button>
      </DialogFooter>
    </div>
  );
}

function AddRequirementDialog(props: { open: boolean; onClose: () => void; companyId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    documentType: 'trade_license',
    description: '',
    dueDate: format(new Date(), 'yyyy-MM-dd'),
    isRecurring: false,
    recurringIntervalDays: 365,
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest('POST', `/api/companies/${props.companyId}/document-requirements`, {
        documentType: data.documentType,
        description: data.description || null,
        dueDate: data.dueDate,
        isRecurring: data.isRecurring,
        recurringIntervalDays: data.isRecurring ? data.recurringIntervalDays : null,
      }),
    onSuccess: () => {
      toast({ title: 'Requirement added' });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', props.companyId, 'document-requirements'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', props.companyId, 'document-chases', 'queue'] });
      props.onClose();
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New document requirement</DialogTitle>
          <DialogDescription>What does this client owe you?</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="docType">Document type</Label>
            <Select value={form.documentType} onValueChange={(v) => setForm((f) => ({ ...f, documentType: v }))}>
              <SelectTrigger id="docType" data-testid="select-doctype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="docDescription">Description (optional)</Label>
            <Input
              id="docDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Q1 2026 bank statement"
            />
          </div>
          <div>
            <Label htmlFor="docDueDate">Due date</Label>
            <Input
              id="docDueDate"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isRecurring"
              checked={form.isRecurring}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, isRecurring: checked === true }))
              }
            />
            <Label htmlFor="isRecurring" className="cursor-pointer">Recurring</Label>
            {form.isRecurring && (
              <>
                <Input
                  type="number"
                  min={1}
                  value={form.recurringIntervalDays}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      recurringIntervalDays: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-32"
                  aria-label="Recurring interval in days"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.dueDate}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddComplianceEventDialog(props: { open: boolean; onClose: () => void; companyId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    eventType: 'trade_license_renewal',
    description: '',
    eventDate: format(new Date(), 'yyyy-MM-dd'),
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest('POST', `/api/companies/${props.companyId}/compliance-calendar`, {
        eventType: data.eventType,
        description: data.description,
        eventDate: data.eventDate,
        reminderDays: [30, 14, 7, 0],
      }),
    onSuccess: () => {
      toast({ title: 'Deadline added' });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', props.companyId, 'compliance-calendar'] });
      props.onClose();
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New compliance deadline</DialogTitle>
          <DialogDescription>UAE compliance event to track and remind on.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="eventType">Event type</Label>
            <Select value={form.eventType} onValueChange={(v) => setForm((f) => ({ ...f, eventType: v }))}>
              <SelectTrigger id="eventType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLIANCE_EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="eventDescription">Description</Label>
            <Input
              id="eventDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Trade licence renewal at Dubai Economy"
            />
          </div>
          <div>
            <Label htmlFor="eventDate">Date</Label>
            <Input
              id="eventDate"
              type="date"
              value={form.eventDate}
              onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.description.trim() || !form.eventDate}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
