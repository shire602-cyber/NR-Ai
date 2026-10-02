import { Link } from "wouter";
import { ArrowRight, CalendarClock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AGEING_BUCKET_KEYS,
  DASHBOARD_PERIODS,
  bucketTotal,
  daysUntil,
  normalizeBuckets,
  overdueOfBuckets,
  vatDueView,
  type AgeingBucketKey,
  type DashboardPeriodKind,
  type DashboardStats,
} from "@/lib/dashboardStats";
import { dubaiToday } from "@/lib/report-presets";
import { messages as pageMessages } from "./DashboardAgeingPanel.i18n";

const BUCKET_COLOR: Record<AgeingBucketKey, string> = {
  current: "bg-success",
  days1to30: "bg-info",
  days31to60: "bg-warning",
  days61to90: "bg-chart-5",
  days90plus: "bg-destructive",
};

/** Month-to-date or fiscal-year-to-date. There is no all-time choice. */
export function DashboardPeriodToggle({
  value,
  onChange,
}: {
  value: DashboardPeriodKind;
  onChange: (next: DashboardPeriodKind) => void;
}) {
  const tr = pageMessages.useT();
  const label: Record<DashboardPeriodKind, string> = {
    month: tr("monthToDate"),
    ytd: tr("yearToDate"),
  };
  return (
    <div
      className="inline-flex rounded-lg border border-border p-0.5"
      role="group"
      aria-label={tr("periodLabel")}
      data-testid="dashboard-period-toggle"
    >
      {DASHBOARD_PERIODS.map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant={value === p ? "default" : "ghost"}
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          data-testid={`dashboard-period-${p}`}
        >
          {label[p]}
        </Button>
      ))}
    </div>
  );
}

interface AgeingCardProps {
  title: string;
  note: string;
  buckets: ReturnType<typeof normalizeBuckets>;
  overdue: number;
  reportHref: string;
  missingDueDate?: number;
  testId: string;
}

function AgeingCard({
  title,
  note,
  buckets,
  overdue,
  reportHref,
  missingDueDate,
  testId,
}: AgeingCardProps) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const total = bucketTotal(buckets);
  const max = Math.max(...AGEING_BUCKET_KEYS.map((k) => buckets[k]), 0);
  const label: Record<AgeingBucketKey, string> = {
    current: tr("notYetDue"),
    days1to30: tr("days1to30"),
    days31to60: tr("days31to60"),
    days61to90: tr("days61to90"),
    days90plus: tr("days90plus"),
  };
  return (
    <Card className="space-y-4 p-5" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">{note}</p>
        </div>
        <div className="text-end">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {tr("totalOpen")}
          </div>
          <div
            dir="ltr"
            className="font-display text-xl tabular-nums"
            data-testid={`${testId}-total`}
          >
            {formatCurrency(total, "AED", locale)}
          </div>
          {overdue > 0 ? (
            <div className="mt-1 text-xs text-destructive" data-testid={`${testId}-overdue`}>
              {tr("overdue")}{" "}
              <span dir="ltr" className="tabular-nums font-medium">
                {formatCurrency(overdue, "AED", locale)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("nothingOpen")}</p>
      ) : (
        <ul className="space-y-2" aria-label={title}>
          {AGEING_BUCKET_KEYS.map((key) => (
            <li key={key} className="space-y-1 text-xs" data-testid={`${testId}-bucket-${key}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{label[key]}</span>
                <span dir="ltr" className="tabular-nums">
                  {formatCurrency(buckets[key], "AED", locale)}
                </span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", BUCKET_COLOR[key])}
                  style={{ width: max > 0 ? `${(buckets[key] / max) * 100}%` : "0%" }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {missingDueDate && missingDueDate > 0 ? (
        <p
          className="flex items-start gap-2 rounded-md bg-warning-subtle p-2 text-xs text-warning"
          data-testid={`${testId}-missing-due`}
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {missingDueDate === 1
            ? tr("missingDueDateOne")
            : tr("missingDueDate", { count: missingDueDate })}
        </p>
      ) : null}

      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ms-2 gap-1 text-accent hover:text-accent"
      >
        <Link href={reportHref}>
          {tr("openAgingReport")} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </Button>
    </Card>
  );
}

function VatDueCard({ stats }: { stats: DashboardStats | undefined }) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const view = vatDueView(stats?.vatDueNext);
  const days = view.kind === "amount" ? daysUntil(view.dueDate, dubaiToday()) : 0;
  return (
    <Card className="space-y-3 p-5" data-testid="dashboard-vat-due">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="h-4 w-4 text-accent" aria-hidden />
        {tr("vatDueNext")}
      </div>
      {view.kind === "amount" ? (
        <>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {tr("vatAmountDue")}
            </div>
            <div
              dir="ltr"
              className="font-display text-2xl tabular-nums"
              data-testid="dashboard-vat-due-amount"
            >
              {formatCurrency(view.amount, "AED", locale)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span dir="auto">{tr("vatPeriodEnd", { date: view.periodEnd })}</span>
            <span aria-hidden>·</span>
            <span dir="auto">{tr("vatDueOn", { date: view.dueDate })}</span>
            <Badge variant={days < 0 ? "danger" : days <= 7 ? "warning" : "neutral"}>
              {days < 0
                ? tr("vatOverdue", { count: -days })
                : days === 0
                  ? tr("vatDueToday")
                  : tr("vatDaysLeft", { count: days })}
            </Badge>
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ms-2 gap-1 text-accent hover:text-accent"
          >
            <Link href="/vat-filing">
              {tr("vatOpenFiling")} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="dashboard-vat-due-unavailable">
            {view.reason === "NO_TRN"
              ? tr("vatNoTrn")
              : view.reason === "EMIRATE_NOT_SET"
                ? tr("vatNoEmirate")
                : tr("vatUnavailable")}
          </p>
          {view.reason !== "UNAVAILABLE" ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/company-profile">{tr("vatFixSettings")}</Link>
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Receivables and payables in five buckets, the overdue figure, and the next VAT payment. */
export function DashboardAgeingPanel({
  stats,
  isLoading,
}: {
  stats: DashboardStats | undefined;
  isLoading: boolean;
}) {
  const tr = pageMessages.useT();
  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const ar = normalizeBuckets(stats?.arAging);
  const ap = normalizeBuckets(stats?.apAging);
  const overdueAr =
    typeof stats?.overdueReceivables === "number" ? stats.overdueReceivables : overdueOfBuckets(ar);
  return (
    <div className="space-y-3" data-testid="dashboard-ageing-panel">
      <div className="grid gap-4 lg:grid-cols-3">
        <AgeingCard
          testId="dashboard-ar"
          title={tr("receivables")}
          note={tr("receivablesNote")}
          buckets={ar}
          overdue={overdueAr}
          missingDueDate={stats?.receivablesMissingDueDate}
          reportHref="/reports/run/ar-aging"
        />
        <AgeingCard
          testId="dashboard-ap"
          title={tr("payables")}
          note={tr("payablesNote")}
          buckets={ap}
          overdue={overdueOfBuckets(ap)}
          reportHref="/reports/run/ap-aging"
        />
        <VatDueCard stats={stats} />
      </div>
      <p className="text-xs text-muted-foreground">{tr("periodNote")}</p>
    </div>
  );
}
