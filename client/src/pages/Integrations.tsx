import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useI18n } from '@/lib/i18n';
import { 
  Sheet, 
  FileSpreadsheet, 
  Download, 
  Upload, 
  Check, 
  X, 
  Loader2, 
  ExternalLink,
  Clock,
  MessageSquare,
  Calculator,
  Wallet,
  RefreshCw,
  Zap,
  Link2,
  History,
  Settings,
  Power
} from 'lucide-react';
import { SiGoogle, SiWhatsapp, SiQuickbooks } from 'react-icons/si';
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
import type { IntegrationSync } from '@shared/schema';

interface IntegrationStatus {
  connected: boolean;
  name: string;
  description: string;
  comingSoon?: boolean;
}

interface IntegrationsStatusResponse {
  googleSheets: IntegrationStatus;
  xero: IntegrationStatus;
  quickbooks: IntegrationStatus;
  whatsapp: IntegrationStatus;
}

interface WhatsappConfigResponse {
  configured: boolean;
  isActive: boolean;
  phoneNumberId?: string;
  businessAccountId?: string;
  hasAccessToken?: boolean;
  companyId: string;
  configId?: string;
}

export default function Integrations() {
  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const [exportType, setExportType] = useState<string>('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [importType, setImportType] = useState<string>('');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>('');
  
  // WhatsApp state
  const [isWhatsappDialogOpen, setIsWhatsappDialogOpen] = useState(false);
  const [whatsappForm, setWhatsappForm] = useState({
    phoneNumberId: '',
    accessToken: '',
    webhookVerifyToken: '',
    businessAccountId: '',
  });

  const isRTL = locale === 'ar';

  const t = {
    title: locale === 'en' ? 'Integrations' : 'التكاملات',
    subtitle: locale === 'en' 
      ? 'Connect your favorite apps and services to sync your financial data'
      : 'اربط تطبيقاتك وخدماتك المفضلة لمزامنة بياناتك المالية',
    connected: locale === 'en' ? 'Connected' : 'متصل',
    notConnected: locale === 'en' ? 'Not Connected' : 'غير متصل',
    comingSoon: locale === 'en' ? 'Coming Soon' : 'قريباً',
    export: locale === 'en' ? 'Export' : 'تصدير',
    import: locale === 'en' ? 'Import' : 'استيراد',
    sync: locale === 'en' ? 'Sync' : 'مزامنة',
    connect: locale === 'en' ? 'Connect' : 'اتصال',
    exportToSheets: locale === 'en' ? 'Export to Google Sheets' : 'تصدير إلى جداول Google',
    selectDataType: locale === 'en' ? 'Select what to export' : 'اختر ما تريد تصديره',
    importFromSheets: locale === 'en' ? 'Import from Google Sheets' : 'استيراد من جداول Google',
    selectImportType: locale === 'en' ? 'Select what to import' : 'اختر ما تريد استيراده',
    sheetUrl: locale === 'en' ? 'Google Sheets URL' : 'رابط جداول Google',
    sheetUrlPlaceholder: locale === 'en' ? 'https://docs.google.com/spreadsheets/d/...' : 'https://docs.google.com/spreadsheets/d/...',
    importing: locale === 'en' ? 'Importing...' : 'جاري الاستيراد...',
    importSuccess: locale === 'en' ? 'Import successful!' : 'تم الاستيراد بنجاح!',
    invoices: locale === 'en' ? 'Invoices' : 'الفواتير',
    expenses: locale === 'en' ? 'Expenses' : 'المصروفات',
    journalEntries: locale === 'en' ? 'Journal Entries' : 'القيود اليومية',
    chartOfAccounts: locale === 'en' ? 'Chart of Accounts' : 'دليل الحسابات',
    exporting: locale === 'en' ? 'Exporting...' : 'جاري التصدير...',
    exportSuccess: locale === 'en' ? 'Export successful!' : 'تم التصدير بنجاح!',
    openSpreadsheet: locale === 'en' ? 'Open Spreadsheet' : 'فتح الجدول',
    syncHistory: locale === 'en' ? 'Sync History' : 'سجل المزامنة',
    noHistory: locale === 'en' ? 'No sync history yet' : 'لا يوجد سجل مزامنة بعد',
    records: locale === 'en' ? 'records' : 'سجلات',
    availableIntegrations: locale === 'en' ? 'Available Integrations' : 'التكاملات المتاحة',
    upcomingIntegrations: locale === 'en' ? 'Coming Soon' : 'قريباً',
    googleSheetsDesc: locale === 'en' 
      ? 'Export invoices, expenses, and reports to Google Sheets for easy sharing and analysis'
      : 'صدّر الفواتير والمصروفات والتقارير إلى Google Sheets للمشاركة والتحليل بسهولة',
    xeroDesc: locale === 'en'
      ? 'Two-way sync with Xero for seamless accounting workflow integration'
      : 'مزامنة ثنائية الاتجاه مع Xero للتكامل السلس مع سير العمل المحاسبي',
    quickbooksDesc: locale === 'en'
      ? 'Sync transactions, invoices, and accounts with QuickBooks Online'
      : 'مزامنة المعاملات والفواتير والحسابات مع QuickBooks Online',
    whatsappDesc: locale === 'en'
      ? 'Extract receipts and invoices from WhatsApp messages automatically'
      : 'استخرج الإيصالات والفواتير من رسائل WhatsApp تلقائياً',
    // WhatsApp translations
    whatsappSetup: locale === 'en' ? 'WhatsApp Setup' : 'إعداد WhatsApp',
    whatsappSetupDesc: locale === 'en' 
      ? 'Connect your WhatsApp Business account to automatically extract receipts from messages'
      : 'اربط حساب WhatsApp Business الخاص بك لاستخراج الإيصالات تلقائياً من الرسائل',
    phoneNumberId: locale === 'en' ? 'Phone Number ID' : 'معرف رقم الهاتف',
    accessToken: locale === 'en' ? 'Access Token' : 'رمز الوصول',
    webhookVerifyToken: locale === 'en' ? 'Webhook Verify Token' : 'رمز التحقق من Webhook',
    businessAccountId: locale === 'en' ? 'Business Account ID' : 'معرف حساب الأعمال',
    configure: locale === 'en' ? 'Configure' : 'تكوين',
    saveConfig: locale === 'en' ? 'Save Configuration' : 'حفظ الإعدادات',
    saving: locale === 'en' ? 'Saving...' : 'جاري الحفظ...',
    whatsappConfigured: locale === 'en' ? 'WhatsApp configured successfully!' : 'تم تكوين WhatsApp بنجاح!',
    whatsappActive: locale === 'en' ? 'Active' : 'نشط',
    whatsappInactive: locale === 'en' ? 'Inactive' : 'غير نشط',
    webhookUrl: locale === 'en' ? 'Webhook URL' : 'رابط Webhook',
    copyWebhookUrl: locale === 'en' ? 'Copy this URL to your Meta Developer Console' : 'انسخ هذا الرابط إلى لوحة تحكم Meta Developer',
  };

  const { data: integrationStatus, isLoading: statusLoading } = useQuery<IntegrationsStatusResponse>({
    queryKey: ['/api/integrations/status'],
  });

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery<IntegrationSync[]>({
    queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`],
    enabled: !!currentCompany?.id,
  });

  // WhatsApp config query
  const { data: whatsappConfig, isLoading: whatsappLoading } = useQuery<WhatsappConfigResponse>({
    queryKey: ['/api/integrations/whatsapp/config'],
  });

  // WhatsApp save config mutation
  const whatsappConfigMutation = useMutation({
    mutationFn: async (config: typeof whatsappForm) => {
      return await apiRequest('POST', '/api/integrations/whatsapp/config', config);
    },
    onSuccess: () => {
      toast({
        title: t.whatsappConfigured,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/config'] });
      setIsWhatsappDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: locale === 'en' ? 'Configuration failed' : 'فشل التكوين',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // WhatsApp toggle mutation
  const whatsappToggleMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('PATCH', '/api/integrations/whatsapp/toggle', {});
    },
    onSuccess: (data: any) => {
      toast({
        title: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/config'] });
    },
    onError: (error: Error) => {
      toast({
        title: locale === 'en' ? 'Toggle failed' : 'فشل التبديل',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async ({ dataType }: { dataType: string }) => {
      const endpoint = `/api/integrations/google-sheets/export/${dataType}`;
      return await apiRequest('POST', endpoint, { companyId: currentCompany?.id });
    },
    onSuccess: (data: any) => {
      toast({
        title: t.exportSuccess,
        description: `${data.recordCount} ${t.records}`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`] });
      setIsExportDialogOpen(false);
      
      // Open the spreadsheet in a new tab
      if (data.url) {
        window.open(data.url, '_blank');
      }
    },
    onError: (error: Error) => {
      toast({
        title: locale === 'en' ? 'Export failed' : 'فشل التصدير',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ dataType, sheetUrl }: { dataType: string; sheetUrl: string }) => {
      const endpoint = `/api/integrations/google-sheets/import/${dataType}`;
      return await apiRequest('POST', endpoint, { companyId: currentCompany?.id, sheetUrl });
    },
    onSuccess: (data: any) => {
      toast({
        title: t.importSuccess,
        description: `${data.recordCount} ${t.records} ${locale === 'en' ? 'imported' : 'تم استيرادها'}`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`] });
      setIsImportDialogOpen(false);
      setSpreadsheetUrl('');
      setImportType('');
    },
    onError: (error: Error) => {
      toast({
        title: locale === 'en' ? 'Import failed' : 'فشل الاستيراد',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleExport = () => {
    if (!exportType) return;
    exportMutation.mutate({ dataType: exportType });
  };

  const handleImport = () => {
    if (!importType || !spreadsheetUrl) return;
    importMutation.mutate({ dataType: importType, sheetUrl: spreadsheetUrl });
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

  const getDataTypeLabel = (dataType: string) => {
    switch (dataType) {
      case 'invoices': return t.invoices;
      case 'expenses': return t.expenses;
      case 'journal_entries': return t.journalEntries;
      case 'chart_of_accounts': return t.chartOfAccounts;
      default: return dataType;
    }
  };

  return (
    <div className={`container max-w-6xl mx-auto py-8 px-4 ${isRTL ? 'rtl' : 'ltr'}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="integrations-title">{t.title}</h1>
        <p className="text-muted-foreground" data-testid="integrations-subtitle">{t.subtitle}</p>
      </div>

      {/* Available Integrations */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t.availableIntegrations}
        </h2>
        
        <div className="grid md:grid-cols-2 gap-6">
          {/* Google Sheets Integration */}
          <Card className="relative overflow-hidden" data-testid="integration-google-sheets">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-bl-full" />
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                <SiGoogle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Google Sheets</CardTitle>
                  <Badge 
                    variant={integrationStatus?.googleSheets?.connected ? 'default' : 'secondary'}
                    className={integrationStatus?.googleSheets?.connected ? 'bg-green-500' : ''}
                    data-testid="google-sheets-status"
                  >
                    {integrationStatus?.googleSheets?.connected ? (
                      <><Check className="w-3 h-3 mr-1" /> {t.connected}</>
                    ) : (
                      <><X className="w-3 h-3 mr-1" /> {t.notConnected}</>
                    )}
                  </Badge>
                </div>
                <CardDescription className="mt-1">{t.googleSheetsDesc}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {integrationStatus?.googleSheets?.connected ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                  <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2" data-testid="button-export-sheets">
                        <Download className="w-4 h-4" />
                        {t.export}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t.exportToSheets}</DialogTitle>
                        <DialogDescription>{t.selectDataType}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <Select value={exportType} onValueChange={setExportType}>
                          <SelectTrigger data-testid="select-export-type">
                            <SelectValue placeholder={t.selectDataType} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="invoices" data-testid="export-option-invoices">
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet className="w-4 h-4" />
                                {t.invoices}
                              </div>
                            </SelectItem>
                            <SelectItem value="expenses" data-testid="export-option-expenses">
                              <div className="flex items-center gap-2">
                                <Wallet className="w-4 h-4" />
                                {t.expenses}
                              </div>
                            </SelectItem>
                            <SelectItem value="journal-entries" data-testid="export-option-journal">
                              <div className="flex items-center gap-2">
                                <Calculator className="w-4 h-4" />
                                {t.journalEntries}
                              </div>
                            </SelectItem>
                            <SelectItem value="chart-of-accounts" data-testid="export-option-coa">
                              <div className="flex items-center gap-2">
                                <Sheet className="w-4 h-4" />
                                {t.chartOfAccounts}
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Button 
                          onClick={handleExport} 
                          disabled={!exportType || exportMutation.isPending}
                          className="w-full"
                          data-testid="button-confirm-export"
                        >
                          {exportMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.exporting}</>
                          ) : (
                            <><Download className="w-4 h-4 mr-2" /> {t.export}</>
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="gap-2" data-testid="button-import-sheets">
                        <Upload className="w-4 h-4" />
                        {t.import}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t.importFromSheets}</DialogTitle>
                        <DialogDescription>{t.selectImportType}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div>
                          <label className="text-sm font-medium mb-2 block">{t.selectImportType}</label>
                          <Select value={importType} onValueChange={setImportType}>
                            <SelectTrigger data-testid="select-import-type">
                              <SelectValue placeholder={t.selectImportType} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="invoices" data-testid="import-option-invoices">
                                {t.invoices}
                              </SelectItem>
                              <SelectItem value="expenses" data-testid="import-option-expenses">
                                {t.expenses}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <label className="text-sm font-medium mb-2 block">{t.sheetUrl}</label>
                          <input
                            type="text"
                            value={spreadsheetUrl}
                            onChange={(e) => setSpreadsheetUrl(e.target.value)}
                            placeholder={t.sheetUrlPlaceholder}
                            className="w-full px-3 py-2 border rounded-md text-sm"
                            data-testid="input-sheet-url"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {locale === 'en' 
                              ? 'First sheet will be used. Ensure columns match expected format.' 
                              : 'سيتم استخدام الورقة الأولى. تأكد من أن الأعمدة تطابق الصيغة المتوقعة.'}
                          </p>
                        </div>
                        
                        <Button 
                          onClick={handleImport} 
                          disabled={!importType || !spreadsheetUrl || importMutation.isPending}
                          className="w-full"
                          data-testid="button-confirm-import"
                        >
                          {importMutation.isPending ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.importing}</>
                          ) : (
                            <><Upload className="w-4 h-4 mr-2" /> {t.import}</>
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {locale === 'en' 
                    ? 'Google Sheets integration needs to be configured in Replit settings.'
                    : 'يجب تكوين تكامل Google Sheets في إعدادات Replit.'}
                </p>
              )}
            </CardContent>
          </Card>

          {/* WhatsApp Integration */}
          <Card className="relative overflow-hidden" data-testid="integration-whatsapp">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-bl-full" />
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                <SiWhatsapp className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">WhatsApp Business</CardTitle>
                  <Badge 
                    variant={whatsappConfig?.configured && whatsappConfig?.isActive ? 'default' : 'secondary'}
                    className={whatsappConfig?.configured && whatsappConfig?.isActive ? 'bg-green-500' : ''}
                    data-testid="whatsapp-status"
                  >
                    {whatsappConfig?.configured && whatsappConfig?.isActive ? (
                      <><Check className="w-3 h-3 mr-1" /> {t.whatsappActive}</>
                    ) : whatsappConfig?.configured ? (
                      <><Power className="w-3 h-3 mr-1" /> {t.whatsappInactive}</>
                    ) : (
                      <><X className="w-3 h-3 mr-1" /> {t.notConnected}</>
                    )}
                  </Badge>
                </div>
                <CardDescription className="mt-1">{t.whatsappDesc}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {whatsappConfig?.configured ? (
                  <>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{t.phoneNumberId}</p>
                        <p className="text-xs text-muted-foreground">{whatsappConfig.phoneNumberId || 'N/A'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={whatsappConfig.isActive}
                          onCheckedChange={() => whatsappToggleMutation.mutate()}
                          disabled={whatsappToggleMutation.isPending}
                          data-testid="switch-whatsapp-toggle"
                        />
                      </div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg border border-dashed">
                      <p className="text-xs font-medium mb-1">{t.webhookUrl}</p>
                      <code className="text-xs text-muted-foreground break-all block mb-1">
                        {window.location.origin}/api/webhooks/whatsapp
                      </code>
                      <p className="text-xs text-muted-foreground">{t.copyWebhookUrl}</p>
                    </div>
                  </>
                ) : null}
                
                <Dialog open={isWhatsappDialogOpen} onOpenChange={setIsWhatsappDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      variant={whatsappConfig?.configured ? 'outline' : 'default'} 
                      className="gap-2 w-full"
                      data-testid="button-configure-whatsapp"
                    >
                      <Settings className="w-4 h-4" />
                      {whatsappConfig?.configured ? t.configure : t.connect}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <SiWhatsapp className="w-5 h-5 text-green-500" />
                        {t.whatsappSetup}
                      </DialogTitle>
                      <DialogDescription>{t.whatsappSetupDesc}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="phoneNumberId">{t.phoneNumberId}</Label>
                        <Input
                          id="phoneNumberId"
                          value={whatsappForm.phoneNumberId}
                          onChange={(e) => setWhatsappForm(prev => ({ ...prev, phoneNumberId: e.target.value }))}
                          placeholder="e.g., 123456789012345"
                          data-testid="input-whatsapp-phone-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="businessAccountId">{t.businessAccountId}</Label>
                        <Input
                          id="businessAccountId"
                          value={whatsappForm.businessAccountId}
                          onChange={(e) => setWhatsappForm(prev => ({ ...prev, businessAccountId: e.target.value }))}
                          placeholder="e.g., 987654321098765"
                          data-testid="input-whatsapp-business-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="accessToken">{t.accessToken}</Label>
                        <Input
                          id="accessToken"
                          type="password"
                          value={whatsappForm.accessToken}
                          onChange={(e) => setWhatsappForm(prev => ({ ...prev, accessToken: e.target.value }))}
                          placeholder="Your permanent access token"
                          data-testid="input-whatsapp-token"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="webhookVerifyToken">{t.webhookVerifyToken}</Label>
                        <Input
                          id="webhookVerifyToken"
                          value={whatsappForm.webhookVerifyToken}
                          onChange={(e) => setWhatsappForm(prev => ({ ...prev, webhookVerifyToken: e.target.value }))}
                          placeholder="Your custom verify token"
                          data-testid="input-whatsapp-verify-token"
                        />
                      </div>
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs font-medium mb-1">{t.webhookUrl}</p>
                        <code className="text-xs text-muted-foreground break-all">
                          {window.location.origin}/api/webhooks/whatsapp
                        </code>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => whatsappConfigMutation.mutate(whatsappForm)}
                        disabled={whatsappConfigMutation.isPending || !whatsappForm.phoneNumberId || !whatsappForm.accessToken}
                        data-testid="button-save-whatsapp-config"
                      >
                        {whatsappConfigMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t.saving}</>
                        ) : (
                          t.saveConfig
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Coming Soon Integrations */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5" />
          {t.upcomingIntegrations}
        </h2>
        
        <div className="grid md:grid-cols-2 gap-6">
          {/* Xero */}
          <Card className="relative overflow-hidden opacity-75" data-testid="integration-xero">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-bl-full" />
            <CardHeader className="flex flex-row items-start gap-4 pb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-sm">X</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Xero</CardTitle>
                  <Badge variant="outline">{t.comingSoon}</Badge>
                </div>
                <CardDescription className="mt-1 text-sm">{t.xeroDesc}</CardDescription>
              </div>
            </CardHeader>
          </Card>

          {/* QuickBooks */}
          <Card className="relative overflow-hidden opacity-75" data-testid="integration-quickbooks">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-bl-full" />
            <CardHeader className="flex flex-row items-start gap-4 pb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-green-700 flex items-center justify-center shadow-lg">
                <SiQuickbooks className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">QuickBooks</CardTitle>
                  <Badge variant="outline">{t.comingSoon}</Badge>
                </div>
                <CardDescription className="mt-1 text-sm">{t.quickbooksDesc}</CardDescription>
              </div>
            </CardHeader>
          </Card>

        </div>
      </div>

      {/* Sync History */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <History className="w-5 h-5" />
          {t.syncHistory}
        </h2>
        
        <Card>
          <CardContent className="pt-6">
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : syncHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t.noHistory}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {syncHistory.slice(0, 10).map((sync) => (
                  <div 
                    key={sync.id} 
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border"
                    data-testid={`sync-history-${sync.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <SiGoogle className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {getDataTypeLabel(sync.dataType)}
                          <Badge variant="outline" className="text-xs">
                            {sync.syncType === 'export' ? t.export : t.import}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {sync.recordCount} {t.records} • {formatDate(sync.syncedAt?.toString() || '')}
                        </div>
                      </div>
                    </div>
                    {sync.externalUrl && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => window.open(sync.externalUrl!, '_blank')}
                        data-testid={`button-open-sync-${sync.id}`}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        {t.openSpreadsheet}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
