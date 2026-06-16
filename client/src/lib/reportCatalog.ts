export const reportTabs = [
  "pl",
  "bs",
  "vat",
  "trial",
  "sales",
  "balances",
  "expenses",
  "ledger",
  "planning",
] as const;

export const reportPersonas = ["owner", "freelancer", "accountant"] as const;

export type ReportTab = (typeof reportTabs)[number];
export type ReportPersona = (typeof reportPersonas)[number];
export type ReportStatus = "live" | "api" | "planned";
export type ReportCommandIcon =
  | "barChart"
  | "book"
  | "creditCard"
  | "fileSpreadsheet"
  | "fileText"
  | "receipt"
  | "users"
  | "wallet";
export type ReportWorkspaceIcon = "briefcase" | "clipboardCheck" | "users";

export interface ReportCatalogItem {
  id: string;
  name: string;
  category: string;
  status: ReportStatus;
  personas: ReportPersona[];
  comparison: string;
  automation: string;
  commandIcon: ReportCommandIcon;
  commandKeywords: string;
  tab?: ReportTab;
  href?: string;
}

export interface ReportAutomationPlaybook {
  id: string;
  title: string;
  trigger: string;
  reportIds: string[];
  cta: string;
  tab?: ReportTab;
  href?: string;
}

export interface ReportPersonaWorkspace {
  persona: ReportPersona;
  title: string;
  focus: string;
  primaryTab: ReportTab;
  icon: ReportWorkspaceIcon;
  commandKeywords: string;
  automations: ReportAutomationPlaybook[];
}

export const reportPersonaWorkspaces: ReportPersonaWorkspace[] = [
  {
    persona: "owner",
    title: "Owner workspace",
    focus: "Cash, profit, receivables, tax, and payroll decisions.",
    primaryTab: "balances",
    icon: "briefcase",
    commandKeywords: "reports owner cash profit receivables tax automation",
    automations: [
      {
        id: "owner-cash-collections",
        title: "Cash and collections command center",
        trigger: "Overdue receivables or cash forecast risk",
        reportIds: ["customer-balances", "ar-aging", "cash-flow-forecast"],
        cta: "Open collections",
        href: "/payment-chasing",
      },
      {
        id: "owner-vat-readiness",
        title: "VAT filing readiness",
        trigger: "Net VAT due, refund, or missing support",
        reportIds: ["vat-summary", "vat-return", "expenses-category"],
        cta: "Open VAT filing",
        href: "/vat-filing",
      },
      {
        id: "owner-spend-guardrails",
        title: "Spend and budget guardrails",
        trigger: "Budget variance or vendor balance pressure",
        reportIds: ["budget-actual", "expenses-category", "vendor-balances"],
        cta: "Open planning",
        tab: "planning",
      },
    ],
  },
  {
    persona: "freelancer",
    title: "Freelancer workspace",
    focus: "Client income, unpaid invoices, expenses, and monthly tax readiness.",
    primaryTab: "sales",
    icon: "users",
    commandKeywords: "reports freelancer invoices clients expenses vat automation",
    automations: [
      {
        id: "freelancer-invoice-followup",
        title: "Invoice follow-up lane",
        trigger: "Unpaid or overdue client invoices",
        reportIds: ["invoice-status", "revenue-customer", "customer-balances"],
        cta: "Open chasing",
        href: "/payment-chasing",
      },
      {
        id: "freelancer-monthly-tax-close",
        title: "Monthly tax and receipt close",
        trigger: "Unposted receipts or VAT-ready expenses",
        reportIds: ["expenses-vendor", "expenses-category", "vat-summary"],
        cta: "Open expenses",
        tab: "expenses",
      },
      {
        id: "freelancer-runway-snapshot",
        title: "Runway snapshot",
        trigger: "Profit movement or low cash forecast",
        reportIds: ["profit-loss", "period-comparison", "cash-flow-forecast"],
        cta: "Open planning",
        tab: "planning",
      },
    ],
  },
  {
    persona: "accountant",
    title: "Accountant workspace",
    focus: "Close workpapers, ledgers, audit trails, tax, and consolidation.",
    primaryTab: "trial",
    icon: "clipboardCheck",
    commandKeywords: "reports accountant close ledger trial balance tax automation",
    automations: [
      {
        id: "accountant-close-review",
        title: "Close review checklist",
        trigger: "Trial-balance differences or unlinked ledger sources",
        reportIds: ["trial-balance", "general-ledger", "account-transactions"],
        cta: "Open close review",
        tab: "trial",
      },
      {
        id: "accountant-tax-workpapers",
        title: "Tax workpaper readiness",
        trigger: "VAT filing support or tax-period review",
        reportIds: ["vat-summary", "vat-return", "expenses-category"],
        cta: "Open VAT filing",
        href: "/vat-filing",
      },
      {
        id: "accountant-advisory-pack",
        title: "Client advisory pack",
        trigger: "Recurring P&L, balance sheet, cash, and comparison review",
        reportIds: ["profit-loss", "balance-sheet", "cash-flow", "period-comparison"],
        cta: "Open report pack",
        tab: "pl",
      },
    ],
  },
];

export const reportCatalog: ReportCatalogItem[] = [
  {
    id: "profit-loss",
    name: "Profit & Loss",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Date range",
    automation: "Net loss review",
    tab: "pl",
    commandIcon: "barChart",
    commandKeywords: "reports pnl income statement revenue expenses",
  },
  {
    id: "balance-sheet",
    name: "Balance Sheet",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Balance review",
    tab: "bs",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports assets liabilities equity financial position",
  },
  {
    id: "vat-summary",
    name: "VAT Summary",
    category: "Tax",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Date range",
    automation: "VAT readiness",
    tab: "vat",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports tax vat output input",
  },
  {
    id: "cash-flow",
    name: "Cash Flow Statement",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Monthly/quarterly/yearly",
    automation: "Cash pressure",
    href: "/advanced-reports?tab=cashflow",
    commandIcon: "wallet",
    commandKeywords: "reports cash flow operating investing financing",
  },
  {
    id: "ar-aging",
    name: "A/R Aging",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment chasing",
    href: "/advanced-reports?tab=aging",
    commandIcon: "users",
    commandKeywords: "reports receivables aging customers overdue collections",
  },
  {
    id: "ap-aging",
    name: "A/P Aging",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment timing",
    href: "/bill-pay?tab=summary",
    commandIcon: "creditCard",
    commandKeywords: "reports payables aging vendors bills due",
  },
  {
    id: "trial-balance",
    name: "Trial Balance",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Date range",
    automation: "Difference flags",
    tab: "trial",
    commandIcon: "book",
    commandKeywords: "reports accounting debits credits close",
  },
  {
    id: "vat-return",
    name: "VAT Return",
    category: "Tax",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Tax period",
    automation: "Filing checklist",
    href: "/vat-filing",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports tax filing return fta",
  },
  {
    id: "period-comparison",
    name: "Period Comparison",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Variance review",
    href: "/advanced-reports?tab=comparison",
    commandIcon: "barChart",
    commandKeywords: "reports comparison variance prior period",
  },
  {
    id: "fx-gains-losses",
    name: "FX Gains and Losses",
    category: "Financial Statements",
    status: "live",
    personas: ["accountant"],
    comparison: "As of date",
    automation: "Exposure flags",
    href: "/exchange-rates",
    commandIcon: "wallet",
    commandKeywords: "reports foreign currency exchange gains losses",
  },
  {
    id: "general-ledger",
    name: "General Ledger",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Date range",
    automation: "Reclassification review",
    tab: "ledger",
    commandIcon: "book",
    commandKeywords: "reports ledger journal accounts accountant",
  },
  {
    id: "account-transactions",
    name: "Account Transactions",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Account drilldown",
    automation: "Missing source review",
    tab: "ledger",
    commandIcon: "book",
    commandKeywords: "reports account transactions drilldown ledger",
  },
  {
    id: "corporate-tax-estimate",
    name: "Corporate Tax Estimate",
    category: "Tax",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Tax year",
    automation: "Tax liability review",
    href: "/corporate-tax",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports corporate tax estimate liability",
  },
  {
    id: "customer-balances",
    name: "Customer Balance Summary",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Open balance",
    automation: "Collections queue",
    tab: "balances",
    commandIcon: "users",
    commandKeywords: "reports customers receivables open balance collections",
  },
  {
    id: "vendor-balances",
    name: "Vendor Balance Summary",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Open balance",
    automation: "Bill pay queue",
    tab: "balances",
    commandIcon: "creditCard",
    commandKeywords: "reports vendors payables open balance bill pay",
  },
  {
    id: "invoice-status",
    name: "Invoice Status",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Status and overdue",
    automation: "Reminder routing",
    tab: "sales",
    commandIcon: "fileText",
    commandKeywords: "reports invoices sales overdue reminders",
  },
  {
    id: "budget-actual",
    name: "Budget vs Actual",
    category: "Management",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Budget variance",
    automation: "Spend alerts",
    tab: "planning",
    commandIcon: "barChart",
    commandKeywords: "reports budget actual variance planning",
  },
  {
    id: "cash-flow-forecast",
    name: "Cash Flow Forecast",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Forecast",
    automation: "Cash warnings",
    tab: "planning",
    commandIcon: "wallet",
    commandKeywords: "reports forecast cash runway planning",
  },
  {
    id: "revenue-customer",
    name: "Revenue by Customer",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Client concentration",
    tab: "sales",
    commandIcon: "users",
    commandKeywords: "reports revenue customer concentration sales",
  },
  {
    id: "sales-product-service",
    name: "Sales by Product/Service",
    category: "Sales",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Margin",
    automation: "Margin alerts",
    href: "/invoices",
    commandIcon: "fileText",
    commandKeywords: "reports sales products services margin",
  },
  {
    id: "expenses-vendor",
    name: "Expenses by Vendor",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Spend review",
    tab: "expenses",
    commandIcon: "receipt",
    commandKeywords: "reports expenses vendors merchants spend",
  },
  {
    id: "expenses-category",
    name: "Expenses by Category",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Budget",
    automation: "Cost alerts",
    tab: "expenses",
    commandIcon: "receipt",
    commandKeywords: "reports expenses categories spend budget",
  },
  {
    id: "inventory-valuation",
    name: "Inventory Valuation",
    category: "Inventory",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Stock risk",
    href: "/inventory",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports inventory valuation stock",
  },
  {
    id: "inventory-movement",
    name: "Inventory Movement",
    category: "Inventory",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Period movement",
    automation: "Reorder alerts",
    href: "/inventory",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports inventory movement reorder",
  },
  {
    id: "fixed-asset-register",
    name: "Fixed Asset Register",
    category: "Assets",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Capitalization review",
    href: "/fixed-assets",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports fixed assets register capitalization",
  },
  {
    id: "depreciation-schedule",
    name: "Depreciation Schedule",
    category: "Assets",
    status: "planned",
    personas: ["accountant"],
    comparison: "Period",
    automation: "Posting suggestions",
    href: "/fixed-assets",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports depreciation fixed assets posting",
  },
  {
    id: "payroll-summary",
    name: "Payroll Summary",
    category: "Payroll",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Pay period",
    automation: "Variance checks",
    href: "/payroll",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports payroll summary wages",
  },
  {
    id: "wps-sif-summary",
    name: "WPS / SIF Summary",
    category: "Payroll",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Pay run",
    automation: "WPS readiness",
    href: "/payroll",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports wps sif payroll readiness",
  },
  {
    id: "expense-claims",
    name: "Expense Claims",
    category: "Purchases",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Claim status",
    automation: "Approval routing",
    href: "/expense-claims",
    commandIcon: "receipt",
    commandKeywords: "reports expense claims approval",
  },
  {
    id: "month-end-close-status",
    name: "Month-End Close Status",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Close period",
    automation: "Close checklist",
    href: "/month-end",
    commandIcon: "book",
    commandKeywords: "reports month end close checklist accountant",
  },
  {
    id: "audit-trail",
    name: "Audit Trail",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Activity period",
    automation: "Risk summary",
    href: "/history",
    commandIcon: "book",
    commandKeywords: "reports audit trail history risk",
  },
  {
    id: "consolidated-statements",
    name: "Consolidated Statements",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Multi-company",
    automation: "Report packs",
    href: "/financial-statements",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports consolidated statements multi company",
  },
];

export const liveReportCatalog = reportCatalog.filter((report) => report.status === "live");

export function reportsHref(
  options: {
    tab?: ReportTab;
    persona?: ReportPersona | "all";
  } = {}
): string {
  const params = new URLSearchParams();
  if (options.tab) params.set("tab", options.tab);
  if (options.persona && options.persona !== "all") params.set("persona", options.persona);

  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export function reportHref(report: Pick<ReportCatalogItem, "href" | "tab">): string | undefined {
  return report.href ?? (report.tab ? reportsHref({ tab: report.tab }) : undefined);
}

export function reportWorkspaceHref(
  workspace: Pick<ReportPersonaWorkspace, "persona" | "primaryTab">
): string {
  return reportsHref({ tab: workspace.primaryTab, persona: workspace.persona });
}

export function reportAutomationPlaybookHref(
  playbook: Pick<ReportAutomationPlaybook, "href" | "tab">,
  persona?: ReportPersona
): string {
  return playbook.href ?? reportsHref({ tab: playbook.tab, persona });
}
