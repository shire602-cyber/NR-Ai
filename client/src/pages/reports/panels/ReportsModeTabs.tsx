// Reports page top-level switch (spec 3.11): the report catalogue and Insights. Advanced
// workspaces (home, suites, delivery, automation, setup, comparisons) keep their own strip.
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import type { ReportsMode } from "../insights/model";

export default function ReportsModeTabs({ mode }: { mode: ReportsMode }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  return (
    <Tabs
      value={mode}
      onValueChange={(value) =>
        navigate(value === "insights" ? "/reports?workspace=insights" : "/reports")
      }
    >
      <TabsList aria-label={t["analytics.reportsModes"]}>
        <TabsTrigger value="reports" data-testid="tab-reports-mode-reports">
          {t["analytics.modeReports"]}
        </TabsTrigger>
        <TabsTrigger value="insights" data-testid="tab-reports-mode-insights">
          {t["analytics.modeInsights"]}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
