import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useI18n } from "@/lib/i18n";
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
  Link2,
  History,
  Settings,
  Power,
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
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
import type { IntegrationSync } from "@shared/schema";
import { messages as pageMessages } from "./Integrations.i18n";

interface IntegrationStatus {
  connected: boolean;
  name: string;
  description: string;
}

interface IntegrationsStatusResponse {
  googleSheets: IntegrationStatus;
}

export default function Integrations() {
  const tr = pageMessages.useT();

  const { locale } = useI18n();
  const { toast } = useToast();
  const { company: currentCompany } = useDefaultCompany();
  const [exportType, setExportType] = useState<string>("");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [importType, setImportType] = useState<string>("");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>("");

  const isRTL = locale === "ar";

  const t = {
    title: tr("integrations"),
    subtitle: tr("connectYourFavoriteAppsAndServices"),
    connected: tr("connected"),
    notConnected: tr("notConnected"),
    export: tr("export"),
    import: tr("import"),
    sync: tr("sync"),
    connect: tr("connect"),
    exportToSheets: tr("exportToGoogleSheets"),
    selectDataType: tr("selectWhatToExport"),
    importFromSheets: tr("importFromGoogleSheets"),
    selectImportType: tr("selectWhatToImport"),
    sheetUrl: tr("googleSheetsUrl"),
    sheetUrlPlaceholder:
      locale === "en"
        ? "https://docs.google.com/spreadsheets/d/..."
        : "https://docs.google.com/spreadsheets/d/...",
    importing: tr("importing"),
    importSuccess: tr("importSuccessful"),
    invoices: tr("invoices"),
    expenses: tr("expenses"),
    journalEntries: tr("journalEntries"),
    chartOfAccounts: tr("chartOfAccounts"),
    exporting: tr("exporting"),
    exportSuccess: tr("exportSuccessful"),
    openSpreadsheet: tr("openSpreadsheet"),
    syncHistory: tr("syncHistory"),
    noHistory: tr("noSyncHistoryYet"),
    records: tr("records"),
    availableIntegrations: tr("availableIntegrations"),
    googleSheetsDesc: tr("exportInvoicesExpensesAndReportsTo"),
  };

  const { data: integrationStatus, isLoading: statusLoading } =
    useQuery<IntegrationsStatusResponse>({
      queryKey: ["/api/integrations/status"],
    });

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery<IntegrationSync[]>({
    queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`],
    enabled: !!currentCompany?.id,
  });

  const exportMutation = useMutation({
    mutationFn: async ({ dataType }: { dataType: string }) => {
      const endpoint = `/api/integrations/google-sheets/export/${dataType}`;
      return await apiRequest("POST", endpoint, { companyId: currentCompany?.id });
    },
    onSuccess: (data: any) => {
      toast({
        title: t.exportSuccess,
        description: `${data.recordCount} ${t.records}`,
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`],
      });
      setIsExportDialogOpen(false);

      // Open the spreadsheet in a new tab
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (error: Error) => {
      toast({
        title: tr("exportFailed"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async ({ dataType, sheetUrl }: { dataType: string; sheetUrl: string }) => {
      const endpoint = `/api/integrations/google-sheets/import/${dataType}`;
      return await apiRequest("POST", endpoint, { companyId: currentCompany?.id, sheetUrl });
    },
    onSuccess: (data: any) => {
      toast({
        title: t.importSuccess,
        description: `${data.recordCount} ${t.records} ${tr("imported")}`,
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/integrations/sync-history?companyId=${currentCompany?.id}`],
      });
      setIsImportDialogOpen(false);
      setSpreadsheetUrl("");
      setImportType("");
    },
    onError: (error: Error) => {
      toast({
        title: tr("importFailed"),
        description: error?.message,
        variant: "destructive",
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
    return date.toLocaleDateString(locale === "ar" ? "ar-AE" : "en-AE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDataTypeLabel = (dataType: string) => {
    switch (dataType) {
      case "invoices":
        return t.invoices;
      case "expenses":
        return t.expenses;
      case "journal_entries":
        return t.journalEntries;
      case "chart_of_accounts":
        return t.chartOfAccounts;
      default:
        return dataType;
    }
  };

  return (
    <div
      className={`container max-w-6xl mx-auto py-8 px-4 ${isRTL ? "rtl" : "ltr"}`}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <PageHeader
        eyebrow={tr("settings")}
        title={t.title}
        testId="integrations-title"
        description={<span data-testid="integrations-subtitle">{t.subtitle}</span>}
        className="mb-8"
      />

      {/* Available Integrations */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t.availableIntegrations}
        </h2>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Google Sheets Integration */}
          <Card className="relative overflow-hidden" data-testid="integration-google-sheets">
            <div className="absolute top-0 end-0 w-32 h-32 rounded-es-full" />
            <CardHeader className="flex flex-row items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg">
                <SiGoogle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{tr("googleSheets")}</CardTitle>
                  <Badge
                    variant={integrationStatus?.googleSheets?.connected ? "default" : "secondary"}
                    className={integrationStatus?.googleSheets?.connected ? "bg-success" : ""}
                    data-testid="google-sheets-status"
                  >
                    {integrationStatus?.googleSheets?.connected ? (
                      <>
                        <Check className="w-3 h-3 me-1" /> {t.connected}
                      </>
                    ) : (
                      <>
                        <X className="w-3 h-3 me-1" /> {t.notConnected}
                      </>
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
                              <SelectItem
                                value="journal-entries"
                                data-testid="export-option-journal"
                              >
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
                              <>
                                <Loader2 className="w-4 h-4 me-2 animate-spin" /> {t.exporting}
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4 me-2" /> {t.export}
                              </>
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="gap-2"
                          data-testid="button-import-sheets"
                        >
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
                            <label className="text-sm font-medium mb-2 block">
                              {t.selectImportType}
                            </label>
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
                              {tr("firstSheetWillBeUsedEnsure")}
                            </p>
                          </div>

                          <Button
                            onClick={handleImport}
                            disabled={!importType || !spreadsheetUrl || importMutation.isPending}
                            className="w-full"
                            data-testid="button-confirm-import"
                          >
                            {importMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 me-2 animate-spin" /> {t.importing}
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4 me-2" /> {t.import}
                              </>
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tr("googleSheetsExportIsNotConfigured")}
                </p>
              )}
            </CardContent>
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
                      <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                        <SiGoogle className="w-5 h-5 text-success" />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {getDataTypeLabel(sync.dataType)}
                          <Badge variant="outline" className="text-xs">
                            {sync.syncType === "export" ? t.export : t.import}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {sync.recordCount} {t.records} •{" "}
                          {formatDate(sync.syncedAt?.toString() || "")}
                        </div>
                      </div>
                    </div>
                    {sync.externalUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(sync.externalUrl!, "_blank")}
                        data-testid={`button-open-sync-${sync.id}`}
                      >
                        <ExternalLink className="w-4 h-4 me-2" />
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
