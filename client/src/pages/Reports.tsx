/**
 * Reports page shell (W5-A, R20-09). State lives in ./reports/useReportsPage; each workspace
 * panel and each focused-report tab is a lazily loaded module under ./reports/. Only the active
 * workspace panel is mounted (inactive panels were display:none before the split).
 */
import { lazy, Suspense } from "react";
import { ReportsPageContext } from "./reports/context";
import { useReportsPage } from "./reports/useReportsPage";
import { ReportPanelFallback } from "./reports/ReportPanelFallback";
import ReportsHeader from "./reports/panels/ReportsHeader";

const HomePanel = lazy(() => import("./reports/panels/HomePanel"));
const SuitesPanel = lazy(() => import("./reports/panels/SuitesPanel"));
const DeliveryPanel = lazy(() => import("./reports/panels/DeliveryPanel"));
const AutomationPanel = lazy(() => import("./reports/panels/AutomationPanel"));
const SetupPanel = lazy(() => import("./reports/panels/SetupPanel"));
const ComparisonsPanel = lazy(() => import("./reports/panels/ComparisonsPanel"));
const ReportsPanel = lazy(() => import("./reports/panels/ReportsPanel"));

export default function Reports() {
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
