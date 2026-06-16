import {
  reportAutomationPlaybookHref,
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
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonas,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportTabs,
  reportWorkspaceHref,
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

    return {
      persona: workspace.persona,
      title: workspace.title,
      navLabel: workspace.navLabel,
      focus: workspace.focus,
      automationOutcome: workspace.automationOutcome,
      href: reportWorkspaceHref(workspace),
      operationsHref: reportSectionHref(workspace, "automation-operations"),
      automationCommandCenterHref: reportSectionHref(workspace, "automation-command-center"),
      reportCount: personaReports.length,
      liveReportCount: personaReports.filter((report) => report.status === "live").length,
      decisionShortcutCount: personaDecisionShortcuts.length,
      automationStarterCount: personaAutomationStarters.length,
      triggerRuleCount: personaTriggerRules.length,
      deliverySubscriptionCount: personaDeliverySubscriptions.length,
      packTemplateCount: personaPackTemplates.length,
      comparisonPresetCount: personaComparisonPresets.length,
      automationPlaybookCount: workspace.automations.length,
    };
  });

  return {
    filters: { persona },
    summary: {
      reportCount: reports.length,
      liveReportCount: reports.filter((report) => report.status === "live").length,
      apiReportCount: reports.filter((report) => report.status === "api").length,
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
      automationPlaybookCount: workspaces.reduce(
        (total, workspace) => total + workspace.automations.length,
        0
      ),
    },
    personaSummaries,
    personas: reportPersonas,
    tabs: reportTabs,
    reports: reports.map((report) => ({
      ...report,
      href: reportHref(report) ?? null,
    })),
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      href: reportWorkspaceHref(workspace),
      operationsHref: reportSectionHref(workspace, "automation-operations"),
      decisionShortcutsHref: reportSectionHref(workspace, "decision-shortcuts"),
      recommendationsHref: reportSectionHref(workspace, "recommendations"),
      automationStartersHref: reportSectionHref(workspace, "automation-starters"),
      triggerRulesHref: reportSectionHref(workspace, "trigger-rules"),
      deliverySubscriptionsHref: reportSectionHref(workspace, "delivery-subscriptions"),
      packReadinessHref: reportSectionHref(workspace, "pack-readiness"),
      automationRulesHref: reportSectionHref(workspace, "automation-rules"),
      automationCommandCenterHref: reportSectionHref(workspace, "automation-command-center"),
      packAutomationHref: reportSectionHref(workspace, "pack-automation"),
      automations: workspace.automations.map((playbook) => ({
        ...playbook,
        href: reportAutomationPlaybookHref(playbook, workspace.persona),
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
  };
}
