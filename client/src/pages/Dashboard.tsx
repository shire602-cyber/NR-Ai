import { TrialBanner } from "@/components/TrialBanner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ClientDashboard from "./ClientDashboard";
import { useCustomerDashboardModel } from "./dashboard/useCustomerDashboardModel";
import { DashboardHero } from "./dashboard/DashboardHero";
import { DashboardOverview } from "./dashboard/DashboardOverview";
import { DashboardPlanning } from "./dashboard/DashboardPlanning";
import { DashboardCharts } from "./dashboard/DashboardCharts";
import { DashboardRecent } from "./dashboard/DashboardRecent";
import { DashboardEmpty, isEmptyCompany } from "./dashboard/DashboardEmpty";
import { GettingStarted } from "./dashboard/GettingStarted";
import { EInvoiceReadinessCard } from "@/components/einvoice/EInvoiceReadinessCard";

// Dashboard page shell. State and derived data live in
// dashboard/useCustomerDashboardModel; each visual section is a component under dashboard/.
// Reports live under Reports (spec 3.6): the dashboard no longer carries the report workspace.

export default function Dashboard() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (user?.userType === "client") return <ClientDashboard />;
  return <CustomerDashboard />;
}

function CustomerDashboard() {
  const m = useCustomerDashboardModel();
  const empty = isEmptyCompany(m);
  return (
    // Rhythm (spec 2.2): 32px between sections, 16px inside them.
    <div className="space-y-8">
      <TrialBanner />
      <DashboardHero m={m} empty={empty} />
      {empty ? (
        <DashboardEmpty m={m} />
      ) : (
        <>
          <GettingStarted m={m} />
          <DashboardOverview m={m} />
          <DashboardCharts m={m} />
          <DashboardPlanning m={m} />
          <EInvoiceReadinessCard companyId={m.selectedCompanyId} />
          <DashboardRecent m={m} />
        </>
      )}
    </div>
  );
}
