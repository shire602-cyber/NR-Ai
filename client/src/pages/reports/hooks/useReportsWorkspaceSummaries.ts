// Persona workspace summaries: report stats, quick access, saved views, suites, management briefs, pack templates and decision shortcuts.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import {
  type ReportCatalogItem,
  reportAutomationImpactProfiles,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportManagementBriefHref,
  reportManagementBriefProfiles,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonaWorkspaces,
  reportQuickAccessProfiles,
  reportRoleWorkflowStepHref,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkflowContextHref,
  reportWorkspaceHref,
} from "@/lib/reportCatalog";
import { matchesReportPersona, reportWorkspaceIcons, uniqueSorted } from "../shared";
import { useMemo } from "react";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";

type UseReportsWorkspaceSummariesDeps = Pick<
  ReportsWorkspaceStateState,
  | "matchesReportWorkflowSearch"
  | "personaFilter"
  | "reportActionContextByPersonaReportId"
  | "syncedReportCatalogSummary"
  | "syncedReportPersonaSummaries"
>;

export function useReportsWorkspaceSummaries({
  matchesReportWorkflowSearch,
  personaFilter,
  reportActionContextByPersonaReportId,
  syncedReportCatalogSummary,
  syncedReportPersonaSummaries,
}: UseReportsWorkspaceSummariesDeps) {
  const reportStats = useMemo(() => {
    if (syncedReportCatalogSummary) {
      return {
        live: syncedReportCatalogSummary.liveReportCount,
        ready: syncedReportCatalogSummary.readyReportCount,
        planned: syncedReportCatalogSummary.plannedReportCount,
        total: syncedReportCatalogSummary.reportCount,
        packTemplates: syncedReportCatalogSummary.packTemplateCount,
        comparisonPresets: syncedReportCatalogSummary.comparisonPresetCount,
        reportSuites: syncedReportCatalogSummary.reportSuiteCount,
        deliverySubscriptions: syncedReportCatalogSummary.deliverySubscriptionCount,
        automationStarters: syncedReportCatalogSummary.automationStarterCount,
        quickAccessProfiles: syncedReportCatalogSummary.quickAccessProfileCount,
        savedViews: syncedReportCatalogSummary.savedViewCount,
        managementBriefs: syncedReportCatalogSummary.managementBriefCount,
        automationImpactProfiles: syncedReportCatalogSummary.automationImpactProfileCount,
        workflowSteps: syncedReportCatalogSummary.workflowStepCount,
        automationPlaybooks: syncedReportCatalogSummary.automationPlaybookCount,
      };
    }

    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) => report.status !== "planned").length;
    const planned = reportCatalog.length - ready;
    return {
      live,
      ready,
      planned,
      total: reportCatalog.length,
      packTemplates: reportPackTemplates.length,
      comparisonPresets: reportComparisonPresets.length,
      reportSuites: reportSuiteProfiles.length,
      deliverySubscriptions: reportDeliverySubscriptions.length,
      automationStarters: reportAutomationStarters.length,
      quickAccessProfiles: reportQuickAccessProfiles.length,
      savedViews: reportSavedViewProfiles.length,
      managementBriefs: reportManagementBriefProfiles.length,
      automationImpactProfiles: reportAutomationImpactProfiles.length,
      workflowSteps: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.workflowSteps.length,
        0
      ),
      automationPlaybooks: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.automations.length,
        0
      ),
    };
  }, [syncedReportCatalogSummary]);
  const workspaceSummaries = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const localReadyReports = reports.filter((report) => report.status !== "planned").length;
      const syncedSummary = syncedReportPersonaSummaries?.find(
        (summary) => summary.persona === workspace.persona
      );
      const catalogReportCount = syncedSummary?.reportCount ?? reports.length;
      const readyReports = syncedSummary?.readyReportCount ?? localReadyReports;
      const plannedReports = reports.filter((report) => report.status === "planned");
      const automationCount =
        syncedSummary?.automationPlaybookCount ?? workspace.automations.length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      const setupChecklist = workspace.setupChecklist.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));

        return {
          ...step,
          reports: linkedReports,
          href: reportSectionHref(workspace, step.section),
        };
      });
      const workflowSteps = workspace.workflowSteps.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const comparisonPreset = reportComparisonPresets.find(
          (preset) => preset.id === step.comparisonPresetId
        );
        const automationStarter = reportAutomationStarters.find(
          (starter) => starter.id === step.automationStarterId
        );
        const deliverySubscription = reportDeliverySubscriptions.find(
          (subscription) => subscription.id === step.deliverySubscriptionId
        );
        const decisionShortcut = reportDecisionShortcuts.find(
          (shortcut) => shortcut.id === step.decisionShortcutId
        );
        const savedView = reportSavedViewProfiles.find((view) => view.id === step.savedViewId);
        const reportSuite = reportSuiteProfiles.find((suite) => suite.id === step.reportSuiteId);

        return {
          ...step,
          reports: linkedReports,
          href: reportRoleWorkflowStepHref(workspace, step),
          sectionHref: reportSectionHref(workspace, step.section),
          comparisonPreset,
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportSectionHref(workspace, "recommendations"),
          automationStarter,
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportSectionHref(workspace, "automation-starters"),
          deliverySubscription,
          deliveryHref: deliverySubscription
            ? reportDeliverySubscriptionHref(deliverySubscription)
            : reportSectionHref(workspace, "delivery-subscriptions"),
          decisionShortcut,
          decisionHref: decisionShortcut
            ? reportDecisionShortcutHref(decisionShortcut)
            : reportSectionHref(workspace, "decision-shortcuts"),
          savedView,
          savedViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          defaultViewLabel: savedView?.title ?? "Role saved view",
          defaultViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          handoffRecipients: deliverySubscription?.recipients ?? workspace.packSchedule.recipients,
          handoffGuardrail:
            deliverySubscription?.deliveryGuardrail ?? workspace.packSchedule.automation,
          reportSuite,
          reportSuiteHref: reportSuite
            ? reportSuiteHref(reportSuite)
            : reportSectionHref(workspace, "report-suites"),
        };
      });
      return {
        ...workspace,
        icon: reportWorkspaceIcons[workspace.icon],
        reports,
        roleSetupHref: reportSectionHref(workspace, "role-setup"),
        roleWorkflowHref: reportSectionHref(workspace, "role-workflows"),
        managementBriefsHref: reportSectionHref(workspace, "management-briefs"),
        setupChecklist,
        setupStepCount: syncedSummary?.setupStepCount ?? setupChecklist.length,
        workflowSteps,
        workflowStepCount: syncedSummary?.workflowStepCount ?? workflowSteps.length,
        catalogReportCount,
        readyReports,
        plannedReports,
        automationCount,
        decisionShortcutCount:
          syncedSummary?.decisionShortcutCount ??
          reportDecisionShortcuts.filter((shortcut) => shortcut.persona === workspace.persona)
            .length,
        automationStarterCount:
          syncedSummary?.automationStarterCount ??
          reportAutomationStarters.filter((starter) => starter.persona === workspace.persona)
            .length,
        triggerRuleCount:
          syncedSummary?.triggerRuleCount ??
          reportAutomationTriggerRules.filter((rule) => rule.persona === workspace.persona).length,
        deliverySubscriptionCount:
          syncedSummary?.deliverySubscriptionCount ??
          reportDeliverySubscriptions.filter(
            (subscription) => subscription.persona === workspace.persona
          ).length,
        packTemplateCount:
          syncedSummary?.packTemplateCount ??
          reportPackTemplates.filter((template) => template.persona === workspace.persona).length,
        comparisonPresetCount:
          syncedSummary?.comparisonPresetCount ??
          reportComparisonPresets.filter((preset) => preset.persona === workspace.persona).length,
        reportSuiteCount:
          syncedSummary?.reportSuiteCount ??
          reportSuiteProfiles.filter((suite) => suite.persona === workspace.persona).length,
        managementBriefCount:
          syncedSummary?.managementBriefCount ??
          reportManagementBriefProfiles.filter((brief) => brief.persona === workspace.persona)
            .length,
        quickAccessProfileCount:
          syncedSummary?.quickAccessProfileCount ??
          reportQuickAccessProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        savedViewCount:
          syncedSummary?.savedViewCount ??
          reportSavedViewProfiles.filter((view) => view.persona === workspace.persona).length,
        automationImpactProfileCount:
          syncedSummary?.automationImpactProfileCount ??
          reportAutomationImpactProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        topReadyReport,
        readiness: catalogReportCount ? Math.round((readyReports / catalogReportCount) * 100) : 0,
      };
    });
  }, [syncedReportPersonaSummaries]);
  const visibleWorkspaceSummaries = useMemo(() => {
    return workspaceSummaries.filter((workspace) =>
      matchesReportPersona([workspace.persona], personaFilter)
    );
  }, [personaFilter, workspaceSummaries]);
  const reportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === profile.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === profile.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === profile.deliverySubscriptionId
      );
      if (!workspace || !comparisonPreset || !automationStarter || !deliverySubscription) {
        return [];
      }

      const reports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const reportEntries = reports.map((report) => {
        const context = reportActionContextByPersonaReportId.get(`${profile.persona}:${report.id}`);
        return {
          report,
          context,
          href:
            context?.reportHref ??
            reportPersonaHref(report, profile.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: profile.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: report.name,
            }),
          comparisonHref: context?.comparisonPresets[0]?.href,
          deliveryHref: context?.deliverySubscriptions[0]?.href,
        };
      });
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...profile,
          workspace,
          reports,
          primaryReports: reportEntries.slice(0, 6),
          additionalReports: reportEntries.slice(6),
          readyCount,
          href: reportSectionHref(workspace, "quick-access"),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);
  const visibleReportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessSummaries.filter(
      (profile) =>
        matchesReportPersona([profile.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          profile.title,
          profile.outcome,
          profile.commandKeywords,
          profile.reports.map((report) => report.name).join(" "),
          profile.comparisonPreset.title,
          profile.automationStarter.title,
          profile.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportQuickAccessSummaries]);
  const reportSavedViewSummaries = useMemo(() => {
    return reportSavedViewProfiles.flatMap((view) => {
      const workspace = workspaceSummaries.find((item) => item.persona === view.persona);
      const report = reportCatalog.find((item) => item.id === view.reportId);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === view.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === view.automationStarterId
      );
      if (!workspace || !report || !comparisonPreset || !automationStarter) return [];
      const context = reportActionContextByPersonaReportId.get(`${view.persona}:${report.id}`);

      return [
        {
          ...view,
          workspace,
          report,
          comparisonPreset,
          automationStarter,
          href: reportSavedViewHref(view),
          reportHref:
            context?.reportHref ??
            reportPersonaHref(report, view.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: view.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: view.title,
            }),
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationHref: reportAutomationStarterHref(automationStarter),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);
  const visibleReportSavedViewSummaries = useMemo(() => {
    return reportSavedViewSummaries.filter(
      (view) =>
        matchesReportPersona([view.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          view.title,
          view.description,
          view.dateRangePreset,
          view.comparisonPeriod,
          view.basis,
          view.currency,
          view.dimension,
          view.exportFormat,
          view.automationTrigger,
          view.commandKeywords,
          view.report.name,
          view.comparisonPreset.title,
          view.automationStarter.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSavedViewSummaries]);
  const reportSuiteSummaries = useMemo(() => {
    return reportSuiteProfiles.flatMap((suite) => {
      const workspace = workspaceSummaries.find((item) => item.persona === suite.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === suite.comparisonPresetId
      );
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === suite.packTemplateId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === suite.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === suite.deliverySubscriptionId
      );
      const triggerRules = suite.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === suite.decisionShortcutId
      );
      if (
        !workspace ||
        !comparisonPreset ||
        !packTemplate ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut
      ) {
        return [];
      }

      const reports = suite.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const savedViews = suite.savedViewIds
        .map((viewId) => reportSavedViewSummaries.find((view) => view.id === viewId))
        .filter((view): view is (typeof reportSavedViewSummaries)[number] => Boolean(view));

      return [
        {
          ...suite,
          workspace,
          reports,
          readyCount: reports.filter((report) => report.status !== "planned").length,
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          triggerRules,
          triggerRuleHref: triggerRules[0]
            ? reportAutomationTriggerRuleHref(triggerRules[0])
            : null,
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedViews,
          href: reportSuiteHref(suite),
          categories: uniqueSorted(reports.map((report) => report.category)),
        },
      ];
    });
  }, [reportSavedViewSummaries, workspaceSummaries]);
  const visibleReportSuiteSummaries = useMemo(() => {
    return reportSuiteSummaries.filter(
      (suite) =>
        matchesReportPersona([suite.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          suite.title,
          suite.outcome,
          suite.workflow,
          suite.primaryAction,
          suite.commandKeywords,
          suite.reports.map((report) => report.name).join(" "),
          suite.comparisonPreset.title,
          suite.packTemplate.title,
          suite.automationStarter.title,
          suite.deliverySubscription.title,
          suite.triggerRules.map((rule) => rule.title).join(" "),
          suite.decisionShortcut.question,
          suite.savedViews.map((view) => view.title).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSuiteSummaries]);
  const reportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefProfiles.flatMap((brief) => {
      const workspace = workspaceSummaries.find((item) => item.persona === brief.persona);
      const reportSuite = reportSuiteSummaries.find((suite) => suite.id === brief.reportSuiteId);
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === brief.packTemplateId
      );
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === brief.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === brief.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === brief.deliverySubscriptionId
      );
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === brief.decisionShortcutId
      );
      const savedView = reportSavedViewProfiles.find((view) => view.id === brief.savedViewId);

      if (
        !workspace ||
        !reportSuite ||
        !packTemplate ||
        !comparisonPreset ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut ||
        !savedView
      ) {
        return [];
      }

      const reports = brief.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...brief,
          workspace,
          reports,
          readyCount,
          reportSuite,
          suiteHref: reportSuiteHref(reportSuite),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedView,
          savedViewHref: reportSavedViewHref(savedView),
          href: reportManagementBriefHref(brief),
        },
      ];
    });
  }, [reportSuiteSummaries, workspaceSummaries]);
  const visibleReportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefSummaries.filter(
      (brief) =>
        matchesReportPersona([brief.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          brief.title,
          brief.audience,
          brief.outcome,
          brief.commandKeywords,
          brief.reports.map((report) => report.name).join(" "),
          brief.kpiMetricIds.join(" "),
          brief.narrativeSections.map((section) => section.title).join(" "),
          brief.narrativeSections.map((section) => section.prompt).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.label).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.dimension).join(" "),
          brief.batchAction?.label ?? "",
          brief.reportSuite.title,
          brief.packTemplate.title,
          brief.comparisonPreset.title,
          brief.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportManagementBriefSummaries]);
  const reportPackTemplateSummaries = useMemo(() => {
    return reportPackTemplates.flatMap((template) => {
      const workspace = workspaceSummaries.find((item) => item.persona === template.persona);
      if (!workspace) return [];

      const reports = template.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...template,
          workspace,
          reports,
          readyCount,
          href: reportPackTemplateHref(template),
          categories: uniqueSorted(reports.map((report) => report.category)),
          comparisonTypes: uniqueSorted(reports.map((report) => report.comparison)),
          automationHooks: uniqueSorted(reports.map((report) => report.automation)),
        },
      ];
    });
  }, [workspaceSummaries]);
  const visibleReportPackTemplates = useMemo(() => {
    return reportPackTemplateSummaries.filter(
      (template) =>
        matchesReportPersona([template.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          template.title,
          template.audience,
          template.outcome,
          template.cadence,
          template.delivery,
          template.comparisonFocus,
          template.automationTrigger,
          template.commandKeywords,
          template.reports.map((report) => report.name).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportPackTemplateSummaries]);
  const reportDecisionShortcutSummaries = useMemo(() => {
    return reportDecisionShortcuts.flatMap((shortcut) => {
      const workspace = workspaceSummaries.find((item) => item.persona === shortcut.persona);
      const primaryReport = reportCatalog.find((report) => report.id === shortcut.primaryReportId);
      if (!workspace || !primaryReport) return [];
      const context = reportActionContextByPersonaReportId.get(
        `${shortcut.persona}:${primaryReport.id}`
      );

      const reports = shortcut.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === shortcut.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === shortcut.automationStarterId
      );

      return [
        {
          ...shortcut,
          workspace,
          primaryReport,
          reports,
          comparisonPreset,
          automationStarter,
          href: reportDecisionShortcutHref(shortcut),
          primaryReportHref:
            context?.reportHref ??
            reportPersonaHref(primaryReport, shortcut.persona) ??
            reportDecisionShortcutHref(shortcut),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: shortcut.persona,
              tab: primaryReport.tab ?? workspace.primaryTab,
              search: shortcut.question,
            }),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportDecisionShortcutHref(shortcut),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportDecisionShortcutHref(shortcut),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);
  const visibleReportDecisionShortcuts = useMemo(() => {
    return reportDecisionShortcutSummaries.filter(
      (shortcut) =>
        matchesReportPersona([shortcut.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          shortcut.question,
          shortcut.answer,
          shortcut.commandKeywords,
          shortcut.primaryReport.name,
          shortcut.reports.map((report) => report.name).join(" "),
          shortcut.comparisonPreset?.title,
          shortcut.automationStarter?.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDecisionShortcutSummaries]);

  return {
    reportStats,
    workspaceSummaries,
    visibleWorkspaceSummaries,
    visibleReportQuickAccessSummaries,
    visibleReportSavedViewSummaries,
    reportSuiteSummaries,
    visibleReportSuiteSummaries,
    visibleReportManagementBriefSummaries,
    reportPackTemplateSummaries,
    visibleReportPackTemplates,
    reportDecisionShortcutSummaries,
    visibleReportDecisionShortcuts,
  };
}

export type ReportsWorkspaceSummariesState = ReturnType<typeof useReportsWorkspaceSummaries>;
