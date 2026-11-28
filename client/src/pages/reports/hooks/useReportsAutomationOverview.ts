// Report packs, roadmap, product-depth coverage, automation rules/operations/impact and accountant handoff previews.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import type { BadgeProps } from "@/components/ui/badge";
import { translateNow } from "@/lib/i18n";
import type { ReportCatalogDiscovery } from "@/lib/reportCatalogApi";
import {
  type ReportCatalogItem,
  type ReportPersona,
  type ReportTab,
  type ReportWorkflowGapFilter,
  buildReportAutomationHealthTrend,
  buildReportAutomationRunbookSteps,
  calculateReportAutomationHealth,
  calculateReportAutomationImpact,
  recordReportAutomationHealthSnapshots,
  reportAutomationImpactProfiles,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportAutomationTriggerRules,
  reportCatalog,
  reportHref,
  reportPersonaHref,
  reportProductDepthAreaHref,
  reportProductDepthAreas,
  reportProductDepthSubgoalHref,
  reportSectionHref,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportWorkspaceHref,
  reportsHref,
} from "@/lib/reportCatalog";
import {
  ReportDeliveryPlanPreview,
  comparisonBadgeVariant,
  deliveryRunStatusVariant,
  formatComparisonPercent,
  formatDeliveryRunTimestamp,
  matchesReportPersona,
  reportStatusMeta,
} from "../shared";
import type { ReportLaunchDeliveryPreview } from "@/components/reports/ReportLaunchPicker";
import { useCallback, useEffect, useMemo } from "react";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsComparisonsAndCloseState } from "./useReportsComparisonsAndClose";
import type { ReportsAutomationQueueState } from "./useReportsAutomationQueue";
import type { ReportsDeliveryStateState } from "./useReportsDeliveryState";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";

type UseReportsAutomationOverviewDeps = Pick<
  ReportsWorkspaceStateState &
    ReportsComparisonsAndCloseState &
    ReportsAutomationQueueState &
    ReportsDeliveryStateState &
    ReportsWorkspaceSummariesState,
  | "acknowledgedReportDeliveryHandoffGaps"
  | "automationLoading"
  | "automationQueue"
  | "comparisonLoading"
  | "comparisonRows"
  | "personaFilter"
  | "reportAutomationHealthHistory"
  | "reportCatalogDiscoveryQuery"
  | "reportDeliveryPlansQuery"
  | "reportDeliveryRunsQuery"
  | "reportDeliverySubscriptionSummaries"
  | "reportWorkflowContextSearchLabel"
  | "setReportAutomationHealthHistory"
  | "visibleReportQuickAccessSummaries"
  | "visibleReportSavedViewSummaries"
  | "visibleReportSuiteSummaries"
  | "workspaceSummaries"
>;

export function useReportsAutomationOverview({
  acknowledgedReportDeliveryHandoffGaps,
  automationLoading,
  automationQueue,
  comparisonLoading,
  comparisonRows,
  personaFilter,
  reportAutomationHealthHistory,
  reportCatalogDiscoveryQuery,
  reportDeliveryPlansQuery,
  reportDeliveryRunsQuery,
  reportDeliverySubscriptionSummaries,
  reportWorkflowContextSearchLabel,
  setReportAutomationHealthHistory,
  visibleReportQuickAccessSummaries,
  visibleReportSavedViewSummaries,
  visibleReportSuiteSummaries,
  workspaceSummaries,
}: UseReportsAutomationOverviewDeps) {
  const reportPackAutomationQueue = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const signals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = signals.filter((item) => item.count > 0);
      const openWorkItemCount = signals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = signals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        signals,
        openSignals,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        status:
          openSignals.length > 0
            ? translateNow("reportCenter.reviewBeforeSend")
            : translateNow("reportCenter.readyToSend"),
      };
    });
  }, [automationQueue, workspaceSummaries]);
  const visibleReportPackAutomation = useMemo(() => {
    return reportPackAutomationQueue.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackAutomationQueue]);
  const reportPacksNeedingReview = visibleReportPackAutomation.filter(
    (item) => item.openSignalCount > 0
  ).length;
  const automationCoverageSummary = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const liveReports = workspace.reports.filter((report) => report.status === "live");
      const automatedSignals = Array.from(new Set(liveReports.map((report) => report.automation)));
      const comparisonTypes = new Set(liveReports.map((report) => report.comparison));
      const workflowReportCount = liveReports.filter((report) => reportHref(report)).length;
      const queueSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = queueSignals.filter((item) => item.count > 0);
      const openWorkItemCount = queueSignals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = queueSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        liveReportCount: liveReports.length,
        comparisonTypeCount: comparisonTypes.size,
        automatedSignalCount: automatedSignals.length,
        workflowReportCount,
        playbookCount: workspace.automations.length,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        topSignals: automatedSignals.slice(0, 4),
        status: openSignals.length > 0 ? translateNow("reportCenter.needsReview") : "Ready",
      };
    });
  }, [automationQueue, workspaceSummaries]);
  const visibleAutomationCoverage = useMemo(() => {
    return automationCoverageSummary.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [automationCoverageSummary, personaFilter]);
  const reportRoadmap = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const prioritizedPlannedReports = workspace.plannedReports
        .slice()
        .sort(
          (a, b) =>
            (b.roadmapPriority?.score ?? 0) - (a.roadmapPriority?.score ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const plannedAutomationHooks = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.automation))
      );
      const plannedCategories = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.category))
      );
      const plannedWorkflowDependencies = Array.from(
        new Set(
          prioritizedPlannedReports
            .map((report) => report.roadmapPrerequisites?.workflowDependency)
            .filter((dependency): dependency is string => Boolean(dependency))
        )
      );
      const nextReports = prioritizedPlannedReports.slice(0, 4);
      const topPriorityReport = nextReports[0] ?? null;
      const topPriorityImpact =
        topPriorityReport?.roadmapPriority?.impactByPersona[workspace.persona];

      return {
        workspace,
        plannedReports: prioritizedPlannedReports,
        nextReports,
        plannedAutomationHooks,
        plannedCategories,
        plannedWorkflowDependencies,
        topPriorityReport,
        topPriorityImpact,
        topPriorityScore: topPriorityReport?.roadmapPriority?.score ?? 0,
        liveReportCount: workspace.reports.length - workspace.plannedReports.length,
        plannedReportCount: workspace.plannedReports.length,
        prerequisiteCount: workspace.plannedReports.filter((report) => report.roadmapPrerequisites)
          .length,
        roadmapStatus:
          workspace.plannedReports.length > 0
            ? translateNow("reportCenter.roadmapGaps")
            : "Coverage complete",
        nextWorkflow:
          nextReports.length > 0
            ? (reportPersonaHref(nextReports[0], workspace.persona) ??
              reportWorkspaceHref(workspace))
            : reportWorkspaceHref(workspace),
      };
    });
  }, [workspaceSummaries]);
  const visibleReportRoadmap = useMemo(() => {
    return reportRoadmap.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportRoadmap]);
  const visiblePlannedReportCount = visibleReportRoadmap.reduce(
    (sum, item) => sum + item.plannedReportCount,
    0
  );
  const localReportProductDepthAreas = useMemo<ReportCatalogDiscovery["productDepthAreas"]>(() => {
    return reportProductDepthAreas.map((area) => ({
      ...area,
      href: reportProductDepthAreaHref(area),
      subgoals: area.subgoals.map((subgoal) => ({
        ...subgoal,
        href: reportProductDepthSubgoalHref(area, subgoal),
      })),
    }));
  }, []);
  const reportProductDepthCoverage: ReportCatalogDiscovery["productDepthAreas"] =
    reportCatalogDiscoveryQuery.data?.productDepthAreas ?? localReportProductDepthAreas;
  const visibleReportProductDepthAreas = useMemo<
    ReportCatalogDiscovery["productDepthAreas"]
  >(() => {
    return reportProductDepthCoverage
      .map((area) => ({
        ...area,
        subgoals: area.subgoals
          .filter((subgoal) => matchesReportPersona(subgoal.personas, personaFilter))
          .map((subgoal) => ({
            ...subgoal,
            sourceDrilldownTargets: subgoal.sourceDrilldownTargets?.filter((target) =>
              matchesReportPersona(target.personas, personaFilter)
            ),
          })),
      }))
      .filter((area) => area.subgoals.length > 0);
  }, [personaFilter, reportProductDepthCoverage]);
  const visibleReportProductDepthSubgoalCount = visibleReportProductDepthAreas.reduce(
    (sum, area) => sum + area.subgoals.length,
    0
  );
  const personaReportRecommendations = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const recommendations: Array<{
        id: string;
        title: string;
        detail: string;
        badge: string;
        badgeVariant: BadgeProps["variant"];
        amount?: number;
        tab?: ReportTab;
        href?: string;
      }> = [];

      const queueItems = automationQueue
        .filter((item) => matchesReportPersona(item.personas, workspace.persona))
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const amountDelta = (b.amount ?? 0) - (a.amount ?? 0);
          return Math.abs(amountDelta) > 0.005 ? amountDelta : b.count - a.count;
        });

      for (const item of queueItems.slice(0, 2)) {
        recommendations.push({
          id: `queue-${workspace.persona}-${item.id}`,
          title: item.title,
          detail: item.detail,
          badge: `${item.count} open`,
          badgeVariant: "warning",
          amount: item.amount,
          tab: item.tab,
          href: item.href,
        });
      }

      const comparisonItems = comparisonRows
        .filter((row) => matchesReportPersona(row.personas, workspace.persona))
        .filter((row) => Math.abs(row.delta) > 0.005)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      for (const row of comparisonItems) {
        if (recommendations.length >= 3) break;
        if (recommendations.some((item) => item.tab === row.tab && !item.href)) continue;

        recommendations.push({
          id: `comparison-${workspace.persona}-${row.id}`,
          title: row.label,
          detail: `${row.signal}: ${formatComparisonPercent(row.percentChange)} vs baseline`,
          badge: "Movement",
          badgeVariant: comparisonBadgeVariant(row),
          amount: row.delta,
          tab: row.tab,
        });
      }

      if (workspace.topReadyReport && recommendations.length < 3) {
        recommendations.push({
          id: `primary-${workspace.persona}-${workspace.topReadyReport.id}`,
          title: workspace.topReadyReport.name,
          detail: workspace.topReadyReport.automation,
          badge: reportStatusMeta[workspace.topReadyReport.status].label,
          badgeVariant: reportStatusMeta[workspace.topReadyReport.status].variant,
          tab: workspace.topReadyReport.tab,
          href: workspace.topReadyReport.href,
        });
      }

      return {
        workspace,
        recommendations: recommendations.slice(0, 3),
      };
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);
  const reportPackDeliveryReadiness = useMemo(() => {
    return reportPackAutomationQueue.map((pack) => {
      const workspace = pack.workspace;
      const packComparisonRows = comparisonRows.filter((row) =>
        matchesReportPersona(row.personas, workspace.persona)
      );
      const comparisonWarnings = packComparisonRows.filter(
        (row) => comparisonBadgeVariant(row) === "warning"
      ).length;
      const recommendationCount =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations.length ?? 0;
      const plannedReportCount = workspace.reports.length - workspace.readyReports;
      const checks = [
        {
          id: "ready-reports",
          label: "Report data refreshed",
          detail: `${workspace.readyReports} ready/API-backed reports for ${workspace.title}.`,
          status: workspace.readyReports > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "comparison-snapshot",
          label: "Comparison snapshot attached",
          detail: `${packComparisonRows.length} current-vs-prior signals in the pack.`,
          status: packComparisonRows.length > 0 ? "Ready" : "Review",
          workflow: reportsHref({ tab: workspace.primaryTab, persona: workspace.persona }),
        },
        {
          id: "recommended-actions",
          label: "Recommended actions ranked",
          detail: `${recommendationCount} next-best report actions included.`,
          status: recommendationCount > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "automation-review",
          label: "Automation exceptions reviewed",
          detail:
            pack.openWorkItemCount > 0
              ? `${pack.openWorkItemCount} open work items before delivery.`
              : "No open automation work items.",
          status: pack.openWorkItemCount > 0 ? "Review" : "Ready",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "delivery-cadence",
          label: "Delivery cadence configured",
          detail: workspace.packSchedule.cadence,
          status: workspace.packSchedule.cadence ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "recipients",
          label: "Recipients configured",
          detail: workspace.packSchedule.recipients,
          status: workspace.packSchedule.recipients ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
      ];
      const reviewCount = checks.filter((check) => check.status === "Review").length;
      const automationHealth = calculateReportAutomationHealth({
        readinessPercent: workspace.readiness,
        automationLaneCount: workspace.automationCount,
        comparisonMetricCount: packComparisonRows.length,
        comparisonWarningCount: comparisonWarnings,
        plannedReportCount,
        reviewSignalCount: reviewCount + comparisonWarnings + plannedReportCount,
      });

      return {
        workspace,
        checks,
        reviewCount,
        automationHealth,
        status:
          reviewCount > 0
            ? translateNow("reportCenter.reviewBeforeSend")
            : translateNow("reportCenter.readyToSend"),
      };
    });
  }, [comparisonRows, personaReportRecommendations, reportPackAutomationQueue]);
  useEffect(() => {
    if (!reportPackDeliveryReadiness.length) return;

    const timer = window.setTimeout(() => {
      setReportAutomationHealthHistory(
        recordReportAutomationHealthSnapshots(
          reportPackDeliveryReadiness.map((item) => ({
            persona: item.workspace.persona,
            health: item.automationHealth,
          }))
        )
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [reportPackDeliveryReadiness, setReportAutomationHealthHistory]);
  const reportAutomationHealthTrends = useMemo(() => {
    return reportPackDeliveryReadiness.map((item) => ({
      workspace: item.workspace,
      trend: buildReportAutomationHealthTrend(
        reportAutomationHealthHistory,
        item.workspace.persona,
        item.automationHealth
      ),
    }));
  }, [reportAutomationHealthHistory, reportPackDeliveryReadiness]);
  const visibleReportPackReadiness = useMemo(() => {
    return reportPackDeliveryReadiness.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackDeliveryReadiness]);
  const visibleReportAutomationHealthTrends = useMemo(() => {
    return reportAutomationHealthTrends.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationHealthTrends]);
  const reportAutomationRules = useMemo(() => {
    return workspaceSummaries.flatMap((workspace) => {
      const workspaceSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );

      return workspace.automations.map((playbook) => {
        const linkedReports = playbook.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const liveReportCount = linkedReports.filter((report) => report.status === "live").length;
        const targetWorkflow = reportAutomationPlaybookHref(playbook, workspace.persona);
        const runbookSteps = buildReportAutomationRunbookSteps(workspace, playbook);
        const matchingSignals = workspaceSignals.filter((signal) => {
          if (playbook.href && signal.href === playbook.href) return true;
          if (playbook.tab && signal.tab === playbook.tab) return true;
          return linkedReports.some((report) => report.tab && report.tab === signal.tab);
        });
        const openSignals = matchingSignals.filter((signal) => signal.count > 0);
        const openWorkItemCount = matchingSignals.reduce((sum, signal) => sum + signal.count, 0);
        const amountAtRisk = matchingSignals.reduce((sum, signal) => sum + (signal.amount ?? 0), 0);
        const comparisonMetricCount = comparisonRows.filter(
          (row) =>
            matchesReportPersona(row.personas, workspace.persona) &&
            linkedReports.some((report) => report.tab === row.tab)
        ).length;
        const status =
          openWorkItemCount > 0
            ? "Review before auto-send"
            : liveReportCount === linkedReports.length
              ? "Ready to auto-send"
              : translateNow("reportCenter.setupNeeded");

        return {
          id: `${workspace.persona}-${playbook.id}`,
          workspace,
          playbook,
          linkedReports,
          liveReportCount,
          reportCount: linkedReports.length,
          matchingSignals,
          openSignals,
          runbookSteps,
          openWorkItemCount,
          amountAtRisk,
          comparisonMetricCount,
          targetWorkflow,
          status,
          statusVariant:
            status === "Ready to auto-send"
              ? ("success" as const)
              : status === "Review before auto-send"
                ? ("warning" as const)
                : ("neutral" as const),
        };
      });
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);
  const visibleReportAutomationRules = useMemo(() => {
    return reportAutomationRules.filter((rule) =>
      matchesReportPersona([rule.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationRules]);
  const reportAutomationRuleReviewCount = visibleReportAutomationRules.filter(
    (rule) => rule.openWorkItemCount > 0 || rule.status === translateNow("reportCenter.setupNeeded")
  ).length;
  const reportAutomationCommandCenter = useMemo(() => {
    const readyRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === "Ready to auto-send"
    ).length;
    const reviewRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.openWorkItemCount > 0
    ).length;
    const setupRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === translateNow("reportCenter.setupNeeded")
    ).length;
    const openWorkItemCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.openWorkItemCount,
      0
    );
    const amountAtRisk = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.amountAtRisk,
      0
    );
    const comparisonMetricCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.comparisonMetricCount,
      0
    );
    const reportBundleCount = new Set(
      visibleReportAutomationRules.flatMap((rule) => rule.linkedReports.map((report) => report.id))
    ).size;
    const autoSendCoveragePercent =
      visibleReportAutomationRules.length > 0
        ? Math.round((readyRuleCount / visibleReportAutomationRules.length) * 100)
        : 0;
    const readyPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount === 0
    ).length;
    const reviewPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount > 0
    ).length;
    const topReviewRules = visibleReportAutomationRules
      .filter(
        (rule) =>
          rule.openWorkItemCount > 0 || rule.status === translateNow("reportCenter.setupNeeded")
      )
      .sort(
        (a, b) =>
          b.openWorkItemCount - a.openWorkItemCount ||
          b.amountAtRisk - a.amountAtRisk ||
          a.playbook.title.localeCompare(b.playbook.title)
      )
      .slice(0, 4);

    return {
      ruleCount: visibleReportAutomationRules.length,
      readyRuleCount,
      reviewRuleCount,
      setupRuleCount,
      openWorkItemCount,
      amountAtRisk,
      comparisonMetricCount,
      reportBundleCount,
      autoSendCoveragePercent,
      readyPackCount,
      reviewPackCount,
      topReviewRules,
    };
  }, [visibleReportAutomationRules, visibleReportPackReadiness]);
  const reportAutomationOperationSummaries = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const packReadiness = reportPackDeliveryReadiness.find(
        (item) => item.workspace.persona === workspace.persona
      );
      const deliverySubscriptions = reportDeliverySubscriptionSummaries.filter(
        (subscription) => subscription.persona === workspace.persona
      );
      const automationRules = reportAutomationRules.filter(
        (rule) => rule.workspace.persona === workspace.persona
      );
      const recommendations =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations ?? [];
      const failedRunCount = deliverySubscriptions.reduce(
        (sum, subscription) =>
          sum + subscription.deliveryRuns.filter((run) => run.status === "failed").length,
        0
      );
      const pausedDeliveryCount = deliverySubscriptions.filter(
        (subscription) => !subscription.enabled
      ).length;
      const setupDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === translateNow("reportCenter.setupNeeded")
      ).length;
      const readyDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === translateNow("reportCenter.readyToSend")
      ).length;
      const reviewDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === translateNow("reportCenter.reviewBeforeSend")
      ).length;
      const readyRuleCount = automationRules.filter(
        (rule) => rule.status === "Ready to auto-send"
      ).length;
      const openWorkItemCount = automationRules.reduce(
        (sum, rule) => sum + rule.openWorkItemCount,
        0
      );
      const amountAtRisk = automationRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const comparisonWarnings = comparisonRows.filter(
        (row) =>
          matchesReportPersona(row.personas, workspace.persona) &&
          comparisonBadgeVariant(row) === "warning"
      ).length;
      const reportCount = workspace.reports.length;
      const reportGapCount = Math.max(0, reportCount - workspace.readyReports);
      const deliveryIssueCount =
        failedRunCount + pausedDeliveryCount + setupDeliveryCount + reviewDeliveryCount;
      const automationScore = packReadiness?.automationHealth.score ?? workspace.readiness;
      const automationHealthVariant =
        packReadiness?.automationHealth.variant ??
        (workspace.readiness >= 85 ? "success" : workspace.readiness >= 60 ? "warning" : "danger");

      const nextAction =
        failedRunCount > 0
          ? {
              label: "Recover failed delivery",
              detail: `${failedRunCount} failed report delivery run${
                failedRunCount === 1 ? "" : "s"
              } can be retried after guardrails are fixed.`,
              href: reportSectionHref(workspace, "delivery-subscriptions"),
              badge: "Recovery",
              badgeVariant: "danger" as const,
            }
          : deliveryIssueCount > 0
            ? {
                label: "Review delivery setup",
                detail: `${deliveryIssueCount} delivery subscription${
                  deliveryIssueCount === 1 ? "" : "s"
                } need setup, guardrail review, or enablement before auto-send.`,
                href: reportSectionHref(workspace, "delivery-subscriptions"),
                badge: "Delivery",
                badgeVariant: "warning" as const,
              }
            : openWorkItemCount > 0
              ? {
                  label: "Clear automation queue",
                  detail: `${openWorkItemCount} open work item${
                    openWorkItemCount === 1 ? "" : "s"
                  } should be resolved before scheduled packs are sent.`,
                  href: reportSectionHref(workspace, "automation-command-center"),
                  badge: "Work queue",
                  badgeVariant: "warning" as const,
                }
              : comparisonWarnings > 0
                ? {
                    label: "Review comparison movement",
                    detail: `${comparisonWarnings} comparison signal${
                      comparisonWarnings === 1 ? "" : "s"
                    } need a note before the next pack delivery.`,
                    href: reportSectionHref(workspace, "recommendations"),
                    badge: "Movement",
                    badgeVariant: "warning" as const,
                  }
                : {
                    label: "Keep automation running",
                    detail: `${readyRuleCount}/${automationRules.length} auto-send rules and ${readyDeliveryCount}/${deliverySubscriptions.length} deliveries are ready.`,
                    href: reportSectionHref(workspace, "automation-command-center"),
                    badge: "Ready",
                    badgeVariant: "success" as const,
                  };

      const status =
        failedRunCount > 0
          ? translateNow("reportCenter.deliveryRecovery")
          : deliveryIssueCount > 0 || openWorkItemCount > 0 || comparisonWarnings > 0
            ? translateNow("reportCenter.needsReview")
            : "Ready to automate";

      return {
        workspace,
        reportCount,
        readyReportCount: workspace.readyReports,
        automationScore,
        automationHealthVariant,
        automationRuleCount: automationRules.length,
        readyRuleCount,
        automationRuleGapCount: Math.max(0, automationRules.length - readyRuleCount),
        deliverySubscriptionCount: deliverySubscriptions.length,
        readyDeliveryCount,
        deliveryGapCount: Math.max(0, deliverySubscriptions.length - readyDeliveryCount),
        reportGapCount,
        failedRunCount,
        openWorkItemCount,
        amountAtRisk,
        comparisonWarnings,
        recommendationCount: recommendations.length,
        nextAction,
        status,
        statusVariant:
          status === "Ready to automate"
            ? ("success" as const)
            : status === translateNow("reportCenter.deliveryRecovery")
              ? ("destructive" as const)
              : ("warning" as const),
      };
    });
  }, [
    comparisonRows,
    personaReportRecommendations,
    reportAutomationRules,
    reportDeliverySubscriptionSummaries,
    reportPackDeliveryReadiness,
    workspaceSummaries,
  ]);
  const visibleReportAutomationOperations = useMemo(() => {
    return reportAutomationOperationSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationOperationSummaries]);
  const reportAutomationOperationsNeedingReview = visibleReportAutomationOperations.filter(
    (item) => item.status !== "Ready to automate"
  ).length;
  const reportHomeQuickReports = useMemo(() => {
    const seenReportIds = new Set<string>();

    return visibleReportQuickAccessSummaries
      .flatMap((profile) =>
        profile.primaryReports.flatMap((entry) => {
          const key = `${profile.persona}:${entry.report.id}`;
          if (seenReportIds.has(key)) return [];
          seenReportIds.add(key);
          return [{ ...entry, profile }];
        })
      )
      .slice(0, 6);
  }, [visibleReportQuickAccessSummaries]);
  const reportHomeSuites = visibleReportSuiteSummaries.slice(0, personaFilter === "all" ? 3 : 2);
  const reportHomeSavedViews = visibleReportSavedViewSummaries.slice(0, 3);
  const reportHomeAutomationOperation = visibleReportAutomationOperations[0] ?? null;
  const reportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      if (!workspace) return [];

      const operation = reportAutomationOperationSummaries.find(
        (item) => item.workspace.persona === profile.persona
      );
      const profileReports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const starters = profile.automationStarterIds
        .map((starterId) => reportAutomationStarters.find((starter) => starter.id === starterId))
        .filter((starter): starter is (typeof reportAutomationStarters)[number] =>
          Boolean(starter)
        );
      const triggerRules = profile.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const estimate = calculateReportAutomationImpact(profile, {
        readyRuleCount: operation?.readyRuleCount ?? 0,
        readyDeliveryCount: operation?.readyDeliveryCount ?? 0,
        readyReportCount:
          operation?.readyReportCount ??
          profileReports.filter((report) => report.status !== "planned").length,
        openWorkItemCount: operation?.openWorkItemCount ?? 0,
        recommendationCount: operation?.recommendationCount ?? 0,
        amountAtRisk: operation?.amountAtRisk ?? 0,
      });

      return [
        {
          profile,
          workspace,
          estimate,
          reports: profileReports,
          starters,
          triggerRules,
          href: reportSectionHref(workspace, "automation-impact"),
          commandCenterHref: reportSectionHref(workspace, "automation-command-center"),
          starterHref: starters[0]
            ? reportAutomationStarterHref(starters[0])
            : reportWorkspaceHref(workspace),
        },
      ];
    });
  }, [reportAutomationOperationSummaries, workspaceSummaries]);
  const visibleReportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationImpactSummaries]);
  const reportAutomationImpactTotals = useMemo(() => {
    return visibleReportAutomationImpactSummaries.reduce(
      (totals, item) => ({
        estimatedMonthlyHoursSaved:
          totals.estimatedMonthlyHoursSaved + item.estimate.estimatedMonthlyHoursSaved,
        estimatedAutomatedItemCount:
          totals.estimatedAutomatedItemCount + item.estimate.estimatedAutomatedItemCount,
        reviewItemCount: totals.reviewItemCount + item.estimate.reviewItemCount,
        amountAtRisk: totals.amountAtRisk + item.estimate.amountAtRisk,
      }),
      {
        estimatedMonthlyHoursSaved: 0,
        estimatedAutomatedItemCount: 0,
        reviewItemCount: 0,
        amountAtRisk: 0,
      }
    );
  }, [visibleReportAutomationImpactSummaries]);
  const reportAccountantHandoffSummaries = useMemo(() => {
    return visibleReportAutomationOperations.map((item) => {
      const workspace = item.workspace;
      const priorityGap: ReportWorkflowGapFilter | null =
        item.failedRunCount > 0 || item.deliveryGapCount > 0
          ? "delivery-gaps"
          : item.automationRuleGapCount > 0 || item.openWorkItemCount > 0
            ? "rule-gaps"
            : item.reportGapCount > 0
              ? "report-gaps"
              : null;

      return {
        ...item,
        shareHref: reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: reportWorkflowContextSearchLabel,
          gap: priorityGap,
        }),
        gapHref: priorityGap
          ? reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
              gap: priorityGap,
            })
          : reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
            }),
        priorityGap,
        priorityGapLabel: priorityGap ? reportWorkflowGapFilterLabels[priorityGap] : "No open gap",
      };
    });
  }, [reportWorkflowContextSearchLabel, visibleReportAutomationOperations]);
  const reportDeliveryHandoffPreviewByPersona = useMemo(() => {
    return reportAccountantHandoffSummaries.reduce<
      Partial<Record<ReportPersona, NonNullable<ReportDeliveryPlanPreview["handoffRows"]>>>
    >((previews, item) => {
      previews[item.workspace.persona] = [
        {
          label: "Shared context",
          value: item.status,
          status: item.status === "Ready to automate" ? "ready" : "review",
          detail: `${item.readyReportCount}/${item.reportCount} reports, ${item.readyRuleCount}/${item.automationRuleCount} rules, ${item.readyDeliveryCount}/${item.deliverySubscriptionCount} deliveries ready.`,
          href: item.shareHref,
        },
        {
          label: "Priority gap",
          value: item.priorityGapLabel,
          status: item.priorityGap ? "review" : "ready",
          detail: `${item.reportGapCount} report gaps, ${item.automationRuleGapCount} rule gaps, ${item.deliveryGapCount} delivery gaps.`,
          href: item.gapHref,
        },
        {
          label: "Next action",
          value: item.nextAction.label,
          status: item.nextAction.badgeVariant === "success" ? "ready" : "review",
          detail: item.nextAction.detail,
          href: item.nextAction.href,
        },
      ];
      return previews;
    }, {});
  }, [reportAccountantHandoffSummaries]);
  const reportDeliverySubscriptionHasReviewHandoff = useCallback(
    (subscriptionId: string) => {
      const subscription = reportDeliverySubscriptionSummaries.find(
        (item) => item.id === subscriptionId
      );
      if (!subscription) return false;
      const handoffRows =
        reportDeliveryHandoffPreviewByPersona[subscription.persona] ??
        subscription.preview.handoffRows ??
        [];
      return handoffRows.some((row) => row.status === "review");
    },
    [reportDeliveryHandoffPreviewByPersona, reportDeliverySubscriptionSummaries]
  );
  const isReportDeliveryHandoffAcknowledged = useCallback(
    (subscriptionId: string) => Boolean(acknowledgedReportDeliveryHandoffGaps[subscriptionId]),
    [acknowledgedReportDeliveryHandoffGaps]
  );
  const reportDeliveryLauncherPreviewById = useMemo(() => {
    return reportDeliverySubscriptionSummaries.reduce<Record<string, ReportLaunchDeliveryPreview>>(
      (previews, subscription) => {
        const latestRun = subscription.latestDeliveryRun;
        const handoffRows = reportDeliveryHandoffPreviewByPersona[subscription.persona];
        const requiresHandoffAcknowledgement =
          handoffRows?.some((row) => row.status === "review") ?? false;
        previews[subscription.id] = {
          status: subscription.status,
          statusVariant: subscription.statusVariant,
          enabled: subscription.enabled,
          nextRunLabel: subscription.nextRunLabel,
          channel: subscription.channel,
          format: subscription.format,
          recipients: subscription.recipients,
          deliveryGuardrail: subscription.deliveryGuardrail,
          summary: subscription.preview.summary,
          suiteTitles:
            subscription.preview.suiteTitles.length > 0
              ? subscription.preview.suiteTitles
              : subscription.reportSuites.map((suite) => suite.title),
          handoffRows,
          handoffRequiresAcknowledgement: requiresHandoffAcknowledgement,
          handoffAcknowledged: Boolean(acknowledgedReportDeliveryHandoffGaps[subscription.id]),
          latestRunStatus: latestRun?.status,
          latestRunStatusVariant: latestRun
            ? deliveryRunStatusVariant(latestRun.status)
            : undefined,
          latestRunId: latestRun?.id,
          latestRunLabel: latestRun ? formatDeliveryRunTimestamp(latestRun.createdAt) : undefined,
          latestRunDetail: latestRun
            ? `Scheduled ${formatDeliveryRunTimestamp(latestRun.scheduledFor)} - ${latestRun.readyReportCount}/${latestRun.reportCount} reports - ${latestRun.channel}`
            : undefined,
          latestRunError:
            latestRun?.status === "failed"
              ? (latestRun.errorMessage ?? "Retry after fixing delivery settings or guardrails.")
              : null,
          queueDisabled: !subscription.enabled,
        };
        return previews;
      },
      {}
    );
  }, [
    acknowledgedReportDeliveryHandoffGaps,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliverySubscriptionSummaries,
  ]);
  const reportAutomationOperationsLoading =
    automationLoading ||
    comparisonLoading ||
    reportDeliveryPlansQuery.isLoading ||
    reportDeliveryRunsQuery.isLoading;
  const reportPackReadinessNeedingReview = visibleReportPackReadiness.filter(
    (item) => item.reviewCount > 0
  ).length;
  const reportPackReviewCount = Math.max(
    reportPacksNeedingReview,
    reportPackReadinessNeedingReview
  );

  return {
    visibleReportPackAutomation,
    visibleAutomationCoverage,
    reportRoadmap,
    visibleReportRoadmap,
    visiblePlannedReportCount,
    visibleReportProductDepthAreas,
    visibleReportProductDepthSubgoalCount,
    personaReportRecommendations,
    reportPackDeliveryReadiness,
    visibleReportPackReadiness,
    visibleReportAutomationHealthTrends,
    reportAutomationRules,
    visibleReportAutomationRules,
    reportAutomationRuleReviewCount,
    reportAutomationCommandCenter,
    reportAutomationOperationSummaries,
    visibleReportAutomationOperations,
    reportAutomationOperationsNeedingReview,
    reportHomeQuickReports,
    reportHomeSuites,
    reportHomeSavedViews,
    reportHomeAutomationOperation,
    visibleReportAutomationImpactSummaries,
    reportAutomationImpactTotals,
    reportAccountantHandoffSummaries,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliverySubscriptionHasReviewHandoff,
    isReportDeliveryHandoffAcknowledged,
    reportDeliveryLauncherPreviewById,
    reportAutomationOperationsLoading,
    reportPackReviewCount,
  };
}

export type ReportsAutomationOverviewState = ReturnType<typeof useReportsAutomationOverview>;
