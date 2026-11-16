import { Fragment, type ReactNode } from "react";
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

/** Fill `{name}` placeholders in a translated sentence with rich nodes. */
function fillTemplate(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const match = /^\{(\w+)\}$/.exec(part);
    return match && match[1] in values ? (
      <Fragment key={i}>{values[match[1]]}</Fragment>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

export function DashboardPlanning({ m }: { m: DashboardModel }) {
  const { t, locale, selectedCompanyId, stats, statsLoading, compliance, margin } = m;
  return (
    <>
      {/* ── Planning: comparison, drill-through, cash, overdue, tax, budget ── */}
      <PeriodComparison stats={stats} loading={statsLoading} locale={locale} />
      <DrillThroughTiles stats={stats} loading={statsLoading} locale={locale} />
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <CashMovement stats={stats} loading={statsLoading} locale={locale} />
        <div className="space-y-4 lg:space-y-6">
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
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="-me-2 text-accent hover:text-accent"
              >
                <Link href="/compliance-calendar">
                  {(t as any).calendarLink ?? "Calendar"}
                  <ArrowRight className="rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
            }
          />
          <Card className="overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-y-0 md:divide-x md:rtl:divide-x-reverse">
              {/* Audit readiness */}
              <div className="p-5 flex items-center gap-4">
                <ScoreRing score={compliance.auditReadiness?.score ?? 0} />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">
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
                  <div className="text-[13px] font-medium text-foreground">VAT 201</div>
                  <FilingStatusBadge status={compliance.vatStatus?.filingStatus} t={t as any} />
                </div>
                <div className="mt-2 text-sm tabular-nums text-foreground">
                  {compliance.vatStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.vatStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="-ms-3 mt-2 text-accent hover:text-accent"
                >
                  <Link href="/vat-filing">
                    {(t as any).openVatWorkspace ?? "Open VAT workspace"}
                    <ArrowRight className="rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
              </div>

              {/* Corporate tax */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-medium text-foreground">
                    {(t as any).corporateTaxLabel ?? "Corporate tax"}
                  </div>
                  <FilingStatusBadge status={compliance.corporateTaxStatus?.status} t={t as any} />
                </div>
                <div className="mt-2 text-sm tabular-nums text-foreground">
                  {compliance.corporateTaxStatus?.nextDue ? (
                    <>
                      {(t as any).nextDue ?? "Next due"}{" "}
                      {formatDate(compliance.corporateTaxStatus.nextDue, locale)}
                    </>
                  ) : (
                    ((t as any).noReturnFiledYet ?? "No return filed yet")
                  )}
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="-ms-3 mt-2 text-accent hover:text-accent"
                >
                  <Link href="/corporate-tax">
                    {(t as any).openTaxWorkpaper ?? "Open tax workpaper"}
                    <ArrowRight className="rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Fix-it list — each open item links to the screen that resolves it */}
            {(compliance.auditReadiness?.issues?.length ?? 0) > 0 && (
              <div className="border-t border-border">
                <div className="eyebrow px-5 pb-1 pt-4">
                  {(t as any).raiseYourScore ?? "Raise your score"}
                </div>
                <div className="divide-y divide-border pb-1.5">
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
            <Card className="overflow-hidden">
              <div className="flex items-start gap-4 p-5 md:p-6">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-accent dark:bg-brand-950">
                  <Sparkles className="h-[18px] w-[18px]" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-h3">
                      <T k="pageLabels.financialInsights" />
                    </h3>
                    <Badge variant="info" dot>
                      <T k="pageLabels.realTime" />
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
                    {stats.revenue > 0 && stats.expenses > 0 && (
                      <>
                        {fillTemplate(t["dashboard.insightMargin"], {
                          margin: (
                            <span className="money font-semibold text-foreground">
                              {margin.toFixed(1)}%
                            </span>
                          ),
                        })}
                        {stats.outstanding > 0 && (
                          <>
                            {" "}
                            {fillTemplate(t["dashboard.insightOutstanding"], {
                              amount: (
                                <span className="money font-semibold text-foreground">
                                  {formatCurrency(stats.outstanding, "AED", locale)}
                                </span>
                              ),
                            })}
                          </>
                        )}
                      </>
                    )}
                    {stats.revenue === 0 &&
                      stats.expenses === 0 &&
                      stats.outstanding > 0 &&
                      fillTemplate(t["dashboard.insightOutstandingOnly"], {
                        amount: (
                          <span className="money font-semibold text-foreground">
                            {formatCurrency(stats.outstanding, "AED", locale)}
                          </span>
                        ),
                      })}
                  </p>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="-ms-3 mt-3 text-accent hover:text-accent"
                  >
                    <Link href="/ai?tab=cfo">
                      <T k="pageLabels.talkToAICFO" />
                      <ArrowRight className="rtl:rotate-180" aria-hidden />
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          </motion.section>
        )}
    </>
  );
}
