import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/lib/i18n';
import {
  Mail,
  MessageCircle,
  Send,
  FileText,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  Inbox,
  Plus,
  Eye,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CommChannel = 'email' | 'whatsapp' | 'sms';
type CommStatus = 'sent' | 'delivered' | 'read' | 'failed';

interface Communication {
  id: string;
  companyId: string;
  companyName: string;
  userId: string | null;
  channel: CommChannel;
  direction: 'inbound' | 'outbound';
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string | null;
  body: string;
  status: CommStatus;
  templateType: string | null;
  sentAt: string;
  createdAt: string;
}

interface CommsLog {
  data: Communication[];
  total: number;
  page: number;
  limit: number;
}

interface Template {
  id: string;
  name: string;
  channel: CommChannel;
  templateType: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  language: string;
  isActive: boolean;
}

interface ClientOption {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface BulkPreviewItem {
  companyId: string;
  companyName: string;
  contactEmail: string | null;
  dueDate: string;
}

interface BulkResult {
  sent: number;
  failed: number;
  results: { companyId: string; companyName: string; sent: boolean; note?: string }[];
}

// ─── Default templates for first-time seeding ────────────────────────────────

const SEED_TEMPLATES = [
  {
    name: 'VAT Reminder (5 Days)',
    channel: 'email' as CommChannel,
    templateType: 'vat_reminder',
    subjectTemplate: 'VAT Return Reminder — Due [date]',
    bodyTemplate:
      'Dear [company],\n\nYour VAT return is due on [date]. Please ensure all documents are submitted to our team promptly.\n\nKind regards,\nNR Accounting Team',
    language: 'en',
    isActive: true,
  },
  {
    name: 'VAT Overdue',
    channel: 'email' as CommChannel,
    templateType: 'vat_reminder',
    subjectTemplate: 'Urgent: VAT Filing Overdue',
    bodyTemplate:
      'Dear [company],\n\nYour VAT filing is now overdue. Please contact us immediately to avoid penalties.\n\nKind regards,\nNR Accounting Team',
    language: 'en',
    isActive: true,
  },
  {
    name: 'Document Request',
    channel: 'email' as CommChannel,
    templateType: 'document_request',
    subjectTemplate: 'Documents Required for [period]',
    bodyTemplate:
      'Dear [company],\n\nWe need the following documents for [period]:\n- Bank statements\n- Receipts\n- Invoices\n\nPlease upload them to your client portal or send them to us.\n\nKind regards,\nNR Accounting Team',
    language: 'en',
    isActive: true,
  },
  {
    name: 'Invoice Delivery',
    channel: 'email' as CommChannel,
    templateType: 'invoice',
    subjectTemplate: 'Invoice [number] for [amount]',
    bodyTemplate:
      'Dear [company],\n\nPlease find attached your invoice [number] for [amount].\n\nPayment is due within 30 days.\n\nKind regards,\nNR Accounting Team',
    language: 'en',
    isActive: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ChannelIcon({ channel }: { channel: CommChannel }) {
  if (channel === 'email') return <Mail className="h-4 w-4 text-blue-500" />;
  if (channel === 'whatsapp') return <MessageCircle className="h-4 w-4 text-green-500" />;
  return <MessageCircle className="h-4 w-4 text-gray-500" />;
}

function CommStatusBadge({ status }: { status: CommStatus }) {
  const map: Record<CommStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    sent: { label: 'Sent', variant: 'default' },
    delivered: { label: 'Delivered', variant: 'secondary' },
    read: { label: 'Read', variant: 'outline' },
    failed: { label: 'Failed', variant: 'destructive' },
  };
  const { label, variant } = map[status] ?? { label: status, variant: 'outline' };
  return <Badge variant={variant}>{label}</Badge>;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-AE');
}

// ─── Inbox Tab ────────────────────────────────────────────────────────────────

function InboxTab() {
  const { t } = useTranslation();
  const [filterCompany, setFilterCompany] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (filterCompany) params.set('companyId', filterCompany);
  if (filterChannel) params.set('channel', filterChannel);

  const { data, isLoading } = useQuery<CommsLog>({
    queryKey: ['/api/firm/comms/log', filterCompany, filterChannel, page],
    queryFn: () => apiRequest('GET', `/api/firm/comms/log?${params}`),
  });

  const { data: clients } = useQuery<ClientOption[]>({
    queryKey: ['/api/firm/clients'],
  });

  const comms = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Select value={filterCompany} onValueChange={(v) => { setFilterCompany(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t.selectClient} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.allAccounts}</SelectItem>
            {clients?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterChannel} onValueChange={(v) => { setFilterChannel(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t.channel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.allAccounts}</SelectItem>
            <SelectItem value="email">{t.email}</SelectItem>
            <SelectItem value="whatsapp">{t.whatsapp}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t.loading}</div>
          ) : comms.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>{t.noCommsYet}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.channel}</TableHead>
                  <TableHead>{t.clientPortfolio}</TableHead>
                  <TableHead>Subject / Preview</TableHead>
                  <TableHead>{t.status}</TableHead>
                  <TableHead>{t.date}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comms.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ChannelIcon channel={c.channel} />
                        <span className="text-xs text-muted-foreground capitalize">{c.channel}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{c.companyName}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate text-sm">
                        {c.subject || c.body.slice(0, 60)}
                      </div>
                      {c.recipientEmail && (
                        <div className="text-xs text-muted-foreground">{c.recipientEmail}</div>
                      )}
                    </TableCell>
                    <TableCell><CommStatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(c.sentAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <span className="px-2 py-1">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compose Tab ──────────────────────────────────────────────────────────────

function ComposeTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [companyId, setCompanyId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const { data: clients } = useQuery<ClientOption[]>({
    queryKey: ['/api/firm/clients'],
  });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['/api/firm/comms/templates'],
  });

  const emailTemplates = templates?.filter((t) => t.channel === 'email') ?? [];
  const waTemplates = templates?.filter((t) => t.channel === 'whatsapp') ?? [];
  const activeTemplates = channel === 'email' ? emailTemplates : waTemplates;

  const sendMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiRequest('POST', channel === 'email' ? '/api/firm/comms/send-email' : '/api/firm/comms/send-whatsapp', data),
    onSuccess: (res: { success: boolean; note?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/comms/log'] });
      if (res.success) {
        toast({ title: 'Message sent' });
      } else {
        toast({ title: 'Logged (not sent)', description: res.note, variant: 'destructive' });
      }
      setBody('');
      setSubject('');
      setSelectedTemplate('');
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: t.error, description: e?.message });
    },
  });

  function applyTemplate(templateId: string) {
    const tmpl = templates?.find((t) => t.id === templateId);
    if (!tmpl) return;
    setSelectedTemplate(templateId);
    if (tmpl.subjectTemplate) setSubject(tmpl.subjectTemplate);
    setBody(tmpl.bodyTemplate);
  }

  function handleClientChange(id: string) {
    setCompanyId(id);
    const client = clients?.find((c) => c.id === id);
    if (client?.contactEmail) setRecipientEmail(client.contactEmail);
    if (client?.contactPhone) setRecipientPhone(client.contactPhone ?? '');
  }

  function handleSend() {
    if (!companyId) return toast({ variant: 'destructive', title: 'Select a client first' });
    if (!body.trim()) return toast({ variant: 'destructive', title: 'Message body is required' });
    if (channel === 'email' && !recipientEmail) return toast({ variant: 'destructive', title: 'Recipient email is required' });
    if (channel === 'whatsapp' && !recipientPhone) return toast({ variant: 'destructive', title: 'Recipient phone is required' });

    const payload: Record<string, string> = { companyId, body };
    if (channel === 'email') {
      payload.recipientEmail = recipientEmail;
      payload.subject = subject;
    } else {
      payload.recipientPhone = recipientPhone;
    }

    sendMutation.mutate(payload);
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Channel toggle */}
      <div className="flex gap-2">
        <Button
          variant={channel === 'email' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setChannel('email')}
        >
          <Mail className="h-4 w-4 mr-1.5" />
          {t.sendEmail}
        </Button>
        <Button
          variant={channel === 'whatsapp' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setChannel('whatsapp')}
        >
          <MessageCircle className="h-4 w-4 mr-1.5" />
          {t.sendWhatsApp}
        </Button>
      </div>

      {/* Client */}
      <div className="space-y-1.5">
        <Label>{t.selectClient}</Label>
        <Select value={companyId} onValueChange={handleClientChange}>
          <SelectTrigger>
            <SelectValue placeholder={t.selectClient} />
          </SelectTrigger>
          <SelectContent>
            {clients?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template */}
      {activeTemplates.length > 0 && (
        <div className="space-y-1.5">
          <Label>{t.selectTemplate}</Label>
          <Select value={selectedTemplate} onValueChange={applyTemplate}>
            <SelectTrigger>
              <SelectValue placeholder={t.selectTemplate} />
            </SelectTrigger>
            <SelectContent>
              {activeTemplates.map((tmpl) => (
                <SelectItem key={tmpl.id} value={tmpl.id}>{tmpl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Recipient */}
      {channel === 'email' ? (
        <>
          <div className="space-y-1.5">
            <Label>{t.recipient} (email)</Label>
            <Input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="client@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. VAT Return Reminder"
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label>{t.recipient} (phone)</Label>
          <Input
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="+971 50 000 0000"
          />
        </div>
      )}

      {/* Body */}
      <div className="space-y-1.5">
        <Label>Message</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Enter your message here..."
          className="resize-none"
        />
      </div>

      <Button onClick={handleSend} disabled={sendMutation.isPending}>
        <Send className="h-4 w-4 mr-1.5" />
        {sendMutation.isPending ? t.loading : t.sendEmail}
      </Button>

      {channel === 'whatsapp' && (
        <p className="text-xs text-muted-foreground mt-1">
          WhatsApp Business API integration is pending. Messages will be logged but not delivered.
        </p>
      )}
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editTemplate, setEditTemplate] = useState<Partial<Template> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['/api/firm/comms/templates'],
  });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Template>) =>
      apiRequest('POST', '/api/firm/comms/templates', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/comms/templates'] });
      toast({ title: t.templateSaved });
      setDialogOpen(false);
      setEditTemplate(null);
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: t.error, description: e?.message });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      for (const tmpl of SEED_TEMPLATES) {
        await apiRequest('POST', '/api/firm/comms/templates', tmpl);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/comms/templates'] });
      toast({ title: 'Default templates added' });
    },
  });

  function openNew() {
    setEditTemplate({
      name: '',
      channel: 'email',
      templateType: 'custom',
      subjectTemplate: '',
      bodyTemplate: '',
      language: 'en',
      isActive: true,
    });
    setDialogOpen(true);
  }

  function openEdit(tmpl: Template) {
    setEditTemplate({ ...tmpl });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!editTemplate?.name || !editTemplate?.bodyTemplate) {
      return toast({ variant: 'destructive', title: 'Name and body are required' });
    }
    saveMutation.mutate(editTemplate);
  }

  const templateTypeLabel: Record<string, string> = {
    vat_reminder: 'VAT Reminder',
    invoice: 'Invoice',
    document_request: 'Document Request',
    payment_confirmation: 'Payment Confirmation',
    custom: 'Custom',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {(templates?.length ?? 0)} template{(templates?.length ?? 0) !== 1 ? 's' : ''}
        </p>
        <div className="flex gap-2">
          {(templates?.length ?? 0) === 0 && (
            <Button variant="outline" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Zap className="h-4 w-4 mr-1.5" />
              {seedMutation.isPending ? t.loading : 'Add Defaults'}
            </Button>
          )}
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t.addTemplate}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t.loading}</div>
          ) : (templates?.length ?? 0) === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>{t.noTemplates}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.templateName}</TableHead>
                  <TableHead>{t.channel}</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>{t.status}</TableHead>
                  <TableHead>{t.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates?.map((tmpl) => (
                  <TableRow key={tmpl.id}>
                    <TableCell className="font-medium">{tmpl.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ChannelIcon channel={tmpl.channel} />
                        <span className="capitalize">{tmpl.channel}</span>
                      </div>
                    </TableCell>
                    <TableCell>{templateTypeLabel[tmpl.templateType] ?? tmpl.templateType}</TableCell>
                    <TableCell className="uppercase">{tmpl.language}</TableCell>
                    <TableCell>
                      <Badge variant={tmpl.isActive ? 'default' : 'secondary'}>
                        {tmpl.isActive ? 'Active' : t.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(tmpl)}>
                        {t.edit}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTemplate?.id ? t.editTemplate : t.addTemplate}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t.templateName}</Label>
              <Input
                value={editTemplate?.name ?? ''}
                onChange={(e) => setEditTemplate((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t.channel}</Label>
                <Select
                  value={editTemplate?.channel ?? 'email'}
                  onValueChange={(v) => setEditTemplate((p) => ({ ...p, channel: v as CommChannel }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={editTemplate?.templateType ?? 'custom'}
                  onValueChange={(v) => setEditTemplate((p) => ({ ...p, templateType: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vat_reminder">VAT Reminder</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="document_request">Document Request</SelectItem>
                    <SelectItem value="payment_confirmation">Payment Confirmation</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editTemplate?.channel === 'email' && (
              <div className="space-y-1.5">
                <Label>{t.subjectTemplate}</Label>
                <Input
                  value={editTemplate?.subjectTemplate ?? ''}
                  onChange={(e) => setEditTemplate((p) => ({ ...p, subjectTemplate: e.target.value }))}
                  placeholder="e.g. VAT Return Reminder — Due [date]"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t.templateBody}</Label>
              <Textarea
                rows={5}
                value={editTemplate?.bodyTemplate ?? ''}
                onChange={(e) => setEditTemplate((p) => ({ ...p, bodyTemplate: e.target.value }))}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Use [company], [date], [period], [number], [amount] as placeholders.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t.loading : t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Bulk Actions Tab ─────────────────────────────────────────────────────────

function BulkActionsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [daysAhead, setDaysAhead] = useState(7);
  const [preview, setPreview] = useState<BulkPreviewItem[] | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/firm/comms/bulk-remind', { daysAhead, dryRun: true }),
    onSuccess: (res: { preview: BulkPreviewItem[]; count: number }) => {
      setPreview(res.preview);
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: t.error, description: e?.message });
    },
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/firm/comms/bulk-remind', { daysAhead, dryRun: false }),
    onSuccess: (res: BulkResult) => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/comms/log'] });
      toast({
        title: `${t.bulkRemindSuccess}: ${res.sent} sent, ${res.failed} failed`,
      });
      setPreview(null);
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: t.error, description: e?.message });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-amber-500" />
            {t.sendVatReminders}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.vatRemindersPreview}</p>

          <div className="flex items-center gap-3">
            <Label className="whitespace-nowrap">{t.daysAhead}:</Label>
            <Select value={String(daysAhead)} onValueChange={(v) => { setDaysAhead(Number(v)); setPreview(null); }}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 5, 7, 10, 14, 30].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending}
            >
              <Eye className="h-4 w-4 mr-1.5" />
              {previewMutation.isPending ? t.loading : t.previewReminders}
            </Button>
            {preview !== null && preview.length > 0 && (
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
              >
                <Send className="h-4 w-4 mr-1.5" />
                {sendMutation.isPending ? t.loading : `${t.sendReminders} (${preview.length})`}
              </Button>
            )}
          </div>

          {preview !== null && (
            <div className="rounded-md border">
              {preview.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {t.noClientsFound}
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 bg-muted/50 text-xs text-muted-foreground border-b">
                    {t.previewNote} — {preview.length} client{preview.length !== 1 ? 's' : ''} will be contacted
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>{t.recipient}</TableHead>
                        <TableHead>VAT Due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((item) => (
                        <TableRow key={item.companyId}>
                          <TableCell className="font-medium">{item.companyName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.contactEmail ? (
                              <span className="flex items-center gap-1">
                                <CheckCircle className="h-3 w-3 text-green-500" />
                                {item.contactEmail}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-destructive">
                                <XCircle className="h-3 w-3" />
                                No email
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {new Date(item.dueDate).toLocaleDateString('en-AE')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FirmComms() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">{t.communicationsHub}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Send emails, manage templates, and track all client communications.
        </p>
      </div>

      <Tabs defaultValue="inbox">
        <div className="overflow-x-auto">
        <TabsList className="flex w-max">
          <TabsTrigger value="inbox" className="flex items-center gap-1.5">
            <Inbox className="h-4 w-4" />{t.inbox}
          </TabsTrigger>
          <TabsTrigger value="compose" className="flex items-center gap-1.5">
            <Send className="h-4 w-4" />{t.compose}
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-1.5">
            <FileText className="h-4 w-4" />{t.templates}
          </TabsTrigger>
          <TabsTrigger value="bulk" className="flex items-center gap-1.5">
            <Zap className="h-4 w-4" />{t.bulkActions}
          </TabsTrigger>
        </TabsList>
        </div>

        <div className="mt-6">
          <TabsContent value="inbox"><InboxTab /></TabsContent>
          <TabsContent value="compose"><ComposeTab /></TabsContent>
          <TabsContent value="templates"><TemplatesTab /></TabsContent>
          <TabsContent value="bulk"><BulkActionsTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
