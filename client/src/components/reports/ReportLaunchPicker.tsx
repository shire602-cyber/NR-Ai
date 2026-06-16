import { useEffect, useMemo, useState } from "react";
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
  getPreferredReportDeliveryAutomationCommand,
  parseReportDeliveryAutomationCommand,
  reportHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportWorkspaceHref,
  type ReportAutomationStarter,
  type ReportCatalogItem,
  type ReportComparisonPreset,
  type ReportDeliveryAutomationCommand,
  type ReportDecisionShortcut,
  type ReportDeliverySubscription,
  type ReportPersona,
  type ReportPersonaWorkspace,
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
  latestRunStatus?: string;
  latestRunStatusVariant?: BadgeProps["variant"];
  latestRunId?: string;
  latestRunLabel?: string;
  latestRunDetail?: string;
  latestRunError?: string | null;
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

interface ReportDeliveryAutomationPreference {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

function reportItemHref(report: LaunchReport): string {
  return report.href ?? reportHref({ href: undefined, tab: report.tab }) ?? "/reports";
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

function workspaceHref(workspace: ReportPersonaWorkspace & { href?: string | null }): string {
  return workspace.href ?? reportWorkspaceHref(workspace);
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
  const [query, setQuery] = useState("");
  const [storedDeliveryAutomationCommand, setStoredDeliveryAutomationCommand] =
    useState<ReportDeliveryAutomationCommand | null>(() =>
      getPreferredReportDeliveryAutomationCommand(persona)
    );

  useEffect(() => {
    setSelectedPersona(persona);
  }, [persona]);

  useEffect(() => {
    setStoredDeliveryAutomationCommand(
      getPreferredReportDeliveryAutomationCommand(selectedPersona)
    );
  }, [selectedPersona]);

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
  const reports = useMemo(() => {
    const source =
      syncedCatalog?.reports ??
      reportCatalog
        .filter((report) => report.personas.includes(selectedPersona))
        .map((report) => ({ ...report, href: reportHref(report) ?? null }));
    const normalizedQuery = query.trim().toLowerCase();

    return source
      .filter((report) => report.status === "live")
      .filter((report) => {
        if (!normalizedQuery) return true;
        return [report.name, report.category, report.decisionQuestion, report.commandKeywords]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [query, selectedPersona, syncedCatalog?.reports]);
  const shortcuts =
    syncedCatalog?.decisionShortcuts ??
    reportDecisionShortcuts.filter((shortcut) => shortcut.persona === selectedPersona);
  const starters =
    syncedCatalog?.automationStarters ??
    reportAutomationStarters.filter((starter) => starter.persona === selectedPersona);
  const deliverySubscriptions =
    syncedCatalog?.deliverySubscriptions ??
    reportDeliverySubscriptions.filter((subscription) => subscription.persona === selectedPersona);
  const comparisonPresets: LaunchComparisonPreset[] =
    syncedCatalog?.comparisonPresets ??
    reportComparisonPresets.filter((preset) => preset.persona === selectedPersona);
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
  const primaryDeliverySubscription = deliverySubscriptions[0];
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
      const comparisonPreset = comparisonPresets[0];
      return comparisonPreset
        ? reportComparisonPresetHref(comparisonPreset)
        : reportSectionHref(workspace, "decision-shortcuts");
    }
    return reportSectionHref(workspace, "delivery-subscriptions");
  }, [comparisonPresets, pinnedDeliveryAutomationCommand, primaryDeliverySubscription, workspace]);
  const isPinnedQueueCommandDisabled =
    deliveryQueueDisabled ||
    primaryDeliveryPreview?.queueDisabled ||
    primaryDeliveryPreview?.enabled === false ||
    !primaryDeliverySubscription;
  const isPinnedRetryCommandDisabled = deliveryRetryDisabled || !primaryDeliveryRetryRunId;
  const isDeliveryMode = mode === "delivery";

  return (
    <Card
      className={cn("border-card-border", className)}
      data-testid={isDeliveryMode ? "report-delivery-launch-picker" : "report-launch-picker"}
    >
      <CardContent className="p-5">
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

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            {reportPersonas.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSelectedPersona(item)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
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
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reports, questions, and automations"
                className="pl-9"
                data-testid="report-launch-search"
              />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-md border border-border/70">
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
                <div className="divide-y divide-border/50">
                  {reports.map((report) => (
                    <Link key={report.id} href={reportItemHref(report)}>
                      <div
                        className="flex cursor-pointer items-start justify-between gap-3 px-3 py-3 transition-colors hover:bg-accent/5"
                        data-testid={`report-launch-report-${report.id}`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{report.name}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {report.decisionQuestion}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {report.category}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
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
                      {deliverySubscriptions.slice(0, 2).map((subscription) => {
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
                              <div>
                                <span className="font-medium text-foreground">To:</span>{" "}
                                {subscriptionRecipients}
                              </div>
                              <div>
                                <span className="font-medium text-foreground">Guardrail:</span>{" "}
                                {subscriptionGuardrail}
                              </div>
                            </div>
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
                                    : "Queue"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {deliverySubscriptions.length === 0 ? (
                        <div className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                          No delivery subscriptions match this role yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Decision shortcuts
                  </div>
                  <div className="mt-3 space-y-2">
                    {shortcuts.slice(0, 2).map((shortcut) => (
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
                    <Sparkles className="h-3.5 w-3.5" /> Automation starters
                  </div>
                  <div className="mt-3 space-y-2">
                    {starters.slice(0, 2).map((starter) => (
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
