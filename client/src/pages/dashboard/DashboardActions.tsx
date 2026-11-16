import { ReportLaunchPicker } from "@/components/reports/ReportLaunchPicker";
import { Plus, Receipt, BookOpen, BarChart3 } from "lucide-react";
import { QuickAction, SectionHeader } from "./Layout";
import type { DashboardModel } from "./useCustomerDashboardModel";
import { useTranslation } from "@/lib/i18n";

export function DashboardActions({ m }: { m: DashboardModel }) {
  const { t } = useTranslation();
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
      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow={t["dashboard.quickActionsEyebrow"]}
          title={t["dashboard.quickActionsTitle"]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 md:gap-4">
          <QuickAction
            icon={Plus}
            title={t["dashboard.quickCreateInvoice"]}
            description={t["dashboard.quickCreateInvoiceBody"]}
            href="/invoices"
            delay={0.05}
          />
          <QuickAction
            icon={Receipt}
            title={t["dashboard.quickScanReceipt"]}
            description={t["dashboard.quickScanReceiptBody"]}
            href="/receipts"
            delay={0.1}
          />
          <QuickAction
            icon={BookOpen}
            title={t["dashboard.quickJournalEntry"]}
            description={t["dashboard.quickJournalEntryBody"]}
            href="/journal"
            delay={0.15}
          />
          <QuickAction
            icon={BarChart3}
            title={t["dashboard.quickViewReports"]}
            description={t["dashboard.quickViewReportsBody"]}
            href="/reports"
            delay={0.2}
          />
        </div>
      </section>

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
        />
      </section>
    </>
  );
}
