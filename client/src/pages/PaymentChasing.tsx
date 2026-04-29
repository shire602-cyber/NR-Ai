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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useTranslation } from '@/lib/i18n';
import { Send, Inbox, BarChart3, Settings as SettingsIcon, FileText, Clock, AlertTriangle, CheckCircle2, Ban } from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';

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
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);

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
      toast({ title: 'Reminder ready', description: 'WhatsApp link copied to preview.' });
      setPreviewBody(data.message);
      setPreviewWaLink(data.waLink);
      setPreviewOpen(true);
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/overdue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/history', companyId] });
    },
    onError: (e: any) => toast({ title: 'Could not send', description: e?.message ?? 'Unknown error', variant: 'destructive' }),
  });

  const bulkSend = useMutation({
    mutationFn: () =>
      apiRequest('POST', `/api/chasing/bulk-send/${companyId}`, { method: 'whatsapp', language: locale }),
    onSuccess: (data: any) => {
      toast({ title: 'Bulk reminders queued', description: `Sent ${data.sent} • Skipped ${data.skipped} • Failed ${data.failed}` });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/overdue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/queue', companyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/chasing/history', companyId] });
    },
    onError: (e: any) => toast({ title: 'Bulk send failed', description: e?.message ?? '—', variant: 'destructive' }),
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

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="payment-chasing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payment Chasing Autopilot</h1>
          <p className="text-muted-foreground">Automated reminders for overdue invoices with smart escalation</p>
        </div>
        <Button
          onClick={() => bulkSend.mutate()}
          disabled={queue.length === 0 || bulkSend.isPending}
          data-testid="button-chase-all"
        >
          <Send className="mr-2 h-4 w-4" />
          {bulkSend.isPending ? 'Sending…' : `Chase all (${queue.length})`}
        </Button>
      </div>

      {/* Aging buckets */}
      <div className="grid gap-4 md:grid-cols-4">
        {(['1-7', '8-30', '31-60', '60+'] as AgingBucket[]).map(b => (
          <Card key={b} className={bucketColor(b)} data-testid={`bucket-${b}`}>
            <CardHeader className="pb-2">
              <CardDescription>{b} days overdue</CardDescription>
              <CardTitle className="text-3xl">{buckets[b] ?? 0}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">invoices</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Total outstanding</CardTitle>
          <CardDescription>{overdue.length} overdue invoices</CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold">
          AED {totalOutstanding.toFixed(2)}
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
              {queue.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  Nothing waiting in the queue.
                </div>
              ) : (
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
              {historyQuery.data?.length === 0 && (
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
          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="metric-conversion-rate">
              <CardHeader>
                <CardDescription>Conversion rate</CardDescription>
                <CardTitle className="text-3xl">{((effQuery.data?.conversionRate ?? 0) * 100).toFixed(1)}%</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {effQuery.data?.paidAfterChase ?? 0} / {effQuery.data?.uniqueInvoices ?? 0} chased invoices paid
              </CardContent>
            </Card>
            <Card data-testid="metric-avg-days">
              <CardHeader>
                <CardDescription>Avg days to payment</CardDescription>
                <CardTitle className="text-3xl">
                  {effQuery.data?.avgDaysToPayment ?? '—'}
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
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={configQuery.data?.chaseFrequencyDays ?? 7}
                    onBlur={(e) => saveConfig.mutate({ chaseFrequencyDays: Number(e.target.value) })}
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
          <Textarea value={previewBody} readOnly className="min-h-[260px] font-mono text-sm" data-testid="textarea-preview" />
          <DialogFooter>
            <Button variant="outline" onClick={() => navigator.clipboard?.writeText(previewBody)}>Copy</Button>
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
          {invoiceHistoryQuery.data && invoiceHistoryQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No chases yet for this invoice.</p>
          )}
          <div className="space-y-3">
            {invoiceHistoryQuery.data?.map(c => (
              <div key={c.id} className="border-l-2 border-muted pl-4 py-2">
                <div className="flex items-center gap-2">
                  <Badge className={levelColor(c.level)}>L{c.level}</Badge>
                  <span className="text-sm font-medium">{new Date(c.sentAt).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">via {c.method} ({c.language})</span>
                </div>
                <pre className="mt-2 text-xs whitespace-pre-wrap font-sans">{c.messageText}</pre>
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
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
            <Button
              onClick={() => editingTemplate && saveTemplate.mutate(editingTemplate)}
              disabled={saveTemplate.isPending}
              data-testid="button-save-template"
            >
              {saveTemplate.isPending ? 'Saving…' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
