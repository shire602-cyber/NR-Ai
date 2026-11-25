import { FileText, ChevronDown } from "lucide-react";
import { T } from "@/components/layout/T";
import { formatMessage, useTranslation } from "@/lib/i18n";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspaceToggle({ m }: { m: DashboardModel }) {
  const { showReportWorkspace, toggleReportWorkspace, preferredReportQuickAccess } = m;
  const { t } = useTranslation();
  return (
    <>
      {/* ── Preferred report workspace (collapsed by default) ───────────── */}
      <section>
        <button
          type="button"
          onClick={toggleReportWorkspace}
          aria-expanded={showReportWorkspace}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3 text-start shadow-card-soft transition-colors duration-fast hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="dashboard-report-workspace-toggle"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <T k="pageLabels.reportsWorkspace" />
            <span className="font-normal text-muted-foreground">
              {formatMessage(t["dashboard.reportsReadyCount"], {
                ready: preferredReportQuickAccess.readyReports,
                total: preferredReportQuickAccess.reports.length,
              })}
            </span>
          </span>
          {/* Expand chevron: down / up, never mirrored in RTL (CTO 12). */}
          <ChevronDown
            aria-hidden
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base ${showReportWorkspace ? "rotate-180" : ""}`}
          />
        </button>
      </section>
    </>
  );
}
