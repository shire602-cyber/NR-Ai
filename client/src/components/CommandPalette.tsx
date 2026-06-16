import { useEffect, useState } from "react";
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
  liveReportCatalog,
  reportAutomationPlaybookHref,
  reportHref,
  reportPersonaWorkspaces,
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

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();

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
    ...reportPersonaWorkspaces.map(
      (workspace): PaletteItem => ({
        id: `report-workspace-${workspace.persona}`,
        label: workspace.title,
        group: "Reports",
        icon: reportWorkspaceIcons[workspace.icon],
        href: reportWorkspaceHref(workspace),
        keywords: workspace.commandKeywords,
      })
    ),
    ...reportPersonaWorkspaces.flatMap((workspace) =>
      workspace.automations.map(
        (playbook): PaletteItem => ({
          id: `report-automation-${playbook.id}`,
          label: `${playbook.title} - ${workspace.title}`,
          group: "Reports",
          icon: reportWorkspaceIcons[workspace.icon],
          href: reportAutomationPlaybookHref(playbook, workspace.persona),
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
    ...liveReportCatalog.map(
      (report): PaletteItem => ({
        id: `report-${report.id}`,
        label: report.name,
        group: "Reports",
        icon: reportCommandIcons[report.commandIcon],
        href: reportHref(report),
        keywords: report.commandKeywords,
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
