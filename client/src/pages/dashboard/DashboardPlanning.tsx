import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import {
  BudgetVsActualWidget,
  CashMovement,
  OverdueSummary,
  PeriodComparison,
} from "./PlanningWidgets";
import { ScoreRing, FilingStatusBadge, FixItRow } from "./CompliancePulse";
import { openAuditChecks } from "./auditChecks";
import type { DashboardModel } from "./useCustomerDashboardModel";

/** Planning (D2b, CTO 4): comparison + budget, then cash + overdue. */
export function DashboardPlanning({ m }: { m: DashboardModel }) {
  const { locale, selectedCompanyId, stats, statsLoading } = m;
  return (
    <>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <PeriodComparison stats={stats} loading={statsLoading} locale={locale} />
        </div>
        <div className="xl:col-span-2">
          <BudgetVsActualWidget companyId={selectedCompanyId} asOf={stats?.asOf} locale={locale} />
        </div>
      </section>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CashMovement stats={stats} loading={statsLoading} locale={locale} />
        <OverdueSummary stats={stats} loading={statsLoading} locale={locale} />
      </section>
    </>
  );
}

function FilingRow({
  label,
  status,
  nextDue,
  href,
  linkLabel,
  m,
}: {
  label: string;
  status: "up_to_date" | "due_soon" | "overdue" | undefined;
  nextDue: string | undefined;
  href: string;
  linkLabel: string;
  m: DashboardModel;
}) {
  const t = m.t as any;
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link
          href={href}
          className="text-small font-medium text-foreground hover:underline"
          title={linkLabel}
        >
          {label}
        </Link>
        <div className="text-caption text-muted-foreground">
          {nextDue
            ? `${t.nextDue ?? t["dashboardPlanning.nextDue"]} ${formatDate(nextDue, m.locale)}`
            : (t.noReturnFiledYet ?? "No return filed yet")}
        </div>
      </div>
      <FilingStatusBadge status={status} t={t} />
    </div>
  );
}

/**
 * Filing pulse (compact): audit readiness, VAT 201 and corporate tax as three rows,
 * with the fix-it list one click away instead of always open (CTO 4).
 */
export function CompliancePanel({ m }: { m: DashboardModel }) {
  const { t, compliance } = m;
  if (!compliance) return null;
  const tt = t as any;
  const issues = compliance.auditReadiness?.issues?.length ?? 0;
  const checks = issues > 0 ? openAuditChecks(compliance.auditReadiness) : [];
  return (
    <Card className="flex h-full flex-col" data-testid="dashboard-filing-pulse">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle>{tt.filingPulse ?? t["dashboardPlanning.filingPulse"]}</CardTitle>
        <Link
          href="/compliance-calendar"
          className="inline-flex items-center gap-1 text-small font-medium text-accent hover:underline"
        >
          {tt.calendarLink ?? "Calendar"}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        <div className="flex items-center gap-4 pb-3">
          <ScoreRing score={compliance.auditReadiness?.score ?? 0} />
          <div className="min-w-0">
            <div className="text-small font-medium text-foreground">
              {tt.auditReadiness ?? t["dashboardPlanning.auditReadiness"]}
            </div>
            <div className="text-caption text-muted-foreground">
              {issues === 0
                ? (tt.auditReadyBooks ?? "No open items — audit-ready books.")
                : `${issues} ${tt.openItemsToResolve ?? "open items to resolve"}`}
            </div>
          </div>
        </div>
        <div className="divide-hairline border-t border-border">
          <FilingRow
            m={m}
            label="VAT 201"
            status={compliance.vatStatus?.filingStatus}
            nextDue={compliance.vatStatus?.nextDue}
            href="/vat-filing"
            linkLabel={tt.openVatWorkspace ?? t["dashboardPlanning.openVatWorkspace"]}
          />
          <FilingRow
            m={m}
            label={tt.corporateTaxLabel ?? t["marketing.demoTabCt"]}
            status={compliance.corporateTaxStatus?.status}
            nextDue={compliance.corporateTaxStatus?.nextDue}
            href="/corporate-tax"
            linkLabel={tt.openTaxWorkpaper ?? t["dashboardPlanning.openTaxWorkpaper"]}
          />
        </div>
        {checks.length > 0 && (
          <details className="group border-t border-border pt-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md py-1.5 text-small font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span>
                {tt.raiseYourScore ?? t["dashboardPlanning.raiseYourScore"]}{" "}
                <span className="font-normal text-muted-foreground">({checks.length})</span>
              </span>
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform duration-base group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="-mx-5 divide-hairline">
              {checks.map((check) => (
                <FixItRow key={check.key} check={check} />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
