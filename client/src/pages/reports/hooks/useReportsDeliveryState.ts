// Report delivery plans, runs, scheduler health, subscriptions, run timeline and recovery summary.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import {
  PersonaFilter,
  ReportDeliveryAutomationPreferenceResponse,
  ReportDeliveryPlanPreview,
  ReportDeliveryPlanResponse,
  ReportDeliveryRunStatusFilter,
  ReportDeliveryRunSummary,
  ReportDeliverySchedulerScanSummary,
  ReportDeliverySettingsDraft,
  formatDeliveryRunTimestamp,
  matchesReportDeliveryRunStatusFilter,
  matchesReportPersona,
} from "../shared";
import {
  type ReportCatalogItem,
  parseReportDeliveryAutomationCommand,
  reportCatalog,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPersonaWorkspaces,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
} from "@/lib/reportCatalog";
import { apiRequest } from "@/lib/queryClient";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsAutomationQueueState } from "./useReportsAutomationQueue";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsComparisonsAndCloseState } from "./useReportsComparisonsAndClose";

type UseReportsDeliveryStateDeps = Pick<
  ReportsWorkspaceStateState &
    ReportsAutomationQueueState &
    ReportsWorkspaceSummariesState &
    ReportsDataQueriesState &
    ReportsComparisonsAndCloseState,
  | "activeTab"
  | "matchesReportWorkflowSearch"
  | "personaFilter"
  | "reportAutomationStarterSummaries"
  | "reportAutomationTriggerRuleSummaries"
  | "reportDecisionShortcutSummaries"
  | "reportDeliveryRunStatusFilter"
  | "reportPackTemplateSummaries"
  | "reportQueryOptions"
  | "reportSuiteSummaries"
  | "reportWorkflowGapFilter"
  | "reportWorkflowSearch"
  | "selectedCompanyId"
  | "setEditingReportDeliverySubscriptionId"
  | "setPinnedReportDeliveryAutomationCommands"
  | "setReportDeliverySettingsDraft"
  | "shouldLoadReportDeliveryData"
  | "visibleReportComparisonPresets"
  | "workspaceSummaries"
>;

export function useReportsDeliveryState({
  activeTab,
  matchesReportWorkflowSearch,
  personaFilter,
  reportAutomationStarterSummaries,
  reportAutomationTriggerRuleSummaries,
  reportDecisionShortcutSummaries,
  reportDeliveryRunStatusFilter,
  reportPackTemplateSummaries,
  reportQueryOptions,
  reportSuiteSummaries,
  reportWorkflowGapFilter,
  reportWorkflowSearch,
  selectedCompanyId,
  setEditingReportDeliverySubscriptionId,
  setPinnedReportDeliveryAutomationCommands,
  setReportDeliverySettingsDraft,
  shouldLoadReportDeliveryData,
  visibleReportComparisonPresets,
  workspaceSummaries,
}: UseReportsDeliveryStateDeps) {
  const reportDeliveryPlansQuery = useQuery<{
    subscriptions: ReportDeliveryPlanResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "subscriptions"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/subscriptions`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });
  const reportDeliveryAutomationPreferencesQuery = useQuery<{
    preferences: ReportDeliveryAutomationPreferenceResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });
  // Merge server-stored pinned commands whenever a new preferences payload arrives.
  const reportDeliveryAutomationPreferences =
    reportDeliveryAutomationPreferencesQuery.data?.preferences;
  const [mergedReportDeliveryAutomationPreferences, setMergedReportDeliveryAutomationPreferences] =
    useState<typeof reportDeliveryAutomationPreferences>(undefined);
  if (mergedReportDeliveryAutomationPreferences !== reportDeliveryAutomationPreferences) {
    setMergedReportDeliveryAutomationPreferences(reportDeliveryAutomationPreferences);
    if (reportDeliveryAutomationPreferences?.length) {
      setPinnedReportDeliveryAutomationCommands((current) => {
        const next = { ...current };
        for (const preference of reportDeliveryAutomationPreferences) {
          next[preference.persona] = parseReportDeliveryAutomationCommand(
            preference.preferredDeliveryAutomationCommand
          );
        }
        return next;
      });
    }
  }
  const reportDeliveryRunsQuery = useQuery<{
    runs: ReportDeliveryRunSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });
  const reportDeliverySchedulerHealthQuery = useQuery<{
    latestScan: ReportDeliverySchedulerScanSummary | null;
    recentScans: ReportDeliverySchedulerScanSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "scheduler-health"],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/report-delivery/scheduler-health?limit=5`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });
  const latestReportDeliverySchedulerScan =
    reportDeliverySchedulerHealthQuery.data?.latestScan ?? null;
  const reportDeliverySchedulerHandoffSkipCount =
    latestReportDeliverySchedulerScan?.snapshot?.skippedHandoff ??
    latestReportDeliverySchedulerScan?.snapshot?.skippedSubscriptionIds?.handoff?.length ??
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews?.length ??
    0;
  const reportDeliverySchedulerGuardrailSkips = latestReportDeliverySchedulerScan
    ? latestReportDeliverySchedulerScan.skippedPaused +
      latestReportDeliverySchedulerScan.skippedSetup
    : 0;
  const reportDeliveryPlanById = useMemo(() => {
    return new Map(
      (reportDeliveryPlansQuery.data?.subscriptions ?? []).map((plan) => [plan.id, plan])
    );
  }, [reportDeliveryPlansQuery.data?.subscriptions]);
  const reportDeliveryRunsBySubscriptionId = useMemo(() => {
    const runsBySubscription = new Map<string, ReportDeliveryRunSummary[]>();
    for (const run of reportDeliveryRunsQuery.data?.runs ?? []) {
      const existing = runsBySubscription.get(run.subscriptionId) ?? [];
      existing.push(run);
      runsBySubscription.set(run.subscriptionId, existing);
    }
    return runsBySubscription;
  }, [reportDeliveryRunsQuery.data?.runs]);
  const reportDeliverySubscriptionSummaries = useMemo(() => {
    return reportDeliverySubscriptions.flatMap((subscription) => {
      const workspace = workspaceSummaries.find((item) => item.persona === subscription.persona);
      if (!workspace) return [];
      const deliveryPlan = reportDeliveryPlanById.get(subscription.id);
      const deliveryRuns = reportDeliveryRunsBySubscriptionId.get(subscription.id) ?? [];
      const reportSuites = reportSuiteSummaries.filter(
        (suite) => suite.deliverySubscriptionId === subscription.id
      );
      const plannedReportSuites =
        deliveryPlan?.reportSuites ??
        reportSuites.map((suite) => ({
          id: suite.id,
          title: suite.title,
          workflow: suite.workflow,
          href: suite.href,
        }));

      const reports = subscription.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;
      const packTemplate =
        reportPackTemplateSummaries.find(
          (template) => template.id === subscription.packTemplateId
        ) ?? null;
      const triggerRules = subscription.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRuleSummaries.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRuleSummaries)[number] =>
          Boolean(rule)
        );
      const automationStarter =
        reportAutomationStarterSummaries.find(
          (starter) => starter.id === subscription.automationStarterId
        ) ?? null;
      const decisionShortcut =
        reportDecisionShortcutSummaries.find(
          (shortcut) => shortcut.id === subscription.decisionShortcutId
        ) ?? null;
      const openWorkItemCount = triggerRules.reduce((sum, rule) => sum + rule.openWorkItemCount, 0);
      const amountAtRisk = triggerRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const enabled = deliveryPlan?.enabled ?? true;
      const status = !enabled
        ? "Paused"
        : openWorkItemCount > 0
          ? "Review before send"
          : (deliveryPlan?.status ?? "ready") === "setup"
            ? "Setup needed"
            : readyCount === reports.length
              ? "Ready to send"
              : "Setup needed";

      return [
        {
          ...subscription,
          enabled,
          workspace,
          reports,
          readyCount,
          packTemplate,
          triggerRules,
          automationStarter,
          decisionShortcut,
          reportSuites: plannedReportSuites,
          suiteCount: deliveryPlan?.suiteCount ?? plannedReportSuites.length,
          openWorkItemCount,
          amountAtRisk,
          cadence: deliveryPlan?.cadence ?? subscription.cadence,
          channel: deliveryPlan?.channel ?? subscription.channel,
          format: deliveryPlan?.format ?? subscription.format,
          recipients: deliveryPlan?.recipients ?? subscription.recipients,
          deliveryGuardrail: deliveryPlan?.deliveryGuardrail ?? subscription.deliveryGuardrail,
          nextRunLabel: deliveryPlan?.nextRunLabel ?? "",
          settingsSource: deliveryPlan?.settingsSource ?? "catalog",
          preview:
            deliveryPlan?.preview ??
            ({
              summary: `${subscription.format} to ${subscription.recipients} through ${subscription.channel}.`,
              readinessLabel: "Catalog preview",
              checklist: [
                {
                  label: "Reports",
                  status: readyCount === reports.length ? "ready" : "review",
                  detail: `${readyCount}/${reports.length} reports ready for this pack.`,
                },
                {
                  label: "Guardrail",
                  status: "ready",
                  detail: subscription.deliveryGuardrail,
                },
              ],
              reportNames: reports.map((report) => report.name),
              triggerRuleTitles: triggerRules.map((rule) => rule.title),
              suiteTitles: plannedReportSuites.map((suite) => suite.title),
            } satisfies ReportDeliveryPlanPreview),
          deliveryRuns,
          latestDeliveryRun: deliveryRuns[0] ?? null,
          href: reportDeliverySubscriptionHref(subscription),
          packTemplateHref: packTemplate?.href ?? reportDeliverySubscriptionHref(subscription),
          automationStarterHref:
            automationStarter?.href ?? reportDeliverySubscriptionHref(subscription),
          decisionShortcutHref:
            decisionShortcut?.href ?? reportDeliverySubscriptionHref(subscription),
          status,
          statusVariant:
            status === "Ready to send"
              ? ("success" as const)
              : status === "Review before send"
                ? ("warning" as const)
                : ("neutral" as const),
        },
      ];
    });
  }, [
    reportDeliveryPlanById,
    reportDeliveryRunsBySubscriptionId,
    reportAutomationStarterSummaries,
    reportAutomationTriggerRuleSummaries,
    reportDecisionShortcutSummaries,
    reportPackTemplateSummaries,
    reportSuiteSummaries,
    workspaceSummaries,
  ]);
  const reportDeliverySchedulerHandoffReviews = useMemo(() => {
    const reviews = latestReportDeliverySchedulerScan?.snapshot?.handoffReviews ?? [];
    return reviews
      .map((review) => {
        const subscription =
          reportDeliverySubscriptionSummaries.find((item) => item.id === review.subscriptionId) ??
          null;
        const workspace =
          subscription?.workspace ??
          workspaceSummaries.find((item) => item.persona === (subscription?.persona ?? "owner")) ??
          workspaceSummaries[0] ??
          null;
        if (!workspace) return null;
        const title = subscription?.title ?? review.subscriptionId;
        const href = reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: title,
          gap: review.gap,
        });

        return {
          ...review,
          title,
          href,
          subscriptionHref: subscription?.href ?? href,
          persona: workspace.persona,
          gapLabel: reportWorkflowGapFilterLabels[review.gap],
        };
      })
      .filter((review): review is NonNullable<typeof review> => Boolean(review))
      .filter(
        (review) =>
          matchesReportPersona([review.persona], personaFilter) &&
          matchesReportWorkflowSearch([
            review.title,
            review.gapLabel,
            review.detail,
            review.message,
            review.subscriptionId,
          ])
      );
  }, [
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews,
    matchesReportWorkflowSearch,
    personaFilter,
    reportDeliverySubscriptionSummaries,
    workspaceSummaries,
  ]);
  const visibleReportDeliverySubscriptions = useMemo(() => {
    return reportDeliverySubscriptionSummaries.filter(
      (subscription) =>
        matchesReportPersona([subscription.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          subscription.title,
          subscription.audience,
          subscription.cadence,
          subscription.channel,
          subscription.format,
          subscription.recipients,
          subscription.deliveryGuardrail,
          subscription.commandKeywords,
          subscription.reports.map((report) => report.name).join(" "),
          subscription.packTemplate?.title,
          subscription.automationStarter?.title,
          subscription.decisionShortcut?.question,
          subscription.reportSuites.map((suite) => `${suite.title} ${suite.workflow}`).join(" "),
          subscription.preview.suiteTitles.join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDeliverySubscriptionSummaries]);
  const activeReportWorkflowGapFilterLabel = useMemo(() => {
    if (reportWorkflowGapFilter.type === "all" || !reportWorkflowGapFilter.persona) return "";
    const workspace = reportPersonaWorkspaces.find(
      (item) => item.persona === reportWorkflowGapFilter.persona
    );
    return `${reportWorkflowGapFilterLabels[reportWorkflowGapFilter.type]} · ${
      workspace?.navLabel ?? reportWorkflowGapFilter.persona
    }`;
  }, [reportWorkflowGapFilter]);
  const reportWorkflowContextSearchLabel = reportWorkflowSearch.trim();
  const hasReportWorkflowContextFilters =
    personaFilter !== "all" ||
    Boolean(reportWorkflowContextSearchLabel) ||
    reportWorkflowGapFilter.type !== "all";
  const reportWorkflowContextSharePersona: PersonaFilter =
    reportWorkflowGapFilter.persona ?? personaFilter;
  const reportWorkflowContextShareHref = useMemo(
    () =>
      reportWorkflowContextHref({
        persona: reportWorkflowContextSharePersona,
        tab: activeTab,
        search: reportWorkflowContextSearchLabel,
        gap: reportWorkflowGapFilter.type === "all" ? null : reportWorkflowGapFilter.type,
      }),
    [
      activeTab,
      reportWorkflowContextSearchLabel,
      reportWorkflowContextSharePersona,
      reportWorkflowGapFilter.type,
    ]
  );
  const reportDeliveryRunStatusCounts = useMemo(() => {
    const counts: Record<ReportDeliveryRunStatusFilter, number> = {
      all: 0,
      queued: 0,
      sent: 0,
      failed: 0,
    };

    for (const subscription of visibleReportDeliverySubscriptions) {
      for (const run of subscription.deliveryRuns) {
        counts.all += 1;
        if (run.status === "queued" || run.status === "sent" || run.status === "failed") {
          counts[run.status] += 1;
        }
      }
    }

    return counts;
  }, [visibleReportDeliverySubscriptions]);
  const reportDeliveryRunTimelineRows = useMemo(() => {
    return visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns.map((run) => ({
          ...run,
          persona: subscription.persona,
          workspaceLabel: subscription.workspace.navLabel,
          subscriptionTitle: subscription.title,
          subscriptionHref: subscription.href,
        }))
      )
      .filter((run) =>
        matchesReportDeliveryRunStatusFilter(run.status, reportDeliveryRunStatusFilter)
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      )
      .slice(0, 6);
  }, [reportDeliveryRunStatusFilter, visibleReportDeliverySubscriptions]);
  const reportDeliveryRecoverySummary = useMemo(() => {
    const failedRuns = visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns
          .filter((run) => run.status === "failed")
          .map((run) => ({
            ...run,
            subscriptionTitle: subscription.title,
            subscriptionHref: subscription.href,
          }))
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      );
    const retryableSubscriptionCount = new Set(failedRuns.map((run) => run.subscriptionId)).size;
    const reviewSubscriptions = visibleReportDeliverySubscriptions.filter(
      (subscription) => subscription.status !== "Ready to send"
    );
    const latestFailedRun = failedRuns[0] ?? null;
    const firstReviewSubscription = reviewSubscriptions[0] ?? null;

    return {
      failedRunCount: failedRuns.length,
      retryableSubscriptionCount,
      reviewSubscriptionCount: reviewSubscriptions.length,
      nextAction: latestFailedRun
        ? {
            kind: "retry" as const,
            label: "Retry latest failed delivery",
            detail: `${latestFailedRun.subscriptionTitle} failed ${formatDeliveryRunTimestamp(latestFailedRun.createdAt)}. Retry after confirming recipients and guardrails are still valid.`,
            runId: latestFailedRun.id,
            badge: "Recovery",
            badgeVariant: "destructive" as const,
          }
        : firstReviewSubscription
          ? {
              kind: "open" as const,
              label: "Review delivery guardrails",
              detail: `${firstReviewSubscription.title} needs review before the next automated send.`,
              href: firstReviewSubscription.href,
              badge: "Review",
              badgeVariant: "warning" as const,
            }
          : {
              kind: "ready" as const,
              label: "Keep scheduled sends running",
              detail:
                visibleReportDeliverySubscriptions.length > 0
                  ? `${visibleReportDeliverySubscriptions.length} delivery subscriptions are ready for this view.`
                  : "No delivery subscriptions match this view yet.",
              badge: "Ready",
              badgeVariant: "success" as const,
            },
    };
  }, [visibleReportDeliverySubscriptions]);
  const reportDeliveryAutomationCommandTargets = useMemo(() => {
    const nextAction = reportDeliveryRecoverySummary.nextAction;
    const reviewSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.status !== "Ready to send"
      ) ?? null;
    const queueSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.enabled && subscription.status === "Ready to send"
      ) ??
      visibleReportDeliverySubscriptions.find((subscription) => subscription.enabled) ??
      null;
    const comparisonPreset =
      visibleReportComparisonPresets
        .slice()
        .sort(
          (first, second) =>
            second.warningCount - first.warningCount || first.title.localeCompare(second.title)
        )[0] ?? null;

    return {
      retryRunId: nextAction.kind === "retry" ? (nextAction.runId ?? null) : null,
      reviewSubscription,
      queueSubscription,
      comparisonPreset,
    };
  }, [
    reportDeliveryRecoverySummary.nextAction,
    visibleReportComparisonPresets,
    visibleReportDeliverySubscriptions,
  ]);
  const startEditingReportDeliverySubscription = useCallback(
    (subscription: (typeof reportDeliverySubscriptionSummaries)[number]) => {
      setEditingReportDeliverySubscriptionId(subscription.id);
      setReportDeliverySettingsDraft({
        cadence: subscription.cadence,
        channel: subscription.channel,
        format: subscription.format,
        recipients: subscription.recipients,
        deliveryGuardrail: subscription.deliveryGuardrail,
      });
    },
    [setEditingReportDeliverySubscriptionId, setReportDeliverySettingsDraft]
  );
  const updateReportDeliverySettingsDraft = useCallback(
    (field: keyof ReportDeliverySettingsDraft, value: string) => {
      setReportDeliverySettingsDraft((current) => ({ ...current, [field]: value }));
    },
    [setReportDeliverySettingsDraft]
  );

  return {
    reportDeliveryPlansQuery,
    reportDeliveryRunsQuery,
    reportDeliverySchedulerHealthQuery,
    latestReportDeliverySchedulerScan,
    reportDeliverySchedulerHandoffSkipCount,
    reportDeliverySchedulerGuardrailSkips,
    reportDeliverySubscriptionSummaries,
    reportDeliverySchedulerHandoffReviews,
    visibleReportDeliverySubscriptions,
    activeReportWorkflowGapFilterLabel,
    reportWorkflowContextSearchLabel,
    hasReportWorkflowContextFilters,
    reportWorkflowContextShareHref,
    reportDeliveryRunStatusCounts,
    reportDeliveryRunTimelineRows,
    reportDeliveryRecoverySummary,
    reportDeliveryAutomationCommandTargets,
    startEditingReportDeliverySubscription,
    updateReportDeliverySettingsDraft,
  };
}

export type ReportsDeliveryStateState = ReturnType<typeof useReportsDeliveryState>;
