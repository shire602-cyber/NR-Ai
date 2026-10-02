import { PageHeader } from "@/components/ui/page-header";
import { todayYmd } from "@/lib/calendar-date";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToExcel, prepareFxGainsLossesForExport } from "@/lib/export";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { Plus, ArrowRightLeft, RefreshCw, Download, Trash2, AlertTriangle } from "lucide-react";
import { messages as pageMessages } from "./ExchangeRates.i18n";

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "INR", "PKR", "EGP", "BHD", "QAR"];
// A rate is always entered as "1 <foreign currency> = <rate> AED".
const BASE_CURRENCY = "AED";
const FOREIGN_CURRENCIES = CURRENCIES.filter((c) => c !== BASE_CURRENCY);

interface ExchangeRate {
  id: string;
  companyId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string;
  scope?: "company" | "system";
  createdAt: string;
}

interface ConvertResult {
  from: string;
  to: string;
  amount: number;
  convertedAmount: number;
  rate: number;
  effectiveDate?: string;
}

interface FxExposureRow {
  entityType: string;
  entityId: string;
  entityNumber: string;
  counterparty: string;
  currency: string;
  foreignAmount: number;
  transactionRate: number;
  currentRate: number;
  bookValueAed: number;
  currentValueAed: number;
  unrealizedGainLoss: number;
}

interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: FxExposureRow[];
  payables: FxExposureRow[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}

export default function ExchangeRates() {
  const trl = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const tr = (en: string, ar: string) => (locale === "ar" ? ar : en);

  // Dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formFromCurrency, setFormFromCurrency] = useState("USD");
  const [formRate, setFormRate] = useState("");
  const [formEffectiveDate, setFormEffectiveDate] = useState(todayYmd());

  // Converter state
  const [convertFrom, setConvertFrom] = useState("USD");
  const [convertTo, setConvertTo] = useState("AED");
  const [convertAmount, setConvertAmount] = useState("");
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);

  // Fetch exchange rates
  const { data: rates, isLoading: isLoadingRates } = useQuery<ExchangeRate[]>({
    queryKey: [`/api/companies/${companyId}/exchange-rates`],
    enabled: !!companyId,
  });

  // Foreign-currency documents the company already has. Invoices and quotes in a
  // currency with no trusted rate cannot be converted to AED, so tell the user
  // which currencies still need a rate (see the notice below).
  const { data: invoiceDocs } = useQuery<Array<{ currency?: string | null }>>({
    queryKey: [`/api/companies/${companyId}/invoices`],
    enabled: !!companyId,
  });
  const { data: quoteDocs } = useQuery<Array<{ currency?: string | null }>>({
    queryKey: [`/api/companies/${companyId}/quotes`],
    enabled: !!companyId,
  });
  const currenciesNeedingRate = useMemo(() => {
    if (!rates) return [];
    const covered = new Set(
      rates.filter((r) => r.toCurrency === BASE_CURRENCY).map((r) => r.fromCurrency)
    );
    const used = new Set<string>();
    for (const doc of [...(invoiceDocs ?? []), ...(quoteDocs ?? [])]) {
      const c = (doc.currency ?? BASE_CURRENCY).toUpperCase();
      if (c !== BASE_CURRENCY) used.add(c);
    }
    return Array.from(used)
      .filter((c) => !covered.has(c))
      .sort();
  }, [rates, invoiceDocs, quoteDocs]);

  const { data: fxReport, isLoading: isLoadingFxReport } = useQuery<FxGainsLossesReport>({
    queryKey: [`/api/companies/${companyId}/reports/fx-gains-losses`],
    enabled: !!companyId,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      fromCurrency: string;
      toCurrency: string;
      rate: number;
      effectiveDate: string;
    }) => {
      return apiRequest("POST", `/api/companies/${companyId}/exchange-rates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/exchange-rates`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/reports/fx-gains-losses`],
      });
      setShowAddDialog(false);
      setFormRate("");
      toast({ title: trl("exchangeRateAddedSuccessfully") });
    },
    onError: (error: Error) => {
      toast({ title: trl("failedToAddRate"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/exchange-rates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/exchange-rates`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/reports/fx-gains-losses`],
      });
      toast({ title: tr("Exchange rate deleted", "تم حذف سعر الصرف") });
    },
    onError: (error: Error) => {
      toast({
        title: tr("Failed to delete rate", "تعذر حذف سعر الصرف"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Convert mutation
  const convertMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        from: convertFrom,
        to: convertTo,
        amount: convertAmount,
      });
      return apiRequest("GET", `/api/companies/${companyId}/exchange-rates/convert?${params}`);
    },
    onSuccess: (data: ConvertResult) => {
      setConvertResult(data);
    },
    onError: (error: Error) => {
      toast({
        title: trl("conversionFailed"),
        description: error?.message,
        variant: "destructive",
      });
      setConvertResult(null);
    },
  });

  const handleAddRate = () => {
    const rate = parseFloat(formRate);
    if (isNaN(rate) || rate <= 0) {
      toast({ title: trl("pleaseEnterAValidRate"), variant: "destructive" });
      return;
    }
    createMutation.mutate({
      // "1 <from> = <rate> AED": the server stores exactly this pair and direction.
      fromCurrency: formFromCurrency,
      toCurrency: BASE_CURRENCY,
      rate,
      effectiveDate: formEffectiveDate,
    });
  };

  const handleConvert = () => {
    const amount = parseFloat(convertAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: trl("pleaseEnterAValidAmount"), variant: "destructive" });
      return;
    }
    convertMutation.mutate();
  };

  const handleExportFxReport = async () => {
    if (!fxReport) {
      toast({
        title: trl("noReportData"),
        description: trl("fxGainsAndLossesIsStill"),
        variant: "destructive",
      });
      return;
    }

    try {
      await exportToExcel(
        prepareFxGainsLossesForExport(fxReport),
        `fx_gains_losses_${new Date().toISOString().slice(0, 10)}`
      );
      toast({
        title: trl("reportExported"),
        description: trl("fxGainsAndLossesHasBeen"),
      });
    } catch (error) {
      toast({
        title: trl("exportFailed"),
        description: error instanceof Error ? error.message : trl("unableToExportFxReport"),
        variant: "destructive",
      });
    }
  };

  if (!canAccess("multiCurrency")) {
    return (
      <UpgradePrompt feature="multiCurrency" requiredTier={getRequiredTier("multiCurrency")} />
    );
  }

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{trl("noCompanyFoundPleaseCreateA")}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow={trl("accounting")}
        title={trl("exchangeRates")}
        description={trl("manageCurrencyExchangeRatesAndConvert")}
        backHref="/reports"
        backLabel={trl("backToReports")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExportFxReport}
              disabled={isLoadingFxReport || !fxReport}
            >
              <Download className="h-4 w-4 me-2" />
              {trl("export")}
            </Button>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 me-2" />
              {trl("addRate")}
            </Button>
          </>
        }
      />

      {currenciesNeedingRate.length > 0 && (
        <div
          role="alert"
          data-testid="notice-rates-required"
          className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-subtle p-4 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            {tr(
              `You have documents in ${currenciesNeedingRate.join(", ")} but no exchange rate for ${currenciesNeedingRate.length === 1 ? "it" : "them"}. Rates entered before the latest update are no longer used, so enter today's rate (1 ${currenciesNeedingRate[0]} = ? AED) with "Add Rate". Until then new documents in that currency cannot be created and recurring invoices in it are skipped.`,
              `لديك مستندات بالعملة ${currenciesNeedingRate.join("، ")} ولا يوجد سعر صرف لها. لم تعد أسعار الصرف المدخلة قبل آخر تحديث مستخدمة، لذا أدخل سعر اليوم (1 ${currenciesNeedingRate[0]} = ؟ درهم) عبر "Add Rate". إلى ذلك الحين لا يمكن إنشاء مستندات جديدة بهذه العملة، وسيتم تخطي الفواتير المتكررة بها.`
            )}
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{trl("fxGainsAndLosses")}</CardTitle>
            <CardDescription>
              {trl("asOf")} {fxReport?.asOf ? formatDate(fxReport.asOf, locale) : trl("today")}{" "}
              {trl("sourceBasisTheOutstandingBalanceOf")}
              {fxReport?.baseCurrency || "AED"}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingFxReport ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {trl("openExposures")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {(fxReport?.receivables?.length ?? 0) + (fxReport?.payables?.length ?? 0)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {trl("unrealizedGains")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-success">
                    {formatCurrency(fxReport?.totalUnrealizedGain ?? 0, "AED", locale)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {trl("unrealizedLosses")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-destructive">
                    {formatCurrency(fxReport?.totalUnrealizedLoss ?? 0, "AED", locale)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {trl("netGainLoss")}
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold ${
                      (fxReport?.netUnrealizedGainLoss ?? 0) >= 0
                        ? "text-success"
                        : "text-destructive"
                    }`}
                  >
                    {formatCurrency(fxReport?.netUnrealizedGainLoss ?? 0, "AED", locale)}
                  </p>
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{trl("type")}</TableHead>
                      <TableHead>{trl("reference")}</TableHead>
                      <TableHead>{trl("counterparty")}</TableHead>
                      <TableHead>{trl("currency")}</TableHead>
                      <TableHead className="text-end">{trl("foreignAmount")}</TableHead>
                      <TableHead className="text-end">{trl("transactionRate")}</TableHead>
                      <TableHead className="text-end">{trl("currentRate")}</TableHead>
                      <TableHead className="text-end">{trl("gainLoss")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...(fxReport?.receivables ?? []), ...(fxReport?.payables ?? [])].length ===
                    0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          {trl("noOpenForeignCurrencyExposuresFor")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      [...(fxReport?.receivables ?? []), ...(fxReport?.payables ?? [])].map(
                        (row) => (
                          <TableRow key={`${row.entityType}-${row.entityId}`}>
                            <TableCell className="capitalize">{row.entityType}</TableCell>
                            <TableCell className="font-mono text-sm">{row.entityNumber}</TableCell>
                            <TableCell>{row.counterparty}</TableCell>
                            <TableCell className="font-medium">{row.currency}</TableCell>
                            <TableCell className="text-end font-mono">
                              {formatNumber(row.foreignAmount, locale)}
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatNumber(row.transactionRate, locale)}
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatNumber(row.currentRate, locale)}
                            </TableCell>
                            <TableCell
                              className={`text-end font-mono ${
                                row.unrealizedGainLoss >= 0 ? "text-success" : "text-destructive"
                              }`}
                            >
                              {formatCurrency(row.unrealizedGainLoss, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        )
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Currency Converter Widget */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {trl("currencyConverter")}
          </CardTitle>
          <CardDescription>{trl("convertAmountsUsingYourLatestExchange")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>{trl("from")}</Label>
              <Select value={convertFrom} onValueChange={setConvertFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{trl("to")}</Label>
              <Select value={convertTo} onValueChange={setConvertTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{trl("amount")}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={trl("enterAmount")}
                value={convertAmount}
                onChange={(e) => {
                  setConvertAmount(e.target.value);
                  setConvertResult(null);
                }}
              />
            </div>
            <Button onClick={handleConvert} disabled={convertMutation.isPending || !convertAmount}>
              {convertMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 me-2" />
              )}
              {trl("convert")}
            </Button>
          </div>
          {convertResult && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-lg font-semibold">
                {formatNumber(convertResult.amount, locale)} {convertResult.from} ={" "}
                {formatNumber(convertResult.convertedAmount, locale)} {convertResult.to}
              </p>
              <p className="text-sm text-muted-foreground">
                {trl("rate1", {
                  from: convertResult.from,
                  rate: convertResult.rate.toFixed(6),
                  to: convertResult.to,
                })}
                {convertResult.effectiveDate && (
                  <>
                    {" "}
                    {trl("asOf2", { formatDate: formatDate(convertResult.effectiveDate, locale) })}
                  </>
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exchange Rates Table */}
      <Card>
        <CardHeader>
          <CardTitle>{trl("savedRates")}</CardTitle>
          <CardDescription>
            {tr(
              "Rates you entered for your company, plus official rates. Your own rate is used first.",
              "الأسعار التي أدخلتها لشركتك بالإضافة إلى الأسعار الرسمية. يُستخدم سعرك الخاص أولاً."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingRates ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !rates || rates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowRightLeft className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>{trl("noExchangeRatesConfiguredYet")}</p>
              <p className="text-sm">{trl("addYourFirstRateToGet")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("Rate", "السعر")}</TableHead>
                  <TableHead>{trl("effectiveDate")}</TableHead>
                  <TableHead>{tr("Applies to", "ينطبق على")}</TableHead>
                  <TableHead>{trl("source")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-mono">
                      1 {rate.fromCurrency} = {Number(rate.rate).toFixed(6)} {rate.toCurrency}
                    </TableCell>
                    <TableCell>{formatDate(rate.effectiveDate, locale)}</TableCell>
                    <TableCell>
                      {rate.scope === "system"
                        ? tr("All companies (official)", "جميع الشركات (رسمي)")
                        : tr("Your company", "شركتك")}
                    </TableCell>
                    <TableCell className="capitalize">{rate.source}</TableCell>
                    <TableCell className="text-end">
                      {rate.scope !== "system" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("Delete rate", "حذف السعر")}
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                tr("Delete this exchange rate?", "هل تريد حذف سعر الصرف هذا؟")
                              )
                            ) {
                              deleteMutation.mutate(rate.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Rate Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{trl("addExchangeRate")}</DialogTitle>
            <DialogDescription>
              {tr(
                "Add an exchange rate for your company. It is used only for your company's documents.",
                "أضف سعر صرف لشركتك. يُستخدم لمستنداتك فقط."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{tr("Foreign currency", "العملة الأجنبية")}</Label>
              <div className="flex items-center gap-2" dir="ltr">
                <span dir="ltr" className="font-mono text-sm">
                  1
                </span>
                <Select value={formFromCurrency} onValueChange={setFormFromCurrency}>
                  <SelectTrigger
                    className="w-28"
                    aria-label={tr("Foreign currency", "العملة الأجنبية")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOREIGN_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span dir="ltr" className="font-mono text-sm">
                  =
                </span>
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="3.6725"
                  aria-label={tr(
                    `Rate: how many ${BASE_CURRENCY} for 1 ${formFromCurrency}`,
                    `السعر: كم درهم مقابل 1 ${formFromCurrency}`
                  )}
                  value={formRate}
                  onChange={(e) => setFormRate(e.target.value)}
                />
                <span dir="ltr" className="font-mono text-sm">
                  {BASE_CURRENCY}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tr(
                  `Enter how many ${BASE_CURRENCY} you get for 1 ${formFromCurrency}. Example: 1 USD = 3.6725 AED.`,
                  `أدخل عدد الدراهم مقابل 1 ${formFromCurrency}. مثال: 1 USD = 3.6725 AED.`
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{trl("effectiveDate")}</Label>
              <Input
                type="date"
                value={formEffectiveDate}
                onChange={(e) => setFormEffectiveDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              {trl("cancel")}
            </Button>
            <Button onClick={handleAddRate} disabled={createMutation.isPending}>
              {createMutation.isPending ? trl("adding") : trl("addRate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
