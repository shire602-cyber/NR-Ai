/**
 * Reports page shell (W5-A, R20-09). State lives in ./reports/useReportsPage; each workspace
 * panel and each focused-report tab is a lazily loaded module under ./reports/. Only the active
 * workspace panel is mounted (inactive panels were display:none before the split).
 *
 * Spec 3.11: `?workspace=insights` is the Insights surface (cash flow, ageing, period
 * comparison, budget vs actual). It owns its queries and never mounts useReportsPage.
 */
import { lazy, Suspense } from "react";
import { useSearch } from "wouter";
import { ReportsPageContext } from "./reports/context";
import { useCatalogRevision, useTranslation } from "@/lib/i18n";
import { useReportsPage } from "./reports/useReportsPage";
import { ReportPanelFallback } from "./reports/ReportPanelFallback";
import ReportsHeader from "./reports/panels/ReportsHeader";
import ReportsModeTabs from "./reports/panels/ReportsModeTabs";
import { reportsModeFromSearch } from "./reports/insights/model";
import { PageHeader } from "@/components/ui/page-header";

const HomePanel = lazy(() => import("./reports/panels/HomePanel"));
const SuitesPanel = lazy(() => import("./reports/panels/SuitesPanel"));
const DeliveryPanel = lazy(() => import("./reports/panels/DeliveryPanel"));
const AutomationPanel = lazy(() => import("./reports/panels/AutomationPanel"));
const SetupPanel = lazy(() => import("./reports/panels/SetupPanel"));
const ComparisonsPanel = lazy(() => import("./reports/panels/ComparisonsPanel"));
const ReportsPanel = lazy(() => import("./reports/panels/ReportsPanel"));
const InsightsPanel = lazy(() => import("./reports/insights/InsightsPanel"));

// The report models are memoised and translate through `translateNow`, so the page remounts when
// the locale or the loaded catalogs change.
export default function Reports() {
  const { locale } = useTranslation();
  const revision = useCatalogRevision();
  const search = useSearch();
  if (reportsModeFromSearch(search) === "insights") return <InsightsPage />;
  return <ReportsPage key={`${locale}:${revision}`} />;
}

function InsightsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title={t.reports}
        description={t["analytics.insightsDescription"]}
      />
      <ReportsModeTabs mode="insights" />
      <Suspense fallback={<ReportPanelFallback />}>
        <InsightsPanel />
      </Suspense>
    </div>
  );
}

function ReportsPage() {
  const state = useReportsPage();
  const workspace = state.activeReportWorkspaceTab;
  return (
    <ReportsPageContext.Provider value={state}>
      <div className="space-y-8">
        <ReportsHeader />
        <Suspense fallback={<ReportPanelFallback />}>
          {workspace === "home" ? <HomePanel /> : null}
          {workspace === "suites" ? <SuitesPanel /> : null}
          {workspace === "delivery" ? <DeliveryPanel /> : null}
          {workspace === "automation" ? <AutomationPanel /> : null}
          {workspace === "setup" ? <SetupPanel /> : null}
          {workspace === "comparisons" ? <ComparisonsPanel /> : null}
          {workspace === "reports" ? <ReportsPanel /> : null}
        </Suspense>
      </div>
    </ReportsPageContext.Provider>
  );
}
