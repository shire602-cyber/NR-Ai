import { ReportLaunchPicker } from "@/components/reports/ReportLaunchPicker";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardActions({ m }: { m: DashboardModel }) {
  const {
    selectedCompanyId,
    preferredReportWorkspace,
    dashboardPinnedDeliveryAutomationCommand,
    queueDashboardReportDeliverySubscription,
    retryDashboardReportDeliveryRun,
    dashboardReportDeliveryLauncherPreviewById,
    queueDashboardReportDeliverySubscriptionWithHandoffGuard,
  } = m;
  return (
    <>
      <section data-testid="dashboard-report-launch-picker">
        <ReportLaunchPicker
          persona={preferredReportWorkspace.persona}
          companyId={selectedCompanyId}
          preferredDeliveryAutomationCommand={dashboardPinnedDeliveryAutomationCommand}
          onQueueDeliverySubscription={(subscriptionId) =>
            queueDashboardReportDeliverySubscriptionWithHandoffGuard(subscriptionId)
          }
          onRetryDeliveryRun={(runId) => retryDashboardReportDeliveryRun.mutate(runId)}
          queueingDeliverySubscriptionId={
            queueDashboardReportDeliverySubscription.isPending
              ? (queueDashboardReportDeliverySubscription.variables?.subscriptionId ?? null)
              : null
          }
          retryingDeliveryRunId={
            retryDashboardReportDeliveryRun.isPending
              ? (retryDashboardReportDeliveryRun.variables ?? null)
              : null
          }
          deliveryQueueDisabled={
            !selectedCompanyId || queueDashboardReportDeliverySubscription.isPending
          }
          deliveryRetryDisabled={!selectedCompanyId || retryDashboardReportDeliveryRun.isPending}
          deliverySubscriptionPreviewById={dashboardReportDeliveryLauncherPreviewById}
          compact
        />
      </section>
    </>
  );
}
