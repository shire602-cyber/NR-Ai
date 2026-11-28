import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { ReportPanelFallback } from "@/pages/reports/ReportPanelFallback";
import { analyticsRedirectTarget } from "@/pages/reports/insights/model";

/**
 * Spec 3.11: /analytics, /advanced-analytics and /advanced-reports became the Insights tab of
 * /reports. The route stays (old links and bookmarks keep working) and forwards to the matching
 * Insights view. The legacy redirects in App.tsx still land here first:
 * /advanced-analytics -> /analytics?view=advanced, /advanced-reports -> /analytics?view=reports.
 */
export default function AnalyticsHub() {
  const search = useSearch();
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(analyticsRedirectTarget(search), { replace: true });
  }, [navigate, search]);
  return <ReportPanelFallback />;
}
