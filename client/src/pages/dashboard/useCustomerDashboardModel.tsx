import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReportLaunchDeliveryPreview } from "@/components/reports/ReportLaunchPicker";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useCatalogText } from "@/lib/reportCatalogText";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import { apiRequest } from "@/lib/queryClient";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  calculateReportAutomationImpact,
  calculateReportAutomationHealth,
  clearPreferredReportWorkflowGapFilter,
  clearPreferredReportWorkflowSearch,
  getPreferredReportPersona,
  getPreferredReportWorkflowGapFilter,
  getPreferredReportWorkflowSearch,
  parseReportDeliveryAutomationCommand,
  reportAutomationImpactProfiles,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonaWorkspaces,
  reportQuickAccessProfiles,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportsHref,
  reportWorkspaceHref,
  reportWorkflowFinderGapHref,
  setPreferredReportPersona,
  type ReportPersona,
  type ReportWorkflowGapFilter,
} from "@/lib/reportCatalog";
import { useDashboardPeriod } from "./period";
import type { DashboardStats } from "./types";
import {
  DashboardComparisonId,
  DashboardComparisonRow,
  DashboardReportAutomationPreference,
  DashboardAutomationAction,
  DashboardReportDeliveryRun,
  dashboardPercentChange,
  formatDashboardComparisonPercent,
  dashboardComparisonBadgeVariant,
  formatDashboardDeliveryRunTime,
  dashboardDeliveryRunStatusVariant,
  dashboardDeliveryRunStatusLabel,
  dashboardReportWorkflowSearchScore,
  getDashboardRoleWorkdayPath,
} from "./workspaceHelpers";

export function useCustomerDashboardModel() {
  const { t, locale } = useTranslation();
  const ct = useCatalogText();
  const { toast } = useToast();
  const { companyId: selectedCompanyId, company: selectedCompany } = useDefaultCompany();
  const [preferredReportPersona, setDashboardReportPersona] = useState<ReportPersona>(
    () => getPreferredReportPersona() ?? "owner"
  );
  const [reportWorkflowPreferenceRevision, setReportWorkflowPreferenceRevision] = useState(0);
  // Progressive disclosure: the full report workspace is heavy and secondary to a
  // daily glance, so it's collapsed by default. Preference persists per user.
  const [showReportWorkspace, setShowReportWorkspace] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dashboard-show-report-workspace") === "true";
    } catch {
      return false;
    }
  });
  const toggleReportWorkspace = () =>
    setShowReportWorkspace((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dashboard-show-report-workspace", next ? "true" : "false");
      } catch {
        /* ignore */
      }
      return next;
    });
  const [
    acknowledgedDashboardReportDeliveryHandoffGaps,
    setAcknowledgedDashboardReportDeliveryHandoffGaps,
  ] = useState<Record<string, true>>({});
  const preferredReportWorkspace = useMemo(() => {
    return (
      reportPersonaWorkspaces.find((workspace) => workspace.persona === preferredReportPersona) ??
      reportPersonaWorkspaces[0]
    );
  }, [preferredReportPersona]);
  // Acknowledgements belong to one persona + company: reset them when either changes.
  const acknowledgementScope = `${preferredReportWorkspace.persona}:${selectedCompanyId ?? ""}`;
  const [acknowledgedScope, setAcknowledgedScope] = useState(acknowledgementScope);
  if (acknowledgedScope !== acknowledgementScope) {
    setAcknowledgedScope(acknowledgementScope);
    setAcknowledgedDashboardReportDeliveryHandoffGaps({});
  }
  const preferredReportWorkflowSearch = useMemo(
    () => getPreferredReportWorkflowSearch(preferredReportWorkspace.persona).trim(),
    // The revision re-reads the localStorage-backed preference after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferredReportWorkspace.persona, reportWorkflowPreferenceRevision]
  );
  const preferredReportWorkflowGapFilter = useMemo(
    () => getPreferredReportWorkflowGapFilter(preferredReportWorkspace.persona),
    // The revision re-reads the localStorage-backed preference after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferredReportWorkspace.persona, reportWorkflowPreferenceRevision]
  );
  const normalizedPreferredReportWorkflowSearch = preferredReportWorkflowSearch.toLowerCase();
  const reportCatalogDiscoveryQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(preferredReportWorkspace.persona),
    queryFn: () => fetchReportCatalogDiscovery(preferredReportWorkspace.persona),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const dashboardReportActionContextById = useMemo(() => {
    return new Map(
      (reportCatalogDiscoveryQuery.data?.reportActionContexts ?? [])
        .filter((context) => context.persona === preferredReportWorkspace.persona)
        .map((context) => [context.reportId, context])
    );
  }, [preferredReportWorkspace.persona, reportCatalogDiscoveryQuery.data?.reportActionContexts]);
  const reportAutomationPreferencesQuery = useQuery<{
    preferences: DashboardReportAutomationPreference[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    enabled: Boolean(selectedCompanyId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const selectedReportPersonaSummary = reportCatalogDiscoveryQuery.data?.personaSummaries[0];
  const dashboardReportWorkspaces = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const readyReports = reports.filter((report) => report.status !== "planned").length;
      const automationStarterCount = reportAutomationStarters.filter(
        (starter) => starter.persona === workspace.persona
      ).length;
      const packTemplateCount = reportPackTemplates.filter(
        (template) => template.persona === workspace.persona
      ).length;
      const comparisonPresetCount = reportComparisonPresets.filter(
        (preset) => preset.persona === workspace.persona
      ).length;
      const syncedSummary =
        selectedReportPersonaSummary?.persona === workspace.persona
          ? selectedReportPersonaSummary
          : null;
      const totalReports = syncedSummary?.reportCount ?? reports.length;
      const readyReportCount = syncedSummary?.readyReportCount ?? readyReports;
      return {
        ...workspace,
        readyReports: readyReportCount,
        totalReports,
        syncedAutomationStarters: syncedSummary?.automationStarterCount,
        automationStarterCount: syncedSummary?.automationStarterCount ?? automationStarterCount,
        packTemplateCount: syncedSummary?.packTemplateCount ?? packTemplateCount,
        comparisonPresetCount: syncedSummary?.comparisonPresetCount ?? comparisonPresetCount,
        readinessPercent: totalReports ? Math.round((readyReportCount / totalReports) * 100) : 0,
        isSelected: workspace.persona === preferredReportPersona,
      };
    });
  }, [preferredReportPersona, selectedReportPersonaSummary]);
  const selectDashboardReportPersona = (persona: ReportPersona) => {
    setPreferredReportPersona(persona);
    setDashboardReportPersona(persona);
  };
  const clearDashboardReportWorkflowContext = () => {
    clearPreferredReportWorkflowSearch(preferredReportWorkspace.persona);
    clearPreferredReportWorkflowGapFilter(preferredReportWorkspace.persona);
    setReportWorkflowPreferenceRevision((revision) => revision + 1);
  };
  const dashboardRoleWorkdayPath = useMemo(
    () => getDashboardRoleWorkdayPath(preferredReportWorkspace),
    [preferredReportWorkspace]
  );
  const preferredWorkspaceCatalogReports = useMemo(() => {
    return reportCatalog.filter((report) =>
      report.personas.includes(preferredReportWorkspace.persona)
    );
  }, [preferredReportWorkspace.persona]);
  const preferredWorkspaceReports = useMemo(() => {
    return preferredWorkspaceCatalogReports
      .filter((report) => report.status !== "planned")
      .map((report, index) => ({
        report,
        index,
        searchScore: dashboardReportWorkflowSearchScore(
          [
            report.name,
            report.category,
            report.comparison,
            report.automation,
            report.decisionQuestion,
            report.commandKeywords,
          ],
          normalizedPreferredReportWorkflowSearch
        ),
      }))
      .sort((a, b) => b.searchScore - a.searchScore || a.index - b.index)
      .map(({ report }) => report)
      .slice(0, 4);
  }, [normalizedPreferredReportWorkflowSearch, preferredWorkspaceCatalogReports]);
  const preferredReportQuickAccess = useMemo(() => {
    const profile =
      reportQuickAccessProfiles.find((item) => item.persona === preferredReportWorkspace.persona) ??
      reportQuickAccessProfiles[0]!;
    const reports = profile.reportIds
      .map((reportId) => reportCatalog.find((report) => report.id === reportId))
      .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
    const reportEntries = reports.map((report) => {
      const context = dashboardReportActionContextById.get(report.id);
      return {
        report,
        context,
        href:
          context?.reportHref ??
          reportPersonaHref(report, preferredReportWorkspace.persona) ??
          reportWorkspaceHref(preferredReportWorkspace),
        workflowHref:
          context?.workflowHref ??
          reportWorkflowContextHref({
            persona: preferredReportWorkspace.persona,
            tab: report.tab ?? preferredReportWorkspace.primaryTab,
            search: report.name,
          }),
        comparisonHref: context?.comparisonPresets[0]?.href,
        deliveryHref: context?.deliverySubscriptions[0]?.href,
      };
    });
    const comparisonPreset = reportComparisonPresets.find(
      (preset) => preset.id === profile.comparisonPresetId
    );
    const automationStarter = reportAutomationStarters.find(
      (starter) => starter.id === profile.automationStarterId
    );
    const deliverySubscription = reportDeliverySubscriptions.find(
      (subscription) => subscription.id === profile.deliverySubscriptionId
    );

    return {
      profile,
      reports,
      primaryReports: reportEntries.slice(0, 6),
      additionalReports: reportEntries.slice(6),
      readyReports: reports.filter((report) => report.status !== "planned").length,
      comparisonHref: comparisonPreset
        ? reportComparisonPresetHref(comparisonPreset)
        : reportSectionHref(preferredReportWorkspace, "recommendations"),
      automationHref: automationStarter
        ? reportAutomationStarterHref(automationStarter)
        : reportSectionHref(preferredReportWorkspace, "automation-starters"),
      deliveryHref: deliverySubscription
        ? reportDeliverySubscriptionHref(deliverySubscription)
        : reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
      href: reportSectionHref(preferredReportWorkspace, "quick-access"),
    };
  }, [dashboardReportActionContextById, preferredReportWorkspace]);
  const preferredReportSetupSteps = useMemo(() => {
    return preferredReportWorkspace.setupChecklist.map((step) => {
      const reports = step.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));

      return {
        ...step,
        reports,
        href: reportSectionHref(preferredReportWorkspace, step.section),
      };
    });
  }, [preferredReportWorkspace]);
  const preferredReportSavedViews = useMemo(() => {
    return reportSavedViewProfiles
      .filter((view) => view.persona === preferredReportWorkspace.persona)
      .map((view) => {
        const report = reportCatalog.find((item) => item.id === view.reportId);
        const comparisonPreset = reportComparisonPresets.find(
          (preset) => preset.id === view.comparisonPresetId
        );
        const automationStarter = reportAutomationStarters.find(
          (starter) => starter.id === view.automationStarterId
        );
        const context = report ? dashboardReportActionContextById.get(report.id) : undefined;

        return {
          ...view,
          report,
          comparisonPreset,
          automationStarter,
          href: reportSavedViewHref(view),
          reportHref: report
            ? (context?.reportHref ??
              reportPersonaHref(report, preferredReportWorkspace.persona) ??
              reportWorkspaceHref(preferredReportWorkspace))
            : reportWorkspaceHref(preferredReportWorkspace),
          workflowHref:
            context?.workflowHref ??
            (report
              ? reportWorkflowContextHref({
                  persona: preferredReportWorkspace.persona,
                  tab: report.tab ?? preferredReportWorkspace.primaryTab,
                  search: view.title,
                })
              : reportSectionHref(preferredReportWorkspace, "workflow-finder")),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportSectionHref(preferredReportWorkspace, "recommendations"),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportSectionHref(preferredReportWorkspace, "automation-starters"),
        };
      });
  }, [dashboardReportActionContextById, preferredReportWorkspace]);
  const preferredReportSuites = useMemo(() => {
    return reportSuiteProfiles
      .filter((suite) => suite.persona === preferredReportWorkspace.persona)
      .map((suite) => {
        const reports = suite.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
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
        const savedViews = suite.savedViewIds
          .map((viewId) => reportSavedViewProfiles.find((view) => view.id === viewId))
          .filter((view): view is (typeof reportSavedViewProfiles)[number] => Boolean(view));

        return {
          ...suite,
          reports,
          readyReports: reports.filter((report) => report.status !== "planned").length,
          comparisonPreset,
          packTemplate,
          automationStarter,
          deliverySubscription,
          triggerRules,
          decisionShortcut,
          savedViews,
          href: reportSuiteHref(suite),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportSectionHref(preferredReportWorkspace, "recommendations"),
          packHref: packTemplate
            ? reportPackTemplateHref(packTemplate)
            : reportSectionHref(preferredReportWorkspace, "pack-readiness"),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportSectionHref(preferredReportWorkspace, "automation-starters"),
          deliveryHref: deliverySubscription
            ? reportDeliverySubscriptionHref(deliverySubscription)
            : reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
          decisionHref: decisionShortcut
            ? reportDecisionShortcutHref(decisionShortcut)
            : reportSectionHref(preferredReportWorkspace, "decision-shortcuts"),
        };
      });
  }, [preferredReportWorkspace]);
  const preferredReportPackReadiness = useMemo(() => {
    const readyReports = preferredWorkspaceCatalogReports.filter(
      (report) => report.status !== "planned"
    ).length;
    const plannedReports = preferredWorkspaceCatalogReports.length - readyReports;

    return {
      readyReports,
      plannedReports,
      totalReports: preferredWorkspaceCatalogReports.length,
      automationLanes: preferredReportWorkspace.automations.length,
      syncedReadyReports: selectedReportPersonaSummary?.readyReportCount ?? readyReports,
      syncedPackTemplates:
        selectedReportPersonaSummary?.packTemplateCount ??
        reportPackTemplates.filter(
          (template) => template.persona === preferredReportWorkspace.persona
        ).length,
      syncedComparisonPresets:
        selectedReportPersonaSummary?.comparisonPresetCount ??
        reportComparisonPresets.filter(
          (preset) => preset.persona === preferredReportWorkspace.persona
        ).length,
      syncedAutomationLanes:
        reportCatalogDiscoveryQuery.data?.summary.automationPlaybookCount ??
        preferredReportWorkspace.automations.length,
      readinessPercent: preferredWorkspaceCatalogReports.length
        ? Math.round((readyReports / preferredWorkspaceCatalogReports.length) * 100)
        : 0,
    };
  }, [
    preferredReportWorkspace.automations.length,
    preferredReportWorkspace.persona,
    preferredWorkspaceCatalogReports,
    reportCatalogDiscoveryQuery.data?.summary.automationPlaybookCount,
    selectedReportPersonaSummary?.comparisonPresetCount,
    selectedReportPersonaSummary?.packTemplateCount,
    selectedReportPersonaSummary?.readyReportCount,
  ]);
  const preferredReportPackTemplates = useMemo(() => {
    return reportPackTemplates
      .filter((template) => template.persona === preferredReportWorkspace.persona)
      .map((template) => {
        const reports = template.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;

        return {
          ...template,
          reports,
          readyReports,
          href: reportPackTemplateHref(template),
          searchScore: dashboardReportWorkflowSearchScore(
            [
              template.title,
              template.audience,
              template.outcome,
              template.cadence,
              template.delivery,
              template.comparisonFocus,
              template.automationTrigger,
              template.commandKeywords,
              reports.map((report) => report.name).join(" "),
            ],
            normalizedPreferredReportWorkflowSearch
          ),
        };
      })
      .sort((a, b) => b.searchScore - a.searchScore);
  }, [normalizedPreferredReportWorkflowSearch, preferredReportWorkspace.persona]);
  const preferredReportAutomationStarters = useMemo(() => {
    return reportAutomationStarters
      .filter((starter) => starter.persona === preferredReportWorkspace.persona)
      .map((starter) => {
        const reports = starter.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;
        const playbooks = starter.playbookIds
          .map((playbookId) =>
            preferredReportWorkspace.automations.find((playbook) => playbook.id === playbookId)
          )
          .filter((playbook): playbook is (typeof preferredReportWorkspace.automations)[number] =>
            Boolean(playbook)
          );

        return {
          ...starter,
          reports,
          readyReports,
          playbooks,
          href: reportAutomationStarterHref(starter),
          searchScore: dashboardReportWorkflowSearchScore(
            [
              starter.title,
              starter.audience,
              starter.outcome,
              starter.setupTime,
              starter.trigger,
              starter.primaryAction,
              starter.commandKeywords,
              reports.map((report) => report.name).join(" "),
              playbooks.map((playbook) => playbook.title).join(" "),
            ],
            normalizedPreferredReportWorkflowSearch
          ),
        };
      })
      .sort((a, b) => b.searchScore - a.searchScore);
  }, [normalizedPreferredReportWorkflowSearch, preferredReportWorkspace]);
  const preferredReportDecisionShortcuts = useMemo(() => {
    return reportDecisionShortcuts
      .filter((shortcut) => shortcut.persona === preferredReportWorkspace.persona)
      .map((shortcut) => {
        const reports = shortcut.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const primaryReport =
          reports.find((report) => report.id === shortcut.primaryReportId) ?? reports[0];
        const context = primaryReport
          ? dashboardReportActionContextById.get(primaryReport.id)
          : undefined;

        return {
          ...shortcut,
          reports,
          primaryReport,
          href: reportDecisionShortcutHref(shortcut),
          primaryReportHref: primaryReport
            ? (context?.reportHref ??
              reportPersonaHref(primaryReport, preferredReportWorkspace.persona) ??
              reportDecisionShortcutHref(shortcut))
            : reportDecisionShortcutHref(shortcut),
          workflowHref:
            context?.workflowHref ??
            (primaryReport
              ? reportWorkflowContextHref({
                  persona: preferredReportWorkspace.persona,
                  tab: primaryReport.tab ?? preferredReportWorkspace.primaryTab,
                  search: shortcut.question,
                })
              : reportDecisionShortcutHref(shortcut)),
          searchScore: dashboardReportWorkflowSearchScore(
            [
              shortcut.question,
              shortcut.answer,
              shortcut.commandKeywords,
              shortcut.reportIds.join(" "),
              primaryReport?.name,
              reports.map((report) => report.name).join(" "),
            ],
            normalizedPreferredReportWorkflowSearch
          ),
        };
      })
      .sort((a, b) => b.searchScore - a.searchScore);
  }, [
    dashboardReportActionContextById,
    normalizedPreferredReportWorkflowSearch,
    preferredReportWorkspace.persona,
    preferredReportWorkspace.primaryTab,
  ]);
  const preferredReportComparisonPresets = useMemo(() => {
    return reportComparisonPresets
      .filter((preset) => preset.persona === preferredReportWorkspace.persona)
      .map((preset) => {
        const reports = preset.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));

        return {
          ...preset,
          reports,
          href: reportComparisonPresetHref(preset),
          searchScore: dashboardReportWorkflowSearchScore(
            [
              preset.title,
              preset.question,
              preset.baseline,
              preset.automationTrigger,
              preset.commandKeywords,
              reports.map((report) => report.name).join(" "),
            ],
            normalizedPreferredReportWorkflowSearch
          ),
        };
      })
      .sort((a, b) => b.searchScore - a.searchScore);
  }, [normalizedPreferredReportWorkflowSearch, preferredReportWorkspace.persona]);
  const preferredReportTriggerRules = useMemo(() => {
    return reportAutomationTriggerRules
      .filter((rule) => rule.persona === preferredReportWorkspace.persona)
      .map((rule) => {
        const reports = rule.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const primaryReport = reports[0] ?? null;

        return {
          ...rule,
          reports,
          primaryReport,
          href: reportAutomationTriggerRuleHref(rule),
          primaryReportHref: primaryReport
            ? (reportPersonaHref(primaryReport, preferredReportWorkspace.persona) ??
              reportAutomationTriggerRuleHref(rule))
            : reportAutomationTriggerRuleHref(rule),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const preferredReportDeliverySubscriptions = useMemo(() => {
    return reportDeliverySubscriptions
      .filter((subscription) => subscription.persona === preferredReportWorkspace.persona)
      .map((subscription) => {
        const reports = subscription.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const readyReports = reports.filter((report) => report.status !== "planned").length;
        const triggerRules = subscription.triggerRuleIds
          .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
          .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
        const packTemplate = reportPackTemplates.find(
          (template) => template.id === subscription.packTemplateId
        );

        return {
          ...subscription,
          reports,
          readyReports,
          triggerRules,
          packTemplate,
          href: reportDeliverySubscriptionHref(subscription),
        };
      });
  }, [preferredReportWorkspace.persona]);
  const dashboardPinnedDeliveryAutomationCommand = useMemo(() => {
    const preference = reportAutomationPreferencesQuery.data?.preferences.find(
      (item) => item.persona === preferredReportWorkspace.persona
    );

    return preference
      ? (parseReportDeliveryAutomationCommand(preference.preferredDeliveryAutomationCommand) ??
          undefined)
      : undefined;
  }, [preferredReportWorkspace.persona, reportAutomationPreferencesQuery.data?.preferences]);

  const {
    choice: periodChoice,
    setChoice: setPeriodChoice,
    query: periodQuery,
  } = useDashboardPeriod();

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery<DashboardStats>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/stats", periodQuery],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/dashboard/stats${periodQuery}`),
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    // R20-05: the list endpoint paginates by default; dashboard aggregates need all rows.
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/invoices?all=true`),
    enabled: !!selectedCompanyId,
  });

  const { data: journalEntries } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    enabled: !!selectedCompanyId,
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/expense-breakdown", periodQuery],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/dashboard/expense-breakdown${periodQuery}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: monthlyTrends, isLoading: trendsLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "dashboard/monthly-trends"],
    enabled: !!selectedCompanyId,
  });

  const { data: compliance } = useQuery<any>({
    queryKey: ["/api/companies", selectedCompanyId, "compliance/overview"],
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const dashboardReportDeliveryRunsQuery = useQuery<{
    runs: DashboardReportDeliveryRun[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs", "dashboard"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    enabled: Boolean(selectedCompanyId),
    retry: 1,
  });

  const queueDashboardReportDeliverySubscription = useMutation({
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
      dashboardReportDeliveryRunsQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: ct.cx("Report pack queued"),
        description: ct.cx(
          nextRunLabel
            ? `${subscriptionTitle} queued for ${nextRunLabel}.`
            : `${subscriptionTitle} queued from Dashboard.`
        ),
      });
    },
    onError: (error: any) => {
      toast({
        title: ct.cx("Could not queue report pack"),
        description: error?.message || ct.cx("Failed to queue the report pack"),
        variant: "destructive",
      });
    },
  });

  const retryDashboardReportDeliveryRun = useMutation({
    mutationFn: (runId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before retrying delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
    },
    onSuccess: (result: any) => {
      dashboardReportDeliveryRunsQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      toast({
        title: ct.cx("Report delivery retry queued"),
        description: ct.cx(`${subscriptionTitle} was requeued from Dashboard.`),
      });
    },
    onError: (error: any) => {
      toast({
        title: ct.cx("Could not retry report delivery"),
        description: error?.message || ct.cx("Failed to retry the report delivery"),
        variant: "destructive",
      });
    },
  });

  // Derive deltas + sparklines from monthlyTrends, gracefully handling empty data
  const sparks = useMemo(() => {
    const trends = monthlyTrends ?? [];
    const revenueSeries = trends.map((t) => Number(t?.revenue ?? 0));
    const expenseSeries = trends.map((t) => Number(t?.expenses ?? 0));
    // B2 (NM4): net profit includes other income, which is not part of revenue.
    const profitSeries = trends.map((t) =>
      t?.netProfit !== undefined
        ? Number(t.netProfit)
        : Number(t?.revenue ?? 0) - Number(t?.expenses ?? 0)
    );

    const pctChange = (series: number[]) => {
      if (series.length < 2) return undefined;
      const prev = series[series.length - 2];
      const curr = series[series.length - 1];
      if (!prev) return undefined;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    return {
      revenue: {
        series: revenueSeries,
        delta: stats?.changes?.vsPrior?.revenue ?? pctChange(revenueSeries),
      },
      expenses: {
        series: expenseSeries,
        delta: stats?.changes?.vsPrior?.expenses ?? pctChange(expenseSeries),
      },
      profit: {
        series: profitSeries,
        delta: stats?.changes?.vsPrior?.netProfit ?? pctChange(profitSeries),
      },
    };
  }, [monthlyTrends, stats]);

  const dashboardComparisonRows = useMemo(() => {
    const trends = monthlyTrends ?? [];
    const current = trends[trends.length - 1] ?? {};
    const previous = trends[trends.length - 2] ?? {};
    const currentRevenue = Number(current?.revenue ?? 0);
    const previousRevenue = Number(previous?.revenue ?? 0);
    const currentExpenses = Number(current?.expenses ?? 0);
    const previousExpenses = Number(previous?.expenses ?? 0);

    const rows: Record<DashboardComparisonId, DashboardComparisonRow> = {
      revenue: {
        id: "revenue",
        label: "Revenue",
        current: currentRevenue,
        previous: previousRevenue,
        delta: currentRevenue - previousRevenue,
        percentChange: dashboardPercentChange(currentRevenue, previousRevenue),
        favorable: "increase",
        href: reportsHref({ tab: "sales", persona: preferredReportWorkspace.persona }),
      },
      expenses: {
        id: "expenses",
        label: "Expenses",
        current: currentExpenses,
        previous: previousExpenses,
        delta: currentExpenses - previousExpenses,
        percentChange: dashboardPercentChange(currentExpenses, previousExpenses),
        favorable: "decrease",
        href: reportsHref({ tab: "expenses", persona: preferredReportWorkspace.persona }),
      },
      profit: {
        id: "profit",
        label: "Profit",
        current: currentRevenue - currentExpenses,
        previous: previousRevenue - previousExpenses,
        delta: currentRevenue - currentExpenses - (previousRevenue - previousExpenses),
        percentChange: dashboardPercentChange(
          currentRevenue - currentExpenses,
          previousRevenue - previousExpenses
        ),
        favorable: "increase",
        href: reportsHref({ tab: "pl", persona: preferredReportWorkspace.persona }),
      },
    };

    const comparisonOrder = {
      owner: ["revenue", "profit", "expenses"],
      freelancer: ["revenue", "expenses", "profit"],
      accountant: ["profit", "revenue", "expenses"],
    } as const;

    return comparisonOrder[preferredReportWorkspace.persona].map((id) => rows[id]);
  }, [monthlyTrends, preferredReportWorkspace.persona]);

  const reportAutomationHealth = useMemo(() => {
    const comparisonWarnings = dashboardComparisonRows.filter(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    ).length;
    return calculateReportAutomationHealth({
      readinessPercent: preferredReportPackReadiness.readinessPercent,
      automationLaneCount: preferredReportPackReadiness.automationLanes,
      comparisonMetricCount: dashboardComparisonRows.length,
      comparisonWarningCount: comparisonWarnings,
      plannedReportCount: preferredReportPackReadiness.plannedReports,
    });
  }, [dashboardComparisonRows, preferredReportPackReadiness]);
  const preferredReportAutomationImpact = useMemo(() => {
    const profile =
      reportAutomationImpactProfiles.find(
        (item) => item.persona === preferredReportWorkspace.persona
      ) ?? reportAutomationImpactProfiles[0]!;
    const readyDeliveryCount = preferredReportDeliverySubscriptions.filter(
      (subscription) => subscription.readyReports >= subscription.reports.length
    ).length;
    const estimate = calculateReportAutomationImpact(profile, {
      readyRuleCount: preferredReportTriggerRules.length,
      readyDeliveryCount,
      readyReportCount: preferredReportPackReadiness.readyReports,
      openWorkItemCount: reportAutomationHealth.reviewSignals,
      recommendationCount: preferredReportDecisionShortcuts.length,
      amountAtRisk: Number(stats?.outstanding ?? 0),
    });

    return {
      profile,
      estimate,
      readyDeliveryCount,
      href: reportSectionHref(preferredReportWorkspace, "automation-impact"),
    };
  }, [
    preferredReportDecisionShortcuts.length,
    preferredReportDeliverySubscriptions,
    preferredReportPackReadiness.readyReports,
    preferredReportTriggerRules.length,
    preferredReportWorkspace,
    reportAutomationHealth.reviewSignals,
    stats?.outstanding,
  ]);

  const dashboardPersonaDeliveryRuns = useMemo(() => {
    const subscriptionIds = new Set(
      preferredReportDeliverySubscriptions.map((subscription) => subscription.id)
    );
    return (dashboardReportDeliveryRunsQuery.data?.runs ?? [])
      .filter((run) => subscriptionIds.has(run.subscriptionId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [dashboardReportDeliveryRunsQuery.data?.runs, preferredReportDeliverySubscriptions]);

  const dashboardLatestDeliveryRun = dashboardPersonaDeliveryRuns[0] ?? null;
  const dashboardLatestFailedDeliveryRun =
    dashboardPersonaDeliveryRuns.find((run) => run.status === "failed") ?? null;
  const dashboardLatestDeliveryRunSubscription = dashboardLatestDeliveryRun
    ? (preferredReportDeliverySubscriptions.find(
        (subscription) => subscription.id === dashboardLatestDeliveryRun.subscriptionId
      ) ?? null)
    : null;
  const dashboardReportDeliveryHandoffBySubscriptionId = useMemo(() => {
    return preferredReportDeliverySubscriptions.reduce<
      Record<
        string,
        {
          priorityGap: ReportWorkflowGapFilter | null;
          rows: NonNullable<ReportLaunchDeliveryPreview["handoffRows"]>;
        }
      >
    >((handoffs, subscription) => {
      const failedRun =
        dashboardPersonaDeliveryRuns.find(
          (run) => run.subscriptionId === subscription.id && run.status === "failed"
        ) ?? null;
      const latestRun =
        dashboardPersonaDeliveryRuns.find((run) => run.subscriptionId === subscription.id) ?? null;
      const reportGapCount = Math.max(0, subscription.reports.length - subscription.readyReports);
      const priorityGap: ReportWorkflowGapFilter | null = failedRun
        ? "delivery-gaps"
        : reportGapCount > 0
          ? "report-gaps"
          : latestRun && latestRun.readinessStatus !== "ready"
            ? "delivery-gaps"
            : null;
      const gapHref = reportWorkflowContextHref({
        persona: preferredReportWorkspace.persona,
        tab: preferredReportWorkspace.primaryTab,
        search: subscription.title,
        gap: priorityGap,
      });
      const gapDetail = failedRun
        ? (failedRun.errorMessage ?? "Recover the failed delivery before the next send.")
        : reportGapCount > 0
          ? `${reportGapCount} report${reportGapCount === 1 ? "" : "s"} need setup before delivery.`
          : latestRun && latestRun.readinessStatus !== "ready"
            ? `Latest run readiness is ${latestRun.readinessStatus}.`
            : "Ready for the next scheduled send.";

      handoffs[subscription.id] = {
        priorityGap,
        rows: [
          {
            label: "Shared context",
            value: priorityGap ? t["dashboard.modelNeedsAcknowledgement"] : "Ready",
            status: priorityGap ? "review" : "ready",
            detail: `${subscription.readyReports}/${subscription.reports.length} reports and ${subscription.triggerRules.length} guardrails tracked from Dashboard.`,
            href: reportWorkflowContextHref({
              persona: preferredReportWorkspace.persona,
              tab: preferredReportWorkspace.primaryTab,
              search: subscription.title,
            }),
          },
          {
            label: "Priority gap",
            value: priorityGap ? reportWorkflowGapFilterLabels[priorityGap] : "No open gap",
            status: priorityGap ? "review" : "ready",
            detail: gapDetail,
            href: gapHref,
          },
          {
            label: "Next action",
            value: failedRun
              ? t["dashboard.modelRecoverFailedDelivery"]
              : priorityGap
                ? t["dashboard.modelReviewHandoffGaps"]
                : "Queue from Dashboard",
            status: priorityGap ? "review" : "ready",
            detail: priorityGap
              ? "Acknowledge the handoff before queuing this report pack from Dashboard."
              : "The dashboard launcher can queue this pack when needed.",
            href: gapHref,
          },
        ],
      };
      return handoffs;
    }, {});
  }, [
    t,
    dashboardPersonaDeliveryRuns,
    preferredReportDeliverySubscriptions,
    preferredReportWorkspace.persona,
    preferredReportWorkspace.primaryTab,
  ]);
  const dashboardReportDeliveryLauncherPreviewById = useMemo(() => {
    return preferredReportDeliverySubscriptions.reduce<
      Record<string, ReportLaunchDeliveryPreview | undefined>
    >((previews, subscription) => {
      const latestRun =
        dashboardPersonaDeliveryRuns.find((run) => run.subscriptionId === subscription.id) ?? null;
      const handoff = dashboardReportDeliveryHandoffBySubscriptionId[subscription.id];
      const reportSuites = preferredReportSuites.filter(
        (suite) => suite.deliverySubscriptionId === subscription.id
      );
      previews[subscription.id] = {
        status: latestRun ? dashboardDeliveryRunStatusLabel(latestRun.status) : "Scheduled",
        statusVariant: latestRun ? dashboardDeliveryRunStatusVariant(latestRun.status) : "info",
        nextRunLabel: subscription.cadence,
        channel: latestRun?.channel ?? subscription.channel,
        format: latestRun?.format ?? subscription.format,
        recipients: latestRun?.recipients ?? subscription.recipients,
        deliveryGuardrail: latestRun?.deliveryGuardrail ?? subscription.deliveryGuardrail,
        summary: `${subscription.reportIds.length} reports · ${subscription.triggerRuleIds.length} guardrails`,
        suiteTitles: reportSuites.map((suite) => suite.title),
        latestRunStatus: latestRun?.status,
        latestRunStatusVariant: latestRun
          ? dashboardDeliveryRunStatusVariant(latestRun.status)
          : undefined,
        latestRunId: latestRun?.id,
        latestRunLabel: latestRun
          ? formatDashboardDeliveryRunTime(latestRun.createdAt, locale)
          : undefined,
        latestRunDetail: latestRun
          ? `Scheduled ${formatDashboardDeliveryRunTime(latestRun.scheduledFor, locale)} · ${latestRun.readyReportCount}/${latestRun.reportCount} reports · ${latestRun.channel}`
          : undefined,
        latestRunError:
          latestRun?.status === "failed"
            ? (latestRun.errorMessage ?? "Retry after fixing delivery settings or guardrails.")
            : null,
        handoffRows: handoff?.rows,
        handoffRequiresAcknowledgement: Boolean(handoff?.priorityGap),
        handoffAcknowledged: Boolean(
          acknowledgedDashboardReportDeliveryHandoffGaps[subscription.id]
        ),
      };
      return previews;
    }, {});
  }, [
    acknowledgedDashboardReportDeliveryHandoffGaps,
    dashboardPersonaDeliveryRuns,
    dashboardReportDeliveryHandoffBySubscriptionId,
    locale,
    preferredReportDeliverySubscriptions,
    preferredReportSuites,
  ]);
  const dashboardDeliveryRunStatusSummary = useMemo(() => {
    if (!dashboardLatestDeliveryRun) return null;

    const subscriptionTitle = dashboardLatestDeliveryRunSubscription?.title ?? "Report delivery";
    const scheduledLabel = formatDashboardDeliveryRunTime(
      dashboardLatestDeliveryRun.scheduledFor,
      locale
    );
    const statusLabel = dashboardDeliveryRunStatusLabel(dashboardLatestDeliveryRun.status);
    const statusVariant = dashboardDeliveryRunStatusVariant(dashboardLatestDeliveryRun.status);
    const detail =
      dashboardLatestDeliveryRun.status === "failed"
        ? `${subscriptionTitle} failed before ${scheduledLabel}${
            dashboardLatestDeliveryRun.errorMessage
              ? `: ${dashboardLatestDeliveryRun.errorMessage}`
              : "."
          }`
        : dashboardLatestDeliveryRun.status === "sent"
          ? `${subscriptionTitle} was sent for ${scheduledLabel}.`
          : dashboardLatestDeliveryRun.status === "queued"
            ? `${subscriptionTitle} is queued for ${scheduledLabel}.`
            : `${subscriptionTitle} is ${dashboardLatestDeliveryRun.status} for ${scheduledLabel}.`;

    return {
      status: dashboardLatestDeliveryRun.status,
      statusLabel,
      statusVariant,
      detail,
    };
  }, [dashboardLatestDeliveryRun, dashboardLatestDeliveryRunSubscription, locale]);
  const preferredReportWorkflowGapLinks = useMemo(() => {
    const deliverySetupGapCount = preferredReportDeliverySubscriptions.filter(
      (subscription) => subscription.readyReports < subscription.reports.length
    ).length;
    const failedDeliveryRunCount = dashboardPersonaDeliveryRuns.filter(
      (run) => run.status === "failed"
    ).length;

    return [
      {
        gap: "report-gaps" as const,
        label: reportWorkflowGapFilterLabels["report-gaps"],
        count: preferredReportPackReadiness.plannedReports,
        isPreferred: preferredReportWorkflowGapFilter === "report-gaps",
        href: reportWorkflowFinderGapHref({
          persona: preferredReportWorkspace.persona,
          gap: "report-gaps",
          search: preferredReportWorkflowSearch,
        }),
      },
      {
        gap: "rule-gaps" as const,
        label: reportWorkflowGapFilterLabels["rule-gaps"],
        count: reportAutomationHealth.reviewSignals,
        isPreferred: preferredReportWorkflowGapFilter === "rule-gaps",
        href: reportWorkflowFinderGapHref({
          persona: preferredReportWorkspace.persona,
          gap: "rule-gaps",
          search: preferredReportWorkflowSearch,
        }),
      },
      {
        gap: "delivery-gaps" as const,
        label: reportWorkflowGapFilterLabels["delivery-gaps"],
        count: deliverySetupGapCount + failedDeliveryRunCount,
        isPreferred: preferredReportWorkflowGapFilter === "delivery-gaps",
        href: reportWorkflowFinderGapHref({
          persona: preferredReportWorkspace.persona,
          gap: "delivery-gaps",
          search: preferredReportWorkflowSearch,
        }),
      },
    ];
  }, [
    dashboardPersonaDeliveryRuns,
    preferredReportDeliverySubscriptions,
    preferredReportPackReadiness.plannedReports,
    preferredReportWorkflowGapFilter,
    preferredReportWorkflowSearch,
    preferredReportWorkspace.persona,
    reportAutomationHealth.reviewSignals,
  ]);
  const preferredReportWorkflowGapLabel = preferredReportWorkflowGapFilter
    ? reportWorkflowGapFilterLabels[preferredReportWorkflowGapFilter]
    : "";
  const hasDashboardReportWorkflowContext = Boolean(
    preferredReportWorkflowSearch || preferredReportWorkflowGapFilter
  );
  const dashboardReportWorkflowContextHref = reportWorkflowContextHref({
    persona: preferredReportWorkspace.persona,
    tab: preferredReportWorkspace.primaryTab,
    search: preferredReportWorkflowSearch,
    gap: preferredReportWorkflowGapFilter,
  });

  const dashboardPinnedAutomationAction = useMemo<DashboardAutomationAction | null>(() => {
    if (!dashboardPinnedDeliveryAutomationCommand) return null;

    const warningComparison = dashboardComparisonRows.find(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    );
    const primaryDeliverySubscription = preferredReportDeliverySubscriptions[0];

    if (dashboardPinnedDeliveryAutomationCommand === "retry") {
      return {
        title: "Recover report delivery",
        detail: dashboardLatestFailedDeliveryRun
          ? `Retry the latest failed ${preferredReportWorkspace.navLabel.toLowerCase()} report delivery from Dashboard.`
          : `Pinned recovery command for ${preferredReportWorkspace.navLabel.toLowerCase()} opens failed deliveries and guardrails before the next pack goes out.`,
        href: reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
        cta: dashboardLatestFailedDeliveryRun
          ? t["components.launchRetryDelivery"]
          : "Open recovery",
        badge: "Pinned recovery",
        badgeVariant: "warning",
        command: dashboardPinnedDeliveryAutomationCommand,
        actionType: dashboardLatestFailedDeliveryRun ? "retry" : "link",
        runId: dashboardLatestFailedDeliveryRun?.id,
      };
    }

    if (dashboardPinnedDeliveryAutomationCommand === "review") {
      return {
        title: "Review delivery guardrails",
        detail: primaryDeliverySubscription
          ? `${primaryDeliverySubscription.title} is the pinned review path for recipients, cadence, and approval guardrails.`
          : `Open delivery guardrails for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href:
          primaryDeliverySubscription?.href ??
          reportSectionHref(preferredReportWorkspace, "delivery-subscriptions"),
        cta: "Review guardrails",
        badge: "Pinned review",
        badgeVariant: "info",
        command: dashboardPinnedDeliveryAutomationCommand,
      };
    }

    if (dashboardPinnedDeliveryAutomationCommand === "queue") {
      return {
        title: "Queue next report pack",
        detail: primaryDeliverySubscription
          ? `${primaryDeliverySubscription.title} is pinned as the next automated report pack for this workspace.`
          : `Open pack automation for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href: reportSectionHref(preferredReportWorkspace, "pack-automation"),
        cta: "Queue pack",
        badge: "Pinned queue",
        badgeVariant: "success",
        command: dashboardPinnedDeliveryAutomationCommand,
        actionType: primaryDeliverySubscription ? "queue" : "link",
        subscriptionId: primaryDeliverySubscription?.id,
      };
    }

    return {
      title: "Open comparison pack",
      detail: warningComparison
        ? `${warningComparison.label} movement is pinned for current-vs-prior review.`
        : `Open comparison recommendations for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
      href:
        warningComparison?.href ?? reportSectionHref(preferredReportWorkspace, "recommendations"),
      cta: "Open comparison",
      badge: "Pinned comparison",
      badgeVariant: warningComparison ? "warning" : "info",
      command: dashboardPinnedDeliveryAutomationCommand,
    };
  }, [
    t,
    dashboardComparisonRows,
    dashboardLatestFailedDeliveryRun,
    dashboardPinnedDeliveryAutomationCommand,
    preferredReportDeliverySubscriptions,
    preferredReportWorkspace,
  ]);

  const preferredAutomationNextAction = useMemo<DashboardAutomationAction>(() => {
    if (dashboardPinnedAutomationAction) return dashboardPinnedAutomationAction;

    const warningComparison = dashboardComparisonRows.find(
      (row) => dashboardComparisonBadgeVariant(row) === "warning"
    );

    if (warningComparison) {
      return {
        title: `Review ${warningComparison.label.toLowerCase()} movement`,
        detail: `${warningComparison.label} moved ${formatDashboardComparisonPercent(
          warningComparison.percentChange
        )} vs prior month for ${preferredReportWorkspace.navLabel.toLowerCase()}.`,
        href: warningComparison.href,
        cta: "Open report",
        badge: "Movement",
        badgeVariant: "warning",
      };
    }

    if (
      reportAutomationHealth.reviewSignals > 0 ||
      preferredReportPackReadiness.plannedReports > 0
    ) {
      return {
        title: "Review automation readiness",
        detail: `${reportAutomationHealth.reviewSignals} review signals and ${preferredReportPackReadiness.plannedReports} planned report gaps before scheduled pack delivery.`,
        href: reportSectionHref(preferredReportWorkspace, "automation-rules"),
        cta: "Open rules",
        badge: "Review",
        badgeVariant: "warning",
      };
    }

    const primaryPlaybook = preferredReportWorkspace.automations[0];

    if (primaryPlaybook) {
      return {
        title: primaryPlaybook.title,
        detail: `${ct.cx(primaryPlaybook.trigger)}. ${ct.cx(preferredReportWorkspace.packSchedule.automation)}`,
        href: reportAutomationPlaybookHref(primaryPlaybook, preferredReportWorkspace.persona),
        cta: primaryPlaybook.cta,
        badge: "Ready lane",
        badgeVariant: "success",
      };
    }

    return {
      title: "Open automation center",
      detail: preferredReportWorkspace.packSchedule.automation,
      href: reportSectionHref(preferredReportWorkspace, "automation-command-center"),
      cta: "Open center",
      badge: "Ready",
      badgeVariant: "success",
    };
  }, [
    ct,
    dashboardComparisonRows,
    dashboardPinnedAutomationAction,
    preferredReportPackReadiness.plannedReports,
    preferredReportWorkspace,
    reportAutomationHealth.reviewSignals,
  ]);
  const queueDashboardReportDeliverySubscriptionWithHandoffGuard = (subscriptionId: string) => {
    const handoff = dashboardReportDeliveryHandoffBySubscriptionId[subscriptionId];
    if (handoff?.priorityGap && !acknowledgedDashboardReportDeliveryHandoffGaps[subscriptionId]) {
      const subscription = preferredReportDeliverySubscriptions.find(
        (item) => item.id === subscriptionId
      );
      setAcknowledgedDashboardReportDeliveryHandoffGaps((current) => ({
        ...current,
        [subscriptionId]: true,
      }));
      toast({
        title: t["dashboard.modelHandoffAck"],
        description: formatMessage(t["dashboard.modelHandoffAckBody"], {
          title: ct.cx(subscription?.title ?? t["dashboard.modelThisReportDelivery"]),
          gap: ct.cx(reportWorkflowGapFilterLabels[handoff.priorityGap]).toLowerCase(),
        }),
      });
      return;
    }

    queueDashboardReportDeliverySubscription.mutate({
      subscriptionId,
      acknowledgeHandoffGaps: Boolean(
        acknowledgedDashboardReportDeliveryHandoffGaps[subscriptionId]
      ),
    });
  };
  const preferredAutomationQueueRequiresHandoffAcknowledgement = Boolean(
    preferredAutomationNextAction.actionType === "queue" &&
    preferredAutomationNextAction.subscriptionId &&
    dashboardReportDeliveryHandoffBySubscriptionId[preferredAutomationNextAction.subscriptionId]
      ?.priorityGap &&
    !acknowledgedDashboardReportDeliveryHandoffGaps[preferredAutomationNextAction.subscriptionId]
  );

  const monthLabel =
    stats && stats.period.preset !== "month"
      ? `${stats.period.from} – ${stats.period.to}`
      : new Date().toLocaleDateString(locale, { month: "long", year: "numeric" });
  const profit = stats?.netProfit ?? 0;
  const margin = stats?.margin ?? 0;
  const heroPeriodLabel =
    !stats || stats.period.preset === "month"
      ? ((t as any).netProfitThisMonth ?? "Net Profit · This Month")
      : `${t["dashboard.modelNetProfit"]} · ${
          stats.period.preset === "quarter"
            ? t["dashboard.modelThisQuarter"]
            : stats.period.preset === "ytd"
              ? t["dashboard.modelYearToDate"]
              : t["dashboard.modelCustomPeriod"]
        }`;

  // Render-side localisation of the catalog-derived report models (F14); the English source
  // objects above stay as authored for hrefs, exports and API payloads.
  const localizedReportModels = useMemo(
    () =>
      ct.deep({
        preferredReportWorkspace,
        dashboardReportWorkspaces,
        dashboardRoleWorkdayPath,
        preferredWorkspaceCatalogReports,
        preferredWorkspaceReports,
        preferredReportQuickAccess,
        preferredReportSetupSteps,
        preferredReportSavedViews,
        preferredReportSuites,
        preferredReportPackReadiness,
        preferredReportPackTemplates,
        preferredReportAutomationStarters,
        preferredReportDecisionShortcuts,
        preferredReportComparisonPresets,
        preferredReportTriggerRules,
        preferredReportDeliverySubscriptions,
        dashboardComparisonRows,
        dashboardLatestDeliveryRun,
        dashboardLatestDeliveryRunSubscription,
        dashboardDeliveryRunStatusSummary,
        dashboardReportDeliveryHandoffBySubscriptionId,
        dashboardReportDeliveryLauncherPreviewById,
        preferredReportWorkflowGapLinks,
        preferredReportWorkflowGapLabel,
        dashboardPinnedAutomationAction,
        preferredAutomationNextAction,
        reportAutomationHealth,
        preferredReportAutomationImpact,
      }),
    [
      ct,
      preferredReportWorkspace,
      dashboardReportWorkspaces,
      dashboardRoleWorkdayPath,
      preferredWorkspaceCatalogReports,
      preferredWorkspaceReports,
      preferredReportQuickAccess,
      preferredReportSetupSteps,
      preferredReportSavedViews,
      preferredReportSuites,
      preferredReportPackReadiness,
      preferredReportPackTemplates,
      preferredReportAutomationStarters,
      preferredReportDecisionShortcuts,
      preferredReportComparisonPresets,
      preferredReportTriggerRules,
      preferredReportDeliverySubscriptions,
      dashboardComparisonRows,
      dashboardLatestDeliveryRun,
      dashboardLatestDeliveryRunSubscription,
      dashboardDeliveryRunStatusSummary,
      dashboardReportDeliveryHandoffBySubscriptionId,
      dashboardReportDeliveryLauncherPreviewById,
      preferredReportWorkflowGapLinks,
      preferredReportWorkflowGapLabel,
      dashboardPinnedAutomationAction,
      preferredAutomationNextAction,
      reportAutomationHealth,
      preferredReportAutomationImpact,
    ]
  );

  return {
    t,
    locale,
    toast,
    selectedCompanyId,
    companyName: selectedCompany?.name as string | undefined,
    company: selectedCompany as { trnVatNumber?: string | null } | undefined,
    preferredReportPersona,
    setDashboardReportPersona,
    reportWorkflowPreferenceRevision,
    setReportWorkflowPreferenceRevision,
    showReportWorkspace,
    setShowReportWorkspace,
    toggleReportWorkspace,
    acknowledgedDashboardReportDeliveryHandoffGaps,
    setAcknowledgedDashboardReportDeliveryHandoffGaps,
    preferredReportWorkflowSearch,
    preferredReportWorkflowGapFilter,
    normalizedPreferredReportWorkflowSearch,
    reportCatalogDiscoveryQuery,
    dashboardReportActionContextById,
    reportAutomationPreferencesQuery,
    selectedReportPersonaSummary,
    selectDashboardReportPersona,
    clearDashboardReportWorkflowContext,
    dashboardPinnedDeliveryAutomationCommand,
    periodChoice,
    setPeriodChoice,
    periodQuery,
    stats,
    statsLoading,
    statsError,
    refetchStats,
    recentInvoices,
    invoicesLoading,
    journalEntries,
    expenseData,
    expenseLoading,
    monthlyTrends,
    trendsLoading,
    compliance,
    dashboardReportDeliveryRunsQuery,
    queueDashboardReportDeliverySubscription,
    retryDashboardReportDeliveryRun,
    sparks,
    dashboardPersonaDeliveryRuns,
    dashboardLatestFailedDeliveryRun,
    hasDashboardReportWorkflowContext,
    dashboardReportWorkflowContextHref,
    queueDashboardReportDeliverySubscriptionWithHandoffGuard,
    preferredAutomationQueueRequiresHandoffAcknowledgement,
    monthLabel,
    profit,
    margin,
    heroPeriodLabel,
    ...localizedReportModels,
  };
}

export type DashboardModel = ReturnType<typeof useCustomerDashboardModel>;
