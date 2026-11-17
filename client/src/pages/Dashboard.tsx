import { TrialBanner } from "@/components/TrialBanner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ClientDashboard from "./ClientDashboard";
import { useCustomerDashboardModel } from "./dashboard/useCustomerDashboardModel";
import { DashboardHero } from "./dashboard/DashboardHero";
import { DashboardOverview } from "./dashboard/DashboardOverview";
import { DashboardPlanning } from "./dashboard/DashboardPlanning";
import { ReportWorkspaceToggle } from "./dashboard/ReportWorkspaceToggle";
import { ReportWorkspaceSection } from "./dashboard/ReportWorkspaceSection";
import { DashboardCharts } from "./dashboard/DashboardCharts";
import { DashboardActions } from "./dashboard/DashboardActions";
import { DashboardRecent } from "./dashboard/DashboardRecent";

// Dashboard page shell. State and derived data live in
// dashboard/useCustomerDashboardModel; each visual section is a component under dashboard/.

export default function Dashboard() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (user?.userType === "client") return <ClientDashboard />;
  return <CustomerDashboard />;
}

function CustomerDashboard() {
  const m = useCustomerDashboardModel();
  return (
    // Rhythm (CTO 4): 40px between sections, 16px inside them.
    <div className="space-y-8 md:space-y-10">
      <TrialBanner />
      <DashboardHero m={m} />
      <DashboardOverview m={m} />
      <DashboardCharts m={m} />
      <DashboardPlanning m={m} />
      <DashboardRecent m={m} />
      {/* Reports: one collapsed row; the launcher and workspace open together (CTO 5). */}
      <div className="space-y-4">
        <ReportWorkspaceToggle m={m} />
        {m.showReportWorkspace && (
          <>
            <DashboardActions m={m} />
            <ReportWorkspaceSection m={m} />
          </>
        )}
      </div>
    </div>
  );
}
