import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  History
} from 'lucide-react';
import { SiGoogle, SiWhatsapp, SiQuickbooks } from 'react-icons/si';
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

export default function Integrations() {
  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const [exportType, setExportType] = useState<string>('');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [importType, setImportType] = useState<string>('');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>('');

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
  };

  const { data: integrationStatus, isLoading: statusLoading } = useQuery<IntegrationsStatusResponse>({
    queryKey: ['/api/integrations/status'],
  });

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery<IntegrationSync[]>({
    queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`],
    enabled: !!currentCompany?.id,
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
        </div>
      </div>

      {/* Coming Soon Integrations */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5" />
          {t.upcomingIntegrations}
        </h2>
        
        <div className="grid md:grid-cols-3 gap-6">
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

          {/* WhatsApp */}
          <Card className="relative overflow-hidden opacity-75" data-testid="integration-whatsapp">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-green-500/10 to-green-600/5 rounded-bl-full" />
            <CardHeader className="flex flex-row items-start gap-4 pb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                <SiWhatsapp className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">WhatsApp</CardTitle>
                  <Badge variant="outline">{t.comingSoon}</Badge>
                </div>
                <CardDescription className="mt-1 text-sm">{t.whatsappDesc}</CardDescription>
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
