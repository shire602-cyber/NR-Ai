import { ReportLaunchPicker } from "@/components/reports/ReportLaunchPicker";
import { Plus, Receipt, BookOpen, BarChart3 } from "lucide-react";
import { QuickAction, SectionHeader } from "./Layout";
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
      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Shortcuts" title="Quick actions" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickAction
            icon={Plus}
            title="Create Invoice"
            description="Create VAT-ready tax invoices in seconds"
            href="/invoices"
            delay={0.05}
          />
          <QuickAction
            icon={Receipt}
            title="Scan Receipt"
            description="OCR receipts straight into your books"
            href="/receipts"
            delay={0.1}
          />
          <QuickAction
            icon={BookOpen}
            title="Journal Entry"
            description="Record manual double-entry transactions"
            href="/journal"
            delay={0.15}
          />
          <QuickAction
            icon={BarChart3}
            title="View Reports"
            description="P&L, balance sheet, cash flow — exportable"
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
