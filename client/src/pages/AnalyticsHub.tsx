import { TabbedHub } from "@/components/layout/TabbedHub";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { useTranslation } from "@/lib/i18n";

const Analytics = lazyWithReload(() => import("@/pages/Analytics"));
const AdvancedAnalytics = lazyWithReload(() => import("@/pages/AdvancedAnalytics"));
const AdvancedReports = lazyWithReload(() => import("@/pages/AdvancedReports"));

/**
 * R20-08: /analytics, /advanced-analytics and /advanced-reports share one
 * route with tabs. The Reports sidebar entry stays a single direct /reports
 * link; these tabs are reached from /analytics (and the legacy redirects).
 */
export default function AnalyticsHub() {
  const { t } = useTranslation();
  return (
    <TabbedHub
      title={t["analytics.hubTitle"]}
      defaultTab="overview"
      // AdvancedReports owns its own `?tab=` (comparison, ...), so the hub uses `view`.
      param="view"
      data-testid="page-analytics-hub"
      tabs={[
        { id: "overview", label: t["analytics.tabOverview"], content: <Analytics /> },
        { id: "advanced", label: t["analytics.tabAdvanced"], content: <AdvancedAnalytics /> },
        { id: "reports", label: t["analytics.tabReports"], content: <AdvancedReports /> },
      ]}
    />
  );
}
