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
import { useTranslation } from "@/lib/i18n";
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

const STRINGS = {
  en: {
    eyebrow: "Accounting",
    title: "Exchange rates",
    description: "Your company's exchange rates, currency conversion and period-end FX revaluation",
    backLabel: "Back to reports",
    addRate: "Add rate",
    adding: "Adding...",
    fxTitle: "FX Gains and Losses",
    fxBasis:
      "Outstanding balances of posted foreign-currency invoices, vendor bills and linked bank accounts, remeasured at the closing rate (spot when no closing rate exists). Drafts are excluded.",
    asOf: "As of",
    today: "today",
    valuesIn: "Values in",
    openExposures: "Open exposures",
    unrealizedGains: "Unrealised gains",
    unrealizedLosses: "Unrealised losses",
    net: "Net gain / loss",
    type: "Type",
    foreignAmount: "Foreign amount",
    transactionRate: "Booked rate",
    currentRate: "Current rate",
    gainLoss: "Gain / loss",
    noExposure: "No open foreign-currency exposures for the selected as-of date.",
    kinds: {
      invoice: "Invoice",
      bill: "Bill",
      bank: "Bank account" /* i18n-ignore: English half of the bilingual s object, Arabic below */,
    } as Record<string, string>,
    converterTitle: "Currency converter",
    converterDesc: "Convert amounts using your company's rates (system rates as fallback)",
    from: "From",
    to: "To",
    enterAmount: "Enter amount",
    convert: "Convert",
    rateLabel: "Rate",
    asOfShort: "as of",
    savedRates: "Saved rates",
    savedRatesDesc:
      "Company rates apply only to this company. System rates are platform reference rates (for example FTA-published) used when the company has none.",
    noRates: "No exchange rates configured yet.",
    noRatesHint: "Add your first rate to get started.",
    rateType: "Rate type",
    scope: "Scope",
    scopeCompany: "Company",
    scopeSystem: "System",
    stale: "Stale",
    staleHint: `Older than ${STALE_DAYS} days`,
    staleBannerTitle: "Some exchange rates are out of date",
    staleBannerBody:
      "These pairs have no rate in the last {days} days. Documents and revaluations will warn until a newer rate is added:",
    feedOffTitle: "Rates are entered manually",
    feedOffBody: "AED to USD uses the fixed peg. Add rates for other currencies here.",
    rewritten: "Corrected",
    rewrittenHint: "Stored inverted by an earlier version; corrected by migration",
    rateTypes: { spot: "Spot", closing: "Closing", average: "Average" } as Record<RateType, string>,
    delete: "Delete",
    addTitle: "Add exchange rate",
    addDesc: "Rates are stored as units of your base currency per 1 unit of the foreign currency.",
    fromCurrency: "From currency",
    toCurrency: "To currency",
    rateHelp: (from: string, to: string) => `1 ${from} = ? ${to}`,
    cancel: "Cancel",
    added: "Exchange rate saved",
    addFailed: "Failed to add rate",
    deleted: "Exchange rate deleted",
    invalidRate: "Please enter a valid rate",
    sameCurrency: "Currencies must be different",
    invalidAmount: "Please enter a valid amount",
    convertFailed: "Conversion failed",
    largeMoveTitle: "Large rate change",
    largeMoveConfirm: "Save anyway",
    reval: "Period-end revaluation",
    revalDesc:
      "Posts one balanced unrealised FX entry dated the as-of date and an automatic reversal dated the next day. Running the same date twice does nothing.",
    revalDate: "Revaluation date",
    preview: "Preview",
    run: "Run revaluation",
    running: "Posting...",
    previewTitle: "Revaluation preview",
    account: "Account",
    debit: "Debit",
    credit: "Credit",
    nothingToPost: "Nothing to revalue on this date.",
    alreadyPosted: "A revaluation is already posted for this date.",
    reversalOn: "Automatic reversal on",
    warnings: "Warnings",
    missingRates: "Missing rates",
    staleConfirmTitle: "Some rates are stale",
    staleConfirm: "Post with these rates",
    bandTitle: "A rate is far from the reference rate",
    bandReason: "Why is this rate right?",
    bandReasonHint:
      "Owner, admin, accountant or CFO only. The reason is kept with the revaluation and in the audit log.",
    bandConfirm: "Post with this rate",
    posted: "Revaluation posted",
    noop: "Nothing posted",
    revalFailed: "Revaluation failed",
    history: "Revaluation history",
    noHistory: "No revaluations yet.",
    status: "Status",
    statuses: { posted: "Posted", undone: "Undone", pending: "Pending" } as Record<string, string>,
    undo: "Undo",
    undone: "Revaluation undone",
    exportEmpty: "No report data",
    exportEmptyDesc: "FX Gains and Losses is still loading or has no rows to export.",
    exported: "Report exported",
    exportedDesc: "FX Gains and Losses has been downloaded.",
    exportFailed: "Export failed",
  },
  ar: {
    eyebrow: "المحاسبة",
    title: "أسعار الصرف",
    description: "أسعار صرف شركتك وتحويل العملات وإعادة تقييم العملات الأجنبية في نهاية الفترة",
    backLabel: "العودة إلى التقارير",
    addRate: "إضافة سعر",
    adding: "جارٍ الإضافة...",
    fxTitle: "أرباح وخسائر الصرف",
    fxBasis:
      "الأرصدة القائمة للفواتير وفواتير الموردين المرحّلة بالعملات الأجنبية والحسابات البنكية المرتبطة، مُعاد قياسها بسعر الإقفال (أو السعر الفوري عند عدم توفره). المسودات مستبعدة.",
    asOf: "كما في",
    today: "اليوم",
    valuesIn: "القيم بعملة",
    openExposures: "التعرضات القائمة",
    unrealizedGains: "أرباح غير محققة",
    unrealizedLosses: "خسائر غير محققة",
    net: "صافي الربح / الخسارة",
    type: "النوع",
    foreignAmount: "المبلغ بالعملة الأجنبية",
    transactionRate: "سعر القيد",
    currentRate: "السعر الحالي",
    gainLoss: "الربح / الخسارة",
    noExposure: "لا توجد تعرضات قائمة بالعملات الأجنبية في التاريخ المحدد.",
    kinds: { invoice: "فاتورة", bill: "فاتورة مورد", bank: "حساب بنكي" } as Record<string, string>,
    converterTitle: "محول العملات",
    converterDesc: "حوّل المبالغ باستخدام أسعار شركتك (وأسعار النظام كبديل)",
    from: "من",
    to: "إلى",
    enterAmount: "أدخل المبلغ",
    convert: "تحويل",
    rateLabel: "السعر",
    asOfShort: "بتاريخ",
    savedRates: "الأسعار المحفوظة",
    savedRatesDesc:
      "أسعار الشركة تخص هذه الشركة فقط. أسعار النظام أسعار مرجعية للمنصة (مثل أسعار الهيئة الاتحادية للضرائب) تُستخدم عند عدم وجود سعر للشركة.",
    noRates: "لم تتم إضافة أي أسعار صرف بعد.",
    noRatesHint: "أضف أول سعر للبدء.",
    rateType: "نوع السعر",
    scope: "النطاق",
    scopeCompany: "الشركة",
    scopeSystem: "النظام",
    stale: "قديم",
    staleHint: `أقدم من ${STALE_DAYS} أيام`,
    staleBannerTitle: "بعض أسعار الصرف قديمة",
    staleBannerBody:
      "لا يوجد سعر لهذه الأزواج خلال آخر {days} يوماً. ستظهر تنبيهات في المستندات وإعادة التقييم حتى تتم إضافة سعر أحدث:",
    feedOffTitle: "تُدخل الأسعار يدويًا",
    feedOffBody:
      "يستخدم سعر الدرهم مقابل الدولار الأمريكي سعر الربط الثابت. أضف أسعار العملات الأخرى هنا.",
    rewritten: "مُصحَّح",
    rewrittenHint: "خُزّن معكوساً في إصدار سابق وصُحّح أثناء الترحيل",
    rateTypes: { spot: "فوري", closing: "إقفال", average: "متوسط" } as Record<RateType, string>,
    delete: "حذف",
    addTitle: "إضافة سعر صرف",
    addDesc: "تُخزّن الأسعار كعدد وحدات عملتك الأساسية مقابل وحدة واحدة من العملة الأجنبية.",
    fromCurrency: "العملة المصدر",
    toCurrency: "العملة الهدف",
    rateHelp: (from: string, to: string) => `1 ${from} = ؟ ${to}`,
    cancel: "إلغاء",
    added: "تم حفظ سعر الصرف",
    addFailed: "تعذرت إضافة السعر",
    deleted: "تم حذف سعر الصرف",
    invalidRate: "يرجى إدخال سعر صحيح",
    sameCurrency: "يجب أن تكون العملتان مختلفتين",
    invalidAmount: "يرجى إدخال مبلغ صحيح",
    convertFailed: "فشل التحويل",
    largeMoveTitle: "تغيّر كبير في السعر",
    largeMoveConfirm: "حفظ على أي حال",
    reval: "إعادة التقييم في نهاية الفترة",
    revalDesc:
      "يرحّل قيداً متوازناً واحداً لفروقات الصرف غير المحققة بتاريخ التقييم وقيداً عكسياً تلقائياً في اليوم التالي. تكرار التشغيل لنفس التاريخ لا يُحدث أي أثر.",
    revalDate: "تاريخ إعادة التقييم",
    preview: "معاينة",
    run: "تشغيل إعادة التقييم",
    running: "جارٍ الترحيل...",
    previewTitle: "معاينة إعادة التقييم",
    account: "الحساب",
    debit: "مدين",
    credit: "دائن",
    nothingToPost: "لا يوجد ما يُعاد تقييمه في هذا التاريخ.",
    alreadyPosted: "تم ترحيل إعادة تقييم لهذا التاريخ مسبقاً.",
    reversalOn: "القيد العكسي التلقائي بتاريخ",
    warnings: "تنبيهات",
    missingRates: "أسعار مفقودة",
    staleConfirmTitle: "بعض الأسعار قديمة",
    staleConfirm: "الترحيل بهذه الأسعار",
    bandTitle: "سعر بعيد عن السعر المرجعي",
    bandReason: "لماذا هذا السعر صحيح؟",
    bandReasonHint:
      "للمالك أو المدير أو المحاسب أو المدير المالي فقط. يُحفظ السبب مع إعادة التقييم وفي سجل التدقيق.",
    bandConfirm: "الترحيل بهذا السعر",
    posted: "تم ترحيل إعادة التقييم",
    noop: "لم يتم ترحيل شيء",
    revalFailed: "فشلت إعادة التقييم",
    history: "سجل إعادة التقييم",
    noHistory: "لا توجد عمليات إعادة تقييم بعد.",
    status: "الحالة",
    statuses: { posted: "مرحّل", undone: "ملغى", pending: "قيد التنفيذ" } as Record<string, string>,
    undo: "تراجع",
    undone: "تم التراجع عن إعادة التقييم",
    exportEmpty: "لا توجد بيانات للتقرير",
    exportEmptyDesc: "تقرير أرباح وخسائر الصرف قيد التحميل أو لا يحتوي على صفوف للتصدير.",
    exported: "تم تصدير التقرير",
    exportedDesc: "تم تنزيل تقرير أرباح وخسائر الصرف.",
    exportFailed: "فشل التصدير",
  },
};

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

/** G8: rate source as a label, never the raw value. */
const SOURCE_LABELS: Record<string, { en: string; ar: string }> = {
  manual: { en: "Manual", ar: "يدوي" },
  cbuae: { en: "Central Bank", ar: "المصرف المركزي" },
  identity: { en: "Fixed", ar: "ثابت" },
  peg: { en: "Fixed peg", ar: "الربط الثابت" },
  import: { en: "Imported", ar: "مستورد" },
  system: { en: "System", ar: "النظام" },
};

function sourceLabel(source: string | null | undefined, locale: string): string {
  const key = (source ?? "").toLowerCase();
  const label = SOURCE_LABELS[key];
  if (!label) return source ?? "";
  return locale === "ar" ? label.ar : label.en;
}

/**
 * G9: the FX service words its warnings in English. Known shapes are re-worded in Arabic here
 * (pairs and dates stay as they are); anything else is shown unchanged.
 */
function localizeFxWarning(warning: string, locale: string): string {
  if (locale !== "ar") return warning;
  const fallback = /^No (\w+) rate for ([A-Z]{3})\/([A-Z]{3}); the spot rate was used\.$/.exec(
    warning
  );
  if (fallback) {
    const kind = { closing: "إقفال", average: "متوسط" }[fallback[1]] ?? fallback[1];
    return `لا يوجد سعر ${kind} للزوج ${fallback[2]}/${fallback[3]}؛ استُخدم السعر الفوري.`;
  }
  const missing = /^No ([A-Z]{3})→([A-Z]{3}) exchange rate on or before (\S+)$/.exec(warning);
  if (missing) {
    return `لا يوجد سعر صرف ${missing[1]}→${missing[2]} في ${missing[3]} أو قبله`;
  }
  const stale =
    /^Rate ([A-Z]{3})\/([A-Z]{3}) is (\d+) days old \(dated (\S+)\); the proximity limit is (\d+) days\.$/.exec(
      warning
    );
  if (stale) {
    return `عمر سعر ${stale[1]}/${stale[2]} ${stale[3]} يومًا (بتاريخ ${stale[4]})؛ الحد المسموح ${stale[5]} يومًا.`;
  }
  return warning;
}

export default function ExchangeRates() {
  const { locale, t } = useTranslation();
  const s = locale === "ar" ? STRINGS.ar : STRINGS.en;
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

  const { data: history } = useQuery<Revaluation[]>({
    queryKey: [historyKey],
    enabled: !!companyId,
  });

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
        s.rateTypes[r.rateType],
        r.source,
        sourceLabel(r.source, locale),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rates, rateSearch, s, locale]);

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
      toast({ title: s.added });
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 409) {
        setLargeMove(error.message);
        return;
      }
      toast({ title: s.addFailed, description: error?.message, variant: "destructive" });
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
      toast({ title: s.deleted });
    },
    onError: (error: Error) => {
      toast({
        title: t["pages.exchangeRatesDeleteFailed"],
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
      toast({ title: s.convertFailed, description: error?.message, variant: "destructive" });
      setConvertResult(null);
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (): Promise<RevaluationPreview> =>
      apiRequest("GET", `${ratesKey}/revalue/preview?asOf=${encodeURIComponent(revalDate)}`),
    onSuccess: (data) => setPreview(data),
    onError: (error: Error) => {
      setPreview(null);
      toast({ title: s.revalFailed, description: error?.message, variant: "destructive" });
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
        toast({ title: s.posted, description: data.netGainLoss });
        setPreview(null);
      } else {
        toast({
          title: s.noop,
          description: data.reason === "ALREADY_POSTED" ? s.alreadyPosted : s.nothingToPost,
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
      toast({ title: s.revalFailed, description: error?.message, variant: "destructive" });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `${historyKey}/${id}/undo`, {}),
    onSuccess: () => {
      invalidateAll();
      setPreview(null);
      toast({ title: s.undone });
    },
    onError: (error: Error) => {
      toast({ title: s.revalFailed, description: error?.message, variant: "destructive" });
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
      toast({ title: s.invalidRate, variant: "destructive" });
      return;
    }
    if (formFromCurrency === formToCurrency) {
      toast({ title: s.sameCurrency, variant: "destructive" });
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
      toast({ title: s.invalidAmount, variant: "destructive" });
      return;
    }
    convertMutation.mutate();
  };

  const handleExportFxReport = async () => {
    if (!fxReport || fxMaybeStale) {
      toast({ title: s.exportEmpty, description: s.exportEmptyDesc, variant: "destructive" });
      return;
    }
    try {
      await exportToExcel(prepareFxGainsLossesForExport(fxReport), `fx_gains_losses_${todayIso()}`);
      toast({ title: s.exported, description: s.exportedDesc });
    } catch (error) {
      toast({
        title: s.exportFailed,
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
        eyebrow={s.eyebrow}
        title={s.title}
        description={s.description}
        backHref="/reports"
        backLabel={s.backLabel}
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
              {s.addRate}
            </Button>
          </>
        }
      />

      {feedStatus && feedStatus.stale.length > 0 && (
        <Alert tone="warning" title={s.staleBannerTitle} data-testid="banner-stale-rates">
          {s.staleBannerBody.replace("{days}", String(feedStatus.maxAgeDays))}{" "}
          {feedStatus.stale
            .map(
              (p) =>
                `${p.pair} (${s.rateTypes[p.rateType as RateType] ?? p.rateType}, ${formatDate(p.date, locale)})`
            )
            .join(", ")}
        </Alert>
      )}
      {feedStatus && feedStatus.feed.capability !== "live" && (
        <SetupNotice title={s.feedOffTitle} testId="banner-feed-off">
          {s.feedOffBody}
        </SetupNotice>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{s.fxTitle}</CardTitle>
          <CardDescription>
            {s.asOf} {fxReport?.asOf ? formatDate(fxReport.asOf, locale) : s.today} · {s.fxBasis}{" "}
            {s.valuesIn} {base}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fxReport === undefined ? (
            fxPaused ? (
              <Alert
                tone="neutral"
                title={t["pages.exchangeRatesPausedTitle"]}
                data-testid="fx-paused"
              >
                {t["pages.exchangeRatesPausedBody"]}
              </Alert>
            ) : fxLoadFailed ? (
              <Alert
                tone="danger"
                title={t["pages.exchangeRatesFxLoadFailedTitle"]}
                data-testid="fx-load-error"
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchFx()}>
                    {t["pages.exchangeRatesRetry"]}
                  </Button>
                }
              >
                {t["pages.exchangeRatesFxLoadFailedBody"]}
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
                  title={t["pages.exchangeRatesFxRefreshFailedTitle"]}
                  data-testid="fx-refresh-error"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchFx()}>
                      {t["pages.exchangeRatesRetry"]}
                    </Button>
                  }
                >
                  {t["pages.exchangeRatesFxRefreshFailedBody"]}
                </Alert>
              )}
              {fxRefreshPaused && (
                <Alert
                  tone="neutral"
                  title={t["pages.exchangeRatesRefreshPausedTitle"]}
                  data-testid="fx-refresh-paused"
                >
                  {t["pages.exchangeRatesFxRefreshPausedBody"]}
                </Alert>
              )}
              {(fxReport?.warnings ?? []).length > 0 && (
                <Alert tone="warning" title={s.warnings}>
                  <ul className="list-disc ps-5">
                    {fxReport?.warnings?.map((w) => (
                      <li key={w}>{localizeFxWarning(w, locale)}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {/* Spec 2.6: no KPI tiles or empty table while nothing is exposed. */}
              {exposureRows.length === 0 ? (
                fxShowEmpty ? (
                  <EmptyState size="sm" title={s.noExposure} testId="fx-exposure-empty" />
                ) : null
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    <StatCard label={s.openExposures} value={exposureRows.length} />
                    <StatCard
                      label={s.unrealizedGains}
                      value={<Money amount={fxReport?.totalUnrealizedGain ?? 0} currency={base} />}
                    />
                    <StatCard
                      label={s.unrealizedLosses}
                      value={<Money amount={fxReport?.totalUnrealizedLoss ?? 0} currency={base} />}
                    />
                    <StatCard
                      label={s.net}
                      value={
                        <Money amount={fxReport?.netUnrealizedGainLoss ?? 0} currency={base} />
                      }
                    />
                  </div>

                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{s.type}</TableHead>
                          <TableHead>
                            <T k="pages.reference" />
                          </TableHead>
                          <TableHead>
                            <T k="pages.counterparty" />
                          </TableHead>
                          <TableHead>
                            <T k="pages.currency" />
                          </TableHead>
                          <TableHead className="text-end">{s.foreignAmount}</TableHead>
                          <TableHead className="text-end">{s.transactionRate}</TableHead>
                          <TableHead className="text-end">{s.currentRate}</TableHead>
                          <TableHead className="text-end">{s.gainLoss}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {exposureRows.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="py-8 text-center text-muted-foreground"
                            >
                              {s.noExposure}
                            </TableCell>
                          </TableRow>
                        ) : (
                          exposureRows.map((row) => (
                            <TableRow key={`${row.entityType}-${row.entityId}`}>
                              <TableCell>{s.kinds[row.entityType] ?? row.entityType}</TableCell>
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
                                  <Badge variant="outline" className="ms-2" title={s.staleHint}>
                                    {s.stale}
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
          <CardTitle>{s.reval}</CardTitle>
          <CardDescription>{s.revalDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="space-y-2">
              <Label htmlFor="reval-date">{s.revalDate}</Label>
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
              {s.preview}
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
              {runMutation.isPending ? s.running : s.run}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="font-medium">
                {s.previewTitle} · {formatDate(preview.asOf, locale)} · {s.reversalOn}{" "}
                {formatDate(preview.reversalDate, locale)}
              </p>
              {preview.alreadyPosted && (
                <p className="text-sm text-muted-foreground">{s.alreadyPosted}</p>
              )}
              {preview.missingRates.length > 0 && (
                <p className="text-sm text-destructive">
                  {s.missingRates}:{" "}
                  {[...new Set(preview.missingRates.map((m) => m.currency))].join(", ")}
                </p>
              )}
              {preview.warnings.length > 0 && (
                <ul className="list-disc ps-5 text-sm text-muted-foreground">
                  {preview.warnings.map((w) => (
                    <li key={w}>{localizeFxWarning(w, locale)}</li>
                  ))}
                </ul>
              )}
              {preview.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{s.nothingToPost}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{s.account}</TableHead>
                      <TableHead className="text-end">{s.debit}</TableHead>
                      <TableHead className="text-end">{s.credit}</TableHead>
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
                      <TableCell className="font-medium">{s.net}</TableCell>
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
            <p className="mb-2 font-medium">{s.history}</p>
            {!history || history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{s.noHistory}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{s.revalDate}</TableHead>
                    <TableHead>{s.status}</TableHead>
                    <TableHead className="text-end">{s.net}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{formatDate(r.asOf, locale)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "posted" ? "default" : "outline"}>
                          {s.statuses[r.status] ?? r.status}
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
                            {s.undo}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Currency converter */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            {s.converterTitle}
          </CardTitle>
          <CardDescription>{s.converterDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>{s.from}</Label>
              {currencySelect(convertFrom, setConvertFrom, "select-convert-from")}
            </div>
            <div className="space-y-2">
              <Label>{s.to}</Label>
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
                placeholder={s.enterAmount}
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
              {s.convert}
            </Button>
          </div>
          {convertResult && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-lg font-semibold">
                {formatNumber(convertResult.amount, locale)} {convertResult.from} ={" "}
                {formatNumber(convertResult.convertedAmount, locale)} {convertResult.to}
              </p>
              <p className="text-sm text-muted-foreground">
                {s.rateLabel}: 1 {convertResult.from} = {convertResult.rate.toFixed(6)}{" "}
                {convertResult.to}
                {convertResult.effectiveDate && (
                  <>
                    {" "}
                    ({s.asOfShort} {formatDate(convertResult.effectiveDate, locale)})
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
          <CardTitle>{s.savedRates}</CardTitle>
          <CardDescription>{s.savedRatesDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          {rates === undefined ? (
            ratesPaused ? (
              <Alert
                tone="neutral"
                title={t["pages.exchangeRatesPausedTitle"]}
                data-testid="rates-paused"
              >
                {t["pages.exchangeRatesPausedBody"]}
              </Alert>
            ) : ratesLoadFailed ? (
              <Alert
                tone="danger"
                title={t["pages.exchangeRatesLoadFailedTitle"]}
                data-testid="rates-load-error"
                action={
                  <Button size="sm" variant="outline" onClick={() => void refetchRates()}>
                    {t["pages.exchangeRatesRetry"]}
                  </Button>
                }
              >
                {t["pages.exchangeRatesLoadFailedBody"]}
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
                  title={t["pages.exchangeRatesRefreshFailedTitle"]}
                  data-testid="rates-refresh-error"
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetchRates()}>
                      {t["pages.exchangeRatesRetry"]}
                    </Button>
                  }
                >
                  {t["pages.exchangeRatesRefreshFailedBody"]}
                </Alert>
              )}
              {ratesRefreshPaused && (
                <Alert
                  tone="neutral"
                  title={t["pages.exchangeRatesRefreshPausedTitle"]}
                  data-testid="rates-refresh-paused"
                >
                  {t["pages.exchangeRatesRefreshPausedBody"]}
                </Alert>
              )}
              {rates.length === 0 ? (
                ratesShowEmpty && (
                  <div className="text-center py-8 text-muted-foreground" data-testid="rates-empty">
                    <ArrowRightLeft className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p>{s.noRates}</p>
                    <p className="text-sm">{s.noRatesHint}</p>
                  </div>
                )
              ) : (
                <>
                  <Input
                    type="search"
                    value={rateSearch}
                    onChange={(e) => setRateSearch(e.target.value)}
                    placeholder={t["pages.exchangeRatesSearchPlaceholder"]}
                    aria-label={t["pages.exchangeRatesSearchLabel"]}
                    data-testid="input-rate-search"
                    className="max-w-sm"
                  />
                  {filteredRates.length === 0 ? (
                    <div
                      className="py-8 text-center text-muted-foreground"
                      data-testid="rates-no-match"
                    >
                      <p>{t["pages.exchangeRatesNoMatch"]}</p>
                      <Button variant="link" size="sm" onClick={() => setRateSearch("")}>
                        {t["pages.exchangeRatesClearSearch"]}
                      </Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{s.from}</TableHead>
                            <TableHead>{s.to}</TableHead>
                            <TableHead className="text-end">{s.rateLabel}</TableHead>
                            <TableHead>{s.rateType}</TableHead>
                            <TableHead>
                              <T k="pages.effectiveDate" />
                            </TableHead>
                            <TableHead>{s.scope}</TableHead>
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
                              <TableCell>{s.rateTypes[rate.rateType] ?? rate.rateType}</TableCell>
                              <TableCell>
                                {formatDate(rate.effectiveDate, locale)}
                                {staleIds.has(rate.id) && (
                                  <Badge variant="outline" className="ms-2" title={s.staleHint}>
                                    {s.stale}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={rate.scope === "company" ? "secondary" : "outline"}>
                                  {rate.scope === "company" ? s.scopeCompany : s.scopeSystem}
                                </Badge>
                                {rate.legacyInverted && (
                                  <Badge variant="outline" className="ms-2" title={s.rewrittenHint}>
                                    {s.rewritten}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{sourceLabel(rate.source, locale)}</TableCell>
                              <TableCell className="text-end">
                                {rate.scope === "company" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={s.delete}
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
            <DialogTitle>{s.addTitle}</DialogTitle>
            <DialogDescription>{s.addDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{s.fromCurrency}</Label>
                {currencySelect(formFromCurrency, changePair("from"), "select-rate-from")}
              </div>
              <div className="space-y-2">
                <Label>{s.toCurrency}</Label>
                {currencySelect(formToCurrency, changePair("to"), "select-rate-to")}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{s.rateLabel}</Label>
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
                  {s.rateHelp(formFromCurrency, formToCurrency)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{s.rateType}</Label>
                <Select value={formRateType} onValueChange={(v) => setFormRateType(v as RateType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATE_TYPES.map((rt) => (
                      <SelectItem key={rt} value={rt}>
                        {s.rateTypes[rt]}
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
              <Alert tone="warning" title={s.largeMoveTitle}>
                {largeMove}
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              {s.cancel}
            </Button>
            {largeMove ? (
              <Button onClick={() => submitRate(true)} disabled={createMutation.isPending}>
                {s.largeMoveConfirm}
              </Button>
            ) : (
              <Button onClick={() => submitRate(false)} disabled={createMutation.isPending}>
                {createMutation.isPending ? s.adding : s.addRate}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stale-rate confirmation for the revaluation run */}
      <Dialog open={!!staleConfirm} onOpenChange={(open) => !open && setStaleConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.staleConfirmTitle}</DialogTitle>
            <DialogDescription>{staleConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaleConfirm(null)}>
              {s.cancel}
            </Button>
            <Button
              onClick={() => runMutation.mutate({ acknowledgeStale: true })}
              disabled={runMutation.isPending}
            >
              {s.staleConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* D2 (N9): a rate outside the sanity band needs a reason */}
      <Dialog open={!!bandConfirm} onOpenChange={(open) => !open && setBandConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.bandTitle}</DialogTitle>
            <DialogDescription>{bandConfirm}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reval-band-reason">{s.bandReason}</Label>
            <Input
              id="reval-band-reason"
              value={bandReason}
              onChange={(e) => setBandReason(e.target.value)}
              data-testid="input-reval-band-reason"
            />
            <p className="text-sm text-muted-foreground">{s.bandReasonHint}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBandConfirm(null)}>
              {s.cancel}
            </Button>
            <Button
              onClick={() =>
                runMutation.mutate({ acknowledgeStale: staleAck, rateOverrideReason: bandReason })
              }
              disabled={runMutation.isPending || bandReason.trim().length < 5}
              data-testid="button-reval-band-confirm"
            >
              {s.bandConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
