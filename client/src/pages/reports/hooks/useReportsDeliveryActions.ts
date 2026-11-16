// Report delivery mutations: save settings, queue (with handoff guard) and retry runs.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import { SaveReportDeliverySubscriptionSettingsInput } from "../shared";
import { translateNow } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsAutomationOverviewState } from "./useReportsAutomationOverview";
import type { ReportsDeliveryStateState } from "./useReportsDeliveryState";

type UseReportsDeliveryActionsDeps = Pick<
  ReportsWorkspaceStateState & ReportsAutomationOverviewState & ReportsDeliveryStateState,
  | "editingReportDeliverySubscriptionId"
  | "isReportDeliveryHandoffAcknowledged"
  | "reportDeliveryAutomationCommandTargets"
  | "reportDeliveryPlansQuery"
  | "reportDeliveryRunsQuery"
  | "reportDeliverySchedulerHealthQuery"
  | "reportDeliverySubscriptionHasReviewHandoff"
  | "reportDeliverySubscriptionSummaries"
  | "selectedCompanyId"
  | "setAcknowledgedReportDeliveryHandoffGaps"
  | "setEditingReportDeliverySubscriptionId"
  | "toast"
>;

export function useReportsDeliveryActions({
  editingReportDeliverySubscriptionId,
  isReportDeliveryHandoffAcknowledged,
  reportDeliveryAutomationCommandTargets,
  reportDeliveryPlansQuery,
  reportDeliveryRunsQuery,
  reportDeliverySchedulerHealthQuery,
  reportDeliverySubscriptionHasReviewHandoff,
  reportDeliverySubscriptionSummaries,
  selectedCompanyId,
  setAcknowledgedReportDeliveryHandoffGaps,
  setEditingReportDeliverySubscriptionId,
  toast,
}: UseReportsDeliveryActionsDeps) {
  const saveReportDeliverySubscriptionSettings = useMutation({
    mutationFn: ({ subscriptionId, ...settings }: SaveReportDeliverySubscriptionSettingsInput) => {
      if (!selectedCompanyId) throw new Error("Select a company before updating delivery.");
      return apiRequest(
        "PATCH",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/settings`,
        settings
      );
    },
    onSuccess: (result: any, variables) => {
      reportDeliveryPlansQuery.refetch();
      if (variables.subscriptionId === editingReportDeliverySubscriptionId) {
        setEditingReportDeliverySubscriptionId(null);
      }
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const onlyToggledEnabled =
        variables.enabled !== undefined &&
        variables.cadence === undefined &&
        variables.channel === undefined &&
        variables.format === undefined &&
        variables.recipients === undefined &&
        variables.deliveryGuardrail === undefined;
      toast({
        title: onlyToggledEnabled
          ? result?.subscription?.enabled
            ? translateNow("reportCenter.deliveryEnabledToast")
            : translateNow("reportCenter.deliveryPausedToast")
          : "Report delivery settings saved",
        description: `${subscriptionTitle} now uses company delivery settings.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update report delivery",
        description: error?.message || "Failed to update report delivery settings",
        variant: "destructive",
      });
    },
  });
  const queueReportDeliverySubscription = useMutation({
    mutationFn: ({
      subscriptionId,
      acknowledgeHandoffGaps,
    }: {
      subscriptionId: string;
      acknowledgeHandoffGaps?: boolean;
    }) => {
      if (!selectedCompanyId) throw new Error("Select a company before queuing delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/queue`,
        acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true } : undefined
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: "Report delivery queued",
        description: nextRunLabel
          ? `${subscriptionTitle} queued for ${nextRunLabel}.`
          : `${subscriptionTitle} queued as an in-app reminder.`,
      });
    },
    onError: (error: any) => {
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      toast({
        title: "Could not queue report delivery",
        description: error?.message || "Failed to queue report delivery",
        variant: "destructive",
      });
    },
  });
  const queueReportDeliverySubscriptionWithHandoffGuard = useCallback(
    (subscriptionId: string) => {
      if (
        reportDeliverySubscriptionHasReviewHandoff(subscriptionId) &&
        !isReportDeliveryHandoffAcknowledged(subscriptionId)
      ) {
        const subscription = reportDeliverySubscriptionSummaries.find(
          (item) => item.id === subscriptionId
        );
        setAcknowledgedReportDeliveryHandoffGaps((current) => ({
          ...current,
          [subscriptionId]: true,
        }));
        toast({
          title: "Handoff gaps acknowledged",
          description: `${
            subscription?.title ?? translateNow("reportCenter.thisReportDelivery")
          } has review gaps in the accountant handoff. Click queue again to send with those gaps acknowledged.`,
        });
        return;
      }

      queueReportDeliverySubscription.mutate({
        subscriptionId,
        acknowledgeHandoffGaps: isReportDeliveryHandoffAcknowledged(subscriptionId),
      });
    },
    [
      isReportDeliveryHandoffAcknowledged,
      queueReportDeliverySubscription,
      reportDeliverySubscriptionHasReviewHandoff,
      reportDeliverySubscriptionSummaries,
      setAcknowledgedReportDeliveryHandoffGaps,
      toast,
    ]
  );
  const commandQueueSubscriptionRequiresHandoffAcknowledgement = Boolean(
    reportDeliveryAutomationCommandTargets.queueSubscription &&
    reportDeliverySubscriptionHasReviewHandoff(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    ) &&
    !isReportDeliveryHandoffAcknowledged(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    )
  );
  const retryReportDeliveryRun = useMutation({
    mutationFn: (runId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before retrying delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      toast({
        title: "Report delivery retry queued",
        description: `${subscriptionTitle} was requeued after recovery.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not retry report delivery",
        description: error?.message || "Failed to retry report delivery",
        variant: "destructive",
      });
    },
  });

  return {
    saveReportDeliverySubscriptionSettings,
    queueReportDeliverySubscription,
    queueReportDeliverySubscriptionWithHandoffGuard,
    commandQueueSubscriptionRequiresHandoffAcknowledgement,
    retryReportDeliveryRun,
  };
}

export type ReportsDeliveryActionsState = ReturnType<typeof useReportsDeliveryActions>;
