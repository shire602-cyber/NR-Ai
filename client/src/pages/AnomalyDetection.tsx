import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation, translateNow } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Money } from "@/components/ui/money";
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  Scan,
  X,
  RefreshCw,
  Clock,
  DollarSign,
  Copy,
  CalendarOff,
  Hash,
  UserX,
  TrendingUp,
} from "lucide-react";

type AnomalySeverity = "critical" | "warning" | "info";
type RawAnomalySeverity = AnomalySeverity | "low" | "medium" | "high" | string;

interface Anomaly {
  id: string;
  type: string;
  severity: RawAnomalySeverity;
  description: string;
  rule?: string | null;
  amount?: number | null;
  date?: string | null;
  relatedId?: string | null;
  relatedType?: string | null;
}

interface AnomalySummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

interface AnomalyResult {
  anomalies: Anomaly[];
  summary: AnomalySummary;
  scannedAt: string | null;
  newAlerts?: number;
}

const severityConfig: Record<
  AnomalySeverity,
  { color: string; bg: string; icon: typeof AlertTriangle; label: string }
> = {
  critical: {
    color: "text-destructive",
    bg: "bg-danger-subtle border-destructive/30",
    icon: AlertCircle,
    label: "Critical",
  },
  warning: {
    color: "text-warning",
    bg: "bg-warning-subtle border-warning/30",
    icon: AlertTriangle,
    label: "Warning",
  },
  info: { color: "text-info", bg: "bg-info-subtle border-info/30", icon: Info, label: "Info" },
};

const typeIcons: Record<string, typeof Copy> = {
  duplicate_amount: Copy,
  unusual_amount: DollarSign,
  weekend_transaction: CalendarOff,
  round_number: Hash,
  duplicate_vendor: UserX,
  expense_spike: TrendingUp,
  cross_period_baseline: TrendingUp,
  duplicate_supplier_invoice: Copy,
  vat_rate_mismatch: Hash,
  trn_missing: UserX,
  trn_malformed: UserX,
};

const RULE_LABELS: Record<string, { en: string; ar: string }> = {
  duplicate_amount: { en: "Duplicate amount", ar: "مبلغ مكرر" },
  unusual_amount: { en: "Unusual amount", ar: "مبلغ غير معتاد" },
  weekend_transaction: { en: "Weekend entry", ar: "قيد في عطلة نهاية الأسبوع" },
  round_number: { en: "Round number", ar: "مبلغ مقرّب" },
  duplicate_vendor: { en: "Possible duplicate charge", ar: "احتمال رسوم مكررة" },
  duplicate_supplier_invoice: { en: "Duplicate supplier invoice", ar: "فاتورة مورد مكررة" },
  vat_rate_mismatch: { en: "VAT rate mismatch", ar: "عدم تطابق نسبة الضريبة" },
  trn_missing: { en: "Supplier TRN missing", ar: "الرقم الضريبي للمورد مفقود" },
  trn_malformed: { en: "Malformed TRN", ar: "رقم ضريبي غير صالح" },
  cross_period_baseline: { en: "Above trailing average", ar: "أعلى من المتوسط السابق" },
};

const severityAliases: Record<string, AnomalySeverity> = {
  critical: "critical",
  high: "warning",
  medium: "warning",
  warning: "warning",
  low: "info",
  info: "info",
};

function normalizeSeverity(severity: RawAnomalySeverity | null | undefined): AnomalySeverity {
  return severity ? (severityAliases[severity] ?? "warning") : "warning";
}

export default function AnomalyDetection() {
  const { t } = useTranslation();
  const { t: _t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  // Reading the list never scans; "Run scan" is an explicit POST (R13-15).
  const { data: result, isLoading } = useQuery<AnomalyResult>({
    queryKey: [`/api/companies/${companyId}/anomalies`],
    enabled: !!companyId,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/anomalies/scan`),
    onSuccess: (scanned: AnomalyResult) => {
      queryClient.setQueryData([`/api/companies/${companyId}/anomalies`], scanned);
      toast({
        title: locale === "ar" ? "اكتمل الفحص" : "Scan complete",
        description:
          locale === "ar"
            ? `تنبيهات جديدة: ${scanned.newAlerts ?? 0}`
            : `${scanned.newAlerts ?? 0} new alert(s) recorded.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });
  const isFetching = scanMutation.isPending;

  const dismissMutation = useMutation({
    mutationFn: async (anomalyId: string) => {
      return apiRequest("POST", `/api/companies/${companyId}/anomalies/${anomalyId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/anomalies`] });
      toast({
        title: translateNow("toasts.anomalyDismissed"),
        description: translateNow("toasts.theAnomalyHasBeenRemovedFromThe"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              <T k="pages.pleaseCreateACompanyFirstToUseAnomalyDetection" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredAnomalies =
    result?.anomalies.filter(
      (a) => severityFilter === "all" || normalizeSeverity(a.severity) === severityFilter
    ) || [];

  const formatAnomalyDate = (dateStr?: string | null) => {
    if (!dateStr) return "N/A";

    try {
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) return dateStr;

      return date.toLocaleDateString("en-AE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-danger-subtle rounded-lg">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {locale === "ar"
                ? "كشف الشذوذ المحاسبي"
                : t["anomalyDetection.accountingAnomalyChecks"]}
            </h1>
            <p className="text-muted-foreground text-sm">
              {locale === "ar"
                ? "فحوصات قائمة على القواعد: التكرار والمبالغ غير المعتادة وضريبة القيمة المضافة والأرقام الضريبية والمقارنة بالأشهر السابقة. تُجرى يومياً أو عند الطلب."
                : "Rule-based checks: duplicates, unusual amounts, VAT rate, TRNs and comparison with trailing months. They run daily or on demand."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {result?.scannedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {locale === "ar" ? "آخر تنبيه مسجّل: " : "Latest alert recorded: "}
              {new Date(result.scannedAt).toLocaleString()}
            </span>
          )}
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={isFetching}
            data-testid="button-run-scan"
          >
            {isFetching ? (
              <RefreshCw className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Scan className="h-4 w-4 me-2" />
            )}
            {isFetching ? "Scanning..." : t["aiInbox.runScan"]}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : result ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSeverityFilter("all")}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">
                <T k="pages.totalAnomalies" />
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.summary.total}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-destructive/30"
            onClick={() => setSeverityFilter("critical")}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-destructive" />
                <T k="pages.critical" />
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-destructive">{result.summary.critical}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-warning/30"
            onClick={() => setSeverityFilter("warning")}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-warning" />
                <T k="pages.warning" />
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-warning">{result.summary.warning}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-info/30"
            onClick={() => setSeverityFilter("info")}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Info className="h-3 w-3 text-info" />
                {t["anomalyDetection.info"]}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-info">{result.summary.info}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{t["anomalyDetection.filter"]}</span>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <T k="pages.allSeverities" />
            </SelectItem>
            <SelectItem value="critical">
              <T k="pages.critical" />
            </SelectItem>
            <SelectItem value="warning">
              <T k="pages.warning" />
            </SelectItem>
            <SelectItem value="info">{t["anomalyDetection.info"]}</SelectItem>
          </SelectContent>
        </Select>
        {severityFilter !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setSeverityFilter("all")}>
            <T k="pages.clearFilter" />
          </Button>
        )}
      </div>

      {/* Anomaly List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : filteredAnomalies.length > 0 ? (
        <div className="space-y-3">
          {filteredAnomalies.map((anomaly) => {
            const severity = normalizeSeverity(anomaly.severity);
            const config = severityConfig[severity];
            const SeverityIcon = config.icon;
            const anomalyType = anomaly.rule || anomaly.type || "anomaly";
            const TypeIcon = typeIcons[anomalyType] || Info;

            return (
              <Card key={anomaly.id} className={`${config.bg} border`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`mt-0.5 ${config.color}`}>
                        <SeverityIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={severity === "critical" ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {config.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {RULE_LABELS[anomalyType]
                              ? locale === "ar"
                                ? RULE_LABELS[anomalyType].ar
                                : RULE_LABELS[anomalyType].en
                              : anomalyType.replace(/_/g, " ")}
                          </Badge>
                          {typeof anomaly.amount === "number" && anomaly.amount > 0 && (
                            <span className="text-sm font-medium">
                              <Money amount={anomaly.amount} currency={"AED"} />
                            </span>
                          )}
                        </div>
                        <p className="text-sm">{anomaly.description}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatAnomalyDate(anomaly.date)}
                          {anomaly.relatedType && (
                            <>
                              <span className="mx-1">|</span>
                              <span className="capitalize">
                                {anomaly.relatedType.replace(/_/g, " ")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismissMutation.mutate(anomaly.id)}
                      disabled={dismissMutation.isPending}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4 me-1" />
                      <T k="pages.dismiss" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : result ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 space-y-3">
              <ShieldAlert className="h-12 w-12 text-success mx-auto" />
              <h3 className="text-lg font-semibold">
                <T k="pages.noAnomaliesFound" />
              </h3>
              <p className="text-muted-foreground text-sm">
                {severityFilter !== "all"
                  ? `No ${severityFilter} anomalies detected. Try changing the filter.`
                  : locale === "ar"
                    ? "لا توجد تنبيهات مفتوحة. شغّل الفحص للتحقق من أحدث المعاملات."
                    : "No open alerts. Run a scan to check the latest transactions."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
