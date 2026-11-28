import { T } from "@/components/layout/T";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert } from "@/components/ui/alert";
import { SetupNotice } from "@/components/ui/setup-notice";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { pegRatePrefill } from "@/lib/document-currency";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { ApiError, apiRequest, getQueryFn } from "@/lib/queryClient";
import { exportToExcel, prepareFxGainsLossesForExport } from "@/lib/export";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import {
  Plus,
  ArrowRightLeft,
  RefreshCw,
  Download,
  Trash2,
  AlertTriangle,
  Undo2,
  Eye,
  PlayCircle,
} from "lucide-react";

const CURRENCIES = [
  "AED",
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "INR",
  "PKR",
  "EGP",
  "BHD",
  "QAR",
  "KWD",
  "OMR",
  "CHF",
  "JPY",
  "CNY",
];
const RATE_TYPES = ["spot", "closing", "average"] as const;
type RateType = (typeof RATE_TYPES)[number];
const STALE_DAYS = 7;
// Rates and FX are cancelled after a delete, so their requests must really abort.
const ratesQueryFn = getQueryFn<ExchangeRate[]>({ on401: "throw" });
const fxQueryFn = getQueryFn<FxGainsLossesReport>({ on401: "throw" });

/** Page copy lives in locales/{en,ar}/exchangeRates.json (`exchangeRates.<key>`). */
type Catalog = Record<string, string | undefined>;

/**
 * A grouped label (`exchangeRates.<group>.<value>`); an unknown value shows as it is. Only the
 * source group lowercases its value (as the legacy source label did); the rest match exactly.
 */
function groupLabel(t: Catalog, group: string, value: string | null | undefined): string {
  const raw = value ?? "";
  const key = `exchangeRates.${group}.${group === "src" ? raw.toLowerCase() : raw}`;
  const text = t[key];
  return text && text !== key ? text : (value ?? "");
}

interface ExchangeRate {
  id: string;
  companyId: string | null;
  scope: "company" | "system";
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  rateType: RateType;
  effectiveDate: string;
  source: string;
  legacyInverted?: boolean;
  createdAt: string;
}

interface ConvertResult {
  from: string;
  to: string;
  amount: number;
  convertedAmount: number;
  rate: number;
  effectiveDate?: string;
  stale?: boolean;
  warning?: string;
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
  stale?: boolean;
}

interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: FxExposureRow[];
  payables: FxExposureRow[];
  bankAccounts?: FxExposureRow[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
  warnings?: string[];
}

interface PreviewLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

interface RevaluationPreview {
  asOf: string;
  reversalDate: string;
  baseCurrency: string;
  lines: PreviewLine[];
  netGainLoss: string;
  alreadyPosted: { id: string; status: string } | null;
  stale: boolean;
  missingRates: Array<{ currency: string }>;
  warnings: string[];
}

interface FeedStatus {
  maxAgeDays: number;
  stale: Array<{ pair: string; rateType: string; date: string; ageDays: number; scope: string }>;
  feed: { capability: string; configured: string[] };
}

interface Revaluation {
  id: string;
  asOf: string;
  status: string;
  netGainLoss: number;
  journalEntryId: string | null;
  reversalEntryId: string | null;
  createdAt: string;
}

const yesterdayIso = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * G9: the FX service words its warnings in English. Known shapes are re-worded in Arabic from
 * the catalog (pairs and dates stay as they are); anything else is shown unchanged.
 */
function localizeFxWarning(warning: string, locale: string, t: Catalog): string {
  if (locale !== "ar") return warning;
  const fallback = /^No (\w+) rate for ([A-Z]{3})\/([A-Z]{3}); the spot rate was used\.$/.exec(
    warning
  );
  if (fallback) {
    const kind =
      fallback[1] === "closing" || fallback[1] === "average"
        ? groupLabel(t, "rt", fallback[1])
        : fallback[1];
    return formatMessage(t["exchangeRates.warnFallback"], {
      kind,
      from: fallback[2],
      to: fallback[3],
    });
  }
  const missing = /^No ([A-Z]{3})→([A-Z]{3}) exchange rate on or before (\S+)$/.exec(warning);
  if (missing) {
    return formatMessage(t["exchangeRates.warnMissing"], {
      from: missing[1],
      to: missing[2],
      date: missing[3],
    });
  }
  const stale =
    /^Rate ([A-Z]{3})\/([A-Z]{3}) is (\d+) days old \(dated (\S+)\); the proximity limit is (\d+) days\.$/.exec(
      warning
    );
  if (stale) {
    return formatMessage(t["exchangeRates.warnStale"], {
      from: stale[1],
      to: stale[2],
      age: stale[3],
      date: stale[4],
      limit: stale[5],
    });
  }
  return warning;
}

export default function ExchangeRates() {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const { gate } = useCompanyPermission();

  const ratesKey = `/api/companies/${companyId}/exchange-rates`;
  const fxKey = `/api/companies/${companyId}/reports/fx-gains-losses`;
  const historyKey = `/api/companies/${companyId}/fx-revaluations`;

  // Add-rate dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formFromCurrency, setFormFromCurrency] = useState("USD");
  const [formToCurrency, setFormToCurrency] = useState("AED");
  const [formRate, setFormRate] = useState(pegRatePrefill("USD", "AED"));
  const [formRateType, setFormRateType] = useState<RateType>("spot");
  const [formEffectiveDate, setFormEffectiveDate] = useState(todayIso());
  const [largeMove, setLargeMove] = useState<string | null>(null);

  // Converter
  const [convertFrom, setConvertFrom] = useState("USD");
  const [convertTo, setConvertTo] = useState("AED");
  const [convertAmount, setConvertAmount] = useState("");
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);

  // Revaluation
  const [revalDate, setRevalDate] = useState(yesterdayIso());
  const [preview, setPreview] = useState<RevaluationPreview | null>(null);
  const [staleConfirm, setStaleConfirm] = useState<string | null>(null);
  // D2 (N9): a rate outside the sanity band needs a reason (owner / admin / accountant / CFO).
  const [bandConfirm, setBandConfirm] = useState<string | null>(null);
  const [bandReason, setBandReason] = useState("");
  const [staleAck, setStaleAck] = useState(false);

  const {
    data: rates,
    isLoadingError: ratesLoadFailed,
    isRefetchError: ratesRefetchFailed,
    isSuccess: ratesLoaded,
    fetchStatus: ratesFetchStatus,
    refetch: refetchRates,
  } = useQuery<ExchangeRate[]>({
    queryKey: [ratesKey],
    queryFn: ratesQueryFn,
    enabled: !!companyId,
  });

  const {
    data: fxReport,
    isLoadingError: fxLoadFailed,
    isRefetchError: fxRefetchFailed,
    isSuccess: fxLoaded,
    fetchStatus: fxFetchStatus,
    refetch: refetchFx,
  } = useQuery<FxGainsLossesReport>({
    queryKey: [fxKey],
    queryFn: fxQueryFn,
    enabled: !!companyId,
  });

  // A pause (offline, or a retry waiting to resume) wins over an error and over empty copy.
  // A failed or held refresh leaves the last loaded data on screen, flagged as possibly out of
  // date. Empty-state copy needs a successful response and nothing in flight or on hold; after
  // a delete the cache is edited locally, so "idle" waits for the reconciling refetch.
  const ratesPaused = ratesFetchStatus === "paused";
  const ratesRefreshFailed = ratesRefetchFailed && !ratesPaused;
  const ratesRefreshPaused = ratesPaused && rates !== undefined;
  const ratesShowEmpty = ratesLoaded && ratesFetchStatus === "idle";
  const fxPaused = fxFetchStatus === "paused";
  const fxRefreshFailed = fxRefetchFailed && !fxPaused;
  const fxRefreshPaused = fxPaused && fxReport !== undefined;
  const fxShowEmpty = fxLoaded && !fxPaused;
  const fxMaybeStale = fxRefetchFailed || fxPaused;

  // History follows the same rules; it stays on the default queryFn, which forwards the signal.
  const {
    data: history,
    isLoadingError: historyLoadFailed,
    isRefetchError: historyRefetchFailed,
    isSuccess: historyLoaded,
    fetchStatus: historyFetchStatus,
    refetch: refetchHistory,
  } = useQuery<Revaluation[]>({
    queryKey: [historyKey],
    enabled: !!companyId,
  });
  const historyPaused = historyFetchStatus === "paused";
  const historyRefreshFailed = historyRefetchFailed && !historyPaused;
  const historyRefreshPaused = historyPaused && history !== undefined;
  const historyShowEmpty = historyLoaded && historyFetchStatus === "idle";

  // W5-C (R14-14): stale-rate banner and feed status.
  const { data: feedStatus } = useQuery<FeedStatus>({
    queryKey: [`/api/companies/${companyId}/exchange-rates/feed-status`],
    enabled: !!companyId,
  });

  const [rateSearch, setRateSearch] = useState("");
  const filteredRates = useMemo(() => {
    const q = rateSearch.trim().toLowerCase();
    if (!q || !rates) return rates ?? [];
    return rates.filter((r) =>
      [
        r.fromCurrency,
        r.toCurrency,
        `${r.fromCurrency}/${r.toCurrency}`,
        r.rateType,
        groupLabel(t, "rt", r.rateType),
        r.source,
        groupLabel(t, "src", r.source),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rates, rateSearch, t]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [ratesKey] });
    queryClient.invalidateQueries({ queryKey: [fxKey] });
    queryClient.invalidateQueries({ queryKey: [historyKey] });
  };

  const [mountedAt] = useState(() => Date.now());
  // The latest row per pair/type/scope decides whether a pair is stale.
  const staleIds = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    const limit = mountedAt - STALE_DAYS * 86_400_000;
    for (const r of rates ?? []) {
      const key = `${r.scope}:${r.fromCurrency}/${r.toCurrency}:${r.rateType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (new Date(r.effectiveDate).getTime() < limit) ids.add(r.id);
    }
    return ids;
  }, [rates, mountedAt]);

  const createMutation = useMutation({
    mutationFn: async (data: {
      fromCurrency: string;
      toCurrency: string;
      rate: number;
      effectiveDate: string;
      rateType: RateType;
      confirmLargeMove?: boolean;
    }) => apiRequest("POST", ratesKey, data),
    onSuccess: () => {
      invalidateAll();
      setShowAddDialog(false);
      setLargeMove(null);
      setFormRate(pegRatePrefill(formFromCurrency, formToCurrency));
      toast({ title: t["exchangeRates.added"] });
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        setLargeMove(error.message);
        return;
      }
      toast({
        title: t["exchangeRates.addFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${ratesKey}/${id}`),
    onSuccess: async (_data, id) => {
      // An in-flight refresh started before the delete would put the deleted row back, so
      // cancel the affected queries, drop the row from the cache, then refetch to reconcile.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: [ratesKey], exact: true }),
        queryClient.cancelQueries({ queryKey: [fxKey], exact: true }),
      ]);
      queryClient.setQueryData<ExchangeRate[]>([ratesKey], (old) =>
        old ? old.filter((r) => r.id !== id) : old
      );
      invalidateAll();
      toast({ title: t["exchangeRates.deleted"] });
    },
    onError: (error: Error) => {
      toast({
        title: t["exchangeRates.deleteFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        from: convertFrom,
        to: convertTo,
        amount: convertAmount,
      });
      return apiRequest("GET", `${ratesKey}/convert?${params}`);
    },
    onSuccess: (data: ConvertResult) => setConvertResult(data),
    onError: (error: Error) => {
      toast({
        title: t["exchangeRates.convertFailed"],
        description: error?.message,
        variant: "destructive",
      });
      setConvertResult(null);
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (): Promise<RevaluationPreview> =>
      apiRequest("GET", `${ratesKey}/revalue/preview?asOf=${encodeURIComponent(revalDate)}`),
    onSuccess: (data) => setPreview(data),
    onError: (error: Error) => {
      setPreview(null);
      toast({
        title: t["exchangeRates.revalFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const runMutation = useMutation({
    mutationFn: async (opts: { acknowledgeStale: boolean; rateOverrideReason?: string }) => {
      setStaleAck(opts.acknowledgeStale);
      return apiRequest("POST", `${ratesKey}/revalue`, { asOf: revalDate, ...opts });
    },
    onSuccess: (data: { posted: boolean; reason?: string; netGainLoss?: string }) => {
      setStaleConfirm(null);
      setBandConfirm(null);
      setBandReason("");
      invalidateAll();
      if (data.posted) {
        toast({ title: t["exchangeRates.posted"], description: data.netGainLoss });
        setPreview(null);
      } else {
        toast({
          title: t["exchangeRates.noop"],
          description:
            data.reason === "ALREADY_POSTED"
              ? t["exchangeRates.alreadyPosted"]
              : t["exchangeRates.nothingToPost"],
        });
      }
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.body?.code === "FX_RATE_OUTSIDE_BAND") {
        setStaleConfirm(null);
        setBandConfirm(error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setStaleConfirm(error.message);
        return;
      }
      toast({
        title: t["exchangeRates.revalFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `${historyKey}/${id}/undo`, {}),
    onSuccess: () => {
      invalidateAll();
      setPreview(null);
      toast({ title: t["exchangeRates.undone"] });
    },
    onError: (error: Error) => {
      toast({
        title: t["exchangeRates.revalFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // E1: keep the rate box on a real value for the pair (the peg for USD/AED), but never
  // overwrite a number the user typed.
  const changePair = (side: "from" | "to") => (value: string) => {
    const nextFrom = side === "from" ? value : formFromCurrency;
    const nextTo = side === "to" ? value : formToCurrency;
    const untouched =
      formRate === "" || formRate === pegRatePrefill(formFromCurrency, formToCurrency);
    if (side === "from") setFormFromCurrency(value);
    else setFormToCurrency(value);
    if (untouched) setFormRate(pegRatePrefill(nextFrom, nextTo));
  };

  const submitRate = (confirmLargeMove: boolean) => {
    const rate = parseFloat(formRate);
    if (isNaN(rate) || rate <= 0) {
      toast({ title: t["exchangeRates.invalidRate"], variant: "destructive" });
      return;
    }
    if (formFromCurrency === formToCurrency) {
      toast({ title: t["exchangeRates.sameCurrency"], variant: "destructive" });
      return;
    }
    createMutation.mutate({
      fromCurrency: formFromCurrency,
      toCurrency: formToCurrency,
      rate,
      effectiveDate: formEffectiveDate,
      rateType: formRateType,
      ...(confirmLargeMove ? { confirmLargeMove: true } : {}),
    });
  };

  const handleConvert = () => {
    const amount = parseFloat(convertAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: t["exchangeRates.invalidAmount"], variant: "destructive" });
      return;
    }
    convertMutation.mutate();
  };

  const handleExportFxReport = async () => {
    if (!fxReport || fxMaybeStale) {
      toast({
        title: t["exchangeRates.exportEmpty"],
        description: t["exchangeRates.exportEmptyDesc"],
        variant: "destructive",
      });
      return;
    }
    try {
      await exportToExcel(prepareFxGainsLossesForExport(fxReport), `fx_gains_losses_${todayIso()}`);
      toast({
        title: t["exchangeRates.exported"],
        description: t["exchangeRates.exportedDesc"],
      });
    } catch (error) {
      toast({
        title: t["exchangeRates.exportFailed"],
        description: error instanceof Error ? error.message : undefined,
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
        <p className="text-muted-foreground">
          <T k="pages.noCompanyFoundPleaseCreateACompanyFirst" />
        </p>
      </div>
    );
  }

  const base = fxReport?.baseCurrency || "AED";
  const staleHint = formatMessage(t["exchangeRates.staleHint"], { days: STALE_DAYS });
  const exposureRows = [
    ...(fxReport?.receivables ?? []),
    ...(fxReport?.payables ?? []),
    ...(fxReport?.bankAccounts ?? []),
  ];

  const currencySelect = (value: string, onChange: (v: string) => void, testId: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}>
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
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow={t["exchangeRates.eyebrow"]}
        title={t["exchangeRates.title"]}
        description={t["exchangeRates.description"]}
        backHref="/reports"
        backLabel={t["exchangeRates.backLabel"]}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExportFxReport}
              disabled={!fxReport || fxMaybeStale}
              data-testid="button-export-fx"
            >
              <Download className="h-4 w-4 me-2" />
              <T k="pages.export" />
            </Button>
            <Button
              onClick={() => setShowAddDialog(true)}
              data-testid="button-add-rate"
              {...gate("documents.write")}
            >
              <Plus className="h-4 w-4 me-2" />
              {t["exchangeRates.addRate"]}
            </Button>
          </>
        }
      />

      {feedStatus && feedStatus.stale.length > 0 && (
        <Alert
          tone="warning"
          title={t["exchangeRates.staleBannerTitle"]}
          data-testid="banner-stale-rates"
        >
          {formatMessage(t["exchangeRates.staleBannerBody"], { days: feedStatus.maxAgeDays })}{" "}
          {feedStatus.stale
            .map(
              (p) => `${p.pair} (${groupLabel(t, "rt", p.rateType)}, ${formatDate(p.date, locale)})`
            )
            .join(", ")}
        </Alert>
      )}
      {feedStatus && feedStatus.feed.capability !== "live" && (
        <SetupNotice title={t["exchangeRates.feedOffTitle"]} testId="banner-feed-off">
          {t["exchangeRates.feedOffBody"]}
        </SetupNotice>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t["exchangeRates.fxTitle"]}</CardTitle>
          <CardDescription>
            {t["exchangeRates.asOf"]}{" "}
            {fxReport?.asOf ? formatDate(fxReport.asOf, locale) : t["exchangeRates.today"]} ·{" "}
            {t["exchangeRates.fxBasis"]} {t["exchangeRates.valuesIn"]} {base}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fxReport === undefined ? (
            fxPaused ? (
              <Alert tone="neutral" title={t["exchangeRates.pausedTitle"]} data-testid="fx-paused">
                {t["exchangeRates.pausedBody"]}
              </Alert>
            ) : fxLoadFailed ? (
              <Alert
                tone="danger"
                title={t["exchangeRates.fxLoadFailedTitle"]}
                data-testid="fx-load-error"
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchFx()}>
                    {t["exchangeRates.retry"]}
                  </Button>
                }
              >
                {t["exchangeRates.fxLoadFailedBody"]}
              </Alert>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            )
          ) : (
            <div className="space-y-4">
              {fxRefreshFailed && (
                <Alert
                  tone="warning"
                  title={t["exchangeRates.fxRefreshFailedTitle"]}
                  data-testid="fx-refresh-error"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchFx()}>
                      {t["exchangeRates.retry"]}
                    </Button>
                  }
                >
                  {t["exchangeRates.fxRefreshFailedBody"]}
                </Alert>
              )}
              {fxRefreshPaused && (
                <Alert
                  tone="neutral"
                  title={t["exchangeRates.refreshPausedTitle"]}
                  data-testid="fx-refresh-paused"
                >
                  {t["exchangeRates.fxRefreshPausedBody"]}
                </Alert>
              )}
              {(fxReport?.warnings ?? []).length > 0 && (
                <Alert tone="warning" title={t["exchangeRates.warnings"]}>
                  <ul className="list-disc ps-5">
                    {fxReport?.warnings?.map((w) => (
                      <li key={w}>{localizeFxWarning(w, locale, t)}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {/* Spec 2.6: no KPI tiles or empty table while nothing is exposed. */}
              {exposureRows.length === 0 ? (
                fxShowEmpty ? (
                  <EmptyState
                    size="sm"
                    title={t["exchangeRates.noExposure"]}
                    testId="fx-exposure-empty"
                  />
                ) : null
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    <StatCard
                      label={t["exchangeRates.openExposures"]}
                      value={exposureRows.length}
                    />
                    <StatCard
                      label={t["exchangeRates.unrealizedGains"]}
                      value={<Money amount={fxReport?.totalUnrealizedGain ?? 0} currency={base} />}
                    />
                    <StatCard
                      label={t["exchangeRates.unrealizedLosses"]}
                      value={<Money amount={fxReport?.totalUnrealizedLoss ?? 0} currency={base} />}
                    />
                    <StatCard
                      label={t["exchangeRates.net"]}
                      value={
                        <Money amount={fxReport?.netUnrealizedGainLoss ?? 0} currency={base} />
                      }
                    />
                  </div>

                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t["exchangeRates.type"]}</TableHead>
                          <TableHead>
                            <T k="pages.reference" />
                          </TableHead>
                          <TableHead>
                            <T k="pages.counterparty" />
                          </TableHead>
                          <TableHead>
                            <T k="pages.currency" />
                          </TableHead>
                          <TableHead className="text-end">
                            {t["exchangeRates.foreignAmount"]}
                          </TableHead>
                          <TableHead className="text-end">
                            {t["exchangeRates.transactionRate"]}
                          </TableHead>
                          <TableHead className="text-end">
                            {t["exchangeRates.currentRate"]}
                          </TableHead>
                          <TableHead className="text-end">{t["exchangeRates.gainLoss"]}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {exposureRows.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="py-8 text-center text-muted-foreground"
                            >
                              {t["exchangeRates.noExposure"]}
                            </TableCell>
                          </TableRow>
                        ) : (
                          exposureRows.map((row) => (
                            <TableRow key={`${row.entityType}-${row.entityId}`}>
                              <TableCell>{groupLabel(t, "kind", row.entityType)}</TableCell>
                              <TableCell className="font-mono text-sm">
                                {row.entityNumber}
                              </TableCell>
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
                                {row.stale && (
                                  <Badge variant="outline" className="ms-2" title={staleHint}>
                                    {t["exchangeRates.stale"]}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-end font-mono ${
                                  row.unrealizedGainLoss >= 0 ? "text-success" : "text-destructive"
                                }`}
                              >
                                {formatCurrency(row.unrealizedGainLoss, base, locale)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Period-end revaluation */}
      <Card>
        <CardHeader>
          <CardTitle>{t["exchangeRates.reval"]}</CardTitle>
          <CardDescription>{t["exchangeRates.revalDesc"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="space-y-2">
              <Label htmlFor="reval-date">{t["exchangeRates.revalDate"]}</Label>
              <DatePicker
                id="reval-date"
                max={todayIso()}
                value={revalDate}
                onChange={(value) => {
                  setRevalDate(value);
                  setPreview(null);
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || !revalDate}
              data-testid="button-reval-preview"
            >
              <Eye className="h-4 w-4 me-2" />
              {t["exchangeRates.preview"]}
            </Button>
            <Button
              onClick={() => runMutation.mutate({ acknowledgeStale: false })}
              disabled={
                runMutation.isPending ||
                !preview ||
                preview.lines.length === 0 ||
                !!preview.alreadyPosted ||
                preview.missingRates.length > 0
              }
              data-testid="button-reval-run"
            >
              <PlayCircle className="h-4 w-4 me-2" />
              {runMutation.isPending ? t["exchangeRates.running"] : t["exchangeRates.run"]}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="font-medium">
                {t["exchangeRates.previewTitle"]} · {formatDate(preview.asOf, locale)} ·{" "}
                {t["exchangeRates.reversalOn"]} {formatDate(preview.reversalDate, locale)}
              </p>
              {preview.alreadyPosted && (
                <p className="text-sm text-muted-foreground">{t["exchangeRates.alreadyPosted"]}</p>
              )}
              {preview.missingRates.length > 0 && (
                <p className="text-sm text-destructive">
                  {t["exchangeRates.missingRates"]}:{" "}
                  {[...new Set(preview.missingRates.map((m) => m.currency))].join(", ")}
                </p>
              )}
              {preview.warnings.length > 0 && (
                <ul className="list-disc ps-5 text-sm text-muted-foreground">
                  {preview.warnings.map((w) => (
                    <li key={w}>{localizeFxWarning(w, locale, t)}</li>
                  ))}
                </ul>
              )}
              {preview.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t["exchangeRates.nothingToPost"]}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t["exchangeRates.account"]}</TableHead>
                      <TableHead className="text-end">{t["exchangeRates.debit"]}</TableHead>
                      <TableHead className="text-end">{t["exchangeRates.credit"]}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.lines.map((l) => (
                      <TableRow key={`${l.accountCode}-${l.description}`}>
                        <TableCell>
                          <span className="font-mono">{l.accountCode}</span> {l.accountName}
                        </TableCell>
                        <TableCell className="text-end font-mono">
                          {Number(l.debit) ? formatNumber(Number(l.debit), locale) : ""}
                        </TableCell>
                        <TableCell className="text-end font-mono">
                          {Number(l.credit) ? formatNumber(Number(l.credit), locale) : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium">{t["exchangeRates.net"]}</TableCell>
                      <TableCell colSpan={2} className="text-end font-mono font-medium">
                        {formatCurrency(Number(preview.netGainLoss), preview.baseCurrency, locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          <div>
            <p className="mb-2 font-medium">{t["exchangeRates.history"]}</p>
            {history === undefined ? (
              historyPaused ? (
                <Alert
                  tone="neutral"
                  title={t["exchangeRates.pausedTitle"]}
                  data-testid="history-paused"
                >
                  {t["exchangeRates.pausedBody"]}
                </Alert>
              ) : historyLoadFailed ? (
                <Alert
                  tone="danger"
                  title={t["exchangeRates.historyLoadFailedTitle"]}
                  data-testid="history-load-error"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchHistory()}>
                      {t["exchangeRates.retry"]}
                    </Button>
                  }
                >
                  {t["exchangeRates.historyLoadFailedBody"]}
                </Alert>
              ) : (
                <div className="space-y-2" data-testid="history-loading">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )
            ) : (
              <div className="space-y-3">
                {historyRefreshFailed && (
                  <Alert
                    tone="warning"
                    title={t["exchangeRates.historyRefreshFailedTitle"]}
                    data-testid="history-refresh-error"
                    action={
                      <Button size="sm" variant="outline" onClick={() => void refetchHistory()}>
                        {t["exchangeRates.retry"]}
                      </Button>
                    }
                  >
                    {t["exchangeRates.historyRefreshFailedBody"]}
                  </Alert>
                )}
                {historyRefreshPaused && (
                  <Alert
                    tone="neutral"
                    title={t["exchangeRates.refreshPausedTitle"]}
                    data-testid="history-refresh-paused"
                  >
                    {t["exchangeRates.historyRefreshPausedBody"]}
                  </Alert>
                )}
                {history.length === 0 ? (
                  historyShowEmpty && (
                    <p className="text-sm text-muted-foreground" data-testid="history-empty">
                      {t["exchangeRates.noHistory"]}
                    </p>
                  )
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t["exchangeRates.revalDate"]}</TableHead>
                        <TableHead>{t["exchangeRates.status"]}</TableHead>
                        <TableHead className="text-end">{t["exchangeRates.net"]}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{formatDate(r.asOf, locale)}</TableCell>
                          <TableCell>
                            <Badge variant={r.status === "posted" ? "default" : "outline"}>
                              {groupLabel(t, "status", r.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-end font-mono">
                            {formatCurrency(Number(r.netGainLoss), base, locale)}
                          </TableCell>
                          <TableCell className="text-end">
                            {r.status === "posted" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => undoMutation.mutate(r.id)}
                                disabled={undoMutation.isPending}
                              >
                                <Undo2 className="h-4 w-4 me-1" />
                                {t["exchangeRates.undo"]}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Currency converter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {t["exchangeRates.converterTitle"]}
          </CardTitle>
          <CardDescription>{t["exchangeRates.converterDesc"]}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>{t["exchangeRates.from"]}</Label>
              {currencySelect(convertFrom, setConvertFrom, "select-convert-from")}
            </div>
            <div className="space-y-2">
              <Label>{t["exchangeRates.to"]}</Label>
              {currencySelect(convertTo, setConvertTo, "select-convert-to")}
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.amount" />
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={t["exchangeRates.enterAmount"]}
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
              {t["exchangeRates.convert"]}
            </Button>
          </div>
          {convertResult && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-lg font-semibold">
                {formatNumber(convertResult.amount, locale)} {convertResult.from} ={" "}
                {formatNumber(convertResult.convertedAmount, locale)} {convertResult.to}
              </p>
              <p className="text-sm text-muted-foreground">
                {t["exchangeRates.rateLabel"]}: 1 {convertResult.from} ={" "}
                {convertResult.rate.toFixed(6)} {convertResult.to}
                {convertResult.effectiveDate && (
                  <>
                    {" "}
                    ({t["exchangeRates.asOfShort"]}{" "}
                    {formatDate(convertResult.effectiveDate, locale)})
                  </>
                )}
              </p>
              {convertResult.stale && convertResult.warning && (
                <p className="mt-1 flex items-center gap-2 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  {convertResult.warning}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Saved rates */}
      <Card>
        <CardHeader>
          <CardTitle>{t["exchangeRates.savedRates"]}</CardTitle>
          <CardDescription>{t["exchangeRates.savedRatesDesc"]}</CardDescription>
        </CardHeader>
        <CardContent>
          {rates === undefined ? (
            ratesPaused ? (
              <Alert
                tone="neutral"
                title={t["exchangeRates.pausedTitle"]}
                data-testid="rates-paused"
              >
                {t["exchangeRates.pausedBody"]}
              </Alert>
            ) : ratesLoadFailed ? (
              <Alert
                tone="danger"
                title={t["exchangeRates.loadFailedTitle"]}
                data-testid="rates-load-error"
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchRates()}>
                    {t["exchangeRates.retry"]}
                  </Button>
                }
              >
                {t["exchangeRates.loadFailedBody"]}
              </Alert>
            ) : (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )
          ) : (
            <div className="space-y-3">
              {ratesRefreshFailed && (
                <Alert
                  tone="warning"
                  title={t["exchangeRates.refreshFailedTitle"]}
                  data-testid="rates-refresh-error"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchRates()}>
                      {t["exchangeRates.retry"]}
                    </Button>
                  }
                >
                  {t["exchangeRates.refreshFailedBody"]}
                </Alert>
              )}
              {ratesRefreshPaused && (
                <Alert
                  tone="neutral"
                  title={t["exchangeRates.refreshPausedTitle"]}
                  data-testid="rates-refresh-paused"
                >
                  {t["exchangeRates.refreshPausedBody"]}
                </Alert>
              )}
              {rates.length === 0 ? (
                ratesShowEmpty && (
                  <div className="text-center py-8 text-muted-foreground" data-testid="rates-empty">
                    <ArrowRightLeft className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p>{t["exchangeRates.noRates"]}</p>
                    <p className="text-sm">{t["exchangeRates.noRatesHint"]}</p>
                  </div>
                )
              ) : (
                <>
                  <Input
                    type="search"
                    value={rateSearch}
                    onChange={(e) => setRateSearch(e.target.value)}
                    placeholder={t["exchangeRates.searchPlaceholder"]}
                    aria-label={t["exchangeRates.searchLabel"]}
                    data-testid="input-rate-search"
                    className="max-w-sm"
                  />
                  {filteredRates.length === 0 ? (
                    <div
                      className="py-8 text-center text-muted-foreground"
                      data-testid="rates-no-match"
                    >
                      <p>{t["exchangeRates.noMatch"]}</p>
                      <Button variant="link" size="sm" onClick={() => setRateSearch("")}>
                        {t["exchangeRates.clearSearch"]}
                      </Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t["exchangeRates.from"]}</TableHead>
                            <TableHead>{t["exchangeRates.to"]}</TableHead>
                            <TableHead className="text-end">
                              {t["exchangeRates.rateLabel"]}
                            </TableHead>
                            <TableHead>{t["exchangeRates.rateType"]}</TableHead>
                            <TableHead>
                              <T k="pages.effectiveDate" />
                            </TableHead>
                            <TableHead>{t["exchangeRates.scope"]}</TableHead>
                            <TableHead>
                              <T k="pages.source" />
                            </TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRates.map((rate) => (
                            <TableRow key={rate.id}>
                              <TableCell className="font-medium">{rate.fromCurrency}</TableCell>
                              <TableCell className="font-medium">{rate.toCurrency}</TableCell>
                              <TableCell className="text-end font-mono">
                                {Number(rate.rate).toFixed(6)}
                              </TableCell>
                              <TableCell>{groupLabel(t, "rt", rate.rateType)}</TableCell>
                              <TableCell>
                                {formatDate(rate.effectiveDate, locale)}
                                {staleIds.has(rate.id) && (
                                  <Badge variant="outline" className="ms-2" title={staleHint}>
                                    {t["exchangeRates.stale"]}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={rate.scope === "company" ? "secondary" : "outline"}>
                                  {rate.scope === "company"
                                    ? t["exchangeRates.scopeCompany"]
                                    : t["exchangeRates.scopeSystem"]}
                                </Badge>
                                {rate.legacyInverted && (
                                  <Badge
                                    variant="outline"
                                    className="ms-2"
                                    title={t["exchangeRates.rewrittenHint"]}
                                  >
                                    {t["exchangeRates.rewritten"]}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{groupLabel(t, "src", rate.source)}</TableCell>
                              <TableCell className="text-end">
                                {rate.scope === "company" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t["exchangeRates.delete"]}
                                    onClick={() => deleteMutation.mutate(rate.id)}
                                    disabled={deleteMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add rate dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) setLargeMove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t["exchangeRates.addTitle"]}</DialogTitle>
            <DialogDescription>{t["exchangeRates.addDesc"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["exchangeRates.fromCurrency"]}</Label>
                {currencySelect(formFromCurrency, changePair("from"), "select-rate-from")}
              </div>
              <div className="space-y-2">
                <Label>{t["exchangeRates.toCurrency"]}</Label>
                {currencySelect(formToCurrency, changePair("to"), "select-rate-to")}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["exchangeRates.rateLabel"]}</Label>
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="3.6725"
                  value={formRate}
                  onChange={(e) => {
                    setFormRate(e.target.value);
                    setLargeMove(null);
                  }}
                  data-testid="input-rate"
                />
                <p className="text-xs text-muted-foreground">
                  {formatMessage(t["exchangeRates.rateHelp"], {
                    from: formFromCurrency,
                    to: formToCurrency,
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t["exchangeRates.rateType"]}</Label>
                <Select value={formRateType} onValueChange={(v) => setFormRateType(v as RateType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATE_TYPES.map((rt) => (
                      <SelectItem key={rt} value={rt}>
                        {groupLabel(t, "rt", rt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.effectiveDate" />
              </Label>
              <DatePicker
                max={todayIso()}
                value={formEffectiveDate}
                onChange={(value) => setFormEffectiveDate(value)}
              />
            </div>
            {largeMove && (
              <Alert tone="warning" title={t["exchangeRates.largeMoveTitle"]}>
                {largeMove}
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              {t["exchangeRates.cancel"]}
            </Button>
            {largeMove ? (
              <Button onClick={() => submitRate(true)} disabled={createMutation.isPending}>
                {t["exchangeRates.largeMoveConfirm"]}
              </Button>
            ) : (
              <Button onClick={() => submitRate(false)} disabled={createMutation.isPending}>
                {createMutation.isPending ? t["exchangeRates.adding"] : t["exchangeRates.addRate"]}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stale-rate confirmation for the revaluation run */}
      <Dialog open={!!staleConfirm} onOpenChange={(open) => !open && setStaleConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t["exchangeRates.staleConfirmTitle"]}</DialogTitle>
            <DialogDescription>{staleConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaleConfirm(null)}>
              {t["exchangeRates.cancel"]}
            </Button>
            <Button
              onClick={() => runMutation.mutate({ acknowledgeStale: true })}
              disabled={runMutation.isPending}
            >
              {t["exchangeRates.staleConfirm"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* D2 (N9): a rate outside the sanity band needs a reason */}
      <Dialog open={!!bandConfirm} onOpenChange={(open) => !open && setBandConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t["exchangeRates.bandTitle"]}</DialogTitle>
            <DialogDescription>{bandConfirm}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reval-band-reason">{t["exchangeRates.bandReason"]}</Label>
            <Input
              id="reval-band-reason"
              value={bandReason}
              onChange={(e) => setBandReason(e.target.value)}
              data-testid="input-reval-band-reason"
            />
            <p className="text-sm text-muted-foreground">{t["exchangeRates.bandReasonHint"]}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBandConfirm(null)}>
              {t["exchangeRates.cancel"]}
            </Button>
            <Button
              onClick={() =>
                runMutation.mutate({ acknowledgeStale: staleAck, rateOverrideReason: bandReason })
              }
              disabled={runMutation.isPending || bandReason.trim().length < 5}
              data-testid="button-reval-band-confirm"
            >
              {t["exchangeRates.bandConfirm"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
