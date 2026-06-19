import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, FileSpreadsheet, Pin, RotateCcw, Search, Send, Sparkles } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
  type ReportCatalogReportActionContext,
} from "@/lib/reportCatalogApi";
import { apiRequest } from "@/lib/queryClient";
import {
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
  getPreferredReportDeliveryAutomationCommand,
  getPreferredReportWorkflowGapFilter,
  getPreferredReportWorkflowSearch,
  parseReportDeliveryAutomationCommand,
  readyReportCatalog,
  reportPersonaHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkspaceHref,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportWorkflowFinderGapHref,
  setPreferredReportWorkflowSearch,
  type ReportAutomationStarter,
  type ReportCatalogItem,
  type ReportComparisonPreset,
  type ReportDeliveryAutomationCommand,
  type ReportDecisionShortcut,
  type ReportDeliverySubscription,
  type ReportPackTemplate,
  type ReportPersona,
  type ReportPersonaWorkspace,
  type ReportSuiteProfile,
  type ReportWorkflowGapFilter,
} from "@/lib/reportCatalog";
import { cn } from "@/lib/utils";

export interface ReportLaunchDeliveryPreview {
  status?: string;
  statusVariant?: BadgeProps["variant"];
  enabled?: boolean;
  nextRunLabel?: string;
  channel?: string;
  format?: string;
  recipients?: string;
  deliveryGuardrail?: string;
  summary?: string;
  suiteTitles?: string[];
  latestRunStatus?: string;
  latestRunStatusVariant?: BadgeProps["variant"];
  latestRunId?: string;
  latestRunLabel?: string;
  latestRunDetail?: string;
  latestRunError?: string | null;
  handoffRows?: Array<{
    label: string;
    value: string;
    detail?: string;
    href?: string;
    status?: "ready" | "review" | "paused";
  }>;
  handoffRequiresAcknowledgement?: boolean;
  handoffAcknowledged?: boolean;
  queueDisabled?: boolean;
}

interface ReportLaunchPickerProps {
  persona?: ReportPersona;
  mode?: "general" | "delivery";
  onQueueDeliverySubscription?: (subscriptionId: string) => void;
  onRetryDeliveryRun?: (runId: string) => void;
  queueingDeliverySubscriptionId?: string | null;
  retryingDeliveryRunId?: string | null;
  deliveryQueueDisabled?: boolean;
  deliveryRetryDisabled?: boolean;
  deliverySubscriptionPreviewById?: Record<string, ReportLaunchDeliveryPreview | undefined>;
  preferredDeliveryAutomationCommand?: ReportDeliveryAutomationCommand | null;
  companyId?: string | null;
  className?: string;
}

type LaunchReport = Omit<ReportCatalogItem, "href"> & { href?: string | null };
type LaunchComparisonPreset = ReportComparisonPreset & { href?: string | null };
type LaunchDecisionShortcut = ReportDecisionShortcut & { href?: string | null };
type LaunchDeliverySubscription = ReportDeliverySubscription & { href?: string | null };
type LaunchPackTemplate = ReportPackTemplate & { href?: string | null };
type LaunchReportSuite = ReportSuiteProfile & { href?: string | null };
type LaunchReportActionLink = { id: string; title: string; href: string };
type ReportLaunchSearchValue = string | number | null | undefined;

interface ReportDeliveryAutomationPreference {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

function reportItemHref(report: LaunchReport, persona: ReportPersona): string {
  return report.href ?? reportPersonaHref(report, persona) ?? "/reports";
}

function starterHref(starter: ReportAutomationStarter & { href?: string | null }): string {
  return starter.href ?? reportAutomationStarterHref(starter);
}

function shortcutHref(shortcut: ReportDecisionShortcut & { href?: string | null }): string {
  return shortcut.href ?? reportDecisionShortcutHref(shortcut);
}

function deliveryHref(subscription: ReportDeliverySubscription & { href?: string | null }): string {
  return subscription.href ?? reportDeliverySubscriptionHref(subscription);
}

function packTemplateHref(template: LaunchPackTemplate): string {
  return template.href ?? reportPackTemplateHref(template);
}

function suiteHref(suite: LaunchReportSuite): string {
  return suite.href ?? reportSuiteHref(suite);
}

function starterActionLink(
  starter: (ReportAutomationStarter & { href?: string | null }) | undefined
): LaunchReportActionLink | undefined {
  return starter ? { id: starter.id, title: starter.title, href: starterHref(starter) } : undefined;
}

function deliveryActionLink(
  subscription: LaunchDeliverySubscription | undefined
): LaunchReportActionLink | undefined {
  return subscription
    ? { id: subscription.id, title: subscription.title, href: deliveryHref(subscription) }
    : undefined;
}

function comparisonActionLink(
  preset: LaunchComparisonPreset | undefined
): LaunchReportActionLink | undefined {
  return preset
    ? { id: preset.id, title: preset.title, href: reportComparisonPresetHref(preset) }
    : undefined;
}

function suiteActionLink(suite: LaunchReportSuite | undefined): LaunchReportActionLink | undefined {
  return suite ? { id: suite.id, title: suite.title, href: suiteHref(suite) } : undefined;
}

function workspaceHref(workspace: ReportPersonaWorkspace & { href?: string | null }): string {
  return workspace.href ?? reportWorkspaceHref(workspace);
}

function reportLaunchSearchHaystack(values: ReportLaunchSearchValue[]): string {
  return values
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();
}

function reportLaunchWorkflowSearchScore(
  values: ReportLaunchSearchValue[],
  normalizedSearch: string
): number {
  if (!normalizedSearch) return 0;
  const haystack = reportLaunchSearchHaystack(values);
  if (!haystack) return 0;
  const terms = normalizedSearch.split(/\s+/).filter(Boolean);
  const phraseScore = haystack.includes(normalizedSearch) ? 100 : 0;
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), phraseScore);
}

function matchesReportLaunchWorkflowSearch(
  values: ReportLaunchSearchValue[],
  normalizedSearch: string
): boolean {
  if (!normalizedSearch) return true;
  const haystack = reportLaunchSearchHaystack(values);
  if (!haystack) return false;
  if (haystack.includes(normalizedSearch)) return true;
  const terms = normalizedSearch.split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}

function rankReportLaunchItems<T>(
  items: T[],
  normalizedSearch: string,
  searchValues: (item: T) => ReportLaunchSearchValue[]
): T[] {
  if (!normalizedSearch) return items;

  return items
    .map((item, index) => ({
      item,
      index,
      searchScore: reportLaunchWorkflowSearchScore(searchValues(item), normalizedSearch),
    }))
    .sort((a, b) => b.searchScore - a.searchScore || a.index - b.index)
    .map(({ item }) => item);
}

function linkedReportSearchValues(reportIds: string[]): ReportLaunchSearchValue[] {
  return [
    reportIds.join(" "),
    reportIds
      .map((reportId) => reportCatalog.find((report) => report.id === reportId)?.name ?? reportId)
      .join(" "),
  ];
}

function reportSearchValues(report: LaunchReport): ReportLaunchSearchValue[] {
  return [
    report.name,
    report.category,
    report.decisionQuestion,
    report.comparison,
    report.automation,
    report.commandKeywords,
  ];
}

function shortcutSearchValues(shortcut: LaunchDecisionShortcut): ReportLaunchSearchValue[] {
  return [
    shortcut.question,
    shortcut.answer,
    shortcut.commandKeywords,
    shortcut.reportIds.join(" "),
  ];
}

function starterSearchValues(
  starter: ReportAutomationStarter & { href?: string | null }
): ReportLaunchSearchValue[] {
  return [
    starter.title,
    starter.audience,
    starter.outcome,
    starter.trigger,
    starter.primaryAction,
    starter.commandKeywords,
    ...linkedReportSearchValues(starter.reportIds),
  ];
}

function deliverySubscriptionSearchValues(
  subscription: LaunchDeliverySubscription
): ReportLaunchSearchValue[] {
  return [
    subscription.title,
    subscription.audience,
    subscription.cadence,
    subscription.channel,
    subscription.recipients,
    subscription.deliveryGuardrail,
    subscription.commandKeywords,
    ...linkedReportSearchValues(subscription.reportIds),
  ];
}

function comparisonPresetSearchValues(preset: LaunchComparisonPreset): ReportLaunchSearchValue[] {
  return [
    preset.title,
    preset.question,
    preset.baseline,
    preset.automationTrigger,
    preset.commandKeywords,
    ...linkedReportSearchValues(preset.reportIds),
  ];
}

function packTemplateSearchValues(template: LaunchPackTemplate): ReportLaunchSearchValue[] {
  return [
    template.title,
    template.audience,
    template.outcome,
    template.cadence,
    template.delivery,
    template.comparisonFocus,
    template.automationTrigger,
    template.commandKeywords,
    ...linkedReportSearchValues(template.reportIds),
  ];
}

function suiteSearchValues(suite: LaunchReportSuite): ReportLaunchSearchValue[] {
  return [
    suite.title,
    suite.outcome,
    suite.workflow,
    suite.primaryAction,
    suite.reportIds.join(" "),
    suite.triggerRuleIds.join(" "),
    suite.deliverySubscriptionId,
    suite.decisionShortcutId,
    suite.savedViewIds.join(" "),
    suite.commandKeywords,
    ...linkedReportSearchValues(suite.reportIds),
  ];
}

const reportLaunchPinnedCommandLabels: Record<ReportDeliveryAutomationCommand, string> = {
  retry: "Retry recovery",
  review: "Review guardrails",
  queue: "Queue next pack",
  comparison: "Open comparison",
};

const reportLaunchPinnedCommandDescriptions: Record<ReportDeliveryAutomationCommand, string> = {
  retry: "Jump back to delivery recovery when a scheduled report pack fails.",
  review: "Open the first delivery subscription that needs guardrail or setup review.",
  queue: "Queue the next scheduled report pack from the launcher.",
  comparison: "Open the persona comparison pack that explains current-vs-prior movement.",
};

export function ReportLaunchPicker({
  persona = "owner",
  mode = "general",
  onQueueDeliverySubscription,
  onRetryDeliveryRun,
  queueingDeliverySubscriptionId = null,
  retryingDeliveryRunId = null,
  deliveryQueueDisabled = false,
  deliveryRetryDisabled = false,
  deliverySubscriptionPreviewById = {},
  preferredDeliveryAutomationCommand,
  companyId = null,
  className,
}: ReportLaunchPickerProps) {
  const [selectedPersona, setSelectedPersona] = useState<ReportPersona>(persona);
  const [query, setQuery] = useState(() => getPreferredReportWorkflowSearch(persona));
  const [storedWorkflowGapFilter, setStoredWorkflowGapFilter] =
    useState<ReportWorkflowGapFilter | null>(() => getPreferredReportWorkflowGapFilter(persona));
  const [storedDeliveryAutomationCommand, setStoredDeliveryAutomationCommand] =
    useState<ReportDeliveryAutomationCommand | null>(() =>
      getPreferredReportDeliveryAutomationCommand(persona)
    );

  useEffect(() => {
    setSelectedPersona(persona);
  }, [persona]);

  useEffect(() => {
    setQuery(getPreferredReportWorkflowSearch(selectedPersona));
    setStoredWorkflowGapFilter(getPreferredReportWorkflowGapFilter(selectedPersona));
    setStoredDeliveryAutomationCommand(
      getPreferredReportDeliveryAutomationCommand(selectedPersona)
    );
  }, [selectedPersona]);

  const updateLauncherQuery = useCallback(
    (value: string) => {
      setQuery(value);
      setPreferredReportWorkflowSearch(value, selectedPersona);
    },
    [selectedPersona]
  );

  const catalogQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(selectedPersona),
    queryFn: () => fetchReportCatalogDiscovery(selectedPersona),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const syncedCatalog = catalogQuery.data;
  const automationPreferencesQuery = useQuery<{
    preferences: ReportDeliveryAutomationPreference[];
  }>({
    queryKey: ["/api/companies", companyId, "report-delivery", "preferences"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/report-delivery/preferences`),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const workspace =
    syncedCatalog?.workspaces[0] ??
    reportPersonaWorkspaces.find((item) => item.persona === selectedPersona) ??
    reportPersonaWorkspaces[0];
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const matchesLauncherQuery = useCallback(
    (values: ReportLaunchSearchValue[]) =>
      matchesReportLaunchWorkflowSearch(values, normalizedQuery),
    [normalizedQuery]
  );
  const reports = useMemo(() => {
    const source =
      syncedCatalog?.reports ??
      readyReportCatalog
        .filter((report) => report.personas.includes(selectedPersona))
        .map((report) => ({ ...report, href: reportPersonaHref(report, selectedPersona) ?? null }));

    return rankReportLaunchItems(
      source
        .filter((report) => report.status !== "planned")
        .filter((report) => matchesLauncherQuery(reportSearchValues(report))),
      normalizedQuery,
      reportSearchValues
    ).slice(0, 5);
  }, [matchesLauncherQuery, normalizedQuery, selectedPersona, syncedCatalog?.reports]);
  const shortcuts: LaunchDecisionShortcut[] =
    syncedCatalog?.decisionShortcuts ??
    reportDecisionShortcuts.filter((shortcut) => shortcut.persona === selectedPersona);
  const starters: Array<ReportAutomationStarter & { href?: string | null }> =
    syncedCatalog?.automationStarters ??
    reportAutomationStarters.filter((starter) => starter.persona === selectedPersona);
  const deliverySubscriptions: LaunchDeliverySubscription[] =
    syncedCatalog?.deliverySubscriptions ??
    reportDeliverySubscriptions.filter((subscription) => subscription.persona === selectedPersona);
  const comparisonPresets: LaunchComparisonPreset[] =
    syncedCatalog?.comparisonPresets ??
    reportComparisonPresets.filter((preset) => preset.persona === selectedPersona);
  const packTemplates: LaunchPackTemplate[] =
    syncedCatalog?.packTemplates ??
    reportPackTemplates.filter((template) => template.persona === selectedPersona);
  const reportSuites: LaunchReportSuite[] =
    syncedCatalog?.reportSuites ??
    reportSuiteProfiles.filter((suite) => suite.persona === selectedPersona);
  const visibleSuites = rankReportLaunchItems(
    reportSuites.filter((suite) => matchesLauncherQuery(suiteSearchValues(suite))),
    normalizedQuery,
    suiteSearchValues
  );
  const visibleShortcuts = rankReportLaunchItems(
    shortcuts.filter((shortcut) => matchesLauncherQuery(shortcutSearchValues(shortcut))),
    normalizedQuery,
    shortcutSearchValues
  );
  const visibleStarters = rankReportLaunchItems(
    starters.filter((starter) => matchesLauncherQuery(starterSearchValues(starter))),
    normalizedQuery,
    starterSearchValues
  );
  const visibleDeliverySubscriptions = rankReportLaunchItems(
    deliverySubscriptions.filter((subscription) =>
      matchesLauncherQuery(deliverySubscriptionSearchValues(subscription))
    ),
    normalizedQuery,
    deliverySubscriptionSearchValues
  );
  const visibleComparisonPresets = rankReportLaunchItems(
    comparisonPresets.filter((preset) =>
      matchesLauncherQuery(comparisonPresetSearchValues(preset))
    ),
    normalizedQuery,
    comparisonPresetSearchValues
  );
  const visiblePackTemplates = rankReportLaunchItems(
    packTemplates.filter((template) => matchesLauncherQuery(packTemplateSearchValues(template))),
    normalizedQuery,
    packTemplateSearchValues
  );
  const reportAutomationContextById = useMemo(() => {
    const context = new Map<
      string,
      {
        syncedContext?: ReportCatalogReportActionContext;
        starter?: LaunchReportActionLink;
        delivery?: LaunchReportActionLink;
        comparison?: LaunchReportActionLink;
        suite?: LaunchReportActionLink;
      }
    >();

    for (const report of reports) {
      const syncedContext = syncedCatalog?.reportActionContexts.find(
        (item) => item.reportId === report.id && item.persona === selectedPersona
      );
      context.set(report.id, {
        syncedContext,
        starter:
          syncedContext?.automationStarters[0] ??
          starterActionLink(starters.find((starter) => starter.reportIds.includes(report.id))),
        delivery:
          syncedContext?.deliverySubscriptions[0] ??
          deliveryActionLink(
            deliverySubscriptions.find((subscription) => subscription.reportIds.includes(report.id))
          ),
        comparison:
          syncedContext?.comparisonPresets[0] ??
          comparisonActionLink(
            comparisonPresets.find((preset) => preset.reportIds.includes(report.id))
          ),
        suite:
          syncedContext?.reportSuites[0] ??
          suiteActionLink(reportSuites.find((suite) => suite.reportIds.includes(report.id))),
      });
    }

    return context;
  }, [
    comparisonPresets,
    deliverySubscriptions,
    reportSuites,
    reports,
    selectedPersona,
    starters,
    syncedCatalog?.reportActionContexts,
  ]);
  const workflowFinderHref = storedWorkflowGapFilter
    ? reportWorkflowFinderGapHref({
        persona: selectedPersona,
        gap: storedWorkflowGapFilter,
        tab: workspace.primaryTab,
        search: trimmedQuery,
      })
    : trimmedQuery
      ? reportWorkflowContextHref({
          persona: selectedPersona,
          tab: workspace.primaryTab,
          search: trimmedQuery,
        })
      : reportSectionHref(workspace, "workflow-finder");
  const matchingAutomationPackHref = visibleSuites[0]
    ? suiteHref(visibleSuites[0])
    : visiblePackTemplates[0]
      ? packTemplateHref(visiblePackTemplates[0])
      : visibleStarters[0]
        ? starterHref(visibleStarters[0])
        : reportSectionHref(workspace, "automation-starters");
  const matchingAutomationPackLabel = visibleSuites[0]
    ? "Open matching suite"
    : visiblePackTemplates[0]
      ? "Open matching pack"
      : visibleStarters[0]
        ? "Open matching automation"
        : "Open automations";
  const hasControlledDeliveryAutomationCommand =
    selectedPersona === persona && preferredDeliveryAutomationCommand !== undefined;
  const syncedDeliveryAutomationCommand = parseReportDeliveryAutomationCommand(
    automationPreferencesQuery.data?.preferences.find(
      (preference) => preference.persona === selectedPersona
    )?.preferredDeliveryAutomationCommand
  );
  const pinnedDeliveryAutomationCommand = hasControlledDeliveryAutomationCommand
    ? preferredDeliveryAutomationCommand
    : (syncedDeliveryAutomationCommand ?? storedDeliveryAutomationCommand);
  const primaryDeliverySubscription = visibleDeliverySubscriptions[0] ?? deliverySubscriptions[0];
  const primaryDeliveryPreview = primaryDeliverySubscription
    ? deliverySubscriptionPreviewById[primaryDeliverySubscription.id]
    : undefined;
  const primaryDeliveryRetryRunId =
    primaryDeliveryPreview?.latestRunStatus === "failed"
      ? (primaryDeliveryPreview.latestRunId ?? null)
      : null;
  const pinnedDeliveryCommandHref = useMemo(() => {
    if (!pinnedDeliveryAutomationCommand) return workspaceHref(workspace);
    if (pinnedDeliveryAutomationCommand === "retry") {
      return reportSectionHref(workspace, "pack-automation");
    }
    if (pinnedDeliveryAutomationCommand === "review") {
      return primaryDeliverySubscription
        ? deliveryHref(primaryDeliverySubscription)
        : reportSectionHref(workspace, "delivery-subscriptions");
    }
    if (pinnedDeliveryAutomationCommand === "comparison") {
      const comparisonPreset = visibleComparisonPresets[0] ?? comparisonPresets[0];
      return comparisonPreset
        ? reportComparisonPresetHref(comparisonPreset)
        : reportSectionHref(workspace, "decision-shortcuts");
    }
    return reportSectionHref(workspace, "delivery-subscriptions");
  }, [
    comparisonPresets,
    pinnedDeliveryAutomationCommand,
    primaryDeliverySubscription,
    visibleComparisonPresets,
    workspace,
  ]);
  const isPinnedQueueCommandDisabled =
    deliveryQueueDisabled ||
    primaryDeliveryPreview?.queueDisabled ||
    primaryDeliveryPreview?.enabled === false ||
    !primaryDeliverySubscription;
  const primaryDeliveryRequiresHandoffAcknowledgement = Boolean(
    primaryDeliveryPreview?.handoffRequiresAcknowledgement &&
    !primaryDeliveryPreview?.handoffAcknowledged
  );
  const isPinnedRetryCommandDisabled = deliveryRetryDisabled || !primaryDeliveryRetryRunId;
  const isDeliveryMode = mode === "delivery";

  return (
    <Card
      className={cn("border-card-border", className)}
      data-testid={isDeliveryMode ? "report-delivery-launch-picker" : "report-launch-picker"}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase font-semibold text-muted-foreground">
              {isDeliveryMode ? "Delivery setup" : "Report launcher"}
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {workspace.navLabel}
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {isDeliveryMode
                ? `Choose the reports, guardrails, and automation starters that should feed scheduled sends for ${workspace.navLabel.toLowerCase()}.`
                : workspace.automationOutcome}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {storedWorkflowGapFilter ? (
              <Badge variant="outline" data-testid="report-launch-gap-context">
                {reportWorkflowGapFilterLabels[storedWorkflowGapFilter]}
              </Badge>
            ) : null}
            {trimmedQuery ? (
              <Badge variant="outline" data-testid="report-launch-search-context">
                <span className="max-w-[12rem] truncate">Search: {trimmedQuery}</span>
              </Badge>
            ) : null}
            <Badge
              variant={catalogQuery.isError ? "warning" : "info"}
              data-testid="report-launch-sync"
            >
              {catalogQuery.isLoading
                ? "Syncing"
                : catalogQuery.isError
                  ? "Local catalog"
                  : `${syncedCatalog?.summary.liveReportCount ?? reports.length} synced reports`}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[168px_minmax(0,1fr)]">
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {reportPersonas.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSelectedPersona(item)}
                className={cn(
                  "w-full rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors",
                  item === selectedPersona
                    ? "border-accent bg-accent/5 text-foreground"
                    : "border-border/70 text-muted-foreground hover:border-accent hover:bg-accent/5"
                )}
                data-testid={`report-launch-persona-${item}`}
              >
                {reportPersonaWorkspaces.find((workspaceItem) => workspaceItem.persona === item)
                  ?.navLabel ?? item}
              </button>
            ))}
          </div>

          <div className="min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateLauncherQuery(event.target.value)}
                placeholder="Search reports, questions, and automations"
                className="pl-9"
                data-testid="report-launch-search"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="report-launch-context-actions">
              <Button asChild size="sm" variant="outline" className="h-8 px-2">
                <Link href={workflowFinderHref} data-testid="report-launch-open-workflow-finder">
                  <Search className="h-3.5 w-3.5" />
                  {storedWorkflowGapFilter ? "Open gap" : "Open finder"}
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 px-2">
                <Link
                  href={matchingAutomationPackHref}
                  data-testid="report-launch-open-matching-pack"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {matchingAutomationPackLabel}
                </Link>
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="overflow-hidden rounded-md border border-border/70">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Reports
                  </div>
                  <Link href={workspaceHref(workspace)}>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-accent">
                      Workspace <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
                <div className="max-h-[30rem] divide-y divide-border/50 overflow-y-auto">
                  {reports.map((report) => {
                    const reportAutomationContext = reportAutomationContextById.get(report.id);
                    return (
                      <div
                        key={report.id}
                        className="grid cursor-pointer gap-3 px-3 py-3 transition-colors hover:bg-accent/5 sm:grid-cols-[minmax(0,1fr)_auto]"
                        data-testid={`report-launch-report-${report.id}`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{report.name}</div>
                          <div className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                            {report.decisionQuestion}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge variant="outline">{report.category}</Badge>
                            {reportAutomationContext?.starter ? (
                              <Badge variant="info">Autopilot</Badge>
                            ) : null}
                            {reportAutomationContext?.delivery ? (
                              <Badge variant="success">Scheduled</Badge>
                            ) : null}
                            {reportAutomationContext?.comparison ? (
                              <Badge variant="neutral">Comparison</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:max-w-[11rem] sm:justify-end">
                          <Button asChild size="sm" variant="outline" className="h-7 px-2">
                            <Link
                              href={
                                reportAutomationContext?.syncedContext?.reportHref ??
                                reportItemHref(report, selectedPersona)
                              }
                            >
                              Open report <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          {reportAutomationContext?.starter ? (
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                              <Link
                                href={reportAutomationContext.starter.href}
                                data-testid={`report-launch-report-automation-${report.id}`}
                              >
                                Autopilot
                              </Link>
                            </Button>
                          ) : null}
                          {reportAutomationContext?.delivery ? (
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                              <Link
                                href={reportAutomationContext.delivery.href}
                                data-testid={`report-launch-report-delivery-${report.id}`}
                              >
                                Delivery
                              </Link>
                            </Button>
                          ) : null}
                          {reportAutomationContext?.comparison ? (
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                              <Link
                                href={reportAutomationContext.comparison.href}
                                data-testid={`report-launch-report-comparison-${report.id}`}
                              >
                                Compare
                              </Link>
                            </Button>
                          ) : null}
                          {reportAutomationContext?.suite ? (
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                              <Link
                                href={reportAutomationContext.suite.href}
                                data-testid={`report-launch-report-suite-${report.id}`}
                              >
                                Suite
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                {pinnedDeliveryAutomationCommand ? (
                  <div
                    className="rounded-md border border-accent/40 bg-accent/5 p-3"
                    data-testid="report-launch-pinned-command"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                        <Pin className="h-3.5 w-3.5" /> Pinned automation
                      </div>
                      <Badge
                        variant="success"
                        data-testid={`report-launch-pinned-command-${pinnedDeliveryAutomationCommand}`}
                      >
                        {reportLaunchPinnedCommandLabels[pinnedDeliveryAutomationCommand]}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {reportLaunchPinnedCommandDescriptions[pinnedDeliveryAutomationCommand]}
                    </div>
                    <div className="mt-3">
                      {pinnedDeliveryAutomationCommand === "queue" &&
                      onQueueDeliverySubscription &&
                      primaryDeliverySubscription ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={isPinnedQueueCommandDisabled}
                          onClick={() =>
                            onQueueDeliverySubscription(primaryDeliverySubscription.id)
                          }
                          data-testid="report-launch-pinned-command-queue"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {queueingDeliverySubscriptionId === primaryDeliverySubscription.id
                            ? "Queueing"
                            : primaryDeliveryRequiresHandoffAcknowledgement
                              ? "Acknowledge handoff"
                              : "Queue pinned pack"}
                        </Button>
                      ) : pinnedDeliveryAutomationCommand === "retry" &&
                        onRetryDeliveryRun &&
                        primaryDeliveryRetryRunId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={isPinnedRetryCommandDisabled}
                          onClick={() => onRetryDeliveryRun(primaryDeliveryRetryRunId)}
                          data-testid="report-launch-pinned-command-retry"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {retryingDeliveryRunId === primaryDeliveryRetryRunId
                            ? "Retrying"
                            : "Retry pinned delivery"}
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline" className="h-7 px-2">
                          <Link
                            href={pinnedDeliveryCommandHref}
                            data-testid="report-launch-pinned-command-open"
                          >
                            Open command <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}

                {isDeliveryMode ? (
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Delivery subscriptions
                    </div>
                    <div className="mt-3 space-y-2">
                      {visibleDeliverySubscriptions.slice(0, 2).map((subscription) => {
                        const deliveryPreview = deliverySubscriptionPreviewById[subscription.id];
                        const subscriptionChannel =
                          deliveryPreview?.channel ?? subscription.channel;
                        const subscriptionFormat = deliveryPreview?.format ?? subscription.format;
                        const subscriptionRecipients =
                          deliveryPreview?.recipients ?? subscription.recipients;
                        const subscriptionGuardrail =
                          deliveryPreview?.deliveryGuardrail ?? subscription.deliveryGuardrail;
                        const isQueueDisabled =
                          deliveryQueueDisabled ||
                          deliveryPreview?.queueDisabled ||
                          deliveryPreview?.enabled === false;
                        const retryLatestDeliveryRunId =
                          deliveryPreview?.latestRunStatus === "failed"
                            ? (deliveryPreview.latestRunId ?? null)
                            : null;
                        const requiresHandoffAcknowledgement = Boolean(
                          deliveryPreview?.handoffRequiresAcknowledgement &&
                          !deliveryPreview?.handoffAcknowledged
                        );

                        return (
                          <div
                            key={subscription.id}
                            className="rounded-md bg-muted/30 p-2 text-xs"
                            data-testid={`report-launch-delivery-subscription-${subscription.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium text-foreground">
                                {subscription.title}
                              </div>
                              {deliveryPreview?.status ? (
                                <Badge
                                  variant={deliveryPreview.statusVariant ?? "neutral"}
                                  dot
                                  className="shrink-0"
                                >
                                  {deliveryPreview.status}
                                </Badge>
                              ) : null}
                            </div>
                            {deliveryPreview?.summary ? (
                              <div className="mt-1 text-muted-foreground">
                                {deliveryPreview.summary}
                              </div>
                            ) : null}
                            <div
                              className="mt-2 space-y-1 text-muted-foreground"
                              data-testid={`report-launch-delivery-preview-${subscription.id}`}
                            >
                              <div>
                                <span className="font-medium text-foreground">Next:</span>{" "}
                                {deliveryPreview?.nextRunLabel || subscription.cadence}
                              </div>
                              <div>
                                <span className="font-medium text-foreground">Channel:</span>{" "}
                                {subscriptionChannel} · {subscriptionFormat}
                              </div>
                              {deliveryPreview?.suiteTitles?.length ? (
                                <div>
                                  <span className="font-medium text-foreground">Suite:</span>{" "}
                                  {deliveryPreview.suiteTitles.join(", ")}
                                </div>
                              ) : null}
                              <div>
                                <span className="font-medium text-foreground">To:</span>{" "}
                                {subscriptionRecipients}
                              </div>
                              <div>
                                <span className="font-medium text-foreground">Guardrail:</span>{" "}
                                {subscriptionGuardrail}
                              </div>
                            </div>
                            {deliveryPreview?.handoffRows?.length ? (
                              <div
                                className="mt-2 space-y-1 rounded-md border border-border/70 bg-background/60 p-2 text-muted-foreground"
                                data-testid={`report-launch-delivery-handoff-${subscription.id}`}
                              >
                                <div className="font-medium text-foreground">
                                  Accountant handoff
                                </div>
                                {deliveryPreview.handoffRows.slice(0, 3).map((row) => (
                                  <div key={row.label}>
                                    <span className="font-medium text-foreground">
                                      {row.label}:
                                    </span>{" "}
                                    {row.value}
                                    {row.detail ? ` - ${row.detail}` : ""}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {deliveryPreview?.latestRunStatus ? (
                              <div
                                className="mt-2 rounded-md border border-border/70 bg-background/60 p-2 text-muted-foreground"
                                data-testid={`report-launch-latest-delivery-run-${subscription.id}`}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant={deliveryPreview.latestRunStatusVariant ?? "info"}
                                    dot
                                  >
                                    {deliveryPreview.latestRunStatus}
                                  </Badge>
                                  {deliveryPreview.latestRunLabel ? (
                                    <span className="font-medium text-foreground">
                                      {deliveryPreview.latestRunLabel}
                                    </span>
                                  ) : null}
                                </div>
                                {deliveryPreview.latestRunDetail ? (
                                  <div className="mt-1">{deliveryPreview.latestRunDetail}</div>
                                ) : null}
                                {deliveryPreview.latestRunError ? (
                                  <div className="mt-1 text-destructive">
                                    {deliveryPreview.latestRunError}
                                  </div>
                                ) : null}
                                {retryLatestDeliveryRunId && onRetryDeliveryRun ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 h-7 px-2"
                                    disabled={deliveryRetryDisabled}
                                    onClick={() => onRetryDeliveryRun(retryLatestDeliveryRunId)}
                                    data-testid={`report-launch-retry-delivery-${subscription.id}`}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {retryingDeliveryRunId === retryLatestDeliveryRunId
                                      ? "Retrying"
                                      : "Retry delivery"}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button asChild size="sm" variant="outline" className="h-7 px-2">
                                <Link href={deliveryHref(subscription)}>
                                  Open <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              {onQueueDeliverySubscription ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  disabled={isQueueDisabled}
                                  onClick={() => onQueueDeliverySubscription(subscription.id)}
                                  data-testid={`report-launch-queue-delivery-${subscription.id}`}
                                >
                                  <Send className="h-3.5 w-3.5" />
                                  {queueingDeliverySubscriptionId === subscription.id
                                    ? "Queueing"
                                    : requiresHandoffAcknowledgement
                                      ? "Acknowledge"
                                      : "Queue"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {visibleDeliverySubscriptions.length === 0 ? (
                        <div className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                          No delivery subscriptions match this role or search yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Report suites
                  </div>
                  <div className="mt-3 space-y-2">
                    {visibleSuites.slice(0, 2).map((suite) => {
                      const deliveryPreview =
                        deliverySubscriptionPreviewById[suite.deliverySubscriptionId];
                      const isQueueDisabled =
                        deliveryQueueDisabled ||
                        deliveryPreview?.queueDisabled ||
                        deliveryPreview?.enabled === false;
                      const requiresHandoffAcknowledgement = Boolean(
                        deliveryPreview?.handoffRequiresAcknowledgement &&
                        !deliveryPreview?.handoffAcknowledged
                      );

                      return (
                        <div
                          key={suite.id}
                          className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5"
                          data-testid={`report-launch-suite-${suite.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-foreground">{suite.title}</div>
                            <Badge variant="outline" className="shrink-0">
                              {suite.reportIds.length} reports
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">{suite.workflow}</div>
                          <div className="mt-1 text-muted-foreground">{suite.outcome}</div>
                          <div className="mt-1 text-muted-foreground">
                            {suite.triggerRuleIds.length} trigger rules · scheduled delivery linked
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline" className="h-7 px-2">
                              <Link href={suiteHref(suite)}>
                                Open <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            {onQueueDeliverySubscription ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                disabled={isQueueDisabled}
                                onClick={() =>
                                  onQueueDeliverySubscription(suite.deliverySubscriptionId)
                                }
                                data-testid={`report-launch-queue-suite-delivery-${suite.id}`}
                              >
                                <Send className="h-3.5 w-3.5" />
                                {queueingDeliverySubscriptionId === suite.deliverySubscriptionId
                                  ? "Queueing"
                                  : requiresHandoffAcknowledgement
                                    ? "Acknowledge"
                                    : "Queue delivery"}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {visibleSuites.length === 0 ? (
                      <div className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                        No report suites match this role or search yet.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Decision shortcuts
                  </div>
                  <div className="mt-3 space-y-2">
                    {visibleShortcuts.slice(0, 2).map((shortcut) => (
                      <Link key={shortcut.id} href={shortcutHref(shortcut)}>
                        <div className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5">
                          <div className="font-medium text-foreground">{shortcut.question}</div>
                          <div className="mt-1 text-muted-foreground">{shortcut.answer}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Comparison packs
                  </div>
                  <div className="mt-3 space-y-2">
                    {visibleComparisonPresets.slice(0, 2).map((preset) => (
                      <Link key={preset.id} href={reportComparisonPresetHref(preset)}>
                        <div
                          className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5"
                          data-testid={`report-launch-comparison-preset-${preset.id}`}
                        >
                          <div className="font-medium text-foreground">{preset.title}</div>
                          <div className="mt-1 text-muted-foreground">{preset.question}</div>
                          <div className="mt-1 text-muted-foreground">
                            {preset.baseline} · {preset.automationTrigger}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Pack templates
                  </div>
                  <div className="mt-3 space-y-2">
                    {visiblePackTemplates.slice(0, 2).map((template) => (
                      <Link key={template.id} href={packTemplateHref(template)}>
                        <div
                          className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5"
                          data-testid={`report-launch-pack-template-${template.id}`}
                        >
                          <div className="font-medium text-foreground">{template.title}</div>
                          <div className="mt-1 text-muted-foreground">{template.outcome}</div>
                          <div className="mt-1 text-muted-foreground">
                            {template.cadence} · {template.delivery}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Automation starters
                  </div>
                  <div className="mt-3 space-y-2">
                    {visibleStarters.slice(0, 2).map((starter) => (
                      <Link key={starter.id} href={starterHref(starter)}>
                        <div className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5">
                          <div className="font-medium text-foreground">{starter.title}</div>
                          <div className="mt-1 text-muted-foreground">{starter.outcome}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
