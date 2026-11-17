import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMessage, useTranslation } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RevenueData {
  totalMRR: number;
  revenueByClient: { companyId: string; companyName: string; totalRevenue: number }[];
  revenueGrowthPercent: number;
  avgRevenuePerClient: number;
}

interface UtilizationData {
  staffCount: number;
  clientsPerStaff: number;
  avgClientsPerAdmin: number;
  totalClients: number;
}

interface HealthSummaryData {
  healthDistribution: { healthy: number; attention: number; critical: number };
  topIssues: { type: string; count: number; affectedClients: number }[];
}

const ISSUE_LABEL: Record<string, string> = {
  overdue_invoices: "firmOps.issueOverdueInvoices",
  overdue_vat: "firmOps.issueOverdueVat",
};

// Opacity steps for one-hue ranked bars (spec 2.7).
const BAR_OPACITY = [1, 0.7, 0.5, 0.35, 0.25];

interface RankedRow {
  key: string;
  label: string;
  value: number;
  display: ReactNode;
}

/** Ranked horizontal bars: label, thin bar in the brand hue, value at the end. */
function RankedList({ rows, testId }: { rows: RankedRow[]; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3" data-testid={testId}>
      {rows.map((row, i) => (
        <li key={row.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-small">
            <span className="min-w-0 truncate text-foreground" dir="auto">
              {row.label}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">{row.display}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-surface-sunken" aria-hidden="true">
            <div
              className="h-1.5 rounded-full bg-[hsl(var(--chart-1))]"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                opacity: BAR_OPACITY[Math.min(i, BAR_OPACITY.length - 1)],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Firm analytics (NR-only, spec 3.17): revenue, utilisation and client health. */
export default function FirmAnalytics() {
  const { t } = useTranslation();

  const { data: revenue, isLoading: revLoading } = useQuery<RevenueData>({
    queryKey: ["/api/firm/analytics/revenue"],
  });
  const { data: utilization, isLoading: utilLoading } = useQuery<UtilizationData>({
    queryKey: ["/api/firm/analytics/utilization"],
  });
  const { data: health, isLoading: healthLoading } = useQuery<HealthSummaryData>({
    queryKey: ["/api/firm/analytics/client-health-summary"],
  });

  const header = (
    <PageHeader
      eyebrow="Firm"
      title={t["firmOps.analyticsTitle"]}
      description={t["firmOps.analyticsDescription"]}
    />
  );

  if (revLoading || utilLoading || healthLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const growth = revenue?.revenueGrowthPercent ?? 0;
  const byClient = (revenue?.revenueByClient ?? []).slice(0, 10);
  const dist = health?.healthDistribution;
  const healthRows: RankedRow[] = dist
    ? [
        { key: "healthy", label: t["firmOps.healthHealthy"], value: dist.healthy },
        { key: "attention", label: t["firmOps.healthAttention"], value: dist.attention },
        { key: "critical", label: t["firmOps.healthCritical"], value: dist.critical },
      ]
        .filter((r) => r.value > 0)
        .map((r) => ({ ...r, display: r.value }))
    : [];

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t["firmOps.statMrr"]}
          value={<Money amount={revenue?.totalMRR ?? 0} currency="AED" />}
          delta={
            growth !== 0
              ? {
                  label: `${Math.abs(growth)}%`,
                  direction: growth > 0 ? "up" : "down",
                  tone: growth > 0 ? "positive" : "negative",
                  context: t["firmOps.vsLast30Days"],
                }
              : undefined
          }
          hint={t["firmOps.vsLast30Days"]}
        />
        <StatCard
          label={t["firmOps.statAvgPerClient"]}
          value={<Money amount={revenue?.avgRevenuePerClient ?? 0} currency="AED" />}
        />
        <StatCard
          label={t["firmOps.statClients"]}
          value={utilization?.totalClients ?? 0}
          hint={formatMessage(t["firmOps.staffCount"], { count: utilization?.staffCount ?? 0 })}
        />
        <StatCard
          label={t["firmOps.statClientsPerStaff"]}
          value={utilization?.clientsPerStaff ?? 0}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <SectionCard className="xl:col-span-2" title={t["firmOps.revenueByClient"]}>
          {byClient.length === 0 ? (
            <p className="text-small text-muted-foreground">{t["firmOps.revenueByClientEmpty"]}</p>
          ) : (
            <RankedList
              testId="firm-revenue-by-client"
              rows={byClient.map((r) => ({
                key: r.companyId,
                label: r.companyName,
                value: r.totalRevenue,
                display: <Money amount={r.totalRevenue} currency="AED" />,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard title={t["firmOps.clientHealth"]}>
          {healthRows.length === 0 ? (
            <p className="text-small text-muted-foreground">{t["firmOps.clientHealthEmpty"]}</p>
          ) : (
            <RankedList rows={healthRows} testId="firm-client-health" />
          )}
          {(health?.topIssues?.length ?? 0) > 0 && (
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              <p className="text-caption font-medium text-muted-foreground">
                {t["firmOps.topIssues"]}
              </p>
              <ul className="space-y-1.5">
                {health!.topIssues.map((issue) => (
                  <li key={issue.type} className="text-small text-foreground">
                    {ISSUE_LABEL[issue.type] ? t[ISSUE_LABEL[issue.type]] : t["firmOps.issueOther"]}
                    <span className="text-muted-foreground">
                      {" · "}
                      {formatMessage(t["firmOps.issueCounts"], {
                        count: issue.count,
                        clients: issue.affectedClients,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={t["firmOps.staffUtilization"]}>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-caption text-muted-foreground">{t["firmOps.totalStaff"]}</dt>
            <dd className="text-h2 font-semibold tabular-nums">{utilization?.staffCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">
              {t["firmOps.statClientsPerStaff"]}
            </dt>
            <dd className="text-h2 font-semibold tabular-nums">
              {utilization?.clientsPerStaff ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">
              {t["firmOps.avgClientsPerAdmin"]}
            </dt>
            <dd className="text-h2 font-semibold tabular-nums">
              {utilization?.avgClientsPerAdmin ?? 0}
            </dd>
          </div>
        </dl>
      </SectionCard>
    </div>
  );
}
