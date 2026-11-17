import { useMemo } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { formatMessage } from "@/lib/i18n";
import { Link } from "wouter";
import { KpiCard } from "./KpiCard";
import type { DashboardModel } from "./useCustomerDashboardModel";

const OPEN_INVOICE_STATUSES = new Set(["sent", "partial"]);

/** Open / overdue receivable counts for the Receivables sub-line ("3 invoices · 2 overdue"). */
function receivableCounts(invoices: any[] | undefined, asOf: string | undefined) {
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  let open = 0;
  let overdue = 0;
  for (const invoice of invoices ?? []) {
    if (!OPEN_INVOICE_STATUSES.has(String(invoice.status))) continue;
    open += 1;
    const due = invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : null;
    if (due && due < today) overdue += 1;
  }
  return { open, overdue };
}

/**
 * KPI strips (D2b, CTO 4): one performance strip for the selected period and one
 * position strip as of today. Each figure appears once: Outstanding is the Receivables
 * tile (with its invoice count sub-line), VAT and the corporate-tax estimate share a tile.
 */
export function DashboardOverview({ m }: { m: DashboardModel }) {
  const { t, stats, statsLoading, recentInvoices, invoicesLoading, sparks, profit } = m;
  const tt = t as Record<string, string>;
  const counts = useMemo(
    () => receivableCounts(recentInvoices, stats?.asOf),
    [recentInvoices, stats?.asOf]
  );
  const vsPrior = tt["dashboard.vsPriorPeriod"];
  const margin = stats?.margin ?? null;
  // Net margin moves in percentage points against the prior period; its sparkline is the
  // monthly margin from the same trend the other three tiles draw (months without revenue = 0).
  const priorMargin = stats?.prior.margin ?? null;
  const marginDelta = margin !== null && priorMargin !== null ? margin - priorMargin : undefined;
  const marginSeries = useMemo(
    () =>
      sparks.revenue.series.map((revenue, i) =>
        revenue ? (sparks.profit.series[i] / Math.abs(revenue)) * 100 : 0
      ),
    [sparks.revenue.series, sparks.profit.series]
  );

  return (
    <>
      {!invoicesLoading &&
        (() => {
          const draftCount = (recentInvoices ?? []).filter(
            (invoice: any) => invoice.status === "draft"
          ).length;
          if (draftCount === 0 || (stats?.revenue ?? 0) > 0) return null;
          return (
            <Alert
              tone="warning"
              title={t["dashboard.draftNotRevenueTitle"]}
              data-testid="card-draft-not-revenue"
              action={
                <Button asChild size="sm" variant="outline" data-testid="button-review-drafts">
                  <Link href="/invoices">{t["dashboard.draftNotRevenueCta"]}</Link>
                </Button>
              }
            >
              {formatMessage(t["dashboard.draftNotRevenueBody"], { count: draftCount })}
            </Alert>
          );
        })()}

      <section className="space-y-4" aria-labelledby="dashboard-kpi-heading">
        <h2 id="dashboard-kpi-heading" className="sr-only">
          {tt["dashboard.performanceHeading"]}
        </h2>
        {/* ── Performance (selected period) ─────────────────────────────── */}
        <div className="mobile-keep-cols grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <KpiCard
            label={tt["dashboard.kpiRevenue"]}
            value={<Money amount={stats?.revenue ?? 0} data-testid="text-revenue" />}
            delta={sparks.revenue.delta}
            trend={
              sparks.revenue.delta === undefined
                ? undefined
                : sparks.revenue.delta >= 0
                  ? "up"
                  : "down"
            }
            deltaContext={vsPrior}
            spark={sparks.revenue.series}
            hint={
              stats?.otherIncome ? (
                <span data-testid="text-other-income">
                  {tt["dashboard.otherIncomeLabel"]}{" "}
                  <Money amount={stats.otherIncome} tone="auto" />
                </span>
              ) : undefined
            }
            accent="brand"
            href={stats?.links.revenue}
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiExpenses"]}
            value={<Money amount={stats?.expenses ?? 0} data-testid="text-expenses" />}
            delta={sparks.expenses.delta}
            trend={
              sparks.expenses.delta === undefined
                ? undefined
                : sparks.expenses.delta > 0
                  ? "down"
                  : "up"
            }
            deltaContext={vsPrior}
            spark={sparks.expenses.series}
            accent="neutral"
            href={stats?.links.expenses}
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiNetProfit"]}
            value={<Money amount={profit} tone="auto" data-testid="text-profit" />}
            delta={sparks.profit.delta}
            trend={
              sparks.profit.delta === undefined
                ? undefined
                : sparks.profit.delta >= 0
                  ? "up"
                  : "down"
            }
            deltaContext={vsPrior}
            spark={sparks.profit.series}
            accent="brand"
            href={stats?.links.netProfit}
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiNetMargin"]}
            value={
              <span
                className={margin !== null && margin < 0 ? "money text-negative" : "money"}
                dir="ltr"
                data-testid="text-net-margin"
              >
                {margin === null ? "—" : `${margin < 0 ? "−" : ""}${Math.abs(margin).toFixed(1)}%`}
              </span>
            }
            delta={marginDelta}
            deltaLabel={
              marginDelta === undefined
                ? undefined
                : formatMessage(tt["dashboard.marginDeltaPts"], {
                    value: `${marginDelta > 0 ? "+" : marginDelta < 0 ? "−" : ""}${Math.abs(marginDelta).toFixed(1)}`,
                  })
            }
            trend={marginDelta === undefined ? undefined : marginDelta >= 0 ? "up" : "down"}
            deltaContext={vsPrior}
            spark={marginSeries}
            accent="brand"
            isLoading={statsLoading}
          />
        </div>

        {/* ── Position (as of today) ─────────────────────────────────────── */}
        <div
          className="mobile-keep-cols grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          data-testid="dashboard-drill-tiles"
        >
          <KpiCard
            label={tt["dashboard.kpiCash"]}
            value={<Money amount={stats?.cashPosition ?? 0} tone="auto" />}
            hint={
              stats?.cashRunway == null
                ? tt["dashboard.cashFromLedger"]
                : formatMessage(tt["dashboard.cashRunwayHint"], {
                    months: stats.cashRunway.toFixed(1),
                  })
            }
            href={stats?.links.cash}
            testId="tile-cash"
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiReceivables"]}
            value={<Money amount={stats?.outstanding ?? 0} data-testid="text-outstanding" />}
            hint={
              counts.open === 0
                ? tt["dashboard.receivablesHintNone"]
                : formatMessage(tt["dashboard.receivablesHint"], {
                    open: counts.open,
                    overdue: counts.overdue,
                  })
            }
            href={stats?.links.outstanding}
            testId="tile-receivables"
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiPayables"]}
            value={<Money amount={stats?.outstandingPayables ?? 0} />}
            hint={
              stats?.dpo == null
                ? tt["dashboard.payablesHintNone"]
                : formatMessage(tt["dashboard.payablesHint"], { days: stats.dpo.toFixed(1) })
            }
            href={stats?.links.payables}
            testId="tile-payables"
            isLoading={statsLoading}
          />
          <KpiCard
            label={tt["dashboard.kpiVatPayable"]}
            value={<Money amount={stats?.vat.netPayable ?? 0} />}
            hint={
              stats ? (
                <span data-testid="tile-corporate-tax">
                  {formatMessage(tt["dashboard.vatHint"], { amount: "" })}
                  <Money amount={stats.corporateTax.estimatedLiability} />
                </span>
              ) : undefined
            }
            href={stats?.links.vat}
            testId="tile-vat"
            isLoading={statsLoading}
          />
        </div>
      </section>
    </>
  );
}
