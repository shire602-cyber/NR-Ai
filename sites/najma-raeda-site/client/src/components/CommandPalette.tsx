import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Home,
  FileText,
  Receipt,
  BookMarked,
  Users,
  BarChart3,
  Wallet,
  CreditCard,
  Briefcase,
  ShoppingBag,
  Building2,
  FileSpreadsheet,
  Settings,
  Plus,
  Sparkles,
  ClipboardCheck,
} from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/commandPalette";
import { apiRequest } from "@/lib/queryClient";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  readyReportCatalog,
  reportAutomationImpactProfiles,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportAutomationPlaybookHref,
  getPreferredReportPersona,
  getPreferredReportWorkflowSearch,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
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
  reportWorkspaceHref,
  type ReportCommandIcon,
  type ReportPersona,
  type ReportWorkflowGapFilter,
  type ReportWorkspaceIcon,
} from "@/lib/reportCatalog";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  group: "Navigate" | "Reports" | "Create" | "Settings";
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  action?: () => void | Promise<void>;
  shortcut?: string;
  keywords?: string;
}

interface CommandPaletteReportDeliveryRun {
  id: string;
  subscriptionId: string;
  status: string;
  scheduledFor: string;
  createdAt: string;
  errorMessage: string | null;
}

interface CommandPaletteReportDeliveryPlan {
  id: string;
  persona: ReportPersona;
  title: string;
  enabled: boolean;
  status: "ready" | "setup" | "paused";
  reportCount: number;
  readyReportCount: number;
  preview?: {
    readinessLabel?: string;
    checklist?: Array<{
      label: string;
      status: "ready" | "review" | "paused";
      detail: string;
    }>;
  };
}

interface CommandPaletteReportActionContext {
  reportHref?: string | null;
  workflowHref: string;
  starter?: {
    title?: string;
    href?: string;
    outcome?: string;
    commandKeywords?: string;
  };
  delivery?: {
    title?: string;
    href?: string;
    deliveryGuardrail?: string;
    commandKeywords?: string;
  };
  comparison?: {
    title?: string;
    href?: string;
    question?: string;
    commandKeywords?: string;
  };
  suite?: {
    title?: string;
    href?: string;
    workflow?: string;
    commandKeywords?: string;
  };
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const reportCommandIcons: Record<ReportCommandIcon, PaletteItem["icon"]> = {
  barChart: BarChart3,
  book: BookMarked,
  creditCard: CreditCard,
  fileSpreadsheet: FileSpreadsheet,
  fileText: FileText,
  receipt: Receipt,
  users: Users,
  wallet: Wallet,
};

const reportWorkspaceIcons: Record<ReportWorkspaceIcon, PaletteItem["icon"]> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

function syncedHref(item: unknown): string | undefined {
  if (!item || typeof item !== "object" || !("href" in item)) return undefined;
  const href = (item as { href?: unknown }).href;
  return typeof href === "string" && href ? href : undefined;
}

function reportWorkflowSearchScore(item: PaletteItem, normalizedSearch: string): number {
  if (item.group !== "Reports" || !normalizedSearch) return 0;

  const label = item.label.toLowerCase();
  const description = item.description?.toLowerCase() ?? "";
  const haystack = `${label} ${description} ${item.keywords ?? ""}`.toLowerCase();
  let score = haystack.includes(normalizedSearch) ? 100 : 0;

  for (const term of normalizedSearch.split(/\s+/).filter(Boolean)) {
    if (label.includes(term)) score += 20;
    if (description.includes(term)) score += 10;
    if (haystack.includes(term)) score += 5;
  }

  return score;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { toast } = useToast();
  const [queueingDeliverySubscriptionId, setQueueingDeliverySubscriptionId] = useState<
    string | null
  >(null);
  const [retryingDeliveryRunId, setRetryingDeliveryRunId] = useState<string | null>(null);
  const [acknowledgedPaletteDeliveryHandoffGaps, setAcknowledgedPaletteDeliveryHandoffGaps] =
    useState<Record<string, true>>({});
  const reportCatalogDiscoveryQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(null),
    queryFn: () => fetchReportCatalogDiscovery(),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const syncedReportCatalog = reportCatalogDiscoveryQuery.data;
  const commandReportWorkspaces = syncedReportCatalog?.workspaces ?? reportPersonaWorkspaces;
  const commandAutomationStarters =
    syncedReportCatalog?.automationStarters ?? reportAutomationStarters;
  const commandDecisionShortcuts =
    syncedReportCatalog?.decisionShortcuts ?? reportDecisionShortcuts;
  const commandTriggerRules = syncedReportCatalog?.triggerRules ?? reportAutomationTriggerRules;
  const commandDeliverySubscriptions =
    syncedReportCatalog?.deliverySubscriptions ?? reportDeliverySubscriptions;
  const commandPackTemplates = syncedReportCatalog?.packTemplates ?? reportPackTemplates;
  const commandComparisonPresets =
    syncedReportCatalog?.comparisonPresets ?? reportComparisonPresets;
  const commandReportSuites = syncedReportCatalog?.reportSuites ?? reportSuiteProfiles;
  const commandQuickAccessProfiles =
    syncedReportCatalog?.quickAccessProfiles ?? reportQuickAccessProfiles;
  const commandSavedViewProfiles = syncedReportCatalog?.savedViews ?? reportSavedViewProfiles;
  const commandAutomationImpactProfiles =
    syncedReportCatalog?.automationImpactProfiles ?? reportAutomationImpactProfiles;
  const commandReadyReports = (syncedReportCatalog?.reports ?? readyReportCatalog).filter(
    (report) => report.status !== "planned"
  );
  const preferredReportPersona = getPreferredReportPersona() ?? "all";
  const preferredReportWorkflowSearch = getPreferredReportWorkflowSearch(preferredReportPersona)
    .trim()
    .toLowerCase();
  const commandReportAutomationContextById = new Map(
    commandReadyReports.map((report): [string, CommandPaletteReportActionContext] => {
      const reportActionPersona =
        preferredReportPersona !== "all" && report.personas.includes(preferredReportPersona)
          ? preferredReportPersona
          : (report.personas[0] ?? "owner");
      const syncedContext =
        syncedReportCatalog?.reportActionContexts.find(
          (context) => context.reportId === report.id && context.persona === reportActionPersona
        ) ??
        syncedReportCatalog?.reportActionContexts.find((context) => context.reportId === report.id);
      const syncedStarter = syncedContext?.automationStarters[0];
      const fallbackStarter = commandAutomationStarters.find((starter) =>
        starter.reportIds.includes(report.id)
      );
      const syncedDelivery = syncedContext?.deliverySubscriptions[0];
      const fallbackDelivery = commandDeliverySubscriptions.find((subscription) =>
        subscription.reportIds.includes(report.id)
      );
      const syncedComparison = syncedContext?.comparisonPresets[0];
      const fallbackComparison = commandComparisonPresets.find((preset) =>
        preset.reportIds.includes(report.id)
      );
      const syncedSuite = syncedContext?.reportSuites[0];
      const fallbackSuite = commandReportSuites.find((suite) =>
        suite.reportIds.includes(report.id)
      );

      return [
        report.id,
        {
          reportHref:
            syncedContext?.reportHref ?? reportPersonaHref(report, reportActionPersona) ?? null,
          workflowHref:
            syncedContext?.workflowHref ??
            reportWorkflowContextHref({
              persona: reportActionPersona,
              tab: report.tab,
              search: report.name,
            }),
          starter: syncedStarter
            ? { title: syncedStarter.title, href: syncedStarter.href }
            : fallbackStarter
              ? {
                  title: fallbackStarter.title,
                  href: syncedHref(fallbackStarter) ?? reportAutomationStarterHref(fallbackStarter),
                  outcome: fallbackStarter.outcome,
                  commandKeywords: fallbackStarter.commandKeywords,
                }
              : undefined,
          delivery: syncedDelivery
            ? { title: syncedDelivery.title, href: syncedDelivery.href }
            : fallbackDelivery
              ? {
                  title: fallbackDelivery.title,
                  href:
                    syncedHref(fallbackDelivery) ??
                    reportDeliverySubscriptionHref(fallbackDelivery),
                  deliveryGuardrail: fallbackDelivery.deliveryGuardrail,
                  commandKeywords: fallbackDelivery.commandKeywords,
                }
              : undefined,
          comparison: syncedComparison
            ? { title: syncedComparison.title, href: syncedComparison.href }
            : fallbackComparison
              ? {
                  title: fallbackComparison.title,
                  href:
                    syncedHref(fallbackComparison) ??
                    reportComparisonPresetHref(fallbackComparison),
                  question: fallbackComparison.question,
                  commandKeywords: fallbackComparison.commandKeywords,
                }
              : undefined,
          suite: syncedSuite
            ? { title: syncedSuite.title, href: syncedSuite.href }
            : fallbackSuite
              ? {
                  title: fallbackSuite.title,
                  href: syncedHref(fallbackSuite) ?? reportSuiteHref(fallbackSuite),
                  workflow: fallbackSuite.workflow,
                  commandKeywords: fallbackSuite.commandKeywords,
                }
              : undefined,
        },
      ];
    })
  );

  useEffect(() => {
    setAcknowledgedPaletteDeliveryHandoffGaps({});
  }, [selectedCompanyId]);

  const commandReportDeliveryPlansQuery = useQuery<{
    subscriptions: CommandPaletteReportDeliveryPlan[];
  }>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "report-delivery",
      "subscriptions",
      "command-palette",
    ],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/subscriptions`),
    enabled: open && Boolean(selectedCompanyId),
    retry: 1,
  });

  const commandReportDeliveryRunsQuery = useQuery<{ runs: CommandPaletteReportDeliveryRun[] }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs", "command-palette"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    enabled: open && Boolean(selectedCompanyId),
    retry: 1,
  });

  const commandFailedDeliveryRuns = (commandReportDeliveryRunsQuery.data?.runs ?? [])
    .filter((run) => run.status === "failed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const getCommandPaletteDeliveryHandoff = (subscription: {
    id: string;
    persona: ReportPersona;
    title: string;
  }) => {
    const plan = commandReportDeliveryPlansQuery.data?.subscriptions.find(
      (item) => item.id === subscription.id
    );
    const failedRun = commandFailedDeliveryRuns.find(
      (run) => run.subscriptionId === subscription.id
    );
    const workspace = commandReportWorkspaces.find((item) => item.persona === subscription.persona);
    const checklistGap = plan?.preview?.checklist?.find(
      (item) => item.status !== "ready" && item.label !== "Automation rules"
    );
    const reportGapCount = plan ? Math.max(0, plan.reportCount - plan.readyReportCount) : 0;
    const gap: ReportWorkflowGapFilter | null = failedRun
      ? "delivery-gaps"
      : plan && (!plan.enabled || plan.status === "paused")
        ? "delivery-gaps"
        : reportGapCount > 0
          ? "report-gaps"
          : plan && plan.status !== "ready"
            ? "delivery-gaps"
            : checklistGap
              ? checklistGap.label === "Reports"
                ? "report-gaps"
                : "delivery-gaps"
              : null;

    if (!gap || !workspace) return null;

    const detail = failedRun
      ? (failedRun.errorMessage ?? "A failed delivery run needs recovery before queueing again.")
      : checklistGap
        ? checklistGap.detail
        : reportGapCount > 0
          ? `${plan?.readyReportCount ?? 0}/${plan?.reportCount ?? 0} reports are ready for this pack.`
          : (plan?.preview?.readinessLabel ?? "Review delivery setup before queueing.");

    return {
      gap,
      label: reportWorkflowGapFilterLabels[gap],
      detail,
      href: reportWorkflowContextHref({
        persona: subscription.persona,
        tab: workspace.primaryTab,
        search: subscription.title,
        gap,
      }),
    };
  };

  const queueReportDeliveryFromPalette = async (subscription: {
    id: string;
    persona: ReportPersona;
    title: string;
  }) => {
    if (!selectedCompanyId) {
      toast({
        title: "Select a company first",
        description: "Choose a company before queuing an automated report pack.",
        variant: "destructive",
      });
      return;
    }

    const handoff = getCommandPaletteDeliveryHandoff(subscription);
    if (handoff && !acknowledgedPaletteDeliveryHandoffGaps[subscription.id]) {
      setAcknowledgedPaletteDeliveryHandoffGaps((current) => ({
        ...current,
        [subscription.id]: true,
      }));
      toast({
        title: "Handoff gaps acknowledged",
        description: `${subscription.title} has ${handoff.label.toLowerCase()}: ${handoff.detail} Select the queue command again to send with those gaps acknowledged.`,
      });
      return;
    }

    setQueueingDeliverySubscriptionId(subscription.id);
    try {
      const acknowledgeHandoffGaps = Boolean(
        handoff && acknowledgedPaletteDeliveryHandoffGaps[subscription.id]
      );
      const result = await apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscription.id}/queue`,
        acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true } : undefined
      );
      const subscriptionTitle = result?.subscription?.title ?? subscription.title;
      const nextRunLabel = result?.subscription?.nextRunLabel;

      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "report-delivery"],
      });

      toast({
        title: "Report pack queued",
        description: nextRunLabel
          ? `${subscriptionTitle} queued for ${nextRunLabel}.`
          : `${subscriptionTitle} queued from the command palette.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not queue report pack",
        description: error?.message || "Failed to queue the report pack.",
        variant: "destructive",
      });
    } finally {
      setQueueingDeliverySubscriptionId(null);
    }
  };

  const retryReportDeliveryFromPalette = async (runId: string, fallbackTitle: string) => {
    if (!selectedCompanyId) {
      toast({
        title: "Select a company first",
        description: "Choose a company before retrying an automated report delivery.",
        variant: "destructive",
      });
      return;
    }

    setRetryingDeliveryRunId(runId);
    try {
      const result = await apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
      const subscriptionTitle = result?.subscription?.title ?? fallbackTitle;

      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "report-delivery"],
      });

      toast({
        title: "Report delivery retry queued",
        description: `${subscriptionTitle} was requeued from the command palette.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not retry report delivery",
        description: error?.message || "Failed to retry the report delivery.",
        variant: "destructive",
      });
    } finally {
      setRetryingDeliveryRunId(null);
    }
  };

  const items: PaletteItem[] = [
    {
      id: "nav-dashboard",
      label: "Dashboard",
      group: "Navigate",
      icon: Home,
      href: "/dashboard",
      shortcut: "g d",
    },
    {
      id: "nav-invoices",
      label: "Invoices",
      group: "Navigate",
      icon: FileText,
      href: "/invoices",
      shortcut: "g i",
    },
    { id: "nav-receipts", label: "Receipts", group: "Navigate", icon: Receipt, href: "/receipts" },
    {
      id: "nav-journal",
      label: "Journal",
      group: "Navigate",
      icon: BookMarked,
      href: "/journal",
      shortcut: "g j",
    },
    {
      id: "nav-contacts",
      label: "Customer Contacts",
      group: "Navigate",
      icon: Users,
      href: "/contacts",
    },
    {
      id: "nav-reports",
      label: "Reports",
      group: "Navigate",
      icon: BarChart3,
      href: "/reports",
      shortcut: "g r",
    },
    ...commandReportWorkspaces.map(
      (workspace): PaletteItem => ({
        id: `report-workspace-${workspace.persona}`,
        label: workspace.title,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: syncedHref(workspace) ?? reportWorkspaceHref(workspace),
        description: workspace.focus,
        keywords: workspace.commandKeywords,
      })
    ),
    ...commandReportWorkspaces.flatMap((workspace) =>
      workspace.automations.map(
        (playbook): PaletteItem => ({
          id: `report-automation-${playbook.id}`,
          label: `${playbook.title} - ${workspace.title}`,
          group: "Reports",
          icon: reportWorkspaceIcons[workspace.icon],
          href: playbook.href ?? reportAutomationPlaybookHref(playbook, workspace.persona),
          description: `${playbook.trigger} · ${playbook.cta}`,
          keywords: [
            workspace.commandKeywords,
            playbook.trigger,
            playbook.cta,
            playbook.reportIds.join(" "),
            "automation playbook report pack",
          ].join(" "),
        })
      )
    ),
    ...commandAutomationStarters.map((starter): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === starter.persona);
      return {
        id: `report-automation-starter-${starter.id}`,
        label: starter.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        href: syncedHref(starter) ?? reportAutomationStarterHref(starter),
        description: `${starter.audience} · ${starter.outcome}`,
        keywords: [
          starter.commandKeywords,
          starter.audience,
          starter.outcome,
          starter.trigger,
          starter.setupSteps.join(" "),
          "automation starter autopilot report pack",
        ].join(" "),
      };
    }),
    ...commandDecisionShortcuts.map((shortcut): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === shortcut.persona);
      return {
        id: `report-decision-shortcut-${shortcut.id}`,
        label: shortcut.question,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : BarChart3,
        href: syncedHref(shortcut) ?? reportDecisionShortcutHref(shortcut),
        description: shortcut.answer,
        keywords: [
          shortcut.commandKeywords,
          shortcut.answer,
          shortcut.reportIds.join(" "),
          shortcut.comparisonPresetId,
          shortcut.automationStarterId,
          "decision question report shortcut",
        ].join(" "),
      };
    }),
    ...commandTriggerRules.map((rule): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === rule.persona);
      return {
        id: `report-trigger-rule-${rule.id}`,
        label: rule.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        href: syncedHref(rule) ?? reportAutomationTriggerRuleHref(rule),
        description: `${rule.condition} · ${rule.actionLabel}`,
        keywords: [
          rule.commandKeywords,
          rule.condition,
          rule.threshold,
          rule.cadence,
          rule.actionLabel,
          "trigger rule threshold report automation alert",
        ].join(" "),
      };
    }),
    ...commandDeliverySubscriptions.map((subscription): PaletteItem => {
      const workspace = commandReportWorkspaces.find(
        (item) => item.persona === subscription.persona
      );
      return {
        id: `report-delivery-subscription-${subscription.id}`,
        label: subscription.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(subscription) ?? reportDeliverySubscriptionHref(subscription),
        description: `${subscription.cadence} · ${subscription.channel} · ${subscription.recipients}`,
        keywords: [
          subscription.commandKeywords,
          subscription.audience,
          subscription.cadence,
          subscription.channel,
          subscription.recipients,
          subscription.deliveryGuardrail,
          "delivery subscription scheduled send report pack recipients",
        ].join(" "),
      };
    }),
    ...commandDeliverySubscriptions.map((subscription): PaletteItem => {
      const workspace = commandReportWorkspaces.find(
        (item) => item.persona === subscription.persona
      );
      const isQueueing = queueingDeliverySubscriptionId === subscription.id;
      const handoff = getCommandPaletteDeliveryHandoff(subscription);
      const requiresHandoffAcknowledgement = Boolean(
        handoff && !acknowledgedPaletteDeliveryHandoffGaps[subscription.id]
      );
      return {
        id: `report-queue-delivery-${subscription.id}`,
        label: `${
          isQueueing
            ? "Queueing"
            : requiresHandoffAcknowledgement
              ? "Acknowledge handoff for"
              : "Queue"
        } ${subscription.title}`,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        action: () => queueReportDeliveryFromPalette(subscription),
        description:
          requiresHandoffAcknowledgement && handoff
            ? `${handoff.label}: ${handoff.detail}`
            : `Send ${subscription.channel} pack to ${subscription.recipients}`,
        keywords: [
          subscription.commandKeywords,
          subscription.audience,
          subscription.cadence,
          subscription.channel,
          subscription.recipients,
          subscription.deliveryGuardrail,
          handoff?.label,
          handoff?.detail,
          handoff?.href,
          requiresHandoffAcknowledgement ? "acknowledge handoff gaps before queueing" : "",
          "queue now send schedule automated report pack from anywhere command palette",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }),
    ...commandFailedDeliveryRuns.map((run): PaletteItem => {
      const subscription = commandDeliverySubscriptions.find(
        (item) => item.id === run.subscriptionId
      );
      const workspace = subscription
        ? commandReportWorkspaces.find((item) => item.persona === subscription.persona)
        : null;
      const fallbackTitle = subscription?.title ?? "Report delivery";
      const isRetrying = retryingDeliveryRunId === run.id;
      return {
        id: `report-retry-delivery-${run.id}`,
        label: `${isRetrying ? "Retrying" : "Retry"} ${fallbackTitle}`,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        action: () => retryReportDeliveryFromPalette(run.id, fallbackTitle),
        description: run.errorMessage ?? "Recover failed automated report delivery",
        keywords: [
          subscription?.commandKeywords,
          subscription?.audience,
          subscription?.channel,
          subscription?.recipients,
          run.errorMessage ?? "",
          "retry failed delivery recover report pack automation command palette from anywhere",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }),
    ...commandPackTemplates.map((template): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === template.persona);
      return {
        id: `report-pack-template-${template.id}`,
        label: template.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(template) ?? reportPackTemplateHref(template),
        description: `${template.audience} · ${template.cadence} · ${template.delivery}`,
        keywords: [
          template.commandKeywords,
          template.audience,
          template.outcome,
          template.comparisonFocus,
          template.automationTrigger,
          "ready made report pack template",
        ].join(" "),
      };
    }),
    ...commandComparisonPresets.map((preset): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === preset.persona);
      return {
        id: `report-comparison-preset-${preset.id}`,
        label: preset.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : BarChart3,
        href: syncedHref(preset) ?? reportComparisonPresetHref(preset),
        description: `${preset.question} · ${preset.baseline}`,
        keywords: [
          preset.commandKeywords,
          preset.question,
          preset.baseline,
          preset.automationTrigger,
          "comparison preset report pack",
        ].join(" "),
      };
    }),
    ...commandReportSuites.map((suite): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === suite.persona);
      return {
        id: `report-suite-${suite.id}`,
        label: suite.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(suite) ?? reportSuiteHref(suite),
        description: `${suite.workflow} · ${suite.reportIds.length} reports · ${suite.primaryAction}`,
        keywords: [
          suite.commandKeywords,
          suite.outcome,
          suite.workflow,
          suite.primaryAction,
          suite.triggerRuleIds.join(" "),
          suite.deliverySubscriptionId,
          suite.decisionShortcutId,
          "report suite role based reports comparison pack automation delivery trigger rules saved views",
        ].join(" "),
      };
    }),
    ...commandReportSuites.flatMap((suite): PaletteItem[] => {
      const subscription = commandDeliverySubscriptions.find(
        (item) => item.id === suite.deliverySubscriptionId
      );
      if (!subscription) return [];

      const workspace = commandReportWorkspaces.find((item) => item.persona === suite.persona);
      const isQueueing = queueingDeliverySubscriptionId === suite.deliverySubscriptionId;
      const handoff = getCommandPaletteDeliveryHandoff(subscription);
      const requiresHandoffAcknowledgement = Boolean(
        handoff && !acknowledgedPaletteDeliveryHandoffGaps[suite.deliverySubscriptionId]
      );

      return [
        {
          id: `report-queue-suite-delivery-${suite.id}`,
          label: `${
            isQueueing
              ? "Queueing delivery for"
              : requiresHandoffAcknowledgement
                ? "Acknowledge handoff for"
                : "Queue delivery for"
          } ${suite.title}`,
          group: "Reports",
          icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
          action: () => queueReportDeliveryFromPalette({ ...subscription, title: suite.title }),
          description:
            requiresHandoffAcknowledgement && handoff
              ? `${handoff.label}: ${handoff.detail}`
              : `Send the linked ${subscription.channel} pack for ${suite.workflow}`,
          keywords: [
            suite.commandKeywords,
            suite.workflow,
            suite.outcome,
            suite.deliverySubscriptionId,
            subscription.commandKeywords,
            subscription.channel,
            subscription.recipients,
            handoff?.label,
            handoff?.detail,
            requiresHandoffAcknowledgement ? "acknowledge handoff gaps before queueing" : "",
            "queue suite delivery send scheduled report suite from anywhere command palette",
          ]
            .filter(Boolean)
            .join(" "),
        },
      ];
    }),
    ...commandSavedViewProfiles.map((view): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === view.persona);
      return {
        id: `report-saved-view-${view.id}`,
        label: view.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(view) ?? reportSavedViewHref(view),
        description: `${view.dateRangePreset} · ${view.comparisonPeriod} · ${view.currency} · ${view.dimension}`,
        keywords: [
          view.commandKeywords,
          view.description,
          view.basis,
          view.exportFormat,
          view.automationTrigger,
          "saved report view date range comparison currency dimension",
        ].join(" "),
      };
    }),
    ...commandReportWorkspaces.flatMap((workspace): PaletteItem[] => [
      {
        id: `report-role-setup-${workspace.persona}`,
        label: `Role setup path - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "role-setup"),
        description: `Start ${workspace.navLabel.toLowerCase()} with reports, comparisons, automations, and scheduled packs.`,
        keywords: `${workspace.commandKeywords} role setup onboarding first run solo entrepreneur freelancer accountant reports automation scheduled packs`,
      },
      {
        id: `report-suites-${workspace.persona}`,
        label: `Report suites - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "report-suites"),
        keywords: `${workspace.commandKeywords} report suites role based reports comparison pack automation delivery trigger rules saved views`,
      },
      {
        id: `report-quick-access-${workspace.persona}`,
        label: `Quick access reports - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "quick-access"),
        description: commandQuickAccessProfiles.find(
          (profile) => profile.persona === workspace.persona
        )?.outcome,
        keywords: `${workspace.commandKeywords} ${
          commandQuickAccessProfiles.find((profile) => profile.persona === workspace.persona)
            ?.commandKeywords ?? ""
        } quick access favorite daily reports open from anywhere`,
      },
      {
        id: `report-saved-views-${workspace.persona}`,
        label: `Saved report views - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "saved-views"),
        keywords: `${workspace.commandKeywords} saved report views date range comparison basis currency dimension export`,
      },
      {
        id: `report-automation-operations-${workspace.persona}`,
        label: `Report automation operations - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-operations"),
        keywords: `${workspace.commandKeywords} operations control room readiness delivery failures automation health next action`,
      },
      {
        id: `report-automation-impact-${workspace.persona}`,
        label: `Automation impact - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-impact"),
        description: commandAutomationImpactProfiles.find(
          (profile) => profile.persona === workspace.persona
        )?.outcome,
        keywords: `${workspace.commandKeywords} ${
          commandAutomationImpactProfiles.find((profile) => profile.persona === workspace.persona)
            ?.commandKeywords ?? ""
        } automation impact time saved work removed reports`,
      },
      {
        id: `report-decision-shortcuts-${workspace.persona}`,
        label: `Decision shortcuts - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "decision-shortcuts"),
        keywords: `${workspace.commandKeywords} decision questions report shortcuts what should I open`,
      },
      {
        id: `report-trigger-rules-${workspace.persona}`,
        label: `Trigger rules - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "trigger-rules"),
        keywords: `${workspace.commandKeywords} trigger rules thresholds report automation alerts`,
      },
      {
        id: `report-delivery-subscriptions-${workspace.persona}`,
        label: `Delivery subscriptions - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "delivery-subscriptions"),
        keywords: `${workspace.commandKeywords} delivery subscriptions scheduled send recipients report pack`,
      },
      {
        id: `report-automation-starters-${workspace.persona}`,
        label: `Automation starters - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-starters"),
        keywords: `${workspace.commandKeywords} automation starters autopilot quick setup checklist`,
      },
      {
        id: `report-recommendations-${workspace.persona}`,
        label: `Recommended reports - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "recommendations"),
        keywords: `${workspace.commandKeywords} recommended next best reports comparisons automation`,
      },
      {
        id: `report-pack-readiness-${workspace.persona}`,
        label: `Report pack readiness - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "pack-readiness"),
        keywords: `${workspace.commandKeywords} readiness delivery checklist pack send review`,
      },
      {
        id: `report-automation-rules-${workspace.persona}`,
        label: `Report automation rules - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-rules"),
        keywords: `${workspace.commandKeywords} automation rules triggers cadence recipients reports auto send`,
      },
      {
        id: `report-automation-command-center-${workspace.persona}`,
        label: `Automation command center - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-command-center"),
        keywords: `${workspace.commandKeywords} automation command center auto send coverage blockers pack readiness`,
      },
      {
        id: `report-pack-automation-${workspace.persona}`,
        label: `Report pack automation - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "pack-automation"),
        keywords: `${workspace.commandKeywords} scheduled send pack automation Google Sheets Excel`,
      },
    ]),
    ...commandReadyReports.map((report): PaletteItem => {
      const context = commandReportAutomationContextById.get(report.id);

      return {
        id: `report-${report.id}`,
        label: report.name,
        group: "Reports",
        icon: reportCommandIcons[report.commandIcon],
        href: context?.reportHref ?? reportPersonaHref(report, preferredReportPersona),
        description: `${report.category} · ${report.comparison} · ${report.automation}`,
        keywords: `${report.commandKeywords} ${report.decisionQuestion}`,
      };
    }),
    ...commandReadyReports.flatMap((report): PaletteItem[] => {
      const context = commandReportAutomationContextById.get(report.id);
      if (!context?.starter && !context?.delivery && !context?.comparison && !context?.suite) {
        return [];
      }

      const contextLabels = [
        context.starter ? `Autopilot: ${context.starter.title}` : null,
        context.delivery ? `Delivery: ${context.delivery.title}` : null,
        context.comparison ? `Compare: ${context.comparison.title}` : null,
        context.suite ? `Suite: ${context.suite.title}` : null,
      ].filter(Boolean);

      const actionKeywords = [
        report.commandKeywords,
        report.decisionQuestion,
        report.automation,
        context.starter?.title,
        context.starter?.outcome,
        context.starter?.commandKeywords,
        context.delivery?.title,
        context.delivery?.deliveryGuardrail,
        context.delivery?.commandKeywords,
        context.comparison?.title,
        context.comparison?.question,
        context.comparison?.commandKeywords,
        context.suite?.title,
        context.suite?.workflow,
        context.suite?.commandKeywords,
      ]
        .filter(Boolean)
        .join(" ");

      return [
        {
          id: `report-action-${report.id}`,
          label: `Automate ${report.name}`,
          group: "Reports",
          icon: reportCommandIcons[report.commandIcon],
          href: context.workflowHref,
          description: contextLabels.join(" · "),
          keywords: `${actionKeywords} report automation action direct from anywhere command palette workflow finder`,
        },
        ...(context.delivery?.href
          ? [
              {
                id: `report-schedule-${report.id}`,
                label: `Schedule ${report.name}`,
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.delivery.href,
                description: context.delivery.title,
                keywords: `${actionKeywords} report delivery schedule subscription send from anywhere command palette`,
              },
            ]
          : []),
        ...(context.comparison?.href
          ? [
              {
                id: `report-compare-${report.id}`,
                label: `Compare ${report.name}`,
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.comparison.href,
                description: context.comparison.title,
                keywords: `${actionKeywords} report comparison preset current vs prior from anywhere command palette`,
              },
            ]
          : []),
        ...(context.suite?.href
          ? [
              {
                id: `report-suite-action-${report.id}`,
                label: `Open ${report.name} suite`,
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.suite.href,
                description: context.suite.title,
                keywords: `${actionKeywords} report suite pack workflow delivery comparison from anywhere command palette`,
              },
            ]
          : []),
      ];
    }),
    {
      id: "nav-bank",
      label: "Bank Reconciliation",
      group: "Navigate",
      icon: Wallet,
      href: "/bank-reconciliation",
    },
    {
      id: "nav-billpay",
      label: "Bill Pay",
      group: "Navigate",
      icon: CreditCard,
      href: "/bill-pay",
    },
    { id: "nav-payroll", label: "Payroll", group: "Navigate", icon: Briefcase, href: "/payroll" },
    {
      id: "nav-inventory",
      label: "Inventory",
      group: "Navigate",
      icon: ShoppingBag,
      href: "/inventory",
    },
    {
      id: "nav-vat",
      label: "VAT Filing",
      group: "Navigate",
      icon: FileSpreadsheet,
      href: "/vat-filing",
    },
    {
      id: "nav-corp-tax",
      label: "Corporate Tax",
      group: "Navigate",
      icon: Building2,
      href: "/corporate-tax",
    },
    { id: "nav-aichat", label: "AI Chat", group: "Navigate", icon: Sparkles, href: "/ai-chat" },
    {
      id: "create-invoice",
      label: "New Invoice",
      group: "Create",
      icon: Plus,
      href: "/invoices?new=1",
      shortcut: "n",
      keywords: "create add invoice",
    },
    {
      id: "create-journal",
      label: "New Journal Entry",
      group: "Create",
      icon: Plus,
      href: "/journal?new=1",
      keywords: "create add journal entry",
    },
    {
      id: "create-receipt",
      label: "Upload Receipt",
      group: "Create",
      icon: Plus,
      href: "/receipts?upload=1",
      keywords: "create add receipt expense",
    },
    {
      id: "settings-company",
      label: "Company Profile",
      group: "Settings",
      icon: Settings,
      href: "/company-profile",
    },
    {
      id: "settings-team",
      label: "Team Management",
      group: "Settings",
      icon: Users,
      href: "/team",
    },
    {
      id: "settings-integrations",
      label: "Integrations",
      group: "Settings",
      icon: Settings,
      href: "/integrations-hub",
    },
  ];

  const orderedItems = preferredReportWorkflowSearch
    ? items
        .map((item, index) => ({
          item,
          index,
          score: reportWorkflowSearchScore(item, preferredReportWorkflowSearch),
        }))
        .sort((a, b) => {
          if (a.item.group !== b.item.group) return a.index - b.index;
          if (a.item.group !== "Reports") return a.index - b.index;
          return b.score - a.score || a.index - b.index;
        })
        .map(({ item }) => item)
    : items;

  const grouped = orderedItems.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  const handleSelect = (item: PaletteItem) => {
    onOpenChange(false);
    if (item.href) navigate(item.href);
    void item.action?.();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search or jump to…" data-testid="command-palette-input" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Object.entries(grouped).map(([group, groupItems], groupIdx) => (
          <div key={group}>
            {groupIdx > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {groupItems.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`}
                    onSelect={() => handleSelect(item)}
                    data-testid={`command-item-${item.id}`}
                  >
                    <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpen);
  }, []);

  useKeyboardShortcuts([
    {
      combo: "mod+k",
      handler: () => setOpen((prev) => !prev),
      allowInInputs: true,
      description: "Open command palette",
    },
    {
      combo: "/",
      handler: () => setOpen(true),
      description: "Search / open command palette",
    },
  ]);

  return <CommandPalette open={open} onOpenChange={setOpen} />;
}
