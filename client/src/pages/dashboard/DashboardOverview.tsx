import { Button } from "@/components/ui/button";
import { formatMessage } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { FileText } from "lucide-react";
import { Link } from "wouter";
import { PeriodSelector } from "./PeriodSelector";
import { KpiCard } from "./KpiCard";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardOverview({ m }: { m: DashboardModel }) {
  const {
    t,
    locale,
    periodChoice,
    setPeriodChoice,
    stats,
    statsLoading,
    recentInvoices,
    invoicesLoading,
    sparks,
    profit,
  } = m;
  return (
    <>
      {/* ── Period selector (R13-19) ─────────────────────────────────────── */}
      <PeriodSelector choice={periodChoice} onChange={setPeriodChoice} locale={locale} />

      {/* ── First-invoice guide / draft explainer (R18-07, R18-12, R18-13) ──── */}
      {!invoicesLoading && (recentInvoices?.length ?? 0) === 0 && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/50 md:flex-row md:items-center md:justify-between md:p-5"
          data-testid="card-first-invoice-guide"
        >
          <div className="min-w-0">
            <h2 className="text-h3 text-foreground">{t["dashboard.firstInvoiceTitle"]}</h2>
            <p className="mt-0.5 max-w-2xl text-small text-muted-foreground">
              {t["dashboard.firstInvoiceBody"]}
            </p>
          </div>
          <Button asChild size="sm" className="shrink-0" data-testid="button-first-invoice">
            <Link href="/invoices?new=1">
              <FileText aria-hidden />
              {t["dashboard.firstInvoiceCta"]}
            </Link>
          </Button>
        </section>
      )}
      {!invoicesLoading &&
        (() => {
          const draftCount = (recentInvoices ?? []).filter(
            (invoice: any) => invoice.status === "draft"
          ).length;
          if (draftCount === 0 || (stats?.revenue ?? 0) > 0) return null;
          return (
            <section
              className="flex flex-col gap-3 rounded-xl border border-warning/25 bg-warning-subtle p-4 md:flex-row md:items-center md:justify-between md:p-5"
              data-testid="card-draft-not-revenue"
            >
              <div className="min-w-0">
                <h2 className="text-h3 text-warning-subtle-foreground">
                  {t["dashboard.draftNotRevenueTitle"]}
                </h2>
                <p className="mt-0.5 max-w-2xl text-small text-warning-subtle-foreground">
                  {formatMessage(t["dashboard.draftNotRevenueBody"], { count: draftCount })}
                </p>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="shrink-0"
                data-testid="button-review-drafts"
              >
                <Link href="/invoices">{t["dashboard.draftNotRevenueCta"]}</Link>
              </Button>
            </section>
          );
        })()}

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={(t as any).revenue ?? "Revenue"}
          value={formatCurrency(stats?.revenue || 0, "AED", locale)}
          delta={sparks.revenue.delta}
          trend={
            sparks.revenue.delta === undefined
              ? undefined
              : sparks.revenue.delta >= 0
                ? "up"
                : "down"
          }
          spark={sparks.revenue.series}
          accent="success"
          isLoading={statsLoading}
          delay={0.05}
        />
        <KpiCard
          label={(t as any).expenses ?? "Expenses"}
          value={formatCurrency(stats?.expenses || 0, "AED", locale)}
          delta={sparks.expenses.delta}
          trend={
            sparks.expenses.delta === undefined
              ? undefined
              : sparks.expenses.delta >= 0
                ? "down"
                : "up"
          }
          spark={sparks.expenses.series}
          accent="warning"
          isLoading={statsLoading}
          delay={0.1}
        />
        <KpiCard
          label={(t as any).profit ?? "Profit"}
          value={formatCurrency(profit, "AED", locale)}
          delta={sparks.profit.delta}
          trend={
            sparks.profit.delta === undefined ? undefined : sparks.profit.delta >= 0 ? "up" : "down"
          }
          spark={sparks.profit.series}
          accent="primary"
          isLoading={statsLoading}
          delay={0.15}
        />
        <KpiCard
          label={(t as any).outstanding ?? "Outstanding"}
          value={formatCurrency(stats?.outstanding || 0, "AED", locale)}
          accent="info"
          isLoading={statsLoading}
          delay={0.2}
        />
      </section>
    </>
  );
}
