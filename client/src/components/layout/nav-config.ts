import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BellRing,
  BookMarked,
  BookOpen,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  CalendarDays,
  Camera,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileCode2,
  FileMinus,
  FileSearch,
  FileSignature,
  FileText,
  FolderOpen,
  Gauge,
  History,
  Inbox,
  Landmark,
  Layers,
  MailPlus,
  MessagesSquare,
  Package,
  Percent,
  PiggyBank,
  ReceiptText,
  Repeat,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Upload,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { SETTINGS_ROUTES } from "@/components/layout/settings-nav";

/**
 * Navigation config shared by the desktop sidebar (AppSidebar) and the mobile More sheet
 * (MobileNav), so both always show the same groups, labels and order.
 */
export interface NavSubItem {
  key?: string;
  titleKey: string;
  url: string;
  title?: string;
  description?: string;
  testId?: string;
  /** Other routes that highlight this item (pages that became tabs of it). */
  matches?: string[];
  /** 20 px icon for the mobile More sheet rows. */
  icon?: LucideIcon;
}

export interface NavGroup {
  key: string;
  titleKey: string;
  icon: LucideIcon;
  items: NavSubItem[];
  url?: string;
  /** Direct items: other routes that highlight this entry. */
  matches?: string[];
}

// WP-A (Fable spec 3.5): no group exceeds 7 items; labels are short sentence case
// (`shell.nav.*`); single destinations are direct items. `testId` keeps the data-testids the
// links had before the regroup (`link-<testId>`). Pages that left the sidebar stay routed and
// are reached from their parent page (tabs), the settings sub-nav or the command palette.
export const CUSTOMER_GROUPS: NavGroup[] = [
  {
    key: "sales",
    titleKey: "shell.nav.sales",
    icon: TrendingUp,
    items: [
      { titleKey: "shell.nav.invoices", url: "/invoices", icon: FileText, testId: "invoices" },
      { titleKey: "shell.nav.quotes", url: "/quotes", icon: FileSignature, testId: "quotes" },
      {
        titleKey: "shell.nav.creditNotes",
        url: "/credit-notes",
        icon: FileMinus,
        testId: "creditNotes",
      },
      {
        titleKey: "shell.nav.recurring",
        url: "/recurring-invoices",
        icon: Repeat,
        testId: "recurringInvoices",
      },
      { titleKey: "shell.nav.customers", url: "/contacts", icon: Users, testId: "contacts" },
      {
        titleKey: "shell.nav.paymentReminders",
        url: "/payment-chasing",
        icon: BellRing,
        testId: "paymentChasing",
      },
    ],
  },
  {
    key: "purchases",
    titleKey: "shell.nav.purchases",
    icon: ShoppingCart,
    items: [
      { titleKey: "shell.nav.bills", url: "/bill-pay", icon: ReceiptText, testId: "billPay" },
      {
        titleKey: "shell.nav.receipts",
        url: "/receipts",
        icon: Camera,
        testId: "receipts",
        matches: ["/receipt-autopilot"],
      },
      { titleKey: "shell.nav.suppliers", url: "/vendors", icon: Truck, testId: "pages.vendor" },
      {
        titleKey: "shell.nav.purchaseOrders",
        url: "/purchase-orders",
        icon: ClipboardCheck,
        testId: "purchaseOrders",
      },
      {
        titleKey: "shell.nav.expenseClaims",
        url: "/expense-claims",
        icon: Wallet,
        testId: "expenseClaims",
      },
    ],
  },
  {
    key: "inventory",
    titleKey: "shell.nav.inventory",
    icon: Package,
    url: "/inventory",
    items: [],
  },
  {
    key: "banking",
    titleKey: "shell.nav.banking",
    icon: Landmark,
    items: [
      {
        titleKey: "shell.nav.bankAccounts",
        url: "/bank-accounts",
        icon: Landmark,
        testId: "banking.accounts.title",
        // The bank connection route highlights Accounts and offers CSV import when unconfigured.
        matches: ["/bank-feeds"],
      },
      {
        titleKey: "shell.nav.reconciliation",
        url: "/bank-reconciliation",
        icon: ArrowLeftRight,
        testId: "bankReconciliation",
        matches: ["/bank-feeds", "/reconciliation-rules", "/auto-reconcile"],
      },
    ],
  },
  {
    key: "accounting",
    titleKey: "shell.nav.accounting",
    icon: BookMarked,
    items: [
      {
        titleKey: "shell.nav.chartOfAccounts",
        url: "/chart-of-accounts",
        icon: BookOpen,
        testId: "chartOfAccounts",
      },
      { titleKey: "shell.nav.journal", url: "/journal", icon: BookMarked, testId: "journal" },
      {
        titleKey: "shell.nav.fixedAssets",
        url: "/fixed-assets",
        icon: Building,
        testId: "fixedAssets",
      },
      { titleKey: "shell.nav.budgets", url: "/budgets", icon: PiggyBank, testId: "budgets" },
      {
        titleKey: "shell.nav.costCentres",
        url: "/cost-centers",
        icon: Layers,
        testId: "costCenters",
      },
      {
        titleKey: "shell.nav.exchangeRates",
        url: "/exchange-rates",
        icon: Coins,
        testId: "exchangeRates",
      },
      {
        titleKey: "shell.nav.monthEnd",
        url: "/month-end",
        icon: CalendarCheck,
        testId: "monthEndClose",
      },
    ],
  },
  {
    key: "reports",
    titleKey: "shell.nav.reports",
    icon: BarChart3,
    url: "/reports",
    // Analytics became the Insights tab of Reports (WP-D); the old routes redirect.
    matches: ["/analytics", "/advanced-analytics", "/advanced-reports", "/cashflow-forecast"],
    items: [],
  },
  {
    key: "compliance",
    titleKey: "shell.nav.tax",
    icon: ClipboardList,
    items: [
      {
        titleKey: "shell.nav.vat",
        url: "/vat-filing",
        icon: Percent,
        testId: "vatFiling",
        matches: ["/vat-autopilot"],
      },
      {
        titleKey: "shell.nav.badDebtRelief",
        url: "/vat-bad-debt-relief",
        icon: ReceiptText,
        testId: "vatBadDebtRelief",
      },
      {
        titleKey: "shell.nav.corporateTax",
        url: "/corporate-tax",
        icon: Building2,
        testId: "corporateTax",
      },
      {
        titleKey: "shell.nav.einvoicing",
        url: "/settings/einvoicing",
        icon: FileCode2,
        testId: "einvoicing-settings",
      },
      {
        titleKey: "shell.nav.calendar",
        url: "/compliance-calendar",
        icon: CalendarDays,
        testId: "complianceCalendar",
        matches: ["/task-center"],
      },
      {
        titleKey: "shell.nav.filedReturns",
        url: "/tax-return-archive",
        icon: Archive,
        testId: "taxReturnArchive",
      },
      {
        titleKey: "shell.nav.evidence",
        url: "/evidence-center",
        icon: ShieldCheck,
        testId: "evidenceCenter",
      },
    ],
  },
  {
    key: "payroll",
    titleKey: "shell.nav.payroll",
    icon: Banknote,
    url: "/payroll",
    items: [],
  },
  {
    key: "ai",
    titleKey: "shell.nav.assistant",
    icon: Sparkles,
    url: "/assistant",
    matches: ["/ai"],
    items: [],
  },
];

// Settings is one entry that opens the settings area (left sub-nav, SettingsLayout).
export const SETTINGS_GROUP: NavGroup = {
  key: "settings",
  titleKey: "shell.nav.settings",
  icon: Settings,
  url: "/settings/company",
  matches: SETTINGS_ROUTES,
  items: [],
};

export const NRA_GROUP: NavGroup = {
  key: "nra",
  titleKey: "shell.nav.practice",
  icon: Briefcase,
  items: [
    {
      titleKey: "shell.nav.commandCentre",
      url: "/firm/command-center",
      icon: Gauge,
      testId: "firmCommandCenter",
      matches: ["/firm/health", "/firm/value-ops", "/firm/analytics", "/firm/pipeline"],
    },
    { titleKey: "shell.nav.clients", url: "/firm/clients", icon: Users, testId: "clientPortfolio" },
    {
      titleKey: "shell.nav.practiceWork",
      url: "/firm/practice",
      icon: Briefcase,
      testId: "firm.practiceWorkspace",
    },
    { titleKey: "shell.nav.staff", url: "/firm/staff", icon: UserCog, testId: "staffManagement" },
    {
      titleKey: "shell.nav.communications",
      url: "/firm/comms",
      icon: MessagesSquare,
      testId: "communications",
    },
    {
      titleKey: "shell.nav.documentChasing",
      url: "/firm/document-chasing",
      icon: FileSearch,
      testId: "documentChasing",
    },
    {
      titleKey: "shell.nav.emailIntake",
      url: "/firm/email-intake",
      icon: Inbox,
      testId: "emailIntake",
    },
  ],
};

export const ADMIN_GROUP: NavGroup = {
  key: "admin",
  titleKey: "shell.nav.admin",
  icon: Shield,
  items: [
    {
      titleKey: "shell.nav.adminOverview",
      url: "/admin/dashboard",
      icon: Gauge,
      testId: "adminDashboard",
    },
    {
      titleKey: "shell.nav.adminUsers",
      url: "/admin/users",
      icon: Users,
      testId: "userManagement",
    },
    {
      titleKey: "shell.nav.adminInvitations",
      url: "/admin/invitations",
      icon: MailPlus,
      testId: "userInvitations",
    },
    {
      titleKey: "shell.nav.adminDocuments",
      url: "/admin/documents",
      icon: FolderOpen,
      testId: "clientDocuments",
    },
    {
      titleKey: "shell.nav.adminImport",
      url: "/admin/import",
      icon: Upload,
      testId: "clientImport",
    },
    {
      titleKey: "shell.nav.adminActivity",
      url: "/admin/activity-logs",
      icon: History,
      testId: "activityLogs",
    },
  ],
};

/** Every group, for resolving which group owns a route. */
export const ALL_NAV_GROUPS: NavGroup[] = [
  ...CUSTOMER_GROUPS,
  NRA_GROUP,
  ADMIN_GROUP,
  SETTINGS_GROUP,
];

export function routeMatchesItem(location: string, itemUrl: string): boolean {
  if (location === itemUrl || location.startsWith(itemUrl + "/")) return true;
  if (itemUrl.includes("?")) return location.startsWith(itemUrl + "&");
  return location.startsWith(itemUrl + "?");
}

export function itemIsActive(
  location: string,
  item: { url?: string; matches?: string[] }
): boolean {
  return [...(item.url ? [item.url] : []), ...(item.matches ?? [])].some((url) =>
    routeMatchesItem(location, url)
  );
}

export function groupIsActive(location: string, group: NavGroup): boolean {
  return group.url
    ? itemIsActive(location, group)
    : group.items.some((item) => itemIsActive(location, item));
}

export function getGroupForRoute(location: string, groups: NavGroup[]): string | null {
  return groups.find((group) => groupIsActive(location, group))?.key ?? null;
}
