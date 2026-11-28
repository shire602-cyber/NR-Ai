import { FileText, Landmark, LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useReadOnlyPlanCta } from "@/hooks/useReadOnlyPlanCta";
import { GettingStarted } from "./GettingStarted";
import type { DashboardModel } from "./useCustomerDashboardModel";

/**
 * First run of the dashboard (spec 3.6 / 2.6): one large empty state that says what the page
 * becomes, plus the Getting started list. No zero tiles and no empty chart axes.
 */
export function DashboardEmpty({ m }: { m: DashboardModel }) {
  const tt = m.t as Record<string, string>;
  const planCta = useReadOnlyPlanCta();
  return (
    <div className="space-y-section" data-testid="dashboard-empty-company">
      <EmptyState
        size="lg"
        icon={LayoutDashboard}
        title={tt["dashboard.emptyCompanyTitle"]}
        description={tt["dashboard.emptyCompanyBody"]}
        action={{
          label: planCta?.label ?? tt["dashboard.gsInvoice"],
          href: planCta?.href ?? "/invoices?new=1",
          icon: FileText,
        }}
        secondaryAction={{
          label: tt["dashboard.emptyCompanyImport"],
          href: "/bank-accounts",
          icon: Landmark,
        }}
        previewColumns={4}
      />
      <GettingStarted m={m} alwaysShow />
    </div>
  );
}
