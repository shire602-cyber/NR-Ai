import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useI18n } from '@/lib/i18n';
import {
  MessageCircle,
  Image,
  FileText,
  Clock,
  Check,
  CheckCheck,
  CheckCircle,
  X,
  Loader2,
  RefreshCw,
  Phone,
  Calendar,
  Send,
  Bell,
  Users,
  HelpCircle,
  Copy,
  Settings,
  Search,
  MoreVertical,
  Paperclip,
  Smile,
  FileText as FileTextIcon,
  ArrowLeft
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { WhatsappMessage, Invoice, CustomerContact } from '@shared/schema';

interface WhatsappConfigResponse {
  configured: boolean;
  isActive: boolean;
  phoneNumberId?: string;
  businessAccountId?: string;
  hasAccessToken?: boolean;
  companyId: string;
  configId?: string;
}

export default function WhatsAppDashboard() {
  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedInvoice, setSelectedInvoice] = useState<string>('');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isRTL = locale === 'ar';

  const t = {
    title: locale === 'en' ? 'WhatsApp' : 'واتساب',
    search: locale === 'en' ? 'Search' : 'بحث',
    noConversations: locale === 'en' ? 'No conversations yet' : 'لا توجد محادثات بعد',
    typeMessage: locale === 'en' ? 'Type a message' : 'اكتب رسالة',
    send: locale === 'en' ? 'Send' : 'إرسال',
    sending: locale === 'en' ? 'Sending...' : 'جاري الإرسال...',
    messageSent: locale === 'en' ? 'Message sent successfully!' : 'تم إرسال الرسالة بنجاح!',
    replySent: locale === 'en' ? 'Reply sent successfully!' : 'تم إرسال الرد بنجاح!',
    notConfigured: locale === 'en' ? 'WhatsApp Not Configured' : 'WhatsApp غير مُعد',
    notConfiguredDesc: locale === 'en'
      ? 'Please configure WhatsApp integration in the Admin Settings page first'
      : 'يرجى إعداد تكامل WhatsApp في صفحة إعدادات المسؤول أولاً',
    goToSettings: locale === 'en' ? 'Go to Admin Settings' : 'الذهاب إلى إعدادات المسؤول',
    sendMessage: locale === 'en' ? 'Send Message' : 'إرسال رسالة',
    sendReminder: locale === 'en' ? 'Send Reminder' : 'إرسال تذكير',
    sendInvoice: locale === 'en' ? 'Send Invoice' : 'إرسال فاتورة',
    selectCustomer: locale === 'en' ? 'Select Customer' : 'اختر العميل',
    orEnterPhone: locale === 'en' ? 'Or enter phone number' : 'أو أدخل رقم الهاتف',
    selectInvoice: locale === 'en' ? 'Select Invoice' : 'اختر الفاتورة',
    active: locale === 'en' ? 'Active' : 'نشط',
    inactive: locale === 'en' ? 'Inactive' : 'غير نشط',
    refresh: locale === 'en' ? 'Refresh' : 'تحديث',
    settings: locale === 'en' ? 'Settings' : 'الإعدادات',
    whatsappNumber: locale === 'en' ? 'WhatsApp Number' : 'رقم WhatsApp',
    copyNumber: locale === 'en' ? 'Copy Number' : 'نسخ الرقم',
    copied: locale === 'en' ? 'Copied!' : 'تم النسخ!',
  };

  const { data: whatsappConfig, isLoading: configLoading } = useQuery<WhatsappConfigResponse>({
    queryKey: ['/api/integrations/whatsapp/config'],
  });

  const { data: messages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<WhatsappMessage[]>({
    queryKey: ['/api/integrations/whatsapp/messages'],
    enabled: whatsappConfig?.configured === true,
    refetchInterval: 30000, // Refresh every 30 seconds
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

  // Group messages by phone number for conversations
  const conversations = messages.reduce((acc, msg) => {
    const phone = (msg.direction === 'inbound' ? msg.from : msg.to) || 'unknown';
    if (!acc[phone]) {
      acc[phone] = [];
    }
    acc[phone].push(msg);
    return acc;
  }, {} as Record<string, WhatsappMessage[]>);

  const conversationList = Object.entries(conversations)
    .map(([phone, msgs]) => {
      const customer = customers.find(c => c.phone === phone);
      const sortedMessages = msgs.sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
      return {
        phone,
        name: customer?.name || phone,
        messages: sortedMessages,
        lastMessage: sortedMessages[sortedMessages.length - 1],
        unreadCount: msgs.filter(m => m.direction === 'inbound' && m.status === 'received').length,
      };
    })
    .filter(conv => !searchQuery || conv.name.toLowerCase().includes(searchQuery.toLowerCase()) || conv.phone.includes(searchQuery))
    .sort((a, b) => new Date(b.lastMessage.createdAt || '').getTime() - new Date(a.lastMessage.createdAt || '').getTime());

  const selectedConversationMessages = selectedConversation ? conversations[selectedConversation]?.sort((a, b) => 
    new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime()
  ) : [];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversationMessages]);

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { to: string; message: string }) => {
      return apiRequest('POST', '/api/integrations/whatsapp/send-message', data);
    },
    onSuccess: () => {
      toast({ title: t.messageSent });
      setSendTo('');
      setSendMessage('');
      setSelectedCustomer('');
      setShowSendDialog(false);
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
    },
    onError: (error: any) => {
      toast({
        title: locale === 'en' ? 'Failed to send message' : 'فشل إرسال الرسالة',
        description: error.message || error.error || (locale === 'en' ? 'Please check your WhatsApp configuration' : 'يرجى التحقق من إعدادات WhatsApp'),
        variant: 'destructive',
      });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (data: { messageId: string; reply: string }) => {
      return apiRequest('POST', '/api/integrations/whatsapp/reply', data);
    },
    onSuccess: () => {
      toast({ title: t.replySent });
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
    },
    onError: (error: any) => {
      toast({
        title: locale === 'en' ? 'Failed to send reply' : 'فشل إرسال الرد',
        description: error.message || error.error || (locale === 'en' ? 'Please check your WhatsApp configuration' : 'يرجى التحقق من إعدادات WhatsApp'),
        variant: 'destructive',
      });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      return apiRequest('POST', `/api/invoices/${invoiceId}/send-reminder`, { channels: ['whatsapp'] });
    },
    onSuccess: () => {
      toast({ title: locale === 'en' ? 'Reminder sent successfully!' : 'تم إرسال التذكير بنجاح!' });
      setSelectedInvoice('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
    },
    onError: (error: any) => {
      toast({
        title: locale === 'en' ? 'Failed to send reminder' : 'فشل إرسال التذكير',
        description: error.message || error.error || (locale === 'en' ? 'Please check your WhatsApp configuration' : 'يرجى التحقق من إعدادات WhatsApp'),
        variant: 'destructive',
      });
    },
  });

  const handleSendMessage = () => {
    if (!sendMessage.trim()) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'Message is required' : 'الرسالة مطلوبة',
        variant: 'destructive',
      });
      return;
    }

    let phoneNumber = sendTo;
    if (selectedCustomer) {
      const customer = customers.find(c => c.id === selectedCustomer);
      if (customer?.phone) {
        phoneNumber = customer.phone;
      } else {
        toast({
          title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
          description: locale === 'en' ? 'Selected customer has no phone number' : 'العميل المحدد ليس لديه رقم هاتف',
          variant: 'destructive',
        });
        return;
      }
    }

    if (!phoneNumber) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'Phone number is required' : 'رقم الهاتف مطلوب',
        variant: 'destructive',
      });
      return;
    }

    sendMessageMutation.mutate({ to: phoneNumber, message: sendMessage });
  };

  const handleSendInvoice = () => {
    if (!selectedInvoice) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'Please select an invoice' : 'يرجى اختيار فاتورة',
        variant: 'destructive',
      });
      return;
    }

    const invoice = invoices.find(i => i.id === selectedInvoice);
    if (!invoice) return;

    const customer = customers.find(c => c.name === invoice.customerName);
    if (!customer?.phone) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'Customer has no phone number' : 'العميل ليس لديه رقم هاتف',
        variant: 'destructive',
      });
      return;
    }

    // Calculate due date correctly: invoice date + payment terms (default 30 days)
    const invoiceDate = new Date(invoice.date);
    const paymentTerms = customer.paymentTerms || 30;
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + paymentTerms);

    const message = locale === 'en'
      ? `Hello ${invoice.customerName},\n\nYour invoice ${invoice.number} for AED ${invoice.total.toFixed(2)} is ready.\n\nDue Date: ${dueDate.toLocaleDateString()}\n\nThank you for your business!`
      : `مرحباً ${invoice.customerName},\n\nفاتورتك ${invoice.number} بمبلغ ${invoice.total.toFixed(2)} درهم جاهزة.\n\nتاريخ الاستحقاق: ${dueDate.toLocaleDateString()}\n\nشكراً لتعاملك معنا!`;

    sendMessageMutation.mutate({ to: customer.phone, message }, {
      onSuccess: () => {
        setShowInvoiceDialog(false);
        setSelectedInvoice('');
      }
    });
  };

  const handleReply = (message?: WhatsappMessage) => {
    if (!selectedConversation) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'No conversation selected' : 'لم يتم اختيار محادثة',
        variant: 'destructive',
      });
      return;
    }
    
    if (!replyText.trim()) {
      toast({
        title: locale === 'en' ? 'Validation Error' : 'خطأ في التحقق',
        description: locale === 'en' ? 'Reply text is required' : 'نص الرد مطلوب',
        variant: 'destructive',
      });
      return;
    }
    
    const conversationMessages = conversations[selectedConversation];
    const lastInboundMessage = message || conversationMessages
      ?.filter(m => m.direction === 'inbound')
      .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())[0];
    
    if (!lastInboundMessage) {
      // If no inbound message, send as a new message to the conversation
      sendMessageMutation.mutate({ 
        to: selectedConversation, 
        message: replyText 
      });
      setReplyText('');
      return;
    }

    replyMutation.mutate({ messageId: lastInboundMessage.id, reply: replyText });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString(locale === 'ar' ? 'ar-AE' : 'en-AE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return locale === 'en' ? 'Today' : 'اليوم';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return locale === 'en' ? 'Yesterday' : 'أمس';
    } else {
      return date.toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
      });
    }
  };

  const copyPhoneNumber = () => {
    if (whatsappConfig?.phoneNumberId) {
      navigator.clipboard.writeText(whatsappConfig.phoneNumberId);
      toast({ title: t.copied });
    }
  };

  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [showDiagnosticDialog, setShowDiagnosticDialog] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<any>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);

  const testWhatsappMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      if (!phoneNumber) {
        throw new Error(locale === 'en' ? 'Phone number is required' : 'رقم الهاتف مطلوب');
      }
      return apiRequest('POST', '/api/integrations/whatsapp/test', { testPhoneNumber: phoneNumber });
    },
    onSuccess: (data) => {
      toast({ 
        title: locale === 'en' ? 'Test Successful!' : 'نجح الاختبار!',
        description: data.message || (locale === 'en' ? 'WhatsApp integration is working correctly' : 'تكامل WhatsApp يعمل بشكل صحيح'),
      });
    },
    onError: (error: any) => {
      toast({
        title: locale === 'en' ? 'Test Failed' : 'فشل الاختبار',
        description: error.message || error.error || (locale === 'en' ? 'Please check your WhatsApp configuration' : 'يرجى التحقق من إعدادات WhatsApp'),
        variant: 'destructive',
      });
    },
  });

  if (configLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!whatsappConfig?.configured) {
    return (
      <div className={`container max-w-4xl mx-auto py-8 px-4 ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <SiWhatsapp className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-xl font-semibold mb-2">{t.notConfigured}</h2>
            <p className="text-muted-foreground mb-6 max-w-md">{t.notConfiguredDesc}</p>
            <Button onClick={() => window.location.href = '/admin'} data-testid="button-go-settings">
              <Settings className="w-4 h-4 mr-2" />
              {t.goToSettings}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedConv = conversationList.find(c => c.phone === selectedConversation);

  return (
    <div className={`h-[calc(100vh-8rem)] flex flex-col ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* WhatsApp-style header */}
      <div className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SiWhatsapp className="w-8 h-8" />
        <div>
            <h1 className="text-lg font-semibold">{t.title}</h1>
            <p className="text-xs text-white/80">
              {whatsappConfig.isActive ? t.active : t.inactive}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10"
                title={locale === 'en' ? 'Test WhatsApp Connection' : 'اختبار اتصال WhatsApp'}
              >
                <CheckCircle className="w-4 h-4" />
          </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{locale === 'en' ? 'Test WhatsApp Connection' : 'اختبار اتصال WhatsApp'}</DialogTitle>
                <DialogDescription>
                  {locale === 'en' 
                    ? 'Enter a phone number to send a test message. Use international format without + (e.g., 971501234567)'
                    : 'أدخل رقم هاتف لإرسال رسالة اختبار. استخدم التنسيق الدولي بدون + (مثال: 971501234567)'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {locale === 'en' ? 'Phone Number' : 'رقم الهاتف'}
                  </label>
                  <Input
                    type="tel"
                    placeholder="971501234567"
                    value={testPhoneNumber}
                    onChange={(e) => setTestPhoneNumber(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === 'en' 
                      ? 'International format without + sign'
                      : 'التنسيق الدولي بدون علامة +'}
                  </p>
        </div>
                <Button
                  onClick={() => {
                    if (testPhoneNumber.trim()) {
                      testWhatsappMutation.mutate(testPhoneNumber.trim(), {
                        onSuccess: () => {
                          setShowTestDialog(false);
                          setTestPhoneNumber('');
                        }
                      });
                    }
                  }}
                  disabled={!testPhoneNumber.trim() || testWhatsappMutation.isPending}
                  className="w-full"
                >
                  {testWhatsappMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {locale === 'en' ? 'Sending...' : 'جاري الإرسال...'}
                    </>
                  ) : (
                    locale === 'en' ? 'Send Test Message' : 'إرسال رسالة اختبار'
                  )}
                </Button>
      </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchMessages()}
            className="text-white hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10"
              >
                <Send className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.sendMessage}</DialogTitle>
                <DialogDescription>
                  {locale === 'en' ? 'Send a message to a customer' : 'إرسال رسالة إلى عميل'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t.selectCustomer}</label>
                  <Select value={selectedCustomer} onValueChange={(value) => {
                    setSelectedCustomer(value);
                    const customer = customers.find(c => c.id === value);
                    if (customer?.phone) {
                      setSendTo(customer.phone);
                    }
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.selectCustomer} />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.filter(c => c.phone).map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name} ({customer.phone})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t.orEnterPhone}</label>
                  <Input
                    placeholder="+971501234567"
                    value={sendTo}
                    onChange={(e) => {
                      setSendTo(e.target.value);
                      setSelectedCustomer('');
                    }}
                  />
            </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{locale === 'en' ? 'Message' : 'الرسالة'}</label>
                  <Textarea
                    placeholder={locale === 'en' ? 'Type your message...' : 'اكتب رسالتك...'}
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    rows={4}
                  />
              </div>
                <Button
                  className="w-full"
                  onClick={handleSendMessage}
                  disabled={sendMessageMutation.isPending}
                >
                  {sendMessageMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t.sending}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      {t.send}
                    </>
                  )}
                </Button>
            </div>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.location.href = '/admin'}>
                <Settings className="w-4 h-4 mr-2" />
                {t.settings}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyPhoneNumber}>
                <Copy className="w-4 h-4 mr-2" />
                {t.copyNumber}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                setShowDiagnosticDialog(true);
                setDiagnosticLoading(true);
                try {
                  const response = await apiRequest('GET', '/api/integrations/whatsapp/diagnose');
                  setDiagnosticData(response);
                } catch (error: any) {
                  setDiagnosticData({
                    error: error.message || error.error || 'Failed to run diagnostics',
                    issues: ['Could not connect to diagnostic endpoint']
                  });
                } finally {
                  setDiagnosticLoading(false);
                }
              }}>
                <HelpCircle className="w-4 h-4 mr-2" />
                {locale === 'en' ? 'Run Diagnostics' : 'تشغيل التشخيص'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
              </div>
            </div>

      {/* Main chat area - WhatsApp style */}
      <div className="flex-1 flex overflow-hidden bg-[#ECE5DD]">
        {/* Left sidebar - Conversations */}
        <div className="w-1/3 border-r border-gray-300 bg-white flex flex-col">
          {/* Search bar */}
          <div className="p-3 bg-[#F0F2F5]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white"
              />
              </div>
      </div>

          {/* Conversations list */}
          <ScrollArea className="flex-1">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : conversationList.length === 0 ? (
              <div className="text-center py-12 px-4">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">{t.noConversations}</p>
                </div>
              ) : (
              <div>
                {conversationList.map((conv) => (
                  <div
                    key={conv.phone}
                    className={`p-3 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedConversation === conv.phone ? 'bg-gray-100' : ''
                    }`}
                    onClick={() => setSelectedConversation(conv.phone)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center text-white font-semibold">
                        {conv.name.charAt(0).toUpperCase()}
                            </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm truncate">{conv.name}</span>
                          <span className="text-xs text-gray-500">
                            {formatTime(conv.lastMessage.createdAt?.toString() || '')}
                                </span>
                              </div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-gray-600 truncate">
                            {conv.lastMessage.content || `[${conv.lastMessage.messageType}]`}
                          </p>
                          {conv.unreadCount > 0 && (
                            <Badge className="bg-[#25D366] text-white text-xs min-w-[20px] h-5 flex items-center justify-center">
                              {conv.unreadCount}
                            </Badge>
                          )}
                              </div>
                            </div>
                          </div>
                  </div>
                ))}
                  </div>
            )}
          </ScrollArea>

          {/* Quick actions at bottom of sidebar */}
          <div className="p-3 border-t border-gray-200 bg-white">
            <div className="grid grid-cols-2 gap-2">
                            <Button
                variant="outline"
                              size="sm"
                className="w-full text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSendDialog(true);
                }}
              >
                <Send className="w-3 h-3 mr-1" />
                {t.sendMessage}
              </Button>
              <Dialog>
                  <DialogTrigger asChild>
                  <Button
                              variant="outline"
                    size="sm"
                    className="w-full text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                    }}
                  >
                    <Bell className="w-3 h-3 mr-1" />
                    {t.sendReminder}
                            </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                    <DialogTitle>{t.sendReminder}</DialogTitle>
                    <DialogDescription>
                      {locale === 'en' ? 'Send payment reminder via WhatsApp' : 'إرسال تذكير دفع عبر WhatsApp'}
                    </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                      <label className="text-sm font-medium">{t.selectInvoice}</label>
                      <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
                        <SelectTrigger>
                          <SelectValue placeholder={t.selectInvoice} />
                          </SelectTrigger>
                          <SelectContent>
                          {invoices.filter(inv => {
                            const customer = customers.find(c => c.name === inv.customerName);
                            return customer?.phone;
                          }).map((invoice) => (
                            <SelectItem key={invoice.id} value={invoice.id}>
                              {invoice.number} - {invoice.customerName} - AED {invoice.total.toFixed(2)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                  </div>
                    <Button
                      className="w-full"
                      onClick={() => selectedInvoice && sendReminderMutation.mutate(selectedInvoice)}
                      disabled={!selectedInvoice || sendReminderMutation.isPending}
                    >
                      {sendReminderMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t.sending}
                        </>
                      ) : (
                        <>
                          <Bell className="w-4 h-4 mr-2" />
                          {t.sendReminder}
                        </>
                      )}
                    </Button>
        </div>
                </DialogContent>
              </Dialog>
              <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
                  <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs col-span-2"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <FileTextIcon className="w-3 h-3 mr-1" />
                    {t.sendInvoice}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                    <DialogTitle>{t.sendInvoice}</DialogTitle>
                    <DialogDescription>
                      {locale === 'en' ? 'Send invoice details via WhatsApp' : 'إرسال تفاصيل الفاتورة عبر WhatsApp'}
                    </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                      <label className="text-sm font-medium">{t.selectInvoice}</label>
                      <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
                        <SelectTrigger>
                          <SelectValue placeholder={t.selectInvoice} />
                          </SelectTrigger>
                          <SelectContent>
                          {invoices.filter(inv => {
                            const customer = customers.find(c => c.name === inv.customerName);
                            return customer?.phone;
                          }).map((invoice) => (
                            <SelectItem key={invoice.id} value={invoice.id}>
                              {invoice.number} - {invoice.customerName} - AED {invoice.total.toFixed(2)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                      className="w-full"
                      onClick={handleSendInvoice}
                      disabled={!selectedInvoice || sendMessageMutation.isPending}
                    >
                      {sendMessageMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t.sending}
                        </>
                      ) : (
                        <>
                          <FileTextIcon className="w-4 h-4 mr-2" />
                          {t.sendInvoice}
                        </>
                        )}
                      </Button>
                  </div>
                  </DialogContent>
                </Dialog>
            </div>
          </div>
                  </div>

        {/* Right side - Chat view */}
        <div className="flex-1 flex flex-col bg-[#ECE5DD]">
          {selectedConversation ? (
            <>
              {/* Chat header */}
              <div className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/10 md:hidden"
                    onClick={() => setSelectedConversation(null)}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center text-white font-semibold">
                    {selectedConv?.name.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <h2 className="font-semibold">{selectedConv?.name || selectedConversation}</h2>
                    <p className="text-xs text-white/80">{selectedConversation}</p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/10"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      const customer = customers.find(c => c.phone === selectedConversation);
                      if (customer && customer.phone) {
                        setSelectedCustomer(customer.id);
                        setSendTo(customer.phone);
                        setShowSendDialog(true);
                      }
                    }}>
                      <Send className="w-4 h-4 mr-2" />
                      {t.sendMessage}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Messages area */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-2">
                  {selectedConversationMessages?.map((message, index) => {
                    const prevMessage = index > 0 ? selectedConversationMessages[index - 1] : null;
                    const showDate = !prevMessage || 
                      new Date(message.createdAt || '').toDateString() !== new Date(prevMessage.createdAt || '').toDateString();
                    
                    return (
                      <div key={message.id}>
                        {showDate && (
                          <div className="text-center my-4">
                            <span className="bg-white/80 px-3 py-1 rounded-full text-xs text-gray-600">
                              {formatDate(message.createdAt?.toString() || '')}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${message.direction === 'inbound' ? 'justify-start' : 'justify-end'} mb-1`}>
                          <div
                            className={`max-w-[70%] rounded-lg px-3 py-2 ${
                              message.direction === 'inbound'
                                ? 'bg-white rounded-tl-none'
                                : 'bg-[#DCF8C6] rounded-tr-none'
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {message.content || `[${message.messageType}]`}
                            </p>
                            <div className={`flex items-center justify-end gap-1 mt-1 ${
                              message.direction === 'inbound' ? 'text-gray-500' : 'text-gray-600'
                            }`}>
                              <span className="text-xs">
                                {formatTime(message.createdAt?.toString() || '')}
                              </span>
                              {message.direction === 'outbound' && (
                                message.status === 'sent' ? (
                                  <CheckCheck className="w-3 h-3 text-blue-500" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )
                              )}
                  </div>
                  </div>
                  </div>
                  </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input area */}
              <div className="bg-[#F0F2F5] p-3 border-t border-gray-300">
                <div className="flex items-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-600 hover:bg-gray-200"
                  >
                    <Paperclip className="w-5 h-5" />
                  </Button>
                  <div className="flex-1 relative">
                    <Textarea
                      placeholder={t.typeMessage}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleReply();
                        }
                      }}
                      rows={1}
                      className="resize-none min-h-[44px] max-h-32 pr-10"
                    />
                </div>
                  <Button
                    onClick={() => handleReply()}
                    disabled={!replyText.trim() || replyMutation.isPending}
                    className="bg-[#25D366] hover:bg-[#20BA5A] text-white rounded-full w-11 h-11 p-0"
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
        </div>
      </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <SiWhatsapp className="w-24 h-24 mx-auto mb-4 text-gray-300" />
                <h3 className="text-xl font-semibold text-gray-500 mb-2">
                  {locale === 'en' ? 'Select a conversation' : 'اختر محادثة'}
                </h3>
                <p className="text-sm text-gray-400">
                  {locale === 'en' 
                    ? 'Choose a conversation from the list to start chatting'
                    : 'اختر محادثة من القائمة لبدء المحادثة'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic Dialog */}
      <Dialog open={showDiagnosticDialog} onOpenChange={setShowDiagnosticDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{locale === 'en' ? 'WhatsApp Diagnostics' : 'تشخيص WhatsApp'}</DialogTitle>
            <DialogDescription>
              {locale === 'en' 
                ? 'Check your WhatsApp integration configuration and connection status'
                : 'تحقق من إعدادات تكامل WhatsApp وحالة الاتصال'}
            </DialogDescription>
          </DialogHeader>
          {diagnosticLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : diagnosticData ? (
            <div className="space-y-4 py-4">
              {/* Status Overview */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border ${diagnosticData.configured ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="text-sm font-medium mb-1">{locale === 'en' ? 'Configuration' : 'الإعدادات'}</div>
                  <div className={`text-lg font-bold ${diagnosticData.configured ? 'text-green-700' : 'text-red-700'}`}>
                    {diagnosticData.configured ? (locale === 'en' ? 'Configured' : 'مُعد') : (locale === 'en' ? 'Not Configured' : 'غير مُعد')}
                  </div>
                </div>
                <div className={`p-4 rounded-lg border ${diagnosticData.isActive ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <div className="text-sm font-medium mb-1">{locale === 'en' ? 'Status' : 'الحالة'}</div>
                  <div className={`text-lg font-bold ${diagnosticData.isActive ? 'text-green-700' : 'text-yellow-700'}`}>
                    {diagnosticData.isActive ? (locale === 'en' ? 'Active' : 'نشط') : (locale === 'en' ? 'Inactive' : 'غير نشط')}
                  </div>
                </div>
              </div>

              {/* Issues */}
              {diagnosticData.issues && diagnosticData.issues.length > 0 && (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                  <div className="text-sm font-semibold text-red-800 mb-2">
                    {locale === 'en' ? 'Issues Found' : 'المشاكل المكتشفة'}
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
                    {diagnosticData.issues.map((issue: string, idx: number) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {diagnosticData.recommendations && diagnosticData.recommendations.length > 0 && (
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="text-sm font-semibold text-blue-800 mb-2">
                    {locale === 'en' ? 'Recommendations' : 'التوصيات'}
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-sm text-blue-700">
                    {diagnosticData.recommendations.map((rec: string, idx: number) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* API Connection Status */}
              {diagnosticData.apiConnection && (
                <div className={`p-4 rounded-lg border ${
                  diagnosticData.apiConnection === 'Connected' 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="text-sm font-semibold mb-2">
                    {locale === 'en' ? 'API Connection' : 'اتصال API'}
                  </div>
                  <div className={`text-sm ${diagnosticData.apiConnection === 'Connected' ? 'text-green-700' : 'text-red-700'}`}>
                    {diagnosticData.apiConnection === 'Connected' 
                      ? (locale === 'en' ? '✓ Connected to Meta API' : '✓ متصل بـ Meta API')
                      : (locale === 'en' ? `✗ Connection failed: ${diagnosticData.apiError || 'Unknown error'}` : `✗ فشل الاتصال: ${diagnosticData.apiError || 'خطأ غير معروف'}`)
                    }
                  </div>
                  {diagnosticData.phoneNumberInfo && (
                    <div className="mt-2 text-xs text-gray-600">
                      <div>{locale === 'en' ? 'Phone Number' : 'رقم الهاتف'}: {diagnosticData.phoneNumberInfo.displayPhoneNumber}</div>
                      {diagnosticData.phoneNumberInfo.verifiedName && (
                        <div>{locale === 'en' ? 'Verified Name' : 'الاسم المُتحقق'}: {diagnosticData.phoneNumberInfo.verifiedName}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Webhook Setup */}
              {diagnosticData.webhookSetup && (
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="text-sm font-semibold mb-2">
                    {locale === 'en' ? 'Webhook Configuration' : 'إعدادات Webhook'}
                  </div>
                  <div className="text-xs text-gray-700 space-y-2">
                    <div>
                      <strong>{locale === 'en' ? 'Webhook URL' : 'رابط Webhook'}:</strong>
                      <div className="font-mono bg-white p-2 rounded mt-1 break-all">{diagnosticData.webhookSetup.url}</div>
                    </div>
                    <div>
                      <strong>{locale === 'en' ? 'Verify Token' : 'رمز التحقق'}:</strong> {diagnosticData.webhookSetup.verifyToken}
                    </div>
                    <div className="mt-3">
                      <strong>{locale === 'en' ? 'Setup Instructions' : 'تعليمات الإعداد'}:</strong>
                      <ol className="list-decimal list-inside space-y-1 mt-1">
                        {diagnosticData.webhookSetup.instructions.map((instruction: string, idx: number) => (
                          <li key={idx} className="text-xs">{instruction}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* Configuration Details */}
              <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                <div className="text-sm font-semibold mb-2">
                  {locale === 'en' ? 'Configuration Details' : 'تفاصيل الإعدادات'}
                </div>
                <div className="text-xs text-gray-700 space-y-1">
                  <div><strong>{locale === 'en' ? 'Phone Number ID' : 'معرف رقم الهاتف'}:</strong> {diagnosticData.phoneNumberId || (locale === 'en' ? 'Not set' : 'غير مُعد')}</div>
                  <div><strong>{locale === 'en' ? 'Has Access Token' : 'يحتوي على رمز الوصول'}:</strong> {diagnosticData.hasAccessToken ? (locale === 'en' ? 'Yes' : 'نعم') : (locale === 'en' ? 'No' : 'لا')}</div>
                  <div><strong>{locale === 'en' ? 'Has Business Account ID' : 'يحتوي على معرف حساب الأعمال'}:</strong> {diagnosticData.hasBusinessAccountId ? (locale === 'en' ? 'Yes' : 'نعم') : (locale === 'en' ? 'No' : 'لا')}</div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
