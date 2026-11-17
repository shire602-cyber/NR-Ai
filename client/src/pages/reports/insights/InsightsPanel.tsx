// Reports > Insights (spec 3.11): one surface replacing /analytics, /advanced-analytics and
// /advanced-reports. Four views behind a segmented control; each view owns its queries, so the
// Insights tab never mounts the Report Center state (useReportsPage).
import { lazy, Suspense } from "react";
import { useLocation, useSearch } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { InsightsSkeleton } from "./shared";
import { INSIGHTS_VIEWS, type InsightsView, insightsHref, insightsViewFromSearch } from "./model";

const CashFlowView = lazy(() => import("./CashFlowView"));
const AgeingView = lazy(() => import("./AgeingView"));
const ComparisonView = lazy(() => import("./ComparisonView"));
const BudgetView = lazy(() => import("./BudgetView"));

export default function InsightsPanel() {
  const { t } = useTranslation();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { companyId, isLoading } = useDefaultCompany();
  const view = insightsViewFromSearch(search);
  const labels: Record<InsightsView, string> = {
    "cash-flow": t["analytics.viewCashFlow"],
    ageing: t["analytics.viewAgeing"],
    comparison: t["analytics.viewComparison"],
    budget: t["analytics.viewBudget"],
  };
  return (
    <section
      className="space-y-6"
      aria-label={t["analytics.insightsTitle"]}
      data-testid="insights-panel"
    >
      <Tabs value={view} onValueChange={(v) => navigate(insightsHref(v as InsightsView))}>
        <TabsList aria-label={t["analytics.insightsViews"]}>
          {INSIGHTS_VIEWS.map((id) => (
            <TabsTrigger key={id} value={id} data-testid={`tab-insights-${id}`}>
              {labels[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {isLoading || !companyId ? (
        <InsightsSkeleton />
      ) : (
        <Suspense fallback={<InsightsSkeleton />}>
          {view === "cash-flow" ? <CashFlowView companyId={companyId} /> : null}
          {view === "ageing" ? <AgeingView companyId={companyId} /> : null}
          {view === "comparison" ? <ComparisonView companyId={companyId} /> : null}
          {view === "budget" ? <BudgetView companyId={companyId} /> : null}
        </Suspense>
      )}
    </section>
  );
}
