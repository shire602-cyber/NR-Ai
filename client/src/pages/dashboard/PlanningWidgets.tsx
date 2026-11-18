import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { StatusBadge as ToneBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/ui/money";
import { formatCurrency, formatMonthKey } from "@/lib/format";
import { formatDateRange } from "@/lib/format-date";
import { formatPercentDelta } from "@/lib/format-money";
import { apiRequest } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { chartTheme, ChartTooltipContent, formatAxisCompact } from "@/components/ui/chart-theme";
import { EmptyState } from "@/components/ui/empty-state";
import { dashboardPeriodLabel } from "./period";
import type {
  BudgetVsActualRow,
  DashboardOverdueDocument,
  DashboardPeriodSummary,
  DashboardStats,
} from "./types";

interface WidgetProps {
  stats: DashboardStats | undefined;
  loading: boolean;
  locale: string;
}

/** Delta pill: same sign rules as money (true minus), colour = good or bad news. */
function ChangeBadge({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className="inline-block w-14 text-center text-caption text-muted-foreground">–</span>
    );
  }
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <Badge variant={good ? "success" : "danger"} className="w-14 justify-center px-1.5">
      <span className="money" dir="ltr">
        {formatPercentDelta(value)}
      </span>
    </Badge>
  );
}

/**
 * Selected period against the prior period and the same period last year (R13-19).
 * One compact matrix: rows are the measures, columns the periods (CTO 4, 7).
 */
export function PeriodComparison({ stats, loading, locale }: WidgetProps) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  if (loading || !stats) return <Skeleton className="h-56 w-full" />;
  const columns: Array<{
    key: string;
    title: string;
    summary: DashboardPeriodSummary;
    change?: { revenue: number | null; expenses: number | null; netProfit: number | null };
  }> = [
    { key: "current", title: tt["dashboard.colSelected"], summary: stats.current },
    {
      key: "prior",
      title: tt["dashboard.colPrior"],
      summary: stats.prior,
      change: stats.changes.vsPrior,
    },
    {
      key: "priorYear",
      title: tt["dashboard.colPriorYear"],
      summary: stats.priorYear,
      change: stats.changes.vsPriorYear,
    },
  ];
  const rows: Array<["revenue" | "expenses" | "netProfit", string, boolean]> = [
    ["revenue", tt["dashboard.kpiRevenue"], false],
    ["expenses", tt["dashboard.kpiExpenses"], true],
    ["netProfit", tt["dashboard.kpiNetProfit"], false],
  ];
  return (
    <Card className="flex h-full flex-col" data-testid="dashboard-period-comparison">
      <CardHeader className="pb-3">
        <CardTitle>
          {tt["dashboard.periodComparisonTitle"]}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {dashboardPeriodLabel(stats.period, locale)}
          </span>
        </CardTitle>
        <p className="text-caption text-muted-foreground">{tt["dashboard.periodComparisonNote"]}</p>
      </CardHeader>
      {/* Phones: one short list per period instead of a wide matrix. */}
      <CardContent className="space-y-4 pt-0 md:hidden">
        {columns.map((col) => (
          <div key={col.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium text-foreground">{col.title}</span>
              <span className="text-caption text-muted-foreground">
                {formatDateRange(col.summary.from, col.summary.to, locale)}
              </span>
            </div>
            <div className="mt-1 divide-hairline">
              {rows.map(([field, label, inverse]) => (
                <div key={field} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex items-center gap-2">
                    <Money amount={col.summary[field]} className="font-medium" />
                    {col.change ? (
                      <ChangeBadge value={col.change[field] ?? null} inverse={inverse} />
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
      <CardContent className="hidden flex-1 pt-0 md:block">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead>
            <tr>
              <th className="pb-2 text-start" aria-hidden />
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="pb-2 ps-4 text-end align-bottom font-normal"
                >
                  <div className="text-caption font-medium text-foreground">{col.title}</div>
                  <div className="text-caption text-muted-foreground">
                    {formatDateRange(col.summary.from, col.summary.to, locale)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([field, label, inverse]) => (
              <tr key={field}>
                <th
                  scope="row"
                  className="border-t border-border py-2.5 text-start font-normal text-muted-foreground"
                >
                  {label}
                </th>
                {columns.map((col) => (
                  <td key={col.key} className="border-t border-border py-2.5 ps-4 text-end">
                    <span className="inline-flex items-center justify-end gap-2">
                      <Money
                        amount={col.summary[field]}
                        className={field === "netProfit" ? "font-semibold" : "font-medium"}
                      />
                      {col.change ? (
                        <ChangeBadge value={col.change[field] ?? null} inverse={inverse} />
                      ) : null}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Monthly cash in and out from the bank and cash accounts, with bank balance against the GL. */
export function CashMovement({ stats, loading, locale }: WidgetProps) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  if (loading || !stats) return <Skeleton className="h-72 w-full" />;
  const data = stats.cashInOut.map((m) => ({
    name: m.period,
    inflow: m.inflow,
    outflow: m.outflow,
  }));
  const accounts = stats.bankVsGl.accounts;
  return (
    <Card className="h-full" data-testid="dashboard-cash-movement">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 space-y-0 pb-2">
        <CardTitle>{tt["dashboard.cashInOutTitle"]}</CardTitle>
        <ul className="flex items-center gap-4 text-caption text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-chart-1" aria-hidden />
            {tt["dashboard.cashIn"]}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-chart-neutral" aria-hidden />
            {tt["dashboard.cashOut"]}
          </li>
        </ul>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length >= 2 ? (
          <div className="h-48 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                {...chartTheme.barChart}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid {...chartTheme.grid} />
                <XAxis
                  dataKey="name"
                  reversed={locale === "ar"}
                  tickFormatter={(key: string) => formatMonthKey(key, locale)}
                  {...chartTheme.xAxis}
                />
                <YAxis
                  orientation={locale === "ar" ? "right" : "left"}
                  tickFormatter={formatAxisCompact}
                  {...chartTheme.yAxis}
                />
                <Tooltip
                  {...chartTheme.tooltip}
                  content={
                    <ChartTooltipContent
                      currency="AED"
                      seriesLabel={(key) =>
                        key === "inflow" ? tt["dashboard.cashIn"] : tt["dashboard.cashOut"]
                      }
                      labelFormatter={(key) => formatMonthKey(String(key), locale)}
                    />
                  }
                />
                <Bar
                  dataKey="inflow"
                  name={tt["dashboard.cashIn"]}
                  {...chartTheme.bar("brand")}
                  isAnimationActive={chartTheme.animate()}
                />
                <Bar
                  dataKey="outflow"
                  name={tt["dashboard.cashOut"]}
                  {...chartTheme.bar("neutral")}
                  isAnimationActive={chartTheme.animate()}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState size="sm" title={tt["dashboard.chartNotEnoughData"]} />
        )}
        <BankVsLedger accounts={accounts} />
      </CardContent>
    </Card>
  );
}

type BankVsGlAccount = DashboardStats["bankVsGl"]["accounts"][number];

/**
 * Bank statement balance against the ledger, one row per bank account (spec 3.6): the
 * difference is labelled and carries the same ties / differs badge as the X6d GL proofs.
 */
function BankVsLedger({ accounts }: { accounts: BankVsGlAccount[] }) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  return (
    <div className="border-t border-border pt-4" data-testid="dashboard-bank-vs-gl">
      <h3 className="text-caption font-medium text-muted-foreground">
        {tt["dashboard.bankVsGlTitle"]}
      </h3>
      {accounts.length === 0 ? (
        <p className="mt-1 text-small text-muted-foreground">
          {tt["dashboard.bankVsGlNoAccounts"]}
        </p>
      ) : (
        <ul className="mt-1 divide-hairline">
          {accounts.map((a) => {
            // X6a: no statement imported means nothing to compare and no difference.
            const noStatement = a.hasStatement === false || a.statementBalance === null;
            const ties = !noStatement && (a.difference ?? 0) === 0;
            const figure = (label: string, value: React.ReactNode) => (
              <div className="min-w-0">
                <dt className="text-caption text-muted-foreground">{label}</dt>
                <dd className="truncate text-small tabular-nums">{value}</dd>
              </div>
            );
            return (
              <li key={a.bankAccountId} className="space-y-1.5 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span dir="auto" className="min-w-0 truncate text-small font-medium">
                    {a.name}
                  </span>
                  {noStatement ? (
                    <span
                      className="shrink-0 text-caption text-muted-foreground"
                      data-testid={`bank-vs-gl-no-statement-${a.bankAccountId}`}
                    >
                      {tt["dashboard.bankNoStatement"]}
                    </span>
                  ) : (
                    <ToneBadge
                      tone={ties ? "success" : "danger"}
                      data-ties-state={ties ? "ties" : "differs"}
                      className="shrink-0"
                    >
                      {ties ? t["launchProof.ties"] : t["launchProof.differs"]}
                    </ToneBadge>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-3">
                  {figure(
                    tt["dashboard.bankColStatement"],
                    noStatement ? "–" : <Money amount={a.statementBalance!} currency={a.currency} />
                  )}
                  {figure(
                    tt["dashboard.bankColLedger"],
                    a.glBalance === null ? (
                      "–"
                    ) : (
                      <Money amount={a.glBalance} currency={a.currency} />
                    )
                  )}
                  {figure(
                    tt["dashboard.bankColDifference"],
                    noStatement ? (
                      "–"
                    ) : (
                      <Money
                        amount={a.difference ?? 0}
                        currency={a.currency}
                        signDisplay={ties ? "auto" : "always"}
                        className={ties ? undefined : "font-medium"}
                      />
                    )
                  )}
                </dl>
                {!noStatement && !ties ? (
                  <p
                    className="text-caption text-muted-foreground"
                    data-testid={`bank-vs-gl-reason-${a.bankAccountId}`}
                  >
                    {formatMessage(
                      (a.difference ?? 0) > 0
                        ? tt["dashboard.bankDiffBooksAhead"]
                        : tt["dashboard.bankDiffStatementAhead"],
                      {
                        amount: formatCurrency(Math.abs(a.difference ?? 0), a.currency, locale),
                      }
                    )}{" "}
                    <Link
                      href="/bank-reconciliation"
                      className="font-medium text-accent hover:underline"
                    >
                      {tt["dashboard.bankDiffReview"]}
                    </Link>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** At most three rows per side, so the card stays compact; "View all" opens the full list. */
const OVERDUE_ROWS = 3;

function OverdueList({
  title,
  docs,
  href,
  testId,
}: {
  title: string;
  docs: DashboardOverdueDocument[];
  href: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-caption font-medium text-muted-foreground">{title}</h3>
        {docs.length > 0 && (
          <Link href={href} className="text-caption font-medium text-accent hover:underline">
            {tt["dashboard.viewAll"]}
          </Link>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="mt-2 text-small text-muted-foreground">{tt["dashboard.overdueNone"]}</p>
      ) : (
        <div className="mt-1 divide-hairline">
          {docs.slice(0, OVERDUE_ROWS).map((d) => (
            <div key={d.documentId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div dir="auto" className="truncate text-small font-medium text-foreground">
                  {d.name}
                </div>
                <div className="truncate text-caption text-muted-foreground">
                  {d.number ? (
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {d.number}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <Money amount={d.open} className="text-small font-medium" />
                <StatusBadge status="overdue" overdueDays={d.daysPastDue} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Customers and suppliers side by side, so neither half of the card sits empty (spec 3.6). */
export function OverdueSummary({ stats, loading }: WidgetProps) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  if (loading || !stats) return <Skeleton className="h-40 w-full" />;
  return (
    <Card className="h-full" data-testid="dashboard-top-overdue">
      <CardHeader className="pb-2">
        <CardTitle>{tt["dashboard.topOverdueTitle"]}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 pt-0 sm:grid-cols-2">
        <OverdueList
          title={tt["dashboard.overdueCustomers"]}
          docs={stats.topOverdue.receivables}
          href={stats.links.overdue}
          testId="overdue-receivables"
        />
        <OverdueList
          title={tt["dashboard.overdueSuppliers"]}
          docs={stats.topOverdue.payables}
          href={stats.links.payables}
          testId="overdue-payables"
        />
      </CardContent>
    </Card>
  );
}

/** Budget against actual for the current month, from the approved budget plan (R13-26). */
export function BudgetVsActualWidget({
  companyId,
  asOf,
  locale,
}: {
  companyId: string | undefined;
  asOf: string | undefined;
  locale: string;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const year = asOf ? Number(asOf.slice(0, 4)) : undefined;
  const month = asOf ? Number(asOf.slice(5, 7)) : undefined;
  const { data, isLoading } = useQuery<BudgetVsActualRow[]>({
    queryKey: ["/api/analytics/budget-vs-actual", companyId, year, month],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/analytics/budget-vs-actual?companyId=${companyId}&year=${year}&month=${month}`
      ),
    enabled: Boolean(companyId && year && month),
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = (data ?? [])
    .slice()
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 5);
  return (
    <Card className="flex h-full flex-col" data-testid="dashboard-budget-vs-actual">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{tt["dashboard.budgetTitle"]}</span>
          <Link href="/budgets" className="text-small font-medium text-accent hover:underline">
            {tt["dashboard.budgetOpen"]}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {rows.length === 0 ? (
          <p className="text-caption text-muted-foreground">{tt["dashboard.budgetNone"]}</p>
        ) : (
          <table className="mobile-fit w-full table-fixed border-separate border-spacing-0 text-caption tabular-nums sm:text-sm">
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="w-[34%] pb-2 text-start font-medium">
                  {tt["dashboard.budgetColAccount"]}
                </th>
                <th scope="col" className="pb-2 text-end font-medium">
                  {tt["dashboard.budgetColBudget"]}
                </th>
                <th scope="col" className="pb-2 text-end font-medium">
                  {tt["dashboard.budgetColActual"]}
                </th>
                <th scope="col" className="pb-2 text-end font-medium">
                  {tt["dashboard.budgetColVariance"]}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId}>
                  <td
                    className="truncate border-t border-border py-2 pe-2"
                    title={locale === "ar" && r.accountNameAr ? r.accountNameAr : r.accountName}
                  >
                    <span dir="auto">
                      {locale === "ar" && r.accountNameAr ? r.accountNameAr : r.accountName}
                    </span>
                  </td>
                  <td className="border-t border-border py-2 text-end text-muted-foreground">
                    <Money amount={r.budgeted} showCurrency={false} />
                  </td>
                  <td className="border-t border-border py-2 text-end">
                    <Money amount={r.actual} showCurrency={false} />
                  </td>
                  <td
                    className={
                      "border-t border-border py-2 text-end font-medium " +
                      (r.favourable ? "text-positive" : "text-negative")
                    }
                  >
                    <Money amount={r.variance} showCurrency={false} signDisplay="always" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
