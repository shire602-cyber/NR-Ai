import {
  buildReportAutomationRunbookSteps,
  reportAutomationPlaybookHref,
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
  reportHref,
  reportManagementBriefHref,
  reportManagementBriefProfiles,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportProductDepthAreaHref,
  reportProductDepthAreas,
  reportProductDepthSubgoalHref,
  reportQuickAccessProfiles,
  reportRoleWorkflowStepHref,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportTabs,
  reportWorkspaceHref,
  reportWorkflowContextHref,
  type ReportPersona,
} from "../../client/src/lib/reportCatalog";

export interface ReportCatalogDiscoveryOptions {
  persona?: ReportPersona | null;
}

export function isReportCatalogPersona(value: unknown): value is ReportPersona {
  return typeof value === "string" && reportPersonas.includes(value as ReportPersona);
}

export function buildReportCatalogDiscovery(options: ReportCatalogDiscoveryOptions = {}) {
  const persona = options.persona ?? null;
  const reports = reportCatalog.filter((report) => !persona || report.personas.includes(persona));
  const workspaces = reportPersonaWorkspaces.filter(
    (workspace) => !persona || workspace.persona === persona
  );
  const decisionShortcuts = reportDecisionShortcuts.filter(
    (shortcut) => !persona || shortcut.persona === persona
  );
  const automationStarters = reportAutomationStarters.filter(
    (starter) => !persona || starter.persona === persona
  );
  const triggerRules = reportAutomationTriggerRules.filter(
    (rule) => !persona || rule.persona === persona
  );
  const deliverySubscriptions = reportDeliverySubscriptions.filter(
    (subscription) => !persona || subscription.persona === persona
  );
  const packTemplates = reportPackTemplates.filter(
    (template) => !persona || template.persona === persona
  );
  const comparisonPresets = reportComparisonPresets.filter(
    (preset) => !persona || preset.persona === persona
  );
  const reportSuites = reportSuiteProfiles.filter((suite) => !persona || suite.persona === persona);
  const managementBriefs = reportManagementBriefProfiles.filter(
    (brief) => !persona || brief.persona === persona
  );
  const quickAccessProfiles = reportQuickAccessProfiles.filter(
    (profile) => !persona || profile.persona === persona
  );
  const savedViews = reportSavedViewProfiles.filter((view) => !persona || view.persona === persona);
  const automationImpactProfiles = reportAutomationImpactProfiles.filter(
    (profile) => !persona || profile.persona === persona
  );
  const productDepthAreas = reportProductDepthAreas
    .map((area) => ({
      ...area,
      subgoals: area.subgoals
        .filter((subgoal) => !persona || subgoal.personas.includes(persona))
        .map((subgoal) =>
          persona
            ? {
                ...subgoal,
                personas: [persona],
                sourceDrilldownTargets: subgoal.sourceDrilldownTargets?.filter((target) =>
                  target.personas.includes(persona)
                ),
              }
            : subgoal
        ),
    }))
    .filter((area) => area.subgoals.length > 0);
  const reportActionContexts = reports.flatMap((report) =>
    report.personas
      .filter((reportPersona) => !persona || reportPersona === persona)
      .map((reportPersona) => {
        const workspace = reportPersonaWorkspaces.find((item) => item.persona === reportPersona);
        const reportHrefValue = reportPersonaHref(report, reportPersona) ?? null;
        const workspaceHref = workspace ? reportWorkspaceHref(workspace) : "/reports";
        const quickAccessProfile = reportQuickAccessProfiles.find(
          (profile) => profile.persona === reportPersona && profile.reportIds.includes(report.id)
        );
        const automationImpactProfile = reportAutomationImpactProfiles.find(
          (profile) => profile.persona === reportPersona && profile.reportIds.includes(report.id)
        );

        return {
          reportId: report.id,
          persona: reportPersona,
          reportHref: reportHrefValue,
          workspaceHref,
          workflowHref: reportWorkflowContextHref({
            persona: reportPersona,
            tab: report.tab ?? workspace?.primaryTab,
            search: report.name,
          }),
          quickAccessHref:
            quickAccessProfile && workspace ? reportSectionHref(workspace, "quick-access") : null,
          automationImpactHref:
            automationImpactProfile && workspace
              ? reportSectionHref(workspace, "automation-impact")
              : null,
          automationStarters: reportAutomationStarters
            .filter(
              (starter) =>
                starter.persona === reportPersona && starter.reportIds.includes(report.id)
            )
            .map((starter) => ({
              id: starter.id,
              title: starter.title,
              href: reportAutomationStarterHref(starter),
            })),
          deliverySubscriptions: reportDeliverySubscriptions
            .filter(
              (subscription) =>
                subscription.persona === reportPersona && subscription.reportIds.includes(report.id)
            )
            .map((subscription) => ({
              id: subscription.id,
              title: subscription.title,
              href: reportDeliverySubscriptionHref(subscription),
            })),
          comparisonPresets: reportComparisonPresets
            .filter(
              (preset) => preset.persona === reportPersona && preset.reportIds.includes(report.id)
            )
            .map((preset) => ({
              id: preset.id,
              title: preset.title,
              href: reportComparisonPresetHref(preset),
            })),
          reportSuites: reportSuiteProfiles
            .filter(
              (suite) => suite.persona === reportPersona && suite.reportIds.includes(report.id)
            )
            .map((suite) => ({
              id: suite.id,
              title: suite.title,
              href: reportSuiteHref(suite),
            })),
          packTemplates: reportPackTemplates
            .filter(
              (template) =>
                template.persona === reportPersona && template.reportIds.includes(report.id)
            )
            .map((template) => ({
              id: template.id,
              title: template.title,
              href: reportPackTemplateHref(template),
            })),
          decisionShortcuts: reportDecisionShortcuts
            .filter(
              (shortcut) =>
                shortcut.persona === reportPersona && shortcut.reportIds.includes(report.id)
            )
            .map((shortcut) => ({
              id: shortcut.id,
              title: shortcut.question,
              href: reportDecisionShortcutHref(shortcut),
            })),
          triggerRules: reportAutomationTriggerRules
            .filter((rule) => rule.persona === reportPersona && rule.reportIds.includes(report.id))
            .map((rule) => ({
              id: rule.id,
              title: rule.title,
              href: reportAutomationTriggerRuleHref(rule),
            })),
          savedViews: reportSavedViewProfiles
            .filter((view) => view.persona === reportPersona && view.reportId === report.id)
            .map((view) => ({
              id: view.id,
              title: view.title,
              href: reportSavedViewHref(view),
            })),
        };
      })
  );
  const personaSummaries = workspaces.map((workspace) => {
    const personaReports = reportCatalog.filter((report) =>
      report.personas.includes(workspace.persona)
    );
    const personaDecisionShortcuts = reportDecisionShortcuts.filter(
      (shortcut) => shortcut.persona === workspace.persona
    );
    const personaAutomationStarters = reportAutomationStarters.filter(
      (starter) => starter.persona === workspace.persona
    );
    const personaTriggerRules = reportAutomationTriggerRules.filter(
      (rule) => rule.persona === workspace.persona
    );
    const personaDeliverySubscriptions = reportDeliverySubscriptions.filter(
      (subscription) => subscription.persona === workspace.persona
    );
    const personaPackTemplates = reportPackTemplates.filter(
      (template) => template.persona === workspace.persona
    );
    const personaComparisonPresets = reportComparisonPresets.filter(
      (preset) => preset.persona === workspace.persona
    );
    const personaReportSuites = reportSuiteProfiles.filter(
      (suite) => suite.persona === workspace.persona
    );
    const personaManagementBriefs = reportManagementBriefProfiles.filter(
      (brief) => brief.persona === workspace.persona
    );
    const personaQuickAccessProfiles = reportQuickAccessProfiles.filter(
      (profile) => profile.persona === workspace.persona
    );
    const personaSavedViews = reportSavedViewProfiles.filter(
      (view) => view.persona === workspace.persona
    );
    const personaAutomationImpactProfiles = reportAutomationImpactProfiles.filter(
      (profile) => profile.persona === workspace.persona
    );
    const personaProductDepthSubgoalCount = reportProductDepthAreas.reduce(
      (total, area) =>
        total +
        area.subgoals.filter((subgoal) => subgoal.personas.includes(workspace.persona)).length,
      0
    );

    return {
      persona: workspace.persona,
      title: workspace.title,
      navLabel: workspace.navLabel,
      focus: workspace.focus,
      automationOutcome: workspace.automationOutcome,
      href: reportWorkspaceHref(workspace),
      roleSetupHref: reportSectionHref(workspace, "role-setup"),
      roleWorkflowsHref: reportSectionHref(workspace, "role-workflows"),
      managementBriefsHref: reportSectionHref(workspace, "management-briefs"),
      operationsHref: reportSectionHref(workspace, "automation-operations"),
      automationCommandCenterHref: reportSectionHref(workspace, "automation-command-center"),
      reportCount: personaReports.length,
      liveReportCount: personaReports.filter((report) => report.status === "live").length,
      apiReportCount: personaReports.filter((report) => report.status === "api").length,
      readyReportCount: personaReports.filter((report) => report.status !== "planned").length,
      plannedReportCount: personaReports.filter((report) => report.status === "planned").length,
      decisionShortcutCount: personaDecisionShortcuts.length,
      automationStarterCount: personaAutomationStarters.length,
      triggerRuleCount: personaTriggerRules.length,
      deliverySubscriptionCount: personaDeliverySubscriptions.length,
      packTemplateCount: personaPackTemplates.length,
      comparisonPresetCount: personaComparisonPresets.length,
      reportSuiteCount: personaReportSuites.length,
      managementBriefCount: personaManagementBriefs.length,
      quickAccessProfileCount: personaQuickAccessProfiles.length,
      savedViewCount: personaSavedViews.length,
      automationImpactProfileCount: personaAutomationImpactProfiles.length,
      productDepthSubgoalCount: personaProductDepthSubgoalCount,
      setupStepCount: workspace.setupChecklist.length,
      workflowStepCount: workspace.workflowSteps.length,
      automationRunbookStepCount: workspace.automations.reduce(
        (total, playbook) => total + buildReportAutomationRunbookSteps(workspace, playbook).length,
        0
      ),
      automationPlaybookCount: workspace.automations.length,
    };
  });

  return {
    filters: { persona },
    summary: {
      reportCount: reports.length,
      liveReportCount: reports.filter((report) => report.status === "live").length,
      apiReportCount: reports.filter((report) => report.status === "api").length,
      readyReportCount: reports.filter((report) => report.status !== "planned").length,
      plannedReportCount: reports.filter((report) => report.status === "planned").length,
      personaCount: reportPersonas.length,
      workspaceCount: workspaces.length,
      reportTabCount: reportTabs.length,
      decisionShortcutCount: decisionShortcuts.length,
      automationStarterCount: automationStarters.length,
      triggerRuleCount: triggerRules.length,
      deliverySubscriptionCount: deliverySubscriptions.length,
      packTemplateCount: packTemplates.length,
      comparisonPresetCount: comparisonPresets.length,
      reportSuiteCount: reportSuites.length,
      managementBriefCount: managementBriefs.length,
      quickAccessProfileCount: quickAccessProfiles.length,
      savedViewCount: savedViews.length,
      automationImpactProfileCount: automationImpactProfiles.length,
      productDepthAreaCount: productDepthAreas.length,
      productDepthSubgoalCount: productDepthAreas.reduce(
        (total, area) => total + area.subgoals.length,
        0
      ),
      workflowStepCount: workspaces.reduce(
        (total, workspace) => total + workspace.workflowSteps.length,
        0
      ),
      automationRunbookStepCount: workspaces.reduce(
        (total, workspace) =>
          total +
          workspace.automations.reduce(
            (workspaceTotal, playbook) =>
              workspaceTotal + buildReportAutomationRunbookSteps(workspace, playbook).length,
            0
          ),
        0
      ),
      automationPlaybookCount: workspaces.reduce(
        (total, workspace) => total + workspace.automations.length,
        0
      ),
    },
    personaSummaries,
    personas: reportPersonas,
    tabs: reportTabs,
    reportActionContexts,
    reports: reports.map((report) => ({
      ...report,
      href: (persona ? reportPersonaHref(report, persona) : reportHref(report)) ?? null,
    })),
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      href: reportWorkspaceHref(workspace),
      roleSetupHref: reportSectionHref(workspace, "role-setup"),
      roleWorkflowsHref: reportSectionHref(workspace, "role-workflows"),
      managementBriefsHref: reportSectionHref(workspace, "management-briefs"),
      reportSuitesHref: reportSectionHref(workspace, "report-suites"),
      quickAccessHref: reportSectionHref(workspace, "quick-access"),
      savedViewsHref: reportSectionHref(workspace, "saved-views"),
      operationsHref: reportSectionHref(workspace, "automation-operations"),
      automationImpactHref: reportSectionHref(workspace, "automation-impact"),
      decisionShortcutsHref: reportSectionHref(workspace, "decision-shortcuts"),
      recommendationsHref: reportSectionHref(workspace, "recommendations"),
      automationStartersHref: reportSectionHref(workspace, "automation-starters"),
      triggerRulesHref: reportSectionHref(workspace, "trigger-rules"),
      deliverySubscriptionsHref: reportSectionHref(workspace, "delivery-subscriptions"),
      packReadinessHref: reportSectionHref(workspace, "pack-readiness"),
      automationRulesHref: reportSectionHref(workspace, "automation-rules"),
      automationCommandCenterHref: reportSectionHref(workspace, "automation-command-center"),
      packAutomationHref: reportSectionHref(workspace, "pack-automation"),
      setupChecklist: workspace.setupChecklist.map((step) => ({
        ...step,
        href: reportSectionHref(workspace, step.section),
      })),
      workflowSteps: workspace.workflowSteps.map((step) => {
        const savedView = reportSavedViewProfiles.find((view) => view.id === step.savedViewId);
        const deliverySubscription = reportDeliverySubscriptions.find(
          (subscription) => subscription.id === step.deliverySubscriptionId
        );

        return {
          ...step,
          href: reportRoleWorkflowStepHref(workspace, step),
          sectionHref: reportSectionHref(workspace, step.section),
          defaultViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          defaultViewLabel: savedView?.title ?? "Role saved view",
          handoffRecipients: deliverySubscription?.recipients ?? workspace.packSchedule.recipients,
          handoffGuardrail:
            deliverySubscription?.deliveryGuardrail ?? workspace.packSchedule.automation,
        };
      }),
      automations: workspace.automations.map((playbook) => ({
        ...playbook,
        href: reportAutomationPlaybookHref(playbook, workspace.persona),
        runbookSteps: buildReportAutomationRunbookSteps(workspace, playbook),
      })),
    })),
    decisionShortcuts: decisionShortcuts.map((shortcut) => ({
      ...shortcut,
      href: reportDecisionShortcutHref(shortcut),
    })),
    automationStarters: automationStarters.map((starter) => ({
      ...starter,
      href: reportAutomationStarterHref(starter),
    })),
    triggerRules: triggerRules.map((rule) => ({
      ...rule,
      href: reportAutomationTriggerRuleHref(rule),
    })),
    deliverySubscriptions: deliverySubscriptions.map((subscription) => ({
      ...subscription,
      href: reportDeliverySubscriptionHref(subscription),
    })),
    packTemplates: packTemplates.map((template) => ({
      ...template,
      href: reportPackTemplateHref(template),
    })),
    comparisonPresets: comparisonPresets.map((preset) => ({
      ...preset,
      href: reportComparisonPresetHref(preset),
    })),
    reportSuites: reportSuites.map((suite) => ({
      ...suite,
      href: reportSuiteHref(suite),
    })),
    managementBriefs: managementBriefs.map((brief) => ({
      ...brief,
      href: reportManagementBriefHref(brief),
    })),
    quickAccessProfiles: quickAccessProfiles.map((profile) => {
      const workspace = reportPersonaWorkspaces.find((item) => item.persona === profile.persona);
      return {
        ...profile,
        href: workspace ? reportSectionHref(workspace, "quick-access") : "/reports",
      };
    }),
    savedViews: savedViews.map((view) => ({
      ...view,
      href: reportSavedViewHref(view),
    })),
    automationImpactProfiles: automationImpactProfiles.map((profile) => {
      const workspace = reportPersonaWorkspaces.find((item) => item.persona === profile.persona);
      return {
        ...profile,
        href: workspace ? reportSectionHref(workspace, "automation-impact") : "/reports",
      };
    }),
    productDepthAreas: productDepthAreas.map((area) => ({
      ...area,
      href: reportProductDepthAreaHref(area),
      subgoals: area.subgoals.map((subgoal) => ({
        ...subgoal,
        href: reportProductDepthSubgoalHref(area, subgoal),
      })),
    })),
  };
}
