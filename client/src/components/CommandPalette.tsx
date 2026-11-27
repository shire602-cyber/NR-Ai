import { useState } from "react";
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
  Camera,
  Clock,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  interpretPaletteQuery,
  paletteFilter,
  pushPaletteRecent,
  readPaletteRecents,
  searchPaletteRecords,
  type PaletteRecent,
  type PaletteRecord,
} from "@/lib/commandPaletteRecords";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useCatalogText, type CatalogTextKind } from "@/lib/reportCatalogText";
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

// D2b (CTO 11): palette groups and items read the nav / report catalogs in the UI locale.
const PALETTE_GROUP_KEYS: Record<PaletteItem["group"], string> = {
  Navigate: "shell.cmdGroupNavigate",
  Reports: "shell.cmdGroupReports",
  Create: "shell.cmdGroupCreate",
  Settings: "shell.cmdGroupSettings",
};

const PALETTE_ITEM_KEYS: Record<string, string> = {
  "nav-dashboard": "shell.cmdDashboard",
  "nav-invoices": "shell.cmdInvoices",
  "nav-receipts": "shell.cmdReceipts",
  "nav-journal": "shell.cmdJournal",
  "nav-contacts": "shell.cmdContacts",
  "nav-reports": "shell.cmdReports",
  "nav-bank": "shell.cmdBankReconciliation",
  "nav-billpay": "shell.cmdBillPay",
  "nav-payroll": "shell.cmdPayroll",
  "nav-inventory": "shell.cmdInventory",
  "nav-vat": "shell.cmdVatFiling",
  "nav-vat-bad-debt-relief": "shell.cmdBadDebtRelief",
  "nav-corp-tax": "shell.cmdCorporateTax",
  "nav-aichat": "shell.cmdAiChat",
  "create-invoice": "shell.cmdNewInvoice",
  "create-journal": "shell.cmdNewJournalEntry",
  "create-receipt": "shell.cmdUploadReceipt",
  "settings-company": "shell.cmdCompanyProfile",
  "settings-team": "shell.cmdTeam",
  "settings-integrations": "shell.cmdIntegrations",
};

/** Workspace-scoped section entries: id prefix -> label template key ({workspace}). */
const PALETTE_SECTION_KEYS: Array<[string, string]> = [
  ["report-role-setup-", "shell.cmdSectionRoleSetup"],
  ["report-suites-", "shell.cmdSectionSuites"],
  ["report-quick-access-", "shell.cmdSectionQuickAccess"],
  ["report-saved-views-", "shell.cmdSectionSavedViews"],
  ["report-automation-operations-", "shell.cmdSectionAutomationOperations"],
  ["report-automation-impact-", "shell.cmdSectionAutomationImpact"],
  ["report-decision-shortcuts-", "shell.cmdSectionDecisionShortcuts"],
  ["report-trigger-rules-", "shell.cmdSectionTriggerRules"],
  ["report-delivery-subscriptions-", "shell.cmdSectionDeliverySubscriptions"],
  ["report-automation-starters-", "shell.cmdSectionAutomationStarters"],
  ["report-recommendations-", "shell.cmdSectionRecommendations"],
  ["report-pack-readiness-", "shell.cmdSectionPackReadiness"],
  ["report-automation-rules-", "shell.cmdSectionAutomationRules"],
  ["report-automation-command-center-", "shell.cmdSectionCommandCenter"],
  ["report-pack-automation-", "shell.cmdSectionPackAutomation"],
];

/** Catalog entities with Arabic overlays: id prefix -> catalog kind + field. */
const PALETTE_CATALOG_PREFIXES: Array<[string, CatalogTextKind, string]> = [
  ["report-automation-starter-", "starter", "title"],
  ["report-decision-shortcut-", "shortcut", "question"],
  ["report-pack-template-", "pack", "title"],
  ["report-comparison-preset-", "preset", "title"],
  ["report-suite-", "suite", "title"],
];

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
  const { t } = useTranslation();
  const ct = useCatalogText();
  const px = (key: string, values: Record<string, string | number> = {}) =>
    formatMessage((t as Record<string, string>)[key] ?? key, values);
  const [queueingDeliverySubscriptionId, setQueueingDeliverySubscriptionId] = useState<
    string | null
  >(null);
  const [retryingDeliveryRunId, setRetryingDeliveryRunId] = useState<string | null>(null);
  const [acknowledgedPaletteDeliveryHandoffGaps, setAcknowledgedPaletteDeliveryHandoffGaps] =
    useState<Record<string, true>>({});
  // R3 (CTO 17): controlled query so the palette can echo its interpretation, show records,
  // and keep the empty state to Recent + Actions.
  const [search, setSearch] = useState("");
  const [recents, setRecents] = useState<PaletteRecent[]>([]);
  // Reset the query and reload recents when the palette opens or closes (state adjusted
  // during render, React's pattern for deriving state from a prop change).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setRecents(readPaletteRecents());
    else setSearch("");
  }
  const trimmedSearch = search.trim();
  const recordSearchEnabled = open && !!selectedCompanyId && trimmedSearch.length >= 2;
  const paletteInvoicesQuery = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/invoices?all=true`),
    enabled: recordSearchEnabled,
    staleTime: 60_000,
    retry: false,
  });
  const paletteCustomersQuery = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "customer-contacts"],
    enabled: recordSearchEnabled,
    staleTime: 60_000,
    retry: false,
  });
  const paletteVendorsQuery = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "vendors"],
    enabled: recordSearchEnabled,
    staleTime: 60_000,
    retry: false,
  });
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

  // Acknowledgements belong to one company: reset them when it changes.
  const [acknowledgementCompanyId, setAcknowledgementCompanyId] = useState(selectedCompanyId);
  if (acknowledgementCompanyId !== selectedCompanyId) {
    setAcknowledgementCompanyId(selectedCompanyId);
    setAcknowledgedPaletteDeliveryHandoffGaps({});
  }

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
      ? (failedRun.errorMessage ?? px("shell.cmdGapFailedRun"))
      : checklistGap
        ? checklistGap.detail
        : reportGapCount > 0
          ? px("shell.cmdGapReportsReady", {
              ready: plan?.readyReportCount ?? 0,
              total: plan?.reportCount ?? 0,
            })
          : (plan?.preview?.readinessLabel ?? px("shell.cmdGapReviewSetup"));

    return {
      gap,
      label: ct.cx(reportWorkflowGapFilterLabels[gap]),
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
        title: px("shell.cmdSelectCompanyFirst"),
        description: px("shell.cmdSelectCompanyQueue"),
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
        title: px("shell.cmdHandoffAcknowledged"),
        description: px("shell.cmdHandoffAcknowledgedBody", {
          title: ct.cx(subscription.title),
          label: handoff.label.toLowerCase(),
          detail: handoff.detail,
        }),
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
        title: px("shell.cmdPackQueued"),
        description: nextRunLabel
          ? px("shell.cmdPackQueuedFor", { title: ct.cx(subscriptionTitle), when: nextRunLabel })
          : px("shell.cmdPackQueuedPalette", { title: ct.cx(subscriptionTitle) }),
      });
    } catch (error: any) {
      toast({
        title: px("shell.cmdQueueFailed"),
        description: error?.message || px("shell.cmdQueueFailedBody"),
        variant: "destructive",
      });
    } finally {
      setQueueingDeliverySubscriptionId(null);
    }
  };

  const retryReportDeliveryFromPalette = async (runId: string, fallbackTitle: string) => {
    if (!selectedCompanyId) {
      toast({
        title: px("shell.cmdSelectCompanyFirst"),
        description: px("shell.cmdSelectCompanyRetry"),
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
        title: px("shell.cmdRetryQueued"),
        description: px("shell.cmdRetryQueuedBody", { title: ct.cx(subscriptionTitle) }),
      });
    } catch (error: any) {
      toast({
        title: px("shell.cmdRetryFailed"),
        description: error?.message || px("shell.cmdRetryFailedBody"),
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
      label: "Customer contacts",
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
        label: ct("workspace", workspace.persona, "title", workspace.title),
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: syncedHref(workspace) ?? reportWorkspaceHref(workspace),
        description: ct("workspace", workspace.persona, "focus", workspace.focus),
        keywords: workspace.commandKeywords,
      })
    ),
    ...commandReportWorkspaces.flatMap((workspace) =>
      workspace.automations.map(
        (playbook): PaletteItem => ({
          id: `report-automation-${playbook.id}`,
          label: `${ct("playbook", playbook.id, "title", playbook.title)} - ${ct("workspace", workspace.persona, "title", workspace.title)}`,
          group: "Reports",
          icon: reportWorkspaceIcons[workspace.icon],
          href: playbook.href ?? reportAutomationPlaybookHref(playbook, workspace.persona),
          description: `${ct("playbook", playbook.id, "trigger", playbook.trigger)} · ${ct("playbook", playbook.id, "cta", playbook.cta)}`,
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
        label: ct("starter", starter.id, "title", starter.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        href: syncedHref(starter) ?? reportAutomationStarterHref(starter),
        description: `${ct("starter", starter.id, "audience", starter.audience)} · ${ct("starter", starter.id, "outcome", starter.outcome)}`,
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
        label: ct("shortcut", shortcut.id, "question", shortcut.question),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : BarChart3,
        href: syncedHref(shortcut) ?? reportDecisionShortcutHref(shortcut),
        description: ct("shortcut", shortcut.id, "answer", shortcut.answer),
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
        label: ct("rule", rule.id, "title", rule.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        href: syncedHref(rule) ?? reportAutomationTriggerRuleHref(rule),
        description: `${ct("rule", rule.id, "condition", rule.condition)} · ${ct("rule", rule.id, "actionLabel", rule.actionLabel)}`,
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
        label: ct("delivery", subscription.id, "title", subscription.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(subscription) ?? reportDeliverySubscriptionHref(subscription),
        description: `${ct("delivery", subscription.id, "cadence", subscription.cadence)} · ${ct("delivery", subscription.id, "channel", subscription.channel)} · ${ct("delivery", subscription.id, "recipients", subscription.recipients)}`,
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
            ? px("shell.cmdQueueing")
            : requiresHandoffAcknowledgement
              ? t["components.paletteAcknowledgeHandoffFor"]
              : t["components.paletteQueue"]
        } ${ct("delivery", subscription.id, "title", subscription.title)}`,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        action: () => queueReportDeliveryFromPalette(subscription),
        description:
          requiresHandoffAcknowledgement && handoff
            ? `${handoff.label}: ${handoff.detail}`
            : px("shell.cmdSendPack", {
                channel: ct("delivery", subscription.id, "channel", subscription.channel),
                recipients: ct("delivery", subscription.id, "recipients", subscription.recipients),
              }),
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
      const fallbackTitle = subscription
        ? ct("delivery", subscription.id, "title", subscription.title)
        : px("shell.cmdReportDeliveryFallback");
      const isRetrying = retryingDeliveryRunId === run.id;
      return {
        id: `report-retry-delivery-${run.id}`,
        label: `${isRetrying ? px("shell.cmdRetrying") : px("shell.cmdRetry")} ${fallbackTitle}`,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
        action: () => retryReportDeliveryFromPalette(run.id, fallbackTitle),
        description: run.errorMessage ?? px("shell.cmdRecoverDelivery"),
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
        label: ct("pack", template.id, "title", template.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(template) ?? reportPackTemplateHref(template),
        description: `${ct("pack", template.id, "audience", template.audience)} · ${ct("pack", template.id, "cadence", template.cadence)} · ${ct("pack", template.id, "delivery", template.delivery)}`,
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
        label: ct("preset", preset.id, "title", preset.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : BarChart3,
        href: syncedHref(preset) ?? reportComparisonPresetHref(preset),
        description: `${ct("preset", preset.id, "question", preset.question)} · ${ct("preset", preset.id, "baseline", preset.baseline)}`,
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
        label: ct("suite", suite.id, "title", suite.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(suite) ?? reportSuiteHref(suite),
        description: px("shell.cmdSuiteDesc", {
          workflow: ct("suite", suite.id, "workflow", suite.workflow),
          n: suite.reportIds.length,
          action: ct("suite", suite.id, "primaryAction", suite.primaryAction),
        }),
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
              ? t["components.paletteQueueingDeliveryFor"]
              : requiresHandoffAcknowledgement
                ? t["components.paletteAcknowledgeHandoffFor"]
                : t["components.paletteQueueDeliveryFor"]
          } ${ct("suite", suite.id, "title", suite.title)}`,
          group: "Reports",
          icon: workspace ? reportWorkspaceIcons[workspace.icon] : Sparkles,
          action: () => queueReportDeliveryFromPalette({ ...subscription, title: suite.title }),
          description:
            requiresHandoffAcknowledgement && handoff
              ? `${handoff.label}: ${handoff.detail}`
              : px("shell.cmdSendLinkedPack", {
                  channel: ct("delivery", subscription.id, "channel", subscription.channel),
                  workflow: ct("suite", suite.id, "workflow", suite.workflow),
                }),
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
        label: ct("savedView", view.id, "title", view.title),
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(view) ?? reportSavedViewHref(view),
        description: `${ct("savedView", view.id, "dateRangePreset", view.dateRangePreset)} · ${ct("savedView", view.id, "comparisonPeriod", view.comparisonPeriod)} · ${view.currency} · ${ct("savedView", view.id, "dimension", view.dimension)}`,
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
        description: px("shell.cmdRoleSetupDesc", {
          name: ct("workspace", workspace.persona, "navLabel", workspace.navLabel).toLowerCase(),
        }),
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
        description: ct.cx(
          commandQuickAccessProfiles.find((profile) => profile.persona === workspace.persona)
            ?.outcome ?? ""
        ),
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
        description: ct(
          "impact",
          workspace.persona,
          "outcome",
          commandAutomationImpactProfiles.find((profile) => profile.persona === workspace.persona)
            ?.outcome ?? ""
        ),
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
        label: ct("report", report.id, "name", report.name),
        group: "Reports",
        icon: reportCommandIcons[report.commandIcon],
        href: context?.reportHref ?? reportPersonaHref(report, preferredReportPersona),
        description: `${ct("category", report.category, "label", report.category)} · ${ct("report", report.id, "comparison", report.comparison)} · ${ct("report", report.id, "automation", report.automation)}`,
        keywords: `${report.commandKeywords} ${report.decisionQuestion}`,
      };
    }),
    ...commandReadyReports.flatMap((report): PaletteItem[] => {
      const context = commandReportAutomationContextById.get(report.id);
      if (!context?.starter && !context?.delivery && !context?.comparison && !context?.suite) {
        return [];
      }

      const contextLabels = [
        context.starter
          ? px("shell.cmdCtxAutopilot", { title: ct.cx(context.starter.title ?? "") })
          : null,
        context.delivery
          ? px("shell.cmdCtxDelivery", { title: ct.cx(context.delivery.title ?? "") })
          : null,
        context.comparison
          ? px("shell.cmdCtxCompare", { title: ct.cx(context.comparison.title ?? "") })
          : null,
        context.suite ? px("shell.cmdCtxSuite", { title: ct.cx(context.suite.title ?? "") }) : null,
      ].filter(Boolean);
      const reportName = ct("report", report.id, "name", report.name);

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
          label: px("shell.cmdAutomateReport", { name: reportName }),
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
                label: px("shell.cmdScheduleReport", { name: reportName }),
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.delivery.href,
                description: ct.cx(context.delivery.title ?? ""),
                keywords: `${actionKeywords} report delivery schedule subscription send from anywhere command palette`,
              },
            ]
          : []),
        ...(context.comparison?.href
          ? [
              {
                id: `report-compare-${report.id}`,
                label: px("shell.cmdCompareReport", { name: reportName }),
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.comparison.href,
                description: ct.cx(context.comparison.title ?? ""),
                keywords: `${actionKeywords} report comparison preset current vs prior from anywhere command palette`,
              },
            ]
          : []),
        ...(context.suite?.href
          ? [
              {
                id: `report-suite-action-${report.id}`,
                label: px("shell.cmdOpenSuiteReport", { name: reportName }),
                group: "Reports" as const,
                icon: reportCommandIcons[report.commandIcon],
                href: context.suite.href,
                description: ct.cx(context.suite.title ?? ""),
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
      label: "VAT filing",
      group: "Navigate",
      icon: FileSpreadsheet,
      href: "/vat-filing",
    },
    {
      id: "nav-vat-bad-debt-relief",
      label: "Bad-debt relief",
      group: "Navigate",
      icon: FileSpreadsheet,
      href: "/vat-bad-debt-relief",
    },
    {
      id: "nav-corp-tax",
      label: "Corporate Tax",
      group: "Navigate",
      icon: Building2,
      href: "/corporate-tax",
    },
    {
      id: "nav-aichat",
      label: "AI chat",
      group: "Navigate",
      icon: Sparkles,
      href: "/ai?tab=chat",
    },
    {
      id: "create-invoice",
      label: "New invoice",
      group: "Create",
      icon: Plus,
      href: "/invoices?new=1",
      shortcut: "n",
      keywords: "create add invoice",
    },
    {
      id: "create-journal",
      label: "New journal entry",
      group: "Create",
      icon: Plus,
      href: "/journal?new=1",
      keywords: "create add journal entry",
    },
    {
      id: "create-receipt",
      label: "Upload receipt",
      group: "Create",
      icon: Plus,
      href: "/receipts?upload=1",
      keywords: "create add receipt expense",
    },
    {
      id: "settings-company",
      label: "Company profile",
      group: "Settings",
      icon: Settings,
      href: "/company-profile",
    },
    {
      id: "settings-team",
      label: "Team management",
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

  const workspaceTitleByPersona = new Map(
    commandReportWorkspaces.map((workspace) => [
      workspace.persona as string,
      ct("workspace", workspace.persona, "title", workspace.title),
    ])
  );
  const readyReportIds = new Set(commandReadyReports.map((report) => report.id as string));
  const localizeItem = (item: PaletteItem): PaletteItem => {
    const tt = t as Record<string, string>;
    const key = PALETTE_ITEM_KEYS[item.id];
    if (key && tt[key]) return { ...item, label: tt[key] };
    if (item.id.startsWith("report-workspace-")) {
      const persona = item.id.slice("report-workspace-".length);
      return {
        ...item,
        label: workspaceTitleByPersona.get(persona) ?? item.label,
      };
    }
    for (const [prefix, sectionKey] of PALETTE_SECTION_KEYS) {
      const persona = item.id.startsWith(prefix) ? item.id.slice(prefix.length) : null;
      if (persona && workspaceTitleByPersona.has(persona) && tt[sectionKey]) {
        return {
          ...item,
          label: formatMessage(tt[sectionKey], {
            workspace: workspaceTitleByPersona.get(persona) ?? persona,
          }),
        };
      }
    }
    for (const [prefix, kind, field] of PALETTE_CATALOG_PREFIXES) {
      if (item.id.startsWith(prefix)) {
        const id = item.id.slice(prefix.length);
        return {
          ...item,
          label: ct(kind, id, field, item.label),
        };
      }
    }
    if (item.id.startsWith("report-")) {
      const reportId = item.id.slice("report-".length);
      if (readyReportIds.has(reportId)) {
        return {
          ...item,
          label: ct("report", reportId, "name", item.label),
        };
      }
    }
    return item;
  };

  const handleSelect = (item: PaletteItem) => {
    onOpenChange(false);
    if (item.href) {
      setRecents(
        pushPaletteRecent({ id: item.id, label: item.label, href: item.href, kind: "page" })
      );
      navigate(item.href);
    }
    void item.action?.();
  };

  const tt = t as Record<string, string>;
  const recordTypeLabel: Record<PaletteRecord["kind"], string> = {
    invoice: tt["shell.cmdRecordInvoice"],
    customer: tt["shell.cmdRecordCustomer"],
    vendor: tt["shell.cmdRecordVendor"],
  };
  const recordIcon: Record<PaletteRecord["kind"], PaletteItem["icon"]> = {
    invoice: FileText,
    customer: Users,
    vendor: Store,
  };
  const recordResults = recordSearchEnabled
    ? searchPaletteRecords(trimmedSearch, {
        invoices: Array.isArray(paletteInvoicesQuery.data) ? paletteInvoicesQuery.data : [],
        customers: Array.isArray(paletteCustomersQuery.data) ? paletteCustomersQuery.data : [],
        vendors: Array.isArray(paletteVendorsQuery.data) ? paletteVendorsQuery.data : [],
      })
    : [];
  const interpreted = interpretPaletteQuery(trimmedSearch);
  const echoTemplate =
    interpreted.kind === "documentNumber"
      ? tt["shell.cmdEchoDocumentNumber"]
      : interpreted.kind === "amount"
        ? tt["shell.cmdEchoAmount"]
        : interpreted.kind === "trn"
          ? tt["shell.cmdEchoTrn"]
          : tt["shell.cmdEchoText"];
  const handleSelectRecord = (record: PaletteRecord) => {
    onOpenChange(false);
    setRecents(
      pushPaletteRecent({
        id: record.id,
        label: record.title,
        href: record.href,
        kind: record.kind,
      })
    );
    navigate(record.href);
  };
  const handleSelectRecent = (recent: PaletteRecent) => {
    onOpenChange(false);
    setRecents(pushPaletteRecent(recent));
    navigate(recent.href);
  };
  const quickActions: PaletteItem[] = [
    {
      id: "action-new-invoice",
      label: tt["shell.cmdActionNewInvoice"],
      group: "Create",
      icon: Plus,
      href: "/invoices?new=1",
      shortcut: "n",
    },
    {
      id: "action-scan-receipt",
      label: tt["shell.cmdActionScanReceipt"],
      group: "Create",
      icon: Camera,
      href: "/receipts?upload=1",
    },
    {
      id: "action-new-journal",
      label: tt["shell.cmdNewJournalEntry"],
      group: "Create",
      icon: Plus,
      href: "/journal?new=1",
    },
  ];
  const renderPaletteItem = (sourceItem: PaletteItem) => {
    // Localized label/description; the English text stays searchable via keywords.
    const item = {
      ...localizeItem(sourceItem),
      keywords: [sourceItem.label, sourceItem.description, sourceItem.keywords]
        .filter(Boolean)
        .join(" "),
    };
    const Icon = item.icon;
    return (
      <CommandItem
        key={item.id}
        value={`${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`}
        onSelect={() => handleSelect(item)}
        data-testid={`command-item-${item.id}`}
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
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
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} commandProps={{ filter: paletteFilter }}>
      <CommandInput
        placeholder={t["components.commandSearchPlaceholder"]}
        value={search}
        onValueChange={setSearch}
        data-testid="command-palette-input"
      />
      {trimmedSearch ? (
        <p
          className="border-b border-border px-3 py-2 text-caption text-muted-foreground"
          aria-live="polite"
          data-testid="command-palette-echo"
          data-query-kind={interpreted.kind}
        >
          {formatMessage(echoTemplate, { query: `\u2068${trimmedSearch}\u2069` })}
        </p>
      ) : null}
      <CommandList label={t["shell.cmdListLabel"]}>
        <CommandEmpty>{t["components.commandNoResults"]}</CommandEmpty>
        {!trimmedSearch ? (
          <>
            {/* Empty state (CTO 17): Recent, then the everyday actions, then pages. */}
            {recents.length > 0 ? (
              // Spec 3.5: recent items are chips (still cmdk options, so arrows + Enter work).
              <CommandGroup
                heading={tt["shell.cmdGroupRecent"]}
                data-testid="command-group-recent"
                className="[&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-wrap [&_[cmdk-group-items]]:gap-1.5 [&_[cmdk-group-items]]:px-1 [&_[cmdk-group-items]]:pb-1"
              >
                {recents.map((recent) => (
                  <CommandItem
                    key={`recent-${recent.id}`}
                    value={`recent ${recent.label} ${recent.id}`}
                    onSelect={() => handleSelectRecent(recent)}
                    data-testid={`command-recent-${recent.id}`}
                    className="h-8 max-w-full gap-1.5 rounded-full border border-border px-3 py-0 text-small"
                  >
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 max-w-[16rem] truncate" dir="auto">
                      {recent.label}
                    </span>
                    {recent.kind && recent.kind !== "page" ? (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {recordTypeLabel[recent.kind]}
                      </Badge>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading={tt["shell.cmdGroupActions"]} data-testid="command-group-actions">
              {quickActions.map(renderPaletteItem)}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={tt[PALETTE_GROUP_KEYS.Navigate] ?? "Navigate"}>
              {(grouped.Navigate ?? []).map(renderPaletteItem)}
            </CommandGroup>
          </>
        ) : (
          <>
            {recordResults.length > 0 ? (
              <CommandGroup
                heading={tt["shell.cmdGroupRecords"]}
                data-testid="command-group-records"
              >
                {recordResults.map((record) => {
                  const Icon = recordIcon[record.kind];
                  return (
                    <CommandItem
                      key={record.id}
                      // Records are already matched (amounts, TRNs too); carry the query so the filter keeps them.
                      value={`record ${record.id} ${record.title} ${record.subtitle ?? ""} ${trimmedSearch}`}
                      onSelect={() => handleSelectRecord(record)}
                      data-testid={`command-record-${record.id}`}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" dir="auto">
                          {record.title}
                        </span>
                        {record.subtitle ? (
                          <span
                            className="mt-0.5 block truncate text-xs text-muted-foreground"
                            dir="auto"
                          >
                            {record.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {recordTypeLabel[record.kind]}
                      </Badge>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {Object.entries(grouped).map(([group, groupItems], groupIdx) => (
              <div key={group}>
                {(groupIdx > 0 || recordResults.length > 0) && <CommandSeparator />}
                <CommandGroup
                  heading={tt[PALETTE_GROUP_KEYS[group as PaletteItem["group"]]] ?? group}
                >
                  {groupItems.map(renderPaletteItem)}
                </CommandGroup>
              </div>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
