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
} from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/lib/commandPalette";

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
    {
      id: "report-profit-loss",
      label: "Profit & Loss",
      group: "Reports",
      icon: BarChart3,
      href: "/reports?tab=pl",
      keywords: "reports pnl income statement revenue expenses",
    },
    {
      id: "report-balance-sheet",
      label: "Balance Sheet",
      group: "Reports",
      icon: FileSpreadsheet,
      href: "/reports?tab=bs",
      keywords: "reports assets liabilities equity financial position",
    },
    {
      id: "report-vat-summary",
      label: "VAT Summary",
      group: "Reports",
      icon: FileSpreadsheet,
      href: "/reports?tab=vat",
      keywords: "reports tax vat output input",
    },
    {
      id: "report-cash-flow",
      label: "Cash Flow Statement",
      group: "Reports",
      icon: Wallet,
      href: "/advanced-reports?tab=cashflow",
      keywords: "reports cash flow operating investing financing",
    },
    {
      id: "report-ar-aging",
      label: "A/R Aging",
      group: "Reports",
      icon: Users,
      href: "/advanced-reports?tab=aging",
      keywords: "reports receivables aging customers overdue collections",
    },
    {
      id: "report-ap-aging",
      label: "A/P Aging",
      group: "Reports",
      icon: CreditCard,
      href: "/bill-pay?tab=summary",
      keywords: "reports payables aging vendors bills due",
    },
    {
      id: "report-trial-balance",
      label: "Trial Balance",
      group: "Reports",
      icon: BookMarked,
      href: "/reports?tab=trial",
      keywords: "reports accounting debits credits close",
    },
    {
      id: "report-vat-return",
      label: "VAT Return",
      group: "Reports",
      icon: FileSpreadsheet,
      href: "/vat-filing",
      keywords: "reports tax filing return fta",
    },
    {
      id: "report-period-comparison",
      label: "Period Comparison",
      group: "Reports",
      icon: BarChart3,
      href: "/advanced-reports?tab=comparison",
      keywords: "reports comparison variance prior period",
    },
    {
      id: "report-fx-gains-losses",
      label: "FX Gains and Losses",
      group: "Reports",
      icon: Wallet,
      href: "/exchange-rates",
      keywords: "reports foreign currency exchange gains losses",
    },
    {
      id: "report-general-ledger",
      label: "General Ledger",
      group: "Reports",
      icon: BookMarked,
      href: "/reports?tab=ledger",
      keywords: "reports ledger journal accounts accountant",
    },
    {
      id: "report-account-transactions",
      label: "Account Transactions",
      group: "Reports",
      icon: BookMarked,
      href: "/reports?tab=ledger",
      keywords: "reports account transactions drilldown ledger",
    },
    {
      id: "report-customer-balances",
      label: "Customer Balance Summary",
      group: "Reports",
      icon: Users,
      href: "/reports?tab=balances",
      keywords: "reports customers receivables open balance collections",
    },
    {
      id: "report-vendor-balances",
      label: "Vendor Balance Summary",
      group: "Reports",
      icon: CreditCard,
      href: "/reports?tab=balances",
      keywords: "reports vendors payables open balance bill pay",
    },
    {
      id: "report-invoice-status",
      label: "Invoice Status",
      group: "Reports",
      icon: FileText,
      href: "/reports?tab=sales",
      keywords: "reports invoices sales overdue reminders",
    },
    {
      id: "report-budget-actual",
      label: "Budget vs Actual",
      group: "Reports",
      icon: BarChart3,
      href: "/reports?tab=planning",
      keywords: "reports budget actual variance planning",
    },
    {
      id: "report-cash-flow-forecast",
      label: "Cash Flow Forecast",
      group: "Reports",
      icon: Wallet,
      href: "/reports?tab=planning",
      keywords: "reports forecast cash runway planning",
    },
    {
      id: "report-revenue-customer",
      label: "Revenue by Customer",
      group: "Reports",
      icon: Users,
      href: "/reports?tab=sales",
      keywords: "reports revenue customer concentration sales",
    },
    {
      id: "report-expenses-vendor",
      label: "Expenses by Vendor",
      group: "Reports",
      icon: Receipt,
      href: "/reports?tab=expenses",
      keywords: "reports expenses vendors merchants spend",
    },
    {
      id: "report-expenses-category",
      label: "Expenses by Category",
      group: "Reports",
      icon: Receipt,
      href: "/reports?tab=expenses",
      keywords: "reports expenses categories spend budget",
    },
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
