import { useEffect, useState, type ComponentProps } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useI18n } from '@/lib/i18n';
import {
  MessageCircle,
  Clock,
  Send,
  Users,
  Search,
  ExternalLink,
  Phone,
  Receipt,
  Bell,
  Megaphone,
  Settings2,
  FileText,
  CreditCard,
  CalendarClock,
  ChevronRight,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { WhatsappMessage, Invoice, CustomerContact, Notification } from '@shared/schema';
import {
  MESSAGE_TEMPLATES,
  fillTemplate,
  formatPhoneForWhatsApp,
  openWhatsApp,
  pickWhatsAppNumber,
  type MessageTemplate,
} from '@/lib/whatsapp-templates';
import {
  draftWithWhatsAppBridge,
  openWhatsAppWithLoggedFallback,
  pingWhatsAppBridge,
  registerWhatsAppBridgeSession,
  updateWhatsAppBridgeJobStatus,
  type WhatsAppBridgePing,
} from '@/lib/whatsapp-bridge';

// ─── Rules ────────────────────────────────────────────────

interface WhatsAppRule {
  id: string;
  name: string;
  type: 'before_due' | 'on_due' | 'after_due' | 'on_invoice' | 'on_event';
  daysOffset: number; // negative = before, 0 = on, positive = after
  templateId: string;
  enabled: boolean;
}

const DEFAULT_RULES: WhatsAppRule[] = [
  { id: 'rule_1', name: 'Invoice Created', type: 'on_invoice', daysOffset: 0, templateId: 'invoice_with_link', enabled: true },
  { id: 'rule_2', name: '3 days before due', type: 'before_due', daysOffset: -3, templateId: 'payment_reminder', enabled: true },
  { id: 'rule_3', name: 'On due date', type: 'on_due', daysOffset: 0, templateId: 'payment_reminder', enabled: true },
  { id: 'rule_4', name: '7 days overdue', type: 'after_due', daysOffset: 7, templateId: 'payment_overdue', enabled: true },
  { id: 'rule_5', name: '14 days overdue', type: 'after_due', daysOffset: 14, templateId: 'payment_overdue', enabled: false },
  { id: 'rule_6', name: 'New client welcome', type: 'on_invoice', daysOffset: 0, templateId: 'welcome_client', enabled: false },
  { id: 'rule_7', name: 'VAT deadline (7 days)', type: 'before_due', daysOffset: -7, templateId: 'vat_deadline_reminder', enabled: true },
];

type WhatsAppBadgeVariant = ComponentProps<typeof Badge>['variant'];

interface WhatsAppBridgeStatus {
  connected: boolean;
  deliveryMode: string;
  deliveryStatus: string;
  canAutoSend: boolean;
  note?: string;
  activeSession?: {
    id: string;
    extensionId: string;
    extensionVersion?: string | null;
    lastSeenAt: string;
    expiresAt: string;
  } | null;
  recentJobs?: Array<{
    id: string;
    kind: string;
    recipientPhone: string;
    recipientName?: string | null;
    status: string;
    deliveryStatus: string;
    createdAt: string;
  }>;
}

interface WhatsAppDispatchOptions {
  kind?: 'direct_message' | 'invoice' | 'document_request' | 'payment_chase' | 'vat_submission_proof' | 'broadcast' | 'custom';
  recipientName?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  attachmentUrl?: string | null;
  attachmentLabel?: string | null;
}

// ─── Component ────────────────────────────────────────────

export default function WhatsAppDashboard() {
  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const isRTL = locale === 'ar';
  const en = locale === 'en';

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showBroadcastDialog, setShowBroadcastDialog] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [rules, setRules] = useState<WhatsAppRule[]>(DEFAULT_RULES);
  const [bridgePing, setBridgePing] = useState<WhatsAppBridgePing>({ available: false });
  const [bridgeChecking, setBridgeChecking] = useState(false);

  // Data queries
  const { data: messages = [], isLoading: messagesLoading } = useQuery<WhatsappMessage[]>({
    queryKey: ['/api/integrations/whatsapp/messages'],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['/api/companies', currentCompany?.id, 'invoices'],
    queryFn: () => apiRequest('GET', `/api/companies/${currentCompany?.id}/invoices`),
    enabled: !!currentCompany?.id,
  });

  const { data: customers = [] } = useQuery<CustomerContact[]>({
    queryKey: ['/api/companies', currentCompany?.id, 'customer-contacts'],
    queryFn: () => apiRequest('GET', `/api/companies/${currentCompany?.id}/customer-contacts`),
    enabled: !!currentCompany?.id,
  });

  const { data: bridgeStatus, refetch: refetchBridgeStatus } = useQuery<WhatsAppBridgeStatus>({
    queryKey: ['/api/integrations/whatsapp/bridge/status'],
  });

  // Notifications for pending actions
  const { data: notificationsData } = useQuery<{ notifications: Notification[]; unreadCount: number }>({
    queryKey: ['/api/notifications'],
  });
  const pendingActions = (notificationsData?.notifications || []).filter(
    (n) => n.type === 'payment_due' && !n.isDismissed && !n.isRead
  );

  const checkBridge = async (showToast = false) => {
    setBridgeChecking(true);
    try {
      const ping = await pingWhatsAppBridge();
      setBridgePing(ping);
      if (ping.available) {
        await registerWhatsAppBridgeSession(ping, currentCompany?.id).catch(() => {});
        await refetchBridgeStatus();
        if (showToast) {
          toast({
            title: en ? 'WhatsApp Bridge detected' : 'تم العثور على جسر واتساب',
            description: en
              ? 'Messages can be drafted in WhatsApp Web for staff review.'
              : 'يمكن تجهيز الرسائل في واتساب ويب للمراجعة.',
          });
        }
      } else if (showToast) {
        toast({
          title: en ? 'Bridge extension not detected' : 'لم يتم العثور على الإضافة',
          description: en
            ? 'We will use the safe WhatsApp Desktop/Web handoff instead.'
            : 'سنستخدم فتح واتساب الآمن بدلاً من ذلك.',
        });
      }
    } finally {
      setBridgeChecking(false);
    }
  };

  useEffect(() => {
    void checkBridge(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  // Filter messages
  const filteredMessages = messages.filter(msg => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      msg.content?.toLowerCase().includes(q) ||
      msg.to?.toLowerCase().includes(q) ||
      msg.from?.toLowerCase().includes(q)
    );
  });

  // Helpers
  const getCustomerName = (phone: string) => {
    const customer = customers.find(
      (c) => c.phone === phone || c.whatsappNumber === phone,
    );
    return customer?.name || phone;
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(en ? 'en-AE' : 'ar-AE', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const getMessageDeliveryMeta = (msg: WhatsappMessage): { label: string; variant: WhatsAppBadgeVariant } => {
    if (msg.direction !== 'outbound') {
      return { label: en ? 'Received' : 'مستلم', variant: 'secondary' };
    }

    const status = (msg.status || '').toLowerCase();
    const isPersonalLink =
      msg.from === 'personal' ||
      msg.waMessageId?.startsWith('personal_') ||
      msg.waMessageId?.startsWith('chase_');

    if (isPersonalLink || status === 'logged') {
      return { label: en ? 'Logged' : 'مسجل', variant: 'neutral' };
    }

    if (status === 'queued') {
      return { label: en ? 'Queued' : 'في الانتظار', variant: 'secondary' };
    }

    if (status === 'drafted') {
      return { label: en ? 'Drafted' : 'مسودة', variant: 'info' };
    }

    if (status === 'sent_unverified') {
      return { label: en ? 'Sent, unverified' : 'مرسل غير مؤكد', variant: 'warning' };
    }

    if (status === 'failed') {
      return { label: en ? 'Failed' : 'فشل', variant: 'danger' };
    }

    if (status === 'delivered' || status === 'processed') {
      return { label: en ? 'Delivered' : 'تم التسليم', variant: 'success' };
    }

    return { label: en ? 'Sent' : 'مرسل', variant: 'info' };
  };

  const logAndOpen = async (phone: string, message: string, options: WhatsAppDispatchOptions = {}) => {
    const normalized = formatPhoneForWhatsApp(phone);
    if (!normalized) {
      toast({
        title: en ? 'Invalid WhatsApp number' : 'رقم واتساب غير صالح',
        variant: 'destructive',
      });
      return;
    }

    let bridgeJobId: string | undefined;
    try {
      const created = await apiRequest('POST', '/api/integrations/whatsapp/bridge/jobs', {
        companyId: currentCompany?.id,
        to: phone,
        recipientName: options.recipientName || null,
        message,
        kind: options.kind || 'direct_message',
        sourceType: options.sourceType || null,
        sourceId: options.sourceId || null,
        attachmentUrl: options.attachmentUrl || null,
        attachmentLabel: options.attachmentLabel || null,
      });
      bridgeJobId = created?.job?.id;
      if (!bridgeJobId) {
        throw new Error('Bridge job was not created');
      }

      const draft = await draftWithWhatsAppBridge({
        jobId: bridgeJobId,
        phone: normalized,
        message,
        recipientName: options.recipientName || null,
        attachmentUrl: options.attachmentUrl || null,
        attachmentLabel: options.attachmentLabel || null,
      });

      if (draft.ok && bridgeJobId) {
        await updateWhatsAppBridgeJobStatus(bridgeJobId, 'drafted', 'drafted').catch(() => {});
        setBridgePing({
          available: true,
          extensionId: draft.extensionId || bridgePing.extensionId,
          version: draft.version || bridgePing.version,
        });
        toast({
          title: en ? 'Draft opened in WhatsApp Web' : 'تم فتح المسودة في واتساب ويب',
          description: en
            ? 'Review the message in WhatsApp Web, then press send there.'
            : 'راجع الرسالة في واتساب ويب ثم أرسلها من هناك.',
        });
      } else {
        await openWhatsAppWithLoggedFallback(normalized, message, bridgeJobId);
        toast({
          title: en ? 'Opening WhatsApp...' : 'جاري فتح واتساب...',
          description: en
            ? 'Bridge extension was not detected; using Desktop/Web handoff.'
            : 'لم يتم العثور على الإضافة؛ سيتم فتح واتساب مباشرة.',
        });
      }
    } catch (error: any) {
      await apiRequest('POST', '/api/integrations/whatsapp/log-message', { to: normalized, message }).catch(() => {});
      openWhatsApp(normalized, message);
      toast({
        title: en ? 'Opening WhatsApp...' : 'جاري فتح واتساب...',
        description: error?.message
          ? (en ? 'Bridge queue failed, so we used the safe handoff.' : 'تعذر إنشاء مهمة الجسر، لذلك استخدمنا الفتح الآمن.')
          : undefined,
      });
    } finally {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
        queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/bridge/status'] });
      }, 1000);
    }
  };

  // ─── Handlers ───────────────────────────────────────────

  const handleSendMessage = () => {
    let phone = sendTo;
    if (selectedCustomer) {
      const cust = customers.find(c => c.id === selectedCustomer);
      const wa = cust ? pickWhatsAppNumber(cust) : null;
      if (wa) phone = wa;
      else {
        toast({ title: en ? 'No phone number' : 'لا يوجد رقم', variant: 'destructive' });
        return;
      }
    }
    if (!phone.trim()) { toast({ title: en ? 'Phone required' : 'رقم الهاتف مطلوب', variant: 'destructive' }); return; }
    if (!sendMessage.trim()) { toast({ title: en ? 'Message required' : 'الرسالة مطلوبة', variant: 'destructive' }); return; }

    const selectedContact = selectedCustomer ? customers.find(c => c.id === selectedCustomer) : null;
    void logAndOpen(phone, sendMessage, {
      kind: selectedTemplate === 'document_request' ? 'document_request' : 'direct_message',
      recipientName: selectedContact?.name || null,
    });
    setSendTo(''); setSendMessage(''); setSelectedCustomer(''); setSelectedTemplate('');
    setShowSendDialog(false);
  };

  const handleSendInvoice = () => {
    if (!selectedInvoice) { toast({ title: en ? 'Select an invoice' : 'اختر فاتورة', variant: 'destructive' }); return; }
    const inv = invoices.find(i => i.id === selectedInvoice);
    if (!inv) return;
    const cust = customers.find(c => c.name === inv.customerName);
    const recipient = cust ? pickWhatsAppNumber(cust) : null;
    if (!recipient) { toast({ title: en ? 'No phone number' : 'لا يوجد رقم', variant: 'destructive' }); return; }

    const invoiceDate = new Date(inv.date);
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + (cust!.paymentTerms || 30));

    const tpl = MESSAGE_TEMPLATES.find(t => t.id === (selectedTemplate || 'invoice_new'));
    const templateStr = en ? (tpl?.template || '') : (tpl?.templateAr || '');
    const message = fillTemplate(templateStr, {
      customer_name: inv.customerName || 'Customer',
      invoice_number: inv.number,
      amount: `AED ${inv.total.toFixed(2)}`,
      due_date: dueDate.toLocaleDateString(en ? 'en-AE' : 'ar-AE'),
      company_name: currentCompany?.name || 'Our Company',
    });

    void logAndOpen(recipient, message, {
      kind: 'invoice',
      recipientName: inv.customerName,
      sourceType: 'invoice',
      sourceId: inv.id,
      attachmentLabel: `Invoice ${inv.number}`,
    });
    setSelectedInvoice(''); setSelectedTemplate(''); setShowInvoiceDialog(false);
  };

  const handleBroadcast = () => {
    if (!broadcastMessage.trim()) { toast({ title: en ? 'Message required' : 'الرسالة مطلوبة', variant: 'destructive' }); return; }
    const recipients = customers
      .map((c) => ({ customer: c, number: pickWhatsAppNumber(c) }))
      .filter((r): r is { customer: CustomerContact; number: string } => !!r.number);
    if (recipients.length === 0) { toast({ title: en ? 'No customers with phone numbers' : 'لا يوجد عملاء بأرقام', variant: 'destructive' }); return; }

    recipients.forEach((r, i) => {
      const tpl = MESSAGE_TEMPLATES.find(t => t.id === 'news_update');
      const templateStr = en ? (tpl?.template || '') : (tpl?.templateAr || '');
      const msg = fillTemplate(templateStr, {
        customer_name: r.customer.name,
        message: broadcastMessage,
        company_name: currentCompany?.name || 'Our Company',
      });

      setTimeout(() => {
        void logAndOpen(r.number, msg, {
          kind: 'broadcast',
          recipientName: r.customer.name,
          sourceType: 'broadcast',
        });
      }, i * 900);
    });

    toast({ title: en ? `Opening WhatsApp for ${recipients.length} customer(s)...` : `جاري فتح واتساب لـ ${recipients.length} عميل...` });
    setBroadcastMessage(''); setShowBroadcastDialog(false);
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
    }, recipients.length * 800 + 1000);
  };

  const handleQuickMessage = (customer: CustomerContact) => {
    const wa = pickWhatsAppNumber(customer);
    if (!wa) { toast({ title: en ? 'No phone number' : 'لا يوجد رقم', variant: 'destructive' }); return; }
    setSelectedCustomer(customer.id);
    setSendTo(wa);
    setSendMessage('');
    setShowSendDialog(true);
  };

  const toggleRule = (ruleId: string) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
    // Save rules to backend
    apiRequest('POST', '/api/integrations/whatsapp/save-rules', {
      rules: rules.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r),
    }).catch(() => {});
  };

  const handleActionNotification = (notification: Notification) => {
    // Find the related invoice to get customer details
    const inv = notification.relatedEntityId
      ? invoices.find((i) => i.id === notification.relatedEntityId)
      : null;

    if (inv) {
      const cust = customers.find((c) => c.name === inv.customerName);
      const wa = cust ? pickWhatsAppNumber(cust) : null;
      if (cust && wa) {
        const tpl = MESSAGE_TEMPLATES.find((t) => t.id === 'payment_reminder');
        const invoiceDate = new Date(inv.date);
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + (cust.paymentTerms || 30));

        const templateStr = en ? (tpl?.template || '') : (tpl?.templateAr || '');
        const message = fillTemplate(templateStr, {
          customer_name: inv.customerName || 'Customer',
          invoice_number: inv.number,
          amount: `AED ${inv.total.toFixed(2)}`,
          due_date: dueDate.toLocaleDateString(en ? 'en-AE' : 'ar-AE'),
          company_name: currentCompany?.name || 'Our Company',
        });

        void logAndOpen(wa, message, {
          kind: 'payment_chase',
          recipientName: inv.customerName,
          sourceType: 'invoice',
          sourceId: inv.id,
        });
      } else {
        toast({ title: en ? 'No phone number for this customer' : 'لا يوجد رقم هاتف لهذا العميل', variant: 'destructive' });
      }
    }

    // Mark notification as read
    apiRequest('PATCH', `/api/notifications/${notification.id}/read`, {}).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
  };

  const dismissNotification = (notificationId: string) => {
    apiRequest('PATCH', `/api/notifications/${notificationId}/dismiss`, {}).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
  };

  const applyTemplate = (templateId: string) => {
    const tpl = MESSAGE_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;

    const custName = selectedCustomer
      ? customers.find(c => c.id === selectedCustomer)?.name || ''
      : '';

    const templateStr = en ? tpl.template : tpl.templateAr;
    const msg = fillTemplate(templateStr, {
      customer_name: custName || (en ? '[Customer Name]' : '[اسم العميل]'),
      message: en ? '[Your message here]' : '[رسالتك هنا]',
      company_name: currentCompany?.name || 'Our Company',
      invoice_number: '[INV-XXX]',
      amount: '[AED X,XXX.XX]',
      due_date: '[Date]',
    });
    setSendMessage(msg);
  };

  const selectedInvoiceRecord = invoices.find((invoice) => invoice.id === selectedInvoice);
  const selectedInvoiceCustomer = selectedInvoiceRecord
    ? customers.find((customer) => customer.name === selectedInvoiceRecord.customerName)
    : null;
  const selectedInvoicePhone = selectedInvoiceCustomer ? pickWhatsAppNumber(selectedInvoiceCustomer) : null;
  const bridgeDetected = Boolean(bridgePing.available || bridgeStatus?.connected);
  const recentBridgeJobs = bridgeStatus?.recentJobs ?? [];

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className={`container max-w-6xl mx-auto py-6 px-4 space-y-6 ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
            <SiWhatsapp className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{en ? 'WhatsApp' : 'واتساب'}</h1>
            <p className="text-sm text-muted-foreground">
              {en
                ? 'Prepare messages, invoice reminders, and broadcasts for WhatsApp Desktop/Web. Sending is confirmed inside WhatsApp.'
                : 'جهّز الرسائل وتذكيرات الفواتير والبث لواتساب. يتم تأكيد الإرسال داخل واتساب.'}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Broadcast */}
          <Dialog open={showBroadcastDialog} onOpenChange={setShowBroadcastDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-broadcast">
                <Megaphone className="w-4 h-4 mr-2" />
                {en ? 'Broadcast News' : 'بث أخبار'}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{en ? 'Broadcast to All Clients' : 'بث لجميع العملاء'}</DialogTitle>
                <DialogDescription>
                  {en
                    ? `Prepare a news or announcement message for ${customers.filter((c) => pickWhatsAppNumber(c)).length} customer(s) with phone numbers`
                    : `جهّز خبر أو إعلان لـ ${customers.filter((c) => pickWhatsAppNumber(c)).length} عميل لديهم أرقام هواتف`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Textarea
                  placeholder={en ? 'Type your announcement...' : 'اكتب إعلانك...'}
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  rows={5}
                  data-testid="input-broadcast"
                />
                <p className="text-xs text-muted-foreground">
                  {en
                    ? 'This will open WhatsApp for each customer. Your browser may ask to allow popups.'
                    : 'سيتم فتح واتساب لكل عميل. قد يطلب المتصفح السماح بالنوافذ المنبثقة.'}
                </p>
                <Button onClick={handleBroadcast} className="w-full bg-green-600 hover:bg-green-700" data-testid="button-send-broadcast">
                  <Megaphone className="w-4 h-4 mr-2" />
                  {en ? `Open ${customers.filter((c) => pickWhatsAppNumber(c)).length} WhatsApp chat(s)` : `فتح ${customers.filter((c) => pickWhatsAppNumber(c)).length} محادثة واتساب`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline"
            onClick={() => {
              setSelectedTemplate('document_request');
              applyTemplate('document_request');
              setShowSendDialog(true);
            }}
            data-testid="button-document-request-whatsapp"
          >
            <FileText className="w-4 h-4 mr-2" />
            {en ? 'Document Request' : 'طلب مستندات'}
          </Button>

          {/* Invoice Reminder */}
          <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-send-invoice">
                <Receipt className="w-4 h-4 mr-2" />
                {en ? 'Invoice Reminder' : 'تذكير فاتورة'}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{en ? 'Prepare Invoice Reminder' : 'تجهيز تذكير فاتورة'}</DialogTitle>
                <DialogDescription>
                  {en ? 'Select an invoice and template, then open WhatsApp to confirm the send.' : 'اختر فاتورة وقالباً ثم افتح واتساب لتأكيد الإرسال.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="mb-1.5 block">{en ? 'Invoice' : 'الفاتورة'}</Label>
                  <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
                    <SelectTrigger data-testid="select-invoice">
                      <SelectValue placeholder={en ? 'Select an invoice' : 'اختر فاتورة'} />
                    </SelectTrigger>
                    <SelectContent>
                      {invoices
                        .filter(inv => inv.status !== 'paid')
                        .map(inv => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.number} - {inv.customerName} - AED {inv.total.toFixed(2)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1.5 block">{en ? 'Template' : 'القالب'}</Label>
                  <Select value={selectedTemplate || 'invoice_new'} onValueChange={setSelectedTemplate}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MESSAGE_TEMPLATES.filter(t => ['invoice', 'payment'].includes(t.category)).map(tpl => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {en ? tpl.name : tpl.nameAr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedInvoiceRecord ? (
                  <div className="p-3 rounded-lg bg-muted text-sm space-y-1">
                    <p><strong>{en ? 'Customer' : 'العميل'}:</strong> {selectedInvoiceRecord.customerName}</p>
                    <p><strong>{en ? 'Amount' : 'المبلغ'}:</strong> AED {selectedInvoiceRecord.total.toFixed(2)}</p>
                    <p><strong>{en ? 'Phone' : 'الهاتف'}:</strong> {selectedInvoicePhone || (en ? 'No phone' : 'لا يوجد رقم')}</p>
                    {!selectedInvoicePhone ? (
                      <p className="text-xs text-destructive">
                        {en
                          ? 'Add a WhatsApp number to this customer before opening an invoice reminder.'
                          : 'أضف رقم واتساب لهذا العميل قبل فتح تذكير الفاتورة.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  onClick={handleSendInvoice}
                  disabled={!selectedInvoice || !selectedInvoicePhone}
                  className="w-full bg-green-600 hover:bg-green-700"
                  data-testid="button-open-whatsapp-invoice"
                >
                  <SiWhatsapp className="w-4 h-4 mr-2" />
                  {en ? 'Open in WhatsApp' : 'فتح في واتساب'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Send Message */}
          <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700" data-testid="button-send-message">
                <Send className="w-4 h-4 mr-2" />
                {en ? 'Prepare Message' : 'تجهيز رسالة'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{en ? 'Prepare WhatsApp Message' : 'تجهيز رسالة واتساب'}</DialogTitle>
                <DialogDescription>
                  {en ? 'Compose a message. It will open in WhatsApp Desktop/Web and be logged here; delivery is not verified by Muhasib.' : 'اكتب الرسالة. ستفتح في واتساب ويتم تسجيلها هنا؛ لا يتحقق محاسب من التسليم.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="mb-1.5 block">{en ? 'Customer' : 'العميل'}</Label>
                  <Select value={selectedCustomer} onValueChange={(val) => {
                    setSelectedCustomer(val);
                    const cust = customers.find(c => c.id === val);
                    const wa = cust ? pickWhatsAppNumber(cust) : null;
                    if (wa) setSendTo(wa);
                  }}>
                    <SelectTrigger data-testid="select-customer">
                      <SelectValue placeholder={en ? 'Select a customer' : 'اختر عميل'} />
                    </SelectTrigger>
                    <SelectContent>
                      {customers
                        .filter((c) => pickWhatsAppNumber(c))
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({pickWhatsAppNumber(c)})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1.5 block">{en ? 'Or enter phone number' : 'أو أدخل رقم الهاتف'}</Label>
                  <Input
                    placeholder={en ? 'e.g. 971501234567' : 'مثال: 971501234567'}
                    value={sendTo}
                    onChange={(e) => { setSendTo(e.target.value); setSelectedCustomer(''); }}
                    data-testid="input-phone"
                  />
                </div>

                <div>
                  <Label className="mb-1.5 block">{en ? 'Template (optional)' : 'قالب (اختياري)'}</Label>
                  <Select value={selectedTemplate} onValueChange={(val) => { setSelectedTemplate(val); applyTemplate(val); }}>
                    <SelectTrigger>
                      <SelectValue placeholder={en ? 'Choose a template...' : 'اختر قالب...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {MESSAGE_TEMPLATES.map(tpl => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {en ? tpl.name : tpl.nameAr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-1.5 block">{en ? 'Message' : 'الرسالة'}</Label>
                  <Textarea
                    placeholder={en ? 'Type your message...' : 'اكتب رسالتك...'}
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    rows={6}
                    data-testid="input-message"
                  />
                </div>

                <Button onClick={handleSendMessage} className="w-full bg-green-600 hover:bg-green-700" data-testid="button-open-whatsapp">
                  <SiWhatsapp className="w-4 h-4 mr-2" />
                  {en ? 'Open in WhatsApp' : 'فتح في واتساب'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={bridgeDetected ? 'success' : 'warning'} dot>
                  {bridgeDetected
                    ? (en ? 'Bridge ready' : 'الجسر جاهز')
                    : (en ? 'Bridge not detected' : 'لم يتم العثور على الجسر')}
                </Badge>
                <Badge variant="neutral">
                  {en ? 'Human-confirmed send' : 'إرسال بمراجعة الموظف'}
                </Badge>
                {bridgePing.version || bridgeStatus?.activeSession?.extensionVersion ? (
                  <Badge variant="outline">
                    v{bridgePing.version || bridgeStatus?.activeSession?.extensionVersion}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground max-w-3xl">
                {en
                  ? 'NR can queue an audited WhatsApp job and draft it in WhatsApp Web when the Chrome bridge is installed. Without it, messages fall back to the existing Desktop/Web handoff and stay marked logged only.'
                  : 'يمكن لـ NR إنشاء مهمة واتساب مسجلة وفتحها كمسودة في واتساب ويب عند تثبيت إضافة كروم. بدونها، سيتم استخدام الفتح المباشر وتبقى الرسالة مسجلة فقط.'}
              </p>
              {recentBridgeJobs.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {en ? 'Latest bridge job' : 'آخر مهمة'}: {recentBridgeJobs[0].kind} · {recentBridgeJobs[0].deliveryStatus}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void checkBridge(true)}
                disabled={bridgeChecking}
                data-testid="button-check-whatsapp-bridge"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {bridgeChecking ? (en ? 'Checking...' : 'جاري الفحص...') : (en ? 'Check Bridge' : 'فحص الجسر')}
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open('https://web.whatsapp.com/', '_blank', 'noopener,noreferrer')}
                data-testid="button-open-whatsapp-web"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                {en ? 'Open WhatsApp Web' : 'فتح واتساب ويب'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs defaultValue="messages" className="w-full">
        <TabsList>
          <TabsTrigger value="messages">
            <MessageCircle className="w-4 h-4 mr-1.5" />
            {en ? 'Messages' : 'الرسائل'}
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Users className="w-4 h-4 mr-1.5" />
            {en ? 'Customers' : 'العملاء'}
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Settings2 className="w-4 h-4 mr-1.5" />
            {en ? 'Rules' : 'القواعد'}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText className="w-4 h-4 mr-1.5" />
            {en ? 'Templates' : 'القوالب'}
          </TabsTrigger>
        </TabsList>

        {/* ─── Messages Tab ─────────────────────────────── */}
        <TabsContent value="messages" className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={en ? 'Search messages...' : 'بحث في الرسائل...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>

          {messagesLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                  <SiWhatsapp className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{en ? 'No messages yet' : 'لا توجد رسائل بعد'}</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  {en ? 'Start by preparing a message, invoice reminder, or broadcast for your clients' : 'ابدأ بتجهيز رسالة أو تذكير فاتورة أو بث لعملائك'}
                </p>
                <Button onClick={() => setShowSendDialog(true)} className="bg-green-600 hover:bg-green-700">
                  <Send className="w-4 h-4 mr-2" />
                  {en ? 'Prepare Message' : 'تجهيز رسالة'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredMessages
                .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())
                .map((msg) => {
                  const delivery = getMessageDeliveryMeta(msg);

                  return (
                    <Card key={msg.id} className="hover:bg-accent/50 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                              <SiWhatsapp className="w-5 h-5 text-green-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm">
                                  {msg.direction === 'outbound'
                                    ? `→ ${getCustomerName(msg.to || '')}`
                                    : `← ${getCustomerName(msg.from || '')}`}
                                </span>
                                <Badge variant={delivery.variant} className="text-xs">
                                  {delivery.label}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-line">{msg.content}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  {msg.createdAt ? formatTime(String(msg.createdAt)) : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                          {msg.to && (
                            <Button variant="ghost" size="sm" className="text-green-600 shrink-0" onClick={() => openWhatsApp(msg.to!, '')}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>

        {/* ─── Customers Tab ────────────────────────────── */}
        <TabsContent value="customers">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customers.map((customer) => {
              const wa = pickWhatsAppNumber(customer);
              const usingDedicatedWa = !!customer.whatsappNumber?.trim();
              return (
                <Card key={customer.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{customer.name}</p>
                        {wa ? (
                          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                            {usingDedicatedWa ? (
                              <SiWhatsapp className="w-3 h-3 text-green-500" />
                            ) : (
                              <Phone className="w-3 h-3" />
                            )}
                            {wa}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            {en ? 'No phone' : 'لا يوجد رقم'}
                          </p>
                        )}
                      </div>
                      {wa && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 shrink-0"
                          onClick={() => handleQuickMessage(customer)}
                        >
                          <SiWhatsapp className="w-5 h-5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {customers.length === 0 && (
              <Card className="col-span-full border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    {en ? 'No customers yet. Add contacts to message them via WhatsApp.' : 'لا يوجد عملاء بعد. أضف جهات اتصال لمراسلتهم عبر واتساب.'}
                  </p>
                  <Button asChild className="mt-4" variant="outline">
                    <a href="/contacts">{en ? 'Add contacts' : 'أضف جهات اتصال'}</a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Rules Tab ────────────────────────────────── */}
        <TabsContent value="rules" className="space-y-4">
          {/* Pending Actions */}
          {pendingActions.length > 0 && (
            <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  <CardTitle className="text-lg">
                    {en ? `Pending Actions (${pendingActions.length})` : `إجراءات معلقة (${pendingActions.length})`}
                  </CardTitle>
                </div>
                <CardDescription>
                  {en
                    ? 'These notifications were created by the scheduler. Open a pre-filled WhatsApp message, review it, then confirm the send in WhatsApp.'
                    : 'تم إنشاء هذه الإشعارات بواسطة المجدول. افتح رسالة واتساب جاهزة وراجعها ثم أكد الإرسال داخل واتساب.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingActions.slice(0, 10).map((notification) => {
                  const relatedInv = notification.relatedEntityId
                    ? invoices.find((i) => i.id === notification.relatedEntityId)
                    : null;
                  const cust = relatedInv ? customers.find((c) => c.name === relatedInv.customerName) : null;

                  return (
                    <div
                      key={notification.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-background hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          notification.priority === 'urgent' ? 'bg-red-500/10' :
                          notification.priority === 'high' ? 'bg-orange-500/10' : 'bg-yellow-500/10'
                        }`}>
                          <CreditCard className={`w-4 h-4 ${
                            notification.priority === 'urgent' ? 'text-red-600' :
                            notification.priority === 'high' ? 'text-orange-600' : 'text-yellow-600'
                          }`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{notification.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                          {relatedInv && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {relatedInv.customerName} {cust?.phone ? `(${cust.phone})` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {cust?.phone && (
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-xs h-8"
                            onClick={() => handleActionNotification(notification)}
                          >
                            <SiWhatsapp className="w-3.5 h-3.5 mr-1" />
                            {en ? 'Open' : 'فتح'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-8 w-8 p-0"
                          onClick={() => dismissNotification(notification.id)}
                          title={en ? 'Dismiss' : 'تجاهل'}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {pendingActions.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    {en
                      ? `+ ${pendingActions.length - 10} more pending actions`
                      : `+ ${pendingActions.length - 10} إجراء معلق آخر`}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Reminder Rules */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{en ? 'Reminder Rules' : 'قواعد التذكيرات'}</CardTitle>
              <CardDescription>
                {en
                  ? 'Configure when WhatsApp reminders should be triggered. When a rule matches, you\'ll be prompted to send via WhatsApp.'
                  : 'حدد متى يجب تفعيل تذكيرات واتساب. عند تطابق قاعدة، سيتم إعلامك للإرسال عبر واتساب.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rules.map((rule) => {
                const tpl = MESSAGE_TEMPLATES.find(t => t.id === rule.templateId);
                const Icon = tpl?.icon || Bell;
                return (
                  <div key={rule.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${rule.enabled ? 'bg-green-500/10' : 'bg-muted'}`}>
                        <Icon className={`w-5 h-5 ${rule.enabled ? 'text-green-600' : 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {en ? 'Template' : 'القالب'}: {en ? tpl?.name : tpl?.nameAr}
                          {rule.type === 'before_due' && ` • ${Math.abs(rule.daysOffset)} ${en ? 'days before due' : 'أيام قبل الاستحقاق'}`}
                          {rule.type === 'on_due' && ` • ${en ? 'On due date' : 'في تاريخ الاستحقاق'}`}
                          {rule.type === 'after_due' && ` • ${rule.daysOffset} ${en ? 'days after due' : 'أيام بعد الاستحقاق'}`}
                          {rule.type === 'on_invoice' && ` • ${en ? 'When invoice is created' : 'عند إنشاء الفاتورة'}`}
                          {rule.type === 'on_event' && ` • ${en ? 'When event occurs' : 'عند حدوث الحدث'}`}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => toggleRule(rule.id)}
                      data-testid={`switch-rule-${rule.id}`}
                    />
                  </div>
                );
              })}

              <div className="pt-2">
                <p className="text-xs text-muted-foreground">
                  {en
                    ? '* Rules will prompt you to send messages — they open WhatsApp on your device. No messages are sent automatically.'
                    : '* القواعد ستطلب منك إرسال الرسائل — تفتح واتساب على جهازك. لا يتم إرسال رسائل تلقائياً.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Templates Tab ────────────────────────────── */}
        <TabsContent value="templates" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MESSAGE_TEMPLATES.map((tpl) => {
              const Icon = tpl.icon;
              return (
                <Card key={tpl.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{en ? tpl.name : tpl.nameAr}</CardTitle>
                        <Badge variant="outline" className="text-xs mt-1">
                          {tpl.category === 'invoice' ? (en ? 'Invoice' : 'فاتورة') :
                           tpl.category === 'payment' ? (en ? 'Payment' : 'دفع') :
                           tpl.category === 'onboarding' ? (en ? 'Onboarding' : 'تسجيل') :
                           tpl.category === 'service' ? (en ? 'Service' : 'خدمة') :
                           tpl.category === 'alert' ? (en ? 'Alert' : 'تنبيه') :
                           tpl.category === 'engagement' ? (en ? 'Engagement' : 'تواصل') :
                           (en ? 'Other' : 'أخرى')}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans bg-muted/50 p-3 rounded-lg max-h-32 overflow-y-auto">
                      {en ? tpl.template : tpl.templateAr}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => {
                        setSelectedTemplate(tpl.id);
                        applyTemplate(tpl.id);
                        setShowSendDialog(true);
                      }}
                    >
                      <Send className="w-3 h-3 mr-1.5" />
                      {en ? 'Use Template' : 'استخدم القالب'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
