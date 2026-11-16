import { FileText, ChevronRight } from "lucide-react";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspaceToggle({ m }: { m: DashboardModel }) {
  const { showReportWorkspace, toggleReportWorkspace, preferredReportQuickAccess } = m;
  return (
    <>
      {/* ── Preferred report workspace (collapsed by default) ───────────── */}
      <section>
        <button
          type="button"
          onClick={toggleReportWorkspace}
          aria-expanded={showReportWorkspace}
          className="flex w-full items-center justify-between rounded-xl border border-card-border bg-card/60 px-4 py-3 text-left transition-colors hover:bg-card"
          data-testid="dashboard-report-workspace-toggle"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
            <FileText className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <T k="pageLabels.reportsWorkspace" />
            <span className="font-normal text-muted-foreground">
              · {preferredReportQuickAccess.readyReports}/
              {preferredReportQuickAccess.reports.length} ready
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${showReportWorkspace ? "rotate-90" : ""}`}
          />
        </button>
      </section>
    </>
  );
}
