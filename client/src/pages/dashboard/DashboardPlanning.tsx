import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Sparkles, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  BudgetVsActualWidget,
  CashMovement,
  DrillThroughTiles,
  OverdueSummary,
  PeriodComparison,
  TaxWidgets,
} from "./PlanningWidgets";
import { ScoreRing, FilingStatusBadge, FixItRow } from "./CompliancePulse";
import { openAuditChecks } from "./auditChecks";
import { SectionHeader } from "./Layout";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardPlanning({ m }: { m: DashboardModel }) {
  const { t, locale, selectedCompanyId, stats, statsLoading, compliance, margin } = m;
  return (
    <>
      {/* ── Planning: comparison, drill-through, cash, overdue, tax, budget ── */}
      <PeriodComparison stats={stats} loading={statsLoading} locale={locale} />
      <DrillThroughTiles stats={stats} loading={statsLoading} locale={locale} />
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CashMovement stats={stats} loading={statsLoading} locale={locale} />
        <div className="space-y-6">
          <OverdueSummary stats={stats} loading={statsLoading} locale={locale} />
          <BudgetVsActualWidget companyId={selectedCompanyId} asOf={stats?.asOf} locale={locale} />
        </div>
      </section>
      <TaxWidgets stats={stats} loading={statsLoading} locale={locale} />

      {/* ── Compliance pulse ─────────────────────────────────────────────── */}
      {compliance && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <SectionHeader
            eyebrow={(t as any).complianceEyebrow ?? "Compliance"}
            title={(t as any).filingPulse ?? "Filing pulse"}
            action={
              <Link href="/compliance-calendar">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-accent hover:text-accent -me-2"
                >
                  {(t as any).calendarLink ?? "Calendar"} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            }
          />
          <Card className="border-card-border overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/60">
              {/* Audit readiness */}
              <div className="p-5 flex items-center gap-4">
                <ScoreRing score={compliance.auditReadiness?.score ?? 0} />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {(t as any).auditReadiness ?? "Audit readiness"}
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground leading-snug">
                    {(compliance.auditReadiness?.issues?.length ?? 0) === 0
                      ? ((t as any).auditReadyBooks ?? "No open items — audit-ready books.")
                      : `${compliance.auditReadiness.issues.length} ${(t as any).openItemsToResolve ?? "open items to resolve"}`}
                  </div>
                </div>
              </div>

              {/* VAT 201 */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    VAT 201
                  </div>
                  <FilingStatusBadge status={compliance.vatStatus?.filingStatus} t={t as any} />
                </div>
                <div className="mt-2 font-mono tabular-nums text-[14px] text-foreground">
                  {compliance.vatStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.vatStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Link href="/vat-filing">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 -ms-3 gap-1 text-accent hover:text-accent"
                  >
                    {(t as any).openVatWorkspace ?? "Open VAT workspace"}{" "}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>

              {/* Corporate tax */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {(t as any).corporateTaxLabel ?? "Corporate tax"}
                  </div>
                  <FilingStatusBadge status={compliance.corporateTaxStatus?.status} t={t as any} />
                </div>
                <div className="mt-2 font-mono tabular-nums text-[14px] text-foreground">
                  {compliance.corporateTaxStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.corporateTaxStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Link href="/corporate-tax">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 -ms-3 gap-1 text-accent hover:text-accent"
                  >
                    {(t as any).openTaxWorkpaper ?? "Open tax workpaper"}{" "}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Fix-it list — each open item links to the screen that resolves it */}
            {(compliance.auditReadiness?.issues?.length ?? 0) > 0 && (
              <div className="border-t border-border/60">
                <div className="px-5 pt-3 pb-1 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  {(t as any).raiseYourScore ?? "Raise your score"}
                </div>
                <div className="divide-y divide-border/40 pb-1.5">
                  {openAuditChecks(compliance.auditReadiness).map((check) => (
                    <FixItRow key={check.key} check={check} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        </motion.section>
      )}

      {/* ── AI Insights — refined ────────────────────────────────────────── */}
      {!statsLoading &&
        stats &&
        (stats.revenue > 0 || stats.expenses > 0 || stats.outstanding > 0) && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
          >
            <Card className="overflow-hidden border-card-border">
              <div className="relative p-5 md:p-6">
                <div aria-hidden className="absolute inset-0 bg-spotlight pointer-events-none" />
                <div className="relative flex items-start gap-4">
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg ring-1 ring-accent/25 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-accent" />
                    </div>
                    <span
                      aria-hidden
                      className="absolute -inset-1 rounded-xl bg-accent/10 animate-ping-soft opacity-70"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold tracking-tight text-[15px]">
                        <T k="pageLabels.financialInsights" />
                      </h3>
                      <Badge variant="info" dot>
                        <T k="pageLabels.realTime" />
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed text-pretty">
                      {stats.revenue > 0 && stats.expenses > 0 && (
                        <>
                          Your profit margin is{" "}
                          <span className="font-mono font-semibold text-foreground">
                            {margin.toFixed(1)}%
                          </span>
                          .
                          {stats.outstanding > 0 && (
                            <>
                              {" "}
                              You have{" "}
                              <span className="font-mono font-semibold text-warning-subtle-foreground">
                                {formatCurrency(stats.outstanding, "AED", locale)}
                              </span>{" "}
                              in outstanding invoices that need attention.
                            </>
                          )}
                        </>
                      )}
                      {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding > 0 && (
                        <>
                          You have{" "}
                          <span className="font-mono font-semibold text-warning-subtle-foreground">
                            {formatCurrency(stats.outstanding, "AED", locale)}
                          </span>{" "}
                          in outstanding invoices.
                        </>
                      )}
                    </p>
                    <Link href="/ai?tab=cfo">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-3 -ms-3 gap-1.5 text-accent hover:text-accent"
                      >
                        <T k="pageLabels.talkToAICFO" />
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          </motion.section>
        )}
    </>
  );
}
