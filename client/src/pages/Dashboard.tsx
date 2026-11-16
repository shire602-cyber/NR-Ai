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
    <div className="space-y-12">
      <DashboardHero m={m} />
      <DashboardOverview m={m} />
      <DashboardPlanning m={m} />
      <ReportWorkspaceToggle m={m} />
      {m.showReportWorkspace && <ReportWorkspaceSection m={m} />}
      <DashboardCharts m={m} />
      <DashboardActions m={m} />
      <DashboardRecent m={m} />
    </div>
  );
}
