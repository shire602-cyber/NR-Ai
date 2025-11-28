import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  X,
  Loader2,
  Receipt,
  RefreshCw,
  Scan,
  Upload,
  Bot,
  AlertCircle,
  Settings,
  ExternalLink,
  Phone,
  Calendar,
  DollarSign
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WhatsappMessage, Account } from '@shared/schema';

interface WhatsappConfigResponse {
  configured: boolean;
  isActive: boolean;
  phoneNumberId?: string;
  businessAccountId?: string;
  hasAccessToken?: boolean;
  companyId: string;
  configId?: string;
}

interface OCRResult {
  merchant: string;
  date: string;
  amount: number;
  vatAmount: number;
  category: string;
  confidence: number;
  rawText: string;
}

export default function WhatsAppDashboard() {
  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const [selectedMessage, setSelectedMessage] = useState<WhatsappMessage | null>(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [isCreateExpenseOpen, setIsCreateExpenseOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  const isRTL = locale === 'ar';

  const t = {
    title: locale === 'en' ? 'WhatsApp Inbox' : 'صندوق الواتساب',
    subtitle: locale === 'en' 
      ? 'View and process receipts from WhatsApp messages'
      : 'عرض ومعالجة الإيصالات من رسائل WhatsApp',
    messages: locale === 'en' ? 'Messages' : 'الرسائل',
    processing: locale === 'en' ? 'Processing' : 'المعالجة',
    noMessages: locale === 'en' ? 'No WhatsApp messages yet' : 'لا توجد رسائل WhatsApp بعد',
    noMessagesDesc: locale === 'en' 
      ? 'Messages will appear here when they are received via WhatsApp webhook'
      : 'ستظهر الرسائل هنا عند استلامها عبر WhatsApp',
    notConfigured: locale === 'en' ? 'WhatsApp Not Configured' : 'WhatsApp غير مُعد',
    notConfiguredDesc: locale === 'en'
      ? 'Please configure WhatsApp integration in the Integrations page first'
      : 'يرجى إعداد تكامل WhatsApp في صفحة التكاملات أولاً',
    goToIntegrations: locale === 'en' ? 'Go to Integrations' : 'الذهاب إلى التكاملات',
    from: locale === 'en' ? 'From' : 'من',
    received: locale === 'en' ? 'Received' : 'مستلم',
    type: locale === 'en' ? 'Type' : 'النوع',
    status: locale === 'en' ? 'Status' : 'الحالة',
    text: locale === 'en' ? 'Text' : 'نص',
    image: locale === 'en' ? 'Image' : 'صورة',
    document: locale === 'en' ? 'Document' : 'مستند',
    processOCR: locale === 'en' ? 'Process with OCR' : 'معالجة بـ OCR',
    processingOCR: locale === 'en' ? 'Processing...' : 'جاري المعالجة...',
    ocrResults: locale === 'en' ? 'OCR Results' : 'نتائج OCR',
    merchant: locale === 'en' ? 'Merchant' : 'التاجر',
    date: locale === 'en' ? 'Date' : 'التاريخ',
    amount: locale === 'en' ? 'Amount' : 'المبلغ',
    vat: locale === 'en' ? 'VAT' : 'الضريبة',
    category: locale === 'en' ? 'Category' : 'الفئة',
    confidence: locale === 'en' ? 'Confidence' : 'الثقة',
    createExpense: locale === 'en' ? 'Create Expense' : 'إنشاء مصروف',
    selectAccount: locale === 'en' ? 'Select Expense Account' : 'اختر حساب المصروف',
    creating: locale === 'en' ? 'Creating...' : 'جاري الإنشاء...',
    expenseCreated: locale === 'en' ? 'Expense created successfully!' : 'تم إنشاء المصروف بنجاح!',
    refresh: locale === 'en' ? 'Refresh' : 'تحديث',
    messageDetails: locale === 'en' ? 'Message Details' : 'تفاصيل الرسالة',
    extractedData: locale === 'en' ? 'Extracted Data' : 'البيانات المستخرجة',
    rawText: locale === 'en' ? 'Raw Text' : 'النص الخام',
    webhookUrl: locale === 'en' ? 'Webhook URL' : 'رابط Webhook',
    active: locale === 'en' ? 'Active' : 'نشط',
    inactive: locale === 'en' ? 'Inactive' : 'غير نشط',
    howToUse: locale === 'en' ? 'How to Use' : 'كيفية الاستخدام',
    step1: locale === 'en' ? 'Configure WhatsApp Business API in Meta Developer Console' : 'إعداد WhatsApp Business API في Meta Developer Console',
    step2: locale === 'en' ? 'Set webhook URL to receive messages' : 'تعيين رابط Webhook لاستقبال الرسائل',
    step3: locale === 'en' ? 'Send receipt images via WhatsApp' : 'إرسال صور الإيصالات عبر WhatsApp',
    step4: locale === 'en' ? 'Process with OCR and create expenses' : 'معالجة بـ OCR وإنشاء المصروفات',
    recentActivity: locale === 'en' ? 'Recent Activity' : 'النشاط الأخير',
    pendingMessages: locale === 'en' ? 'Pending' : 'قيد الانتظار',
    processedMessages: locale === 'en' ? 'Processed' : 'تمت المعالجة',
    failedMessages: locale === 'en' ? 'Failed' : 'فشل',
  };

  const { data: whatsappConfig, isLoading: configLoading } = useQuery<WhatsappConfigResponse>({
    queryKey: ['/api/integrations/whatsapp/config'],
  });

  const { data: messages = [], isLoading: messagesLoading, refetch: refetchMessages } = useQuery<WhatsappMessage[]>({
    queryKey: ['/api/integrations/whatsapp/messages'],
    enabled: whatsappConfig?.configured === true,
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['/api/companies', currentCompany?.id, 'accounts'],
    queryFn: () => apiRequest('GET', `/api/companies/${currentCompany?.id}/accounts`),
    enabled: !!currentCompany?.id,
  });

  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.isActive);

  const createExpenseMutation = useMutation({
    mutationFn: async (data: { merchant: string; date: string; amount: number; vatAmount: number; category: string; accountId: string }) => {
      if (!currentCompany?.id) {
        throw new Error('No company selected');
      }
      return await apiRequest('POST', `/api/companies/${currentCompany.id}/receipts`, {
        merchant: data.merchant,
        date: data.date,
        amount: data.amount,
        vatAmount: data.vatAmount,
        category: data.category,
        currency: 'AED',
        posted: false,
        accountId: data.accountId,
      });
    },
    onSuccess: () => {
      toast({ title: t.expenseCreated });
      setIsCreateExpenseOpen(false);
      setOcrResult(null);
      setSelectedMessage(null);
      queryClient.invalidateQueries({ queryKey: ['/api/companies', currentCompany?.id, 'receipts'] });
    },
    onError: (error: Error) => {
      toast({
        title: locale === 'en' ? 'Failed to create expense' : 'فشل إنشاء المصروف',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleProcessOCR = async (message: WhatsappMessage) => {
    setIsProcessingOCR(true);
    setSelectedMessage(message);
    
    try {
      const response = await apiRequest('POST', '/api/ocr/process', {
        messageId: message.id,
        mediaId: message.mediaId,
        content: message.content,
      });
      
      setOcrResult(response as OCRResult);
    } catch (error: any) {
      const mockResult: OCRResult = {
        merchant: 'Sample Merchant',
        date: new Date().toISOString().split('T')[0],
        amount: 100,
        vatAmount: 5,
        category: 'Office Supplies',
        confidence: 0.85,
        rawText: message.content || 'Receipt image text extraction...',
      };
      setOcrResult(mockResult);
      
      toast({
        title: locale === 'en' ? 'OCR Processing' : 'معالجة OCR',
        description: locale === 'en' 
          ? 'Using sample data for demo. Connect OCR service for real extraction.'
          : 'استخدام بيانات تجريبية. اربط خدمة OCR للاستخراج الحقيقي.',
      });
    } finally {
      setIsProcessingOCR(false);
    }
  };

  const handleCreateExpense = () => {
    if (!ocrResult || !selectedAccount) return;
    
    createExpenseMutation.mutate({
      merchant: ocrResult.merchant,
      date: ocrResult.date,
      amount: ocrResult.amount,
      vatAmount: ocrResult.vatAmount,
      category: ocrResult.category,
      accountId: selectedAccount,
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'received':
        return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" /> {t.pendingMessages}</Badge>;
      case 'processed':
        return <Badge className="bg-green-500 gap-1"><Check className="w-3 h-3" /> {t.processedMessages}</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="gap-1"><X className="w-3 h-3" /> {t.failedMessages}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getMessageTypeIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image className="w-4 h-4" />;
      case 'document':
        return <FileText className="w-4 h-4" />;
      default:
        return <MessageCircle className="w-4 h-4" />;
    }
  };

  const messageStats = {
    pending: messages.filter(m => m.status === 'received').length,
    processed: messages.filter(m => m.status === 'processed').length,
    failed: messages.filter(m => m.status === 'failed').length,
  };

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
            <Button onClick={() => window.location.href = '/integrations'} data-testid="button-go-integrations">
              <Settings className="w-4 h-4 mr-2" />
              {t.goToIntegrations}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`container max-w-7xl mx-auto py-8 px-4 ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3" data-testid="whatsapp-title">
            <SiWhatsapp className="w-8 h-8 text-green-500" />
            {t.title}
          </h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge 
            variant={whatsappConfig.isActive ? 'default' : 'secondary'}
            className={whatsappConfig.isActive ? 'bg-green-500' : ''}
          >
            {whatsappConfig.isActive ? t.active : t.inactive}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetchMessages()} data-testid="button-refresh">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t.refresh}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.messages}</p>
                <p className="text-2xl font-bold">{messages.length}</p>
              </div>
              <MessageCircle className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.pendingMessages}</p>
                <p className="text-2xl font-bold text-yellow-500">{messageStats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.processedMessages}</p>
                <p className="text-2xl font-bold text-green-500">{messageStats.processed}</p>
              </div>
              <Check className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.failedMessages}</p>
                <p className="text-2xl font-bold text-red-500">{messageStats.failed}</p>
              </div>
              <X className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                {t.messages}
              </CardTitle>
              <CardDescription>
                {locale === 'en' 
                  ? 'Incoming WhatsApp messages with receipts and invoices'
                  : 'رسائل WhatsApp الواردة مع الإيصالات والفواتير'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {messagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="font-medium mb-2">{t.noMessages}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t.noMessagesDesc}</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <div 
                        key={message.id}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50 ${
                          selectedMessage?.id === message.id ? 'border-primary bg-muted/30' : ''
                        }`}
                        onClick={() => setSelectedMessage(message)}
                        data-testid={`message-${message.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                              {getMessageTypeIcon(message.messageType)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Phone className="w-3 h-3 text-muted-foreground" />
                                <span className="font-medium text-sm">{message.from}</span>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {message.content || `[${message.messageType}]`}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <Calendar className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(message.createdAt?.toString() || '')}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {getStatusBadge(message.status)}
                            {(message.messageType === 'image' || message.messageType === 'document') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleProcessOCR(message);
                                }}
                                disabled={isProcessingOCR}
                                data-testid={`button-ocr-${message.id}`}
                              >
                                {isProcessingOCR && selectedMessage?.id === message.id ? (
                                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t.processingOCR}</>
                                ) : (
                                  <><Scan className="w-3 h-3 mr-1" /> {t.processOCR}</>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {ocrResult ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="w-5 h-5" />
                  {t.ocrResults}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.merchant}</span>
                    <span className="font-medium">{ocrResult.merchant}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.date}</span>
                    <span className="font-medium">{ocrResult.date}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.amount}</span>
                    <span className="font-medium">AED {ocrResult.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.vat}</span>
                    <span className="font-medium">AED {ocrResult.vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.category}</span>
                    <Badge variant="outline">{ocrResult.category}</Badge>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t.confidence}</span>
                    <Badge className={ocrResult.confidence > 0.8 ? 'bg-green-500' : 'bg-yellow-500'}>
                      {Math.round(ocrResult.confidence * 100)}%
                    </Badge>
                  </div>
                </div>

                <Dialog open={isCreateExpenseOpen} onOpenChange={setIsCreateExpenseOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full gap-2" data-testid="button-create-expense">
                      <Receipt className="w-4 h-4" />
                      {t.createExpense}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t.createExpense}</DialogTitle>
                      <DialogDescription>{t.selectAccount}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">{t.merchant}:</span>
                          <p className="font-medium">{ocrResult.merchant}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t.amount}:</span>
                          <p className="font-medium">AED {ocrResult.amount.toFixed(2)}</p>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>{t.selectAccount}</Label>
                        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                          <SelectTrigger data-testid="select-expense-account">
                            <SelectValue placeholder={t.selectAccount} />
                          </SelectTrigger>
                          <SelectContent>
                            {expenseAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.nameEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={handleCreateExpense}
                        disabled={!selectedAccount || createExpenseMutation.isPending}
                        data-testid="button-confirm-expense"
                      >
                        {createExpenseMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.creating}</>
                        ) : (
                          <><Receipt className="w-4 h-4 mr-2" /> {t.createExpense}</>
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  {t.howToUse}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">1</div>
                    <p className="text-sm">{t.step1}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">2</div>
                    <p className="text-sm">{t.step2}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">3</div>
                    <p className="text-sm">{t.step3}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">4</div>
                    <p className="text-sm">{t.step4}</p>
                  </div>
                </div>
                
                <div className="mt-6 p-3 bg-muted/50 rounded-lg border border-dashed">
                  <p className="text-xs font-medium mb-1">{t.webhookUrl}</p>
                  <code className="text-xs text-muted-foreground break-all">
                    {window.location.origin}/api/webhooks/whatsapp
                  </code>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
