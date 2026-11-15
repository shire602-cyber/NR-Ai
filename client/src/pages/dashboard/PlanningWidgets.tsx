import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { CHART_COLORS } from "./chart-colors";
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

const L = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);

function ChangeBadge({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground">–</span>;
  const good = inverse ? value <= 0 : value >= 0;
  return (
    <Badge variant={good ? "success" : "danger"} className="tabular-nums">
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </Badge>
  );
}

function PeriodColumn({
  title,
  summary,
  change,
  locale,
}: {
  title: string;
  summary: DashboardPeriodSummary;
  change?: { revenue: number | null; expenses: number | null; netProfit: number | null };
  locale: string;
}) {
  const rows: Array<[string, number, number | null | undefined, boolean]> = [
    [L(locale, "Revenue", "الإيرادات"), summary.revenue, change?.revenue, false],
    [L(locale, "Expenses", "المصروفات"), summary.expenses, change?.expenses, true],
    [L(locale, "Net profit", "صافي الربح"), summary.netProfit, change?.netProfit, false],
  ];
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        {title}
        <span className="ml-2 font-mono normal-case tracking-normal">
          {summary.from ?? ""} – {summary.to}
        </span>
      </div>
      {rows.map(([label, value, delta, inverse]) => (
        <div key={label} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono tabular-nums">{formatCurrency(value, "AED", locale)}</span>
            {change && <ChangeBadge value={delta ?? null} inverse={inverse} />}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Selected period against the prior period and the same period last year (R13-19). */
export function PeriodComparison({ stats, loading, locale }: WidgetProps) {
  if (loading || !stats) return <Skeleton className="h-40 w-full" />;
  return (
    <Card data-testid="dashboard-period-comparison">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {L(locale, "Period comparison", "مقارنة الفترات")} · {stats.period.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <PeriodColumn
          title={L(locale, "Selected period", "الفترة المحددة")}
          summary={stats.current}
          locale={locale}
        />
        <PeriodColumn
          title={L(locale, "Prior period", "الفترة السابقة")}
          summary={stats.prior}
          change={stats.changes.vsPrior}
          locale={locale}
        />
        <PeriodColumn
          title={L(locale, "Same period last year", "الفترة نفسها من العام الماضي")}
          summary={stats.priorYear}
          change={stats.changes.vsPriorYear}
          locale={locale}
        />
      </CardContent>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {L(
          locale,
          "Changes are shown against each comparison column. Figures come from the posted ledger.",
          "التغيير معروض مقابل كل عمود مقارنة. الأرقام من دفتر الأستاذ المرحّل."
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  href,
  label,
  value,
  hint,
  testId,
}: {
  href: string;
  label: string;
  value: string;
  hint?: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer h-full" data-testid={testId}>
        <CardContent className="p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 font-display text-[22px] tabular-nums leading-none">{value}</div>
          {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}

/** Cash, receivable and payable tiles, each linking to the filtered list (R13-21). */
export function DrillThroughTiles({ stats, loading, locale }: WidgetProps) {
  if (loading || !stats) return <Skeleton className="h-28 w-full" />;
  const days = (n: number | null) =>
    n === null
      ? L(locale, "Not enough data", "لا توجد بيانات كافية")
      : `${n.toFixed(1)} ${L(locale, "days", "يوم")}`;
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="dashboard-drill-tiles">
      <Tile
        href={stats.links.cash}
        label={L(locale, "Cash (GL)", "النقد (الدفتر)")}
        value={formatCurrency(stats.cashPosition, "AED", locale)}
        hint={
          stats.cashRunway === null
            ? undefined
            : `${L(locale, "Runway", "المدة المتاحة")} ${stats.cashRunway.toFixed(1)} ${L(locale, "months", "شهر")}`
        }
        testId="tile-cash"
      />
      <Tile
        href={stats.links.outstanding}
        label={L(locale, "Receivables", "الذمم المدينة")}
        value={formatCurrency(stats.outstanding, "AED", locale)}
        hint={`DSO ${days(stats.dso)}`}
        testId="tile-receivables"
      />
      <Tile
        href={stats.links.payables}
        label={L(locale, "Payables", "الذمم الدائنة")}
        value={formatCurrency(stats.outstandingPayables, "AED", locale)}
        hint={`DPO ${days(stats.dpo)}`}
        testId="tile-payables"
      />
      <Tile
        href={stats.links.journal}
        label={L(locale, "Net profit", "صافي الربح")}
        value={formatCurrency(stats.netProfit, "AED", locale)}
        hint={stats.period.label}
        testId="tile-net-profit"
      />
    </section>
  );
}

/** Monthly cash in and out from the bank and cash accounts, with bank balance against the GL. */
export function CashMovement({ stats, loading, locale }: WidgetProps) {
  if (loading || !stats) return <Skeleton className="h-72 w-full" />;
  const data = stats.cashInOut.map((m) => ({
    name: m.period,
    inflow: m.inflow,
    outflow: m.outflow,
  }));
  const accounts = stats.bankVsGl.accounts;
  return (
    <Card data-testid="dashboard-cash-movement">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {L(locale, "Cash in and out", "حركة النقد الداخلة والخارجة")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-56 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} width={56} />
              <Tooltip formatter={(v: number) => formatCurrency(v, "AED", locale)} />
              <Legend />
              <Bar
                dataKey="inflow"
                name={L(locale, "Cash in", "داخل")}
                fill={CHART_COLORS.accent}
              />
              <Bar
                dataKey="outflow"
                name={L(locale, "Cash out", "خارج")}
                fill={CHART_COLORS.warning}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2" data-testid="dashboard-bank-vs-gl">
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
            {L(
              locale,
              "Bank statement balance vs general ledger",
              "رصيد كشف البنك مقابل دفتر الأستاذ"
            )}
          </div>
          {accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {L(
                locale,
                "No bank accounts are linked yet. The ledger cash balance is shown above; add a bank account in Banking to compare it with statements.",
                "لم يتم ربط حسابات بنكية بعد. يظهر رصيد النقد في الدفتر أعلاه؛ أضف حساباً بنكياً من صفحة البنوك لمقارنته بالكشوف."
              )}
            </p>
          ) : (
            accounts.map((a) => (
              <div
                key={a.bankAccountId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>{a.name}</span>
                <span className="flex items-center gap-3 font-mono tabular-nums">
                  <span>{formatCurrency(a.statementBalance, "AED", locale)}</span>
                  <span className="text-muted-foreground">
                    {a.glBalance === null ? "–" : formatCurrency(a.glBalance, "AED", locale)}
                  </span>
                  {a.difference !== null && a.difference !== 0 && (
                    <Badge variant="warning">{formatCurrency(a.difference, "AED", locale)}</Badge>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OverdueList({
  title,
  docs,
  href,
  locale,
  testId,
}: {
  title: string;
  docs: DashboardOverdueDocument[];
  href: string;
  locale: string;
  testId: string;
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <Link href={href}>
        <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
          {title}
        </div>
      </Link>
      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {L(locale, "Nothing overdue", "لا توجد مبالغ متأخرة")}
        </p>
      ) : (
        docs.map((d) => (
          <div key={d.documentId} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              {d.name}
              {d.number ? <span className="text-muted-foreground"> · {d.number}</span> : null}
            </span>
            <span className="flex items-center gap-2 font-mono tabular-nums">
              {formatCurrency(d.open, "AED", locale)}
              <Badge variant="danger">
                {d.daysPastDue} {L(locale, "d", "ي")}
              </Badge>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export function OverdueSummary({ stats, loading, locale }: WidgetProps) {
  if (loading || !stats) return <Skeleton className="h-40 w-full" />;
  return (
    <Card data-testid="dashboard-top-overdue">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{L(locale, "Top overdue", "أعلى المتأخرات")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <OverdueList
          title={L(locale, "Customers owing you", "عملاء مستحق عليهم")}
          docs={stats.topOverdue.receivables}
          href={stats.links.overdue}
          locale={locale}
          testId="overdue-receivables"
        />
        <OverdueList
          title={L(locale, "Bills you owe", "فواتير مستحقة عليك")}
          docs={stats.topOverdue.payables}
          href={stats.links.payables}
          locale={locale}
          testId="overdue-payables"
        />
      </CardContent>
    </Card>
  );
}

/** VAT and corporate tax from the ledger, linking to the filing pages (R13-22). */
export function TaxWidgets({ stats, loading, locale }: WidgetProps) {
  if (loading || !stats) return <Skeleton className="h-28 w-full" />;
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="dashboard-tax-widgets">
      <Tile
        href={stats.links.vat}
        label={L(locale, "VAT payable (ledger)", "ضريبة القيمة المضافة المستحقة (الدفتر)")}
        value={formatCurrency(stats.vat.netPayable, "AED", locale)}
        hint={`${L(locale, "Output", "مخرجات")} ${formatCurrency(stats.vat.outputVat, "AED", locale)} · ${L(locale, "Input", "مدخلات")} ${formatCurrency(stats.vat.inputVat, "AED", locale)}`}
        testId="tile-vat"
      />
      <Tile
        href={stats.links.corporateTax}
        label={L(
          locale,
          "Corporate tax estimate (fiscal year to date)",
          "تقدير ضريبة الشركات (منذ بداية السنة المالية)"
        )}
        value={formatCurrency(stats.corporateTax.estimatedLiability, "AED", locale)}
        hint={`${L(locale, "Taxable income", "الدخل الخاضع للضريبة")} ${formatCurrency(stats.corporateTax.taxableIncome, "AED", locale)} · ${L(locale, "an estimate, not a filed return", "تقدير وليس إقراراً مقدماً")}`}
        testId="tile-corporate-tax"
      />
    </section>
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
    .slice(0, 6);
  return (
    <Card data-testid="dashboard-budget-vs-actual">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>
            {L(locale, "Budget vs actual · this month", "الموازنة مقابل الفعلي · هذا الشهر")}
          </span>
          <Link href="/budgets">
            <span className="text-xs font-normal text-accent cursor-pointer">
              {L(locale, "Open budgets", "فتح الموازنات")}
            </span>
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {L(
              locale,
              "No approved budget covers this month. Approve a budget to compare it with actuals here.",
              "لا توجد موازنة معتمدة لهذا الشهر. اعتمد موازنة لمقارنتها بالفعلي هنا."
            )}
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.lineId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{r.accountName}</span>
              <span className="flex items-center gap-2 font-mono tabular-nums">
                <span className="text-muted-foreground">
                  {formatCurrency(r.budgeted, "AED", locale)}
                </span>
                <span>{formatCurrency(r.actual, "AED", locale)}</span>
                <Badge variant={r.favourable ? "success" : "danger"}>
                  {r.variance > 0 ? "+" : ""}
                  {formatCurrency(r.variance, "AED", locale)}
                </Badge>
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
