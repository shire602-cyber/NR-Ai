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
          className="rounded-2xl border border-accent/30 bg-accent/5 p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
          data-testid="card-first-invoice-guide"
        >
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">
              {t["dashboard.firstInvoiceTitle"]}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground max-w-2xl">
              {t["dashboard.firstInvoiceBody"]}
            </p>
          </div>
          <Link href="/invoices?new=1">
            <Button size="sm" data-testid="button-first-invoice">
              <FileText className="w-3.5 h-3.5" />
              {t["dashboard.firstInvoiceCta"]}
            </Button>
          </Link>
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
              className="rounded-2xl border border-warning/30 bg-warning/5 p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
              data-testid="card-draft-not-revenue"
            >
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-foreground">
                  {t["dashboard.draftNotRevenueTitle"]}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground max-w-2xl">
                  {formatMessage(t["dashboard.draftNotRevenueBody"], { count: draftCount })}
                </p>
              </div>
              <Link href="/invoices">
                <Button size="sm" variant="outline" data-testid="button-review-drafts">
                  {t["dashboard.draftNotRevenueCta"]}
                </Button>
              </Link>
            </section>
          );
        })()}

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
