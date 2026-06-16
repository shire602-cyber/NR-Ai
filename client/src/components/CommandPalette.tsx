import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/commandPalette";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  liveReportCatalog,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportAutomationPlaybookHref,
  reportHref,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportWorkspaceHref,
  type ReportCommandIcon,
  type ReportWorkspaceIcon,
} from "@/lib/reportCatalog";

interface PaletteItem {
  id: string;
  label: string;
  group: "Navigate" | "Reports" | "Create" | "Settings";
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  action?: () => void;
  shortcut?: string;
  keywords?: string;
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

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();
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
  const commandLiveReports = (syncedReportCatalog?.reports ?? liveReportCatalog).filter(
    (report) => report.status === "live"
  );

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
    ...commandPackTemplates.map((template): PaletteItem => {
      const workspace = commandReportWorkspaces.find((item) => item.persona === template.persona);
      return {
        id: `report-pack-template-${template.id}`,
        label: template.title,
        group: "Reports",
        icon: workspace ? reportWorkspaceIcons[workspace.icon] : FileSpreadsheet,
        href: syncedHref(template) ?? reportPackTemplateHref(template),
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
        keywords: [
          preset.commandKeywords,
          preset.question,
          preset.baseline,
          preset.automationTrigger,
          "comparison preset report pack",
        ].join(" "),
      };
    }),
    ...commandReportWorkspaces.flatMap((workspace): PaletteItem[] => [
      {
        id: `report-automation-operations-${workspace.persona}`,
        label: `Report automation operations - ${workspace.title}`,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportSectionHref(workspace, "automation-operations"),
        keywords: `${workspace.commandKeywords} operations control room readiness delivery failures automation health next action`,
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
    ...commandLiveReports.map(
      (report): PaletteItem => ({
        id: `report-${report.id}`,
        label: report.name,
        group: "Reports",
        icon: reportCommandIcons[report.commandIcon],
        href: report.href ?? reportHref({ href: undefined, tab: report.tab }),
        keywords: `${report.commandKeywords} ${report.decisionQuestion}`,
      })
    ),
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

  const grouped = items.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  const handleSelect = (item: PaletteItem) => {
    onOpenChange(false);
    if (item.href) navigate(item.href);
    item.action?.();
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
                    value={`${item.label} ${item.keywords ?? ""}`}
                    onSelect={() => handleSelect(item)}
                    data-testid={`command-item-${item.id}`}
                  >
                    <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{item.label}</span>
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
