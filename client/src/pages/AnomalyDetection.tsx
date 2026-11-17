import { T } from "@/components/layout/T";
import type { CopyDescriptor } from "@shared/server-copy";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { anomalyRuleLabel } from "@/lib/anomaly-rules";
import { anomalyMessage } from "@/lib/server-message";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate as formatDisplayDate } from "@/lib/format-date";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
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
  /** The same sentence as key + params (API); older rows are parsed back from the English. */
  message?: CopyDescriptor | null;
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
  { color: string; icon: typeof AlertTriangle; labelKey: string }
> = {
  critical: { color: "text-destructive", icon: AlertCircle, labelKey: "pages.critical" },
  warning: { color: "text-warning", icon: AlertTriangle, labelKey: "pages.warning" },
  info: { color: "text-info", icon: Info, labelKey: "anomalyDetection.info" },
};

/** Catalog key of the record type an alert points at (`relatedType` is a raw enum). */
const RELATED_TYPE_KEY: Record<string, string> = {
  journal_entry: "anomalyChecks.typeJournalEntry",
  receipt: "anomalyChecks.typeReceipt",
  invoice: "anomalyChecks.typeInvoice",
  vendor_bill: "anomalyChecks.typeVendorBill",
  account: "anomalyChecks.typeAccount",
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
  return <AnomalyChecks />;
}

/**
 * The checks list as a component (spec 3.11): the /anomaly-detection page renders it with its
 * header; WP-E mounts it inside Assistant > Review with `embedded` (no page header).
 */
export function AnomalyChecks({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useTranslation();
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
        title: t["anomalyChecks.scanComplete"],
        description: formatMessage(t["anomalyChecks.newAlerts"], {
          count: scanned.newAlerts ?? 0,
        }),
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
        <Skeleton className="h-24" />
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
  const hasAlerts = (result?.summary.total ?? 0) > 0;

  const formatAnomalyDate = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    const formatted = formatDisplayDate(dateStr, locale);
    return formatted || dateStr;
  };

  // Embedded in Assistant > Review the page already has its primary action, so the scan here is
  // a secondary button; on its own page it is the one primary.
  const scanButton = (
    <Button
      variant={embedded ? "outline" : "default"}
      onClick={() => scanMutation.mutate()}
      disabled={isFetching}
      data-testid="button-run-scan"
    >
      {isFetching ? (
        <RefreshCw className="h-4 w-4 me-2 animate-spin" />
      ) : (
        <Scan className="h-4 w-4 me-2" />
      )}
      {t["aiInbox.runScan"]}
    </Button>
  );

  const severityLabel = (severity: AnomalySeverity) => t[severityConfig[severity].labelKey];

  return (
    <div className="space-y-6">
      {embedded ? null : (
        <PageHeader
          eyebrow={t["anomalyChecks.eyebrow"]}
          title={t["anomalyDetection.accountingAnomalyChecks"]}
          description={t["anomalyChecks.pageDescription"]}
          primaryAction={scanButton}
        />
      )}
      {result?.scannedAt ? (
        <p className="flex items-center gap-1 text-caption text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden />
          {formatMessage(t["anomalyChecks.latestAlert"], {
            date: formatDisplayDate(result.scannedAt, locale),
          })}
        </p>
      ) : null}

      {/* Summary: only when there is something to count (no row of zeros). */}
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : result && hasAlerts && !embedded ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(
            [
              ["all", t["pages.totalAnomalies"], result.summary.total],
              ["critical", severityLabel("critical"), result.summary.critical],
              ["warning", severityLabel("warning"), result.summary.warning],
              ["info", severityLabel("info"), result.summary.info],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              onClick={() => setSeverityFilter(id)}
              aria-pressed={severityFilter === id}
            >
              <StatCard label={label} value={count} />
            </button>
          ))}
        </div>
      ) : null}

      {/* Filters and, embedded, the scan action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasAlerts ? (
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
                <SelectItem value="critical">{severityLabel("critical")}</SelectItem>
                <SelectItem value="warning">{severityLabel("warning")}</SelectItem>
                <SelectItem value="info">{severityLabel("info")}</SelectItem>
              </SelectContent>
            </Select>
            {severityFilter !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setSeverityFilter("all")}>
                <T k="pages.clearFilter" />
              </Button>
            )}
          </div>
        ) : (
          <span />
        )}
        {embedded ? scanButton : null}
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
            const relatedKey = anomaly.relatedType ? RELATED_TYPE_KEY[anomaly.relatedType] : null;

            return (
              <Card key={anomaly.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`mt-0.5 ${config.color}`}>
                        <SeverityIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge
                            tone={
                              severity === "critical"
                                ? "danger"
                                : severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                            className="text-xs"
                          >
                            {severityLabel(severity)}
                          </StatusBadge>
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {anomalyRuleLabel(anomalyType, locale)}
                          </Badge>
                          {typeof anomaly.amount === "number" && anomaly.amount > 0 && (
                            <span className="text-sm font-medium">
                              <Money amount={anomaly.amount} currency={"AED"} />
                            </span>
                          )}
                        </div>
                        <p className="text-sm">{anomalyMessage(anomaly, t, locale)}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatAnomalyDate(anomaly.date)}
                          {relatedKey && (
                            <>
                              <span className="mx-1">|</span>
                              <span>{t[relatedKey]}</span>
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
        <EmptyState
          icon={ShieldAlert}
          title={t["pages.noAnomaliesFound"]}
          description={
            severityFilter !== "all"
              ? formatMessage(t["anomalyChecks.noneForSeverity"], {
                  severity: severityLabel(severityFilter as AnomalySeverity).toLowerCase(),
                })
              : t["anomalyChecks.emptyBody"]
          }
          testId="anomaly-empty"
        />
      ) : null}
    </div>
  );
}
