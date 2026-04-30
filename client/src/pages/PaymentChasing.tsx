import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useTranslation } from '@/lib/i18n';
import { Send, Inbox, BarChart3, Settings as SettingsIcon, FileText, Clock, AlertTriangle, CheckCircle2, Ban, AlertCircle } from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';

// Threshold above which "Chase all" requires explicit confirmation. Picked to
// match a conservative "is this batch big enough to be embarrassing if wrong"
// gut-check; tweak if customer feedback suggests another number.
const BULK_CONFIRM_THRESHOLD = 10;

// Known placeholder tokens — must mirror RenderContext keys in the service.
// The template editor highlights any tokens outside this set so a typo like
// `{customername}` doesn't silently render as literal text in production.
const KNOWN_PLACEHOLDERS = [
  'customerName',
  'invoiceNumber',
  'amount',
  'currency',
  'dueDate',
  'daysOverdue',
  'paymentLink',
  'senderName',
] as const;

// ─── Types (inline; mirror server contracts) ────────────────────────────────

type AgingBucket = '1-7' | '8-30' | '31-60' | '60+';
type ChaseLevel = 1 | 2 | 3 | 4;

interface AgingRow {
  invoice: {
    id: string;
    number: string;
    customerName: string;
    currency: string;
    total: number;
    dueDate: string | null;
    status: string;
    contactId?: string | null;
    chaseLevel?: number;
    lastChasedAt?: string | null;
    doNotChase?: boolean;
  };
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
  recommendedLevel: ChaseLevel;
  nextLevel?: ChaseLevel;
}

interface OverdueResponse {
  rows: AgingRow[];
  buckets: Record<AgingBucket, number>;
  totalOutstanding: number;
}

interface QueueResponse {
  queue: AgingRow[];
  groups: Array<{
    contactId: string | null;
    customerName: string;
    rows: AgingRow[];
    totalOutstanding: number;
    currency: string;
    recommendedLevel: ChaseLevel;
  }>;
  config: { frequencyDays: number; maxLevel: number; preferredMethod: string; autoChaseEnabled: boolean };
}

interface ChaseRecord {
  id: string;
  invoiceId: string;
  level: number;
  method: string;
  language: string;
  messageText: string;
  daysOverdueAtSend: number;
  amountAtSend: number;
  status: string;
  sentAt: string;
  paidAt: string | null;
}

interface Effectiveness {
  totalChases: number;
  uniqueInvoices: number;
  paidAfterChase: number;
  paidWithin7: number;
  paidWithin14: number;
  paidWithin30: number;
  conversionRate: number;
  avgDaysToPayment: number | null;
  byLevel: Record<string, { sent: number; paid: number }>;
}

interface Template {
  id: string;
  companyId: string | null;
  level: number;
  language: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
}

interface ChaseConfig {
  companyId: string;
  autoChaseEnabled: boolean;
  chaseFrequencyDays: number;
  maxLevel: number;
  preferredMethod: string;
  doNotChaseContactIds: string;
  defaultLanguage: string;
}

interface BulkSendResult {
  invoiceId: string;
  level: number;
  status: 'sent' | 'failed' | 'skipped_max_level' | 'skipped_no_template' | string;
  waLink?: string | null;
  error?: string;
}

interface BulkSendResponse {
  sent: number;
  skipped: number;
  failed: number;
  results: BulkSendResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function levelLabel(level: number, locale: string): string {
  const en = ['', 'Friendly reminder', 'Firm reminder', 'Urgent notice', 'Final notice'];
  const ar = ['', 'تذكير ودي', 'تذكير حازم', 'إشعار عاجل', 'إشعار نهائي'];
  return (locale === 'ar' ? ar : en)[level] || `Level ${level}`;
}

function levelColor(level: number): string {
  switch (level) {
    case 1: return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 2: return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    case 3: return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 4: return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function bucketColor(b: AgingBucket): string {
  switch (b) {
    case '1-7': return 'bg-blue-50 dark:bg-blue-900/30';
    case '8-30': return 'bg-amber-50 dark:bg-amber-900/30';
    case '31-60': return 'bg-orange-50 dark:bg-orange-900/30';
    case '60+': return 'bg-red-50 dark:bg-red-900/30';
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PaymentChasing() {
  const { companyId } = useDefaultCompany();
  const { locale } = useTranslation();
  const { toast } = useToast();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBody, setPreviewBody] = useState('');
  const [previewWaLink, setPreviewWaLink] = useState<string | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState<'en' | 'ar'>('en');
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkSendResponse | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────
  const overdueQuery = useQuery<OverdueResponse>({
    queryKey: ['/api/chasing/overdue', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/overdue/${companyId}`),
    enabled: !!companyId,
  });

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ['/api/chasing/queue', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/queue/${companyId}`),
    enabled: !!companyId,
  });

  const historyQuery = useQuery<ChaseRecord[]>({
    queryKey: ['/api/chasing/history', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/history/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });

  const effQuery = useQuery<Effectiveness>({
    queryKey: ['/api/chasing/effectiveness', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/effectiveness/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });

  const templatesQuery = useQuery<Template[]>({
    queryKey: ['/api/chasing/templates', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/templates/${companyId}`),
    enabled: !!companyId,
  });

  const configQuery = useQuery<ChaseConfig>({
    queryKey: ['/api/chasing/config', companyId],
    queryFn: () => apiRequest('GET', `/api/chasing/config/${companyId}`),
    enabled: !!companyId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────
  const sendOne = useMutation({
    mutationFn: (invoiceId: string) =>
      apiRequest('POST', `/api/chasing/send/${invoiceId}`, { method: 'whatsapp', language: locale }),
    onSuccess: (data: any) => {
      toast({ title: 'Reminder ready', description: 'Review the message, then open WhatsApp to send.' });
      setPreviewBody(data.message);
      setPreviewWaLink(data.waLink);
      // Use the language we requested — server may fall back to default but the
      // text we just got back is rendered in the requested locale's template.
      setPreviewLanguage(locale === 'ar' ? 'ar' : 'en');
      setPreviewOpen(true);
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/overdue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/history', companyId] });
    },
    onError: (e: any) => toast({ title: 'Could not send', description: e?.message ?? 'Unknown error', variant: 'destructive' }),
  });

  const bulkSend = useMutation<BulkSendResponse, Error, void>({
    mutationFn: () =>
      apiRequest('POST', `/api/chasing/bulk-send/${companyId}`, { method: 'whatsapp', language: locale }),
    onSuccess: (data) => {
      const failed = data.failed ?? 0;
      toast({
        title: failed > 0 ? 'Bulk send completed with errors' : 'Bulk reminders queued',
        description: `Sent ${data.sent} • Skipped ${data.skipped} • Failed ${failed}`,
        variant: failed > 0 ? 'destructive' : 'default',
      });
      setBulkResults(data);
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/overdue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/history', companyId] });
    },
    onError: (e) => toast({ title: 'Bulk send failed', description: e?.message ?? '—', variant: 'destructive' }),
  });

  const toggleDoNotChase = useMutation({
    mutationFn: ({ invoiceId, value }: { invoiceId: string; value: boolean }) =>
      apiRequest('PATCH', `/api/chasing/invoice/${invoiceId}/do-not-chase`, { doNotChase: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/overdue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
    },
  });

  const saveConfig = useMutation({
    mutationFn: (patch: Partial<ChaseConfig> & { doNotChaseContactIds?: string[] }) =>
      apiRequest('PATCH', `/api/chasing/config/${companyId}`, patch),
    onSuccess: () => {
      toast({ title: 'Settings saved' });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/config', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: (t: Template) => {
      // companyId-owned templates are PATCHable; system defaults (companyId=null) get cloned via POST.
      if (t.companyId === companyId) {
        return apiRequest('PATCH', `/api/chasing/templates/${companyId}/${t.id}`, {
          level: t.level, language: t.language, subject: t.subject, body: t.body,
        });
      }
      return apiRequest('POST', `/api/chasing/templates/${companyId}`, {
        level: t.level, language: t.language, subject: t.subject, body: t.body,
      });
    },
    onSuccess: () => {
      toast({ title: 'Template saved' });
      setEditingTemplate(null);
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/templates', companyId] });
    },
    onError: (e: any) => toast({
      title: 'Could not save template',
      description: e?.message ?? 'Unknown error',
      variant: 'destructive',
    }),
  });

  // ── Per-invoice history ────────────────────────────────────────────────
  const invoiceHistoryQuery = useQuery<ChaseRecord[]>({
    queryKey: ['/api/chasing/invoice', historyInvoiceId, 'history'],
    queryFn: () => apiRequest('GET', `/api/chasing/invoice/${historyInvoiceId}/history`),
    enabled: !!historyInvoiceId,
  });

  // ── Derived ────────────────────────────────────────────────────────────
  const overdue = overdueQuery.data?.rows ?? [];
  const buckets: Record<AgingBucket, number> =
    overdueQuery.data?.buckets ?? { '1-7': 0, '8-30': 0, '31-60': 0, '60+': 0 };
  const totalOutstanding = overdueQuery.data?.totalOutstanding ?? 0;
  const queue = queueQuery.data?.queue ?? [];

  const sortedOverdue = useMemo(
    () => [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue),
    [overdue],
  );

  // Pick a currency label for the Total Outstanding card. If every overdue row
  // is in the same currency, show that. Otherwise fall back to "Mixed" rather
  // than misleadingly tagging the sum with one of them.
  const totalOutstandingCurrency = useMemo(() => {
    const currencies = new Set(overdue.map(r => r.invoice.currency));
    if (currencies.size === 0) return configQuery.data?.defaultLanguage === 'ar' ? 'AED' : 'AED';
    if (currencies.size === 1) return [...currencies][0];
    return 'Mixed';
  }, [overdue, configQuery.data?.defaultLanguage]);

  // Placeholder validation for the template editor: tokens not in the
  // RenderContext set will silently render as literal text in production.
  const editingPlaceholders = useMemo(() => {
    if (!editingTemplate) return { all: [] as string[], unknown: [] as string[] };
    const matches = Array.from(editingTemplate.body.matchAll(/\{(\w+)\}/g)).map(m => m[1]);
    const all = Array.from(new Set(matches));
    const unknown = all.filter(p => !KNOWN_PLACEHOLDERS.includes(p as typeof KNOWN_PLACEHOLDERS[number]));
    return { all, unknown };
  }, [editingTemplate]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="payment-chasing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Chasing Autopilot</h1>
          <p className="text-muted-foreground">Automated reminders for overdue invoices with smart escalation</p>
        </div>
        <Button
          onClick={() => {
            if (queue.length > BULK_CONFIRM_THRESHOLD) {
              setBulkConfirmOpen(true);
            } else {
              bulkSend.mutate();
            }
          }}
          disabled={queue.length === 0 || bulkSend.isPending}
          data-testid="button-chase-all"
        >
          <Send className="mr-2 h-4 w-4" />
          {bulkSend.isPending ? `Sending ${queue.length}…` : `Chase all (${queue.length})`}
        </Button>
      </div>

      {/* Aging buckets */}
      <div className="grid gap-4 md:grid-cols-4">
        {(['1-7', '8-30', '31-60', '60+'] as AgingBucket[]).map(b => (
          <Card key={b} className={bucketColor(b)} data-testid={`bucket-${b}`}>
            <CardHeader className="pb-2">
              <CardDescription>{b} days overdue</CardDescription>
              <CardTitle className="text-3xl">
                {overdueQuery.isLoading ? <Skeleton className="h-9 w-12" /> : (buckets[b] ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">invoices</CardContent>
          </Card>
        ))}
      </div>

      {overdueQuery.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Could not load overdue invoices: {overdueQuery.error instanceof Error ? overdueQuery.error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Total outstanding</CardTitle>
          <CardDescription>
            {overdueQuery.isLoading ? 'Loading…' : `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold" data-testid="total-outstanding">
          {overdueQuery.isLoading ? (
            <Skeleton className="h-9 w-48" />
          ) : (
            <>
              {totalOutstandingCurrency} {totalOutstanding.toFixed(2)}
              {totalOutstandingCurrency === 'Mixed' && (
                <p className="text-xs font-normal text-muted-foreground mt-1">
                  Sum across multiple currencies — open the table for per-invoice amounts.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overdue" className="w-full">
        <TabsList>
          <TabsTrigger value="overdue"><AlertTriangle className="mr-2 h-4 w-4" />Overdue</TabsTrigger>
          <TabsTrigger value="queue"><Inbox className="mr-2 h-4 w-4" />Queue</TabsTrigger>
          <TabsTrigger value="history"><Clock className="mr-2 h-4 w-4" />History</TabsTrigger>
          <TabsTrigger value="effectiveness"><BarChart3 className="mr-2 h-4 w-4" />Effectiveness</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="mr-2 h-4 w-4" />Templates</TabsTrigger>
          <TabsTrigger value="settings"><SettingsIcon className="mr-2 h-4 w-4" />Settings</TabsTrigger>
        </TabsList>

        {/* ── Overdue ─────────────────────────────────────────────────── */}
        <TabsContent value="overdue">
          <Card>
            <CardHeader>
              <CardTitle>Overdue invoices</CardTitle>
              <CardDescription>Sorted by days overdue (oldest first)</CardDescription>
            </CardHeader>
            <CardContent>
              {overdueQuery.isLoading && <Skeleton className="h-32" />}
              {!overdueQuery.isLoading && sortedOverdue.length === 0 && (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
                  No overdue invoices. Nice.
                </div>
              )}
              {sortedOverdue.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="text-right">Days overdue</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead>Last chase</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOverdue.map(row => (
                      <TableRow key={row.invoice.id} data-testid={`overdue-row-${row.invoice.number}`}>
                        <TableCell className="font-mono">{row.invoice.number}</TableCell>
                        <TableCell>{row.invoice.customerName}</TableCell>
                        <TableCell className="text-right">{row.invoice.currency} {row.outstanding.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{row.daysOverdue}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.bucket}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.invoice.chaseLevel && row.invoice.chaseLevel > 0 ? (
                            <Badge className={levelColor(row.invoice.chaseLevel)}>
                              L{row.invoice.chaseLevel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setHistoryInvoiceId(row.invoice.id)}
                            data-testid={`button-history-${row.invoice.number}`}
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant={row.invoice.doNotChase ? 'destructive' : 'ghost'}
                            onClick={() => toggleDoNotChase.mutate({ invoiceId: row.invoice.id, value: !row.invoice.doNotChase })}
                            data-testid={`button-dnc-${row.invoice.number}`}
                            title={row.invoice.doNotChase ? 'Resume chasing' : 'Do not chase'}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => sendOne.mutate(row.invoice.id)}
                            disabled={row.invoice.doNotChase || sendOne.isPending}
                            data-testid={`button-send-${row.invoice.number}`}
                          >
                            <SiWhatsapp className="mr-1 h-4 w-4" />
                            Send
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Queue ──────────────────────────────────────────────────── */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle>Next chase queue</CardTitle>
              <CardDescription>
                Invoices eligible for the next chase action (frequency = {queueQuery.data?.config.frequencyDays ?? 7} days,
                max level = {queueQuery.data?.config.maxLevel ?? 4})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {queueQuery.isLoading && <Skeleton className="h-32" />}
              {queueQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Could not load chase queue: {queueQuery.error instanceof Error ? queueQuery.error.message : 'Unknown error'}
                  </AlertDescription>
                </Alert>
              )}
              {!queueQuery.isLoading && !queueQuery.isError && queue.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  Nothing waiting in the queue.
                </div>
              ) : !queueQuery.isLoading && !queueQuery.isError && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Next level</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map(row => (
                      <TableRow key={row.invoice.id} data-testid={`queue-row-${row.invoice.number}`}>
                        <TableCell className="font-mono">{row.invoice.number}</TableCell>
                        <TableCell>{row.invoice.customerName}</TableCell>
                        <TableCell>
                          {row.nextLevel ? (
                            <Badge className={levelColor(row.nextLevel)}>
                              L{row.nextLevel} — {levelLabel(row.nextLevel, locale)}
                            </Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-right">{row.invoice.currency} {row.outstanding.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{row.daysOverdue}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => sendOne.mutate(row.invoice.id)}>
                            Send
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History ────────────────────────────────────────────────── */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Chase history</CardTitle>
              <CardDescription>Last 180 days</CardDescription>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading && <Skeleton className="h-32" />}
              {historyQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Could not load history: {historyQuery.error instanceof Error ? historyQuery.error.message : 'Unknown error'}
                  </AlertDescription>
                </Alert>
              )}
              {!historyQuery.isLoading && !historyQuery.isError && historyQuery.data?.length === 0 && (
                <div className="text-muted-foreground text-sm py-8 text-center">No chase history yet.</div>
              )}
              {historyQuery.data && historyQuery.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Lang</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Days overdue</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Paid?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data.map(c => (
                      <TableRow key={c.id} data-testid={`history-row-${c.id}`}>
                        <TableCell>{new Date(c.sentAt).toLocaleString()}</TableCell>
                        <TableCell><Badge className={levelColor(c.level)}>L{c.level}</Badge></TableCell>
                        <TableCell>{c.method}</TableCell>
                        <TableCell>{c.language}</TableCell>
                        <TableCell>
                          <Badge
                            variant={c.status === 'failed' ? 'destructive' : 'outline'}
                            data-testid={`history-status-${c.id}`}
                          >
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{c.daysOverdueAtSend}</TableCell>
                        <TableCell className="text-right">{Number(c.amountAtSend).toFixed(2)}</TableCell>
                        <TableCell>
                          {c.paidAt ? (
                            <Badge className="bg-green-100 text-green-800">Paid {new Date(c.paidAt).toLocaleDateString()}</Badge>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Effectiveness ──────────────────────────────────────────── */}
        <TabsContent value="effectiveness">
          {effQuery.isError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Could not load effectiveness metrics: {effQuery.error instanceof Error ? effQuery.error.message : 'Unknown error'}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="metric-conversion-rate">
              <CardHeader>
                <CardDescription>Conversion rate</CardDescription>
                <CardTitle className="text-3xl">
                  {effQuery.isLoading
                    ? <Skeleton className="h-9 w-20" />
                    : `${((effQuery.data?.conversionRate ?? 0) * 100).toFixed(1)}%`}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {effQuery.isLoading
                  ? <Skeleton className="h-3 w-32" />
                  : `${effQuery.data?.paidAfterChase ?? 0} / ${effQuery.data?.uniqueInvoices ?? 0} chased invoices paid`}
              </CardContent>
            </Card>
            <Card data-testid="metric-avg-days">
              <CardHeader>
                <CardDescription>Avg days to payment</CardDescription>
                <CardTitle className="text-3xl">
                  {effQuery.isLoading
                    ? <Skeleton className="h-9 w-16" />
                    : (effQuery.data?.avgDaysToPayment ?? '—')}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">after first chase</CardContent>
            </Card>
            <Card data-testid="metric-windowed">
              <CardHeader>
                <CardDescription>Paid within window</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>7 days: <strong>{effQuery.data?.paidWithin7 ?? 0}</strong></div>
                <div>14 days: <strong>{effQuery.data?.paidWithin14 ?? 0}</strong></div>
                <div>30 days: <strong>{effQuery.data?.paidWithin30 ?? 0}</strong></div>
              </CardContent>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>By escalation level</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[1, 2, 3, 4].map(level => {
                    const lv = effQuery.data?.byLevel?.[String(level)] ?? { sent: 0, paid: 0 };
                    const rate = lv.sent === 0 ? 0 : (lv.paid / lv.sent) * 100;
                    return (
                      <TableRow key={level}>
                        <TableCell><Badge className={levelColor(level)}>L{level} — {levelLabel(level, locale)}</Badge></TableCell>
                        <TableCell className="text-right">{lv.sent}</TableCell>
                        <TableCell className="text-right">{lv.paid}</TableCell>
                        <TableCell className="text-right">{rate.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Templates ──────────────────────────────────────────────── */}
        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle>Message templates</CardTitle>
              <CardDescription>
                Customize each escalation level. Placeholders:
                <code className="ml-2 text-xs">{'{customerName} {invoiceNumber} {amount} {currency} {dueDate} {daysOverdue} {paymentLink} {senderName}'}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {templatesQuery.isLoading && <Skeleton className="h-32" />}
              {templatesQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Could not load templates: {templatesQuery.error instanceof Error ? templatesQuery.error.message : 'Unknown error'}
                  </AlertDescription>
                </Alert>
              )}
              {!templatesQuery.isLoading && !templatesQuery.isError && (templatesQuery.data?.length ?? 0) === 0 && (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  No templates available — defaults will be created on first send.
                </div>
              )}
              {!templatesQuery.isLoading && !templatesQuery.isError && (templatesQuery.data?.length ?? 0) > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Level</TableHead>
                      <TableHead>Language</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead className="text-right">Edit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templatesQuery.data?.map(t => (
                      <TableRow key={t.id} data-testid={`template-row-${t.level}-${t.language}`}>
                        <TableCell><Badge className={levelColor(t.level)}>L{t.level}</Badge></TableCell>
                        <TableCell>{t.language}</TableCell>
                        <TableCell>{t.companyId ? 'Custom' : 'Default'}</TableCell>
                        <TableCell className="max-w-xs truncate">{t.subject ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setEditingTemplate(t)}>
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settings ───────────────────────────────────────────────── */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Chase configuration</CardTitle>
              <CardDescription>Controls how aggressively the autopilot chases overdue invoices</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {configQuery.isLoading && <Skeleton className="h-32" />}
              {configQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Could not load settings: {configQuery.error instanceof Error ? configQuery.error.message : 'Unknown error'}
                  </AlertDescription>
                </Alert>
              )}
              {!configQuery.isLoading && !configQuery.isError && (
              <>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-chase enabled</Label>
                  <p className="text-xs text-muted-foreground">Automatically queue chases as invoices age</p>
                </div>
                <Switch
                  checked={configQuery.data?.autoChaseEnabled ?? false}
                  onCheckedChange={(v) => saveConfig.mutate({ autoChaseEnabled: v })}
                  data-testid="switch-auto-chase"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label>Chase frequency (days)</Label>
                  <Input
                    key={`freq-${configQuery.data?.chaseFrequencyDays ?? 7}`}
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={configQuery.data?.chaseFrequencyDays ?? 7}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      // Server schema enforces 1..365; validate client-side too
                      // so the user gets immediate feedback rather than a 400.
                      if (!Number.isFinite(n) || n < 1 || n > 365) {
                        toast({
                          title: 'Invalid frequency',
                          description: 'Pick a value between 1 and 365 days.',
                          variant: 'destructive',
                        });
                        e.target.value = String(configQuery.data?.chaseFrequencyDays ?? 7);
                        return;
                      }
                      saveConfig.mutate({ chaseFrequencyDays: n });
                    }}
                    data-testid="input-frequency"
                  />
                </div>
                <div>
                  <Label>Max escalation level</Label>
                  <Select
                    value={String(configQuery.data?.maxLevel ?? 4)}
                    onValueChange={(v) => saveConfig.mutate({ maxLevel: Number(v) })}
                  >
                    <SelectTrigger data-testid="select-max-level"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map(l => (
                        <SelectItem key={l} value={String(l)}>L{l} — {levelLabel(l, locale)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default language</Label>
                  <Select
                    value={configQuery.data?.defaultLanguage ?? 'en'}
                    onValueChange={(v) => saveConfig.mutate({ defaultLanguage: v })}
                  >
                    <SelectTrigger data-testid="select-language"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Preview dialog ──────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reminder ready</DialogTitle>
            <DialogDescription>Review the message, then open WhatsApp to send.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={previewBody}
            readOnly
            dir={previewLanguage === 'ar' ? 'rtl' : 'ltr'}
            className="min-h-[260px] font-mono text-sm"
            data-testid="textarea-preview"
          />
          {!previewWaLink && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No WhatsApp link generated — the contact has no phone number on file. Copy the message and send it manually.
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="button-copy-preview"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.writeText) {
                    throw new Error('Clipboard API unavailable');
                  }
                  await navigator.clipboard.writeText(previewBody);
                  toast({ title: 'Copied to clipboard' });
                } catch (err) {
                  toast({
                    title: 'Could not copy',
                    description: err instanceof Error ? err.message : 'Select the text and copy manually.',
                    variant: 'destructive',
                  });
                }
              }}
            >
              Copy
            </Button>
            {previewWaLink && (
              <Button asChild>
                <a href={previewWaLink} target="_blank" rel="noreferrer">
                  <SiWhatsapp className="mr-2 h-4 w-4" /> Open WhatsApp
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Per-invoice history dialog ──────────────────────────────── */}
      <Dialog open={!!historyInvoiceId} onOpenChange={(open) => !open && setHistoryInvoiceId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Invoice chase timeline</DialogTitle>
          </DialogHeader>
          {invoiceHistoryQuery.isLoading && <Skeleton className="h-32" />}
          {invoiceHistoryQuery.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Could not load timeline: {invoiceHistoryQuery.error instanceof Error ? invoiceHistoryQuery.error.message : 'Unknown error'}
              </AlertDescription>
            </Alert>
          )}
          {invoiceHistoryQuery.data && invoiceHistoryQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No chases yet for this invoice.</p>
          )}
          <div className="space-y-3">
            {invoiceHistoryQuery.data?.map(c => (
              <div
                key={c.id}
                className="border-l-2 border-muted pl-4 py-2"
                data-testid={`timeline-entry-${c.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={levelColor(c.level)}>L{c.level}</Badge>
                  <span className="text-sm font-medium">{new Date(c.sentAt).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">via {c.method} ({c.language})</span>
                  <Badge variant={c.status === 'failed' ? 'destructive' : 'outline'} className="text-xs">
                    {c.status}
                  </Badge>
                </div>
                <pre
                  className="mt-2 text-xs whitespace-pre-wrap font-sans"
                  dir={c.language === 'ar' ? 'rtl' : 'ltr'}
                >
                  {c.messageText}
                </pre>
                {c.paidAt && (
                  <Badge className="mt-2 bg-green-100 text-green-800">Paid {new Date(c.paidAt).toLocaleDateString()}</Badge>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Template editor dialog ─────────────────────────────────── */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Edit template — L{editingTemplate?.level} {editingTemplate?.language === 'ar' ? '(Arabic)' : '(English)'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate?.companyId ? 'Custom template — saving updates this template.' : 'System default — saving creates a company override.'}
            </DialogDescription>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4">
              <div>
                <Label>Subject (used for email)</Label>
                <Input
                  value={editingTemplate.subject ?? ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                  dir={editingTemplate.language === 'ar' ? 'rtl' : 'ltr'}
                  data-testid="input-template-subject"
                />
              </div>
              <div>
                <Label>Body</Label>
                <Textarea
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                  className="min-h-[260px] font-mono text-sm"
                  dir={editingTemplate.language === 'ar' ? 'rtl' : 'ltr'}
                  data-testid="textarea-template-body"
                />
                {editingPlaceholders.unknown.length > 0 && (
                  <Alert variant="destructive" className="mt-2" data-testid="alert-unknown-placeholders">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Unknown placeholder{editingPlaceholders.unknown.length === 1 ? '' : 's'}:{' '}
                      <code>{editingPlaceholders.unknown.map(p => `{${p}}`).join(', ')}</code>
                      {' '}— these will render as literal text. Known placeholders:{' '}
                      <code>{KNOWN_PLACEHOLDERS.map(p => `{${p}}`).join(', ')}</code>.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
            <Button
              onClick={() => editingTemplate && saveTemplate.mutate(editingTemplate)}
              disabled={saveTemplate.isPending || !editingTemplate?.body?.trim()}
              data-testid="button-save-template"
            >
              {saveTemplate.isPending ? 'Saving…' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk-send confirmation ──────────────────────────────────── */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent data-testid="alert-bulk-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Send {queue.length} chase reminders?</AlertDialogTitle>
            <AlertDialogDescription>
              This will record a chase against each invoice and bump its escalation level.
              For WhatsApp you will still need to open each generated link to actually send the message.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk"
              onClick={() => {
                setBulkConfirmOpen(false);
                bulkSend.mutate();
              }}
            >
              Send all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk-send results ───────────────────────────────────────── */}
      <Dialog
        open={!!bulkResults}
        onOpenChange={(open) => !open && setBulkResults(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bulk chase results</DialogTitle>
            <DialogDescription>
              {bulkResults && (
                <>
                  Sent <strong className="text-foreground">{bulkResults.sent}</strong>
                  {' • '}Skipped <strong className="text-foreground">{bulkResults.skipped}</strong>
                  {' • '}Failed <strong className={bulkResults.failed > 0 ? 'text-destructive' : 'text-foreground'}>
                    {bulkResults.failed}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {bulkResults && bulkResults.results.length > 0 && (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkResults.results.map(r => {
                    // Match invoice number from the queue snapshot at time of send.
                    const matchedInvoice = queue.find(q => q.invoice.id === r.invoiceId)
                      ?? overdue.find(o => o.invoice.id === r.invoiceId);
                    const number = matchedInvoice?.invoice.number ?? r.invoiceId.slice(0, 8);
                    return (
                      <TableRow key={r.invoiceId} data-testid={`bulk-result-${r.invoiceId}`}>
                        <TableCell className="font-mono text-xs">{number}</TableCell>
                        <TableCell>
                          {r.level > 0 ? <Badge className={levelColor(r.level)}>L{r.level}</Badge> : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'sent' ? 'default' : r.status === 'failed' ? 'destructive' : 'outline'}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.error ? (
                            <span className="text-destructive">{r.error}</span>
                          ) : r.waLink ? (
                            <a
                              href={r.waLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline-offset-2 hover:underline inline-flex items-center"
                            >
                              <SiWhatsapp className="mr-1 h-3 w-3" /> Open
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkResults(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
