import { apiRequest } from "./queryClient";
import type {
  ReportAutomationPlaybook,
  ReportAutomationStarter,
  ReportAutomationTriggerRule,
  ReportCatalogItem,
  ReportComparisonPreset,
  ReportDecisionShortcut,
  ReportDeliverySubscription,
  ReportPackTemplate,
  ReportPersona,
  ReportPersonaWorkspace,
  ReportTab,
} from "./reportCatalog";

export interface ReportCatalogDiscoverySummary {
  reportCount: number;
  liveReportCount: number;
  apiReportCount: number;
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
  automationPlaybookCount: number;
}

export interface ReportPersonaCatalogSummary {
  persona: ReportPersona;
  title: string;
  navLabel: string;
  focus: string;
  automationOutcome: string;
  href: string;
  operationsHref: string;
  automationCommandCenterHref: string;
  reportCount: number;
  liveReportCount: number;
  decisionShortcutCount: number;
  automationStarterCount: number;
  triggerRuleCount: number;
  deliverySubscriptionCount: number;
  packTemplateCount: number;
  comparisonPresetCount: number;
  automationPlaybookCount: number;
}

export interface ReportCatalogDiscovery {
  filters: {
    persona: ReportPersona | null;
  };
  summary: ReportCatalogDiscoverySummary;
  personaSummaries: ReportPersonaCatalogSummary[];
  personas: ReportPersona[];
  tabs: ReportTab[];
  reports: Array<Omit<ReportCatalogItem, "href"> & { href: string | null }>;
  workspaces: Array<
    ReportPersonaWorkspace & {
      href: string;
      operationsHref: string;
      decisionShortcutsHref: string;
      recommendationsHref: string;
      automationStartersHref: string;
      triggerRulesHref: string;
      deliverySubscriptionsHref: string;
      packReadinessHref: string;
      automationRulesHref: string;
      automationCommandCenterHref: string;
      packAutomationHref: string;
      automations: Array<ReportAutomationPlaybook & { href: string }>;
    }
  >;
  decisionShortcuts: Array<ReportDecisionShortcut & { href: string }>;
  automationStarters: Array<ReportAutomationStarter & { href: string }>;
  triggerRules: Array<ReportAutomationTriggerRule & { href: string }>;
  deliverySubscriptions: Array<ReportDeliverySubscription & { href: string }>;
  packTemplates: Array<ReportPackTemplate & { href: string }>;
  comparisonPresets: Array<ReportComparisonPreset & { href: string }>;
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
