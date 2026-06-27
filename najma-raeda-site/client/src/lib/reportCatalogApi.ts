import { apiRequest } from "./queryClient";
import type {
  ReportAutomationImpactProfile,
  ReportAutomationPlaybook,
  ReportAutomationRunbookStep,
  ReportAutomationStarter,
  ReportAutomationTriggerRule,
  ReportCatalogItem,
  ReportComparisonPreset,
  ReportDecisionShortcut,
  ReportDeliverySubscription,
  ReportManagementBriefProfile,
  ReportPackTemplate,
  ReportPersona,
  ReportPersonaWorkspace,
  ReportProductDepthArea,
  ReportProductDepthSubgoal,
  ReportQuickAccessProfile,
  ReportRoleWorkflowStep,
  ReportSavedViewProfile,
  ReportSuiteProfile,
  ReportTab,
  ReportWorkspaceSetupStep,
} from "./reportCatalog";

export interface ReportCatalogDiscoverySummary {
  reportCount: number;
  liveReportCount: number;
  apiReportCount: number;
  readyReportCount: number;
  plannedReportCount: number;
  personaCount: number;
  workspaceCount: number;
  reportTabCount: number;
  decisionShortcutCount: number;
  automationStarterCount: number;
  triggerRuleCount: number;
  deliverySubscriptionCount: number;
  packTemplateCount: number;
  comparisonPresetCount: number;
  reportSuiteCount: number;
  managementBriefCount: number;
  quickAccessProfileCount: number;
  savedViewCount: number;
  automationImpactProfileCount: number;
  productDepthAreaCount: number;
  productDepthSubgoalCount: number;
  workflowStepCount: number;
  automationRunbookStepCount: number;
  automationPlaybookCount: number;
}

export interface ReportPersonaCatalogSummary {
  persona: ReportPersona;
  title: string;
  navLabel: string;
  focus: string;
  automationOutcome: string;
  href: string;
  roleSetupHref: string;
  roleWorkflowsHref: string;
  operationsHref: string;
  automationCommandCenterHref: string;
  reportCount: number;
  liveReportCount: number;
  apiReportCount: number;
  readyReportCount: number;
  plannedReportCount: number;
  decisionShortcutCount: number;
  automationStarterCount: number;
  triggerRuleCount: number;
  deliverySubscriptionCount: number;
  packTemplateCount: number;
  comparisonPresetCount: number;
  reportSuiteCount: number;
  managementBriefCount: number;
  quickAccessProfileCount: number;
  savedViewCount: number;
  automationImpactProfileCount: number;
  productDepthSubgoalCount: number;
  setupStepCount: number;
  workflowStepCount: number;
  automationRunbookStepCount: number;
  automationPlaybookCount: number;
}

export interface ReportCatalogActionLink {
  id: string;
  title: string;
  href: string;
}

export interface ReportCatalogReportActionContext {
  reportId: string;
  persona: ReportPersona;
  reportHref: string | null;
  workspaceHref: string;
  workflowHref: string;
  quickAccessHref: string | null;
  automationImpactHref: string | null;
  automationStarters: ReportCatalogActionLink[];
  deliverySubscriptions: ReportCatalogActionLink[];
  comparisonPresets: ReportCatalogActionLink[];
  reportSuites: ReportCatalogActionLink[];
  packTemplates: ReportCatalogActionLink[];
  decisionShortcuts: ReportCatalogActionLink[];
  triggerRules: ReportCatalogActionLink[];
  savedViews: ReportCatalogActionLink[];
}

export interface ReportCatalogDiscovery {
  filters: {
    persona: ReportPersona | null;
  };
  summary: ReportCatalogDiscoverySummary;
  personaSummaries: ReportPersonaCatalogSummary[];
  personas: ReportPersona[];
  tabs: ReportTab[];
  reportActionContexts: ReportCatalogReportActionContext[];
  reports: Array<Omit<ReportCatalogItem, "href"> & { href: string | null }>;
  workspaces: Array<
    ReportPersonaWorkspace & {
      href: string;
      roleSetupHref: string;
      roleWorkflowsHref: string;
      managementBriefsHref: string;
      reportSuitesHref: string;
      quickAccessHref: string;
      savedViewsHref: string;
      operationsHref: string;
      automationImpactHref: string;
      decisionShortcutsHref: string;
      recommendationsHref: string;
      automationStartersHref: string;
      triggerRulesHref: string;
      deliverySubscriptionsHref: string;
      packReadinessHref: string;
      automationRulesHref: string;
      automationCommandCenterHref: string;
      packAutomationHref: string;
      setupChecklist: Array<ReportWorkspaceSetupStep & { href: string }>;
      workflowSteps: Array<
        ReportRoleWorkflowStep & {
          href: string;
          sectionHref: string;
          defaultViewHref: string;
          defaultViewLabel: string;
          handoffRecipients: string;
          handoffGuardrail: string;
        }
      >;
      automations: Array<
        ReportAutomationPlaybook & { href: string; runbookSteps: ReportAutomationRunbookStep[] }
      >;
    }
  >;
  decisionShortcuts: Array<ReportDecisionShortcut & { href: string }>;
  automationStarters: Array<ReportAutomationStarter & { href: string }>;
  triggerRules: Array<ReportAutomationTriggerRule & { href: string }>;
  deliverySubscriptions: Array<ReportDeliverySubscription & { href: string }>;
  packTemplates: Array<ReportPackTemplate & { href: string }>;
  comparisonPresets: Array<ReportComparisonPreset & { href: string }>;
  reportSuites: Array<ReportSuiteProfile & { href: string }>;
  managementBriefs: Array<ReportManagementBriefProfile & { href: string }>;
  quickAccessProfiles: Array<ReportQuickAccessProfile & { href: string }>;
  savedViews: Array<ReportSavedViewProfile & { href: string }>;
  automationImpactProfiles: Array<ReportAutomationImpactProfile & { href: string }>;
  productDepthAreas: Array<
    Omit<ReportProductDepthArea, "subgoals"> & {
      href: string;
      subgoals: Array<ReportProductDepthSubgoal & { href: string }>;
    }
  >;
}

export function reportCatalogDiscoveryQueryKey(persona?: ReportPersona | null) {
  return ["/api/reports/catalog", persona ?? "all"] as const;
}

export function reportCatalogDiscoveryPath(persona?: ReportPersona | null): string {
  if (!persona) return "/api/reports/catalog";
  const params = new URLSearchParams({ persona });
  return `/api/reports/catalog?${params.toString()}`;
}

export function fetchReportCatalogDiscovery(
  persona?: ReportPersona | null
): Promise<ReportCatalogDiscovery> {
  return apiRequest("GET", reportCatalogDiscoveryPath(persona));
}
