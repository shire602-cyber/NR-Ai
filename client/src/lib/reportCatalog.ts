export const reportTabs = [
  "pl",
  "bs",
  "vat",
  "tax",
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
export type ReportSection = "recommendations" | "pack-readiness" | "pack-automation";
export type ReportStatus = "live" | "api" | "planned";
export type ReportRoadmapImpact = "high" | "medium" | "low";
export type ReportAutomationHealthVariant = "success" | "warning" | "danger";
export type ReportAutomationHealthTrendDirection = "up" | "down" | "flat" | "new";
export type ReportAutomationHealthTrendVariant = "success" | "warning" | "neutral" | "info";
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
  roadmapPrerequisites?: {
    dataSource: string;
    workflowDependency: string;
    automationRule: string;
  };
  roadmapPriority?: {
    score: number;
    impactByPersona: Partial<Record<ReportPersona, ReportRoadmapImpact>>;
    rationale: string;
  };
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

export interface ReportPackSchedule {
  cadence: string;
  delivery: string;
  recipients: string;
  trigger: string;
  automation: string;
}

export interface ReportPersonaWorkspace {
  persona: ReportPersona;
  title: string;
  navLabel: string;
  focus: string;
  primaryTab: ReportTab;
  icon: ReportWorkspaceIcon;
  commandKeywords: string;
  packSchedule: ReportPackSchedule;
  automations: ReportAutomationPlaybook[];
}

export interface ReportAutomationHealthInput {
  readinessPercent: number;
  automationLaneCount: number;
  comparisonMetricCount?: number;
  comparisonWarningCount?: number;
  plannedReportCount?: number;
  reviewSignalCount?: number;
  automationLaneTarget?: number;
}

export interface ReportAutomationHealth {
  score: number;
  label: string;
  variant: ReportAutomationHealthVariant;
  readinessScore: number;
  automationLaneScore: number;
  comparisonScore: number;
  comparisonWarnings: number;
  reviewSignals: number;
}

export interface ReportAutomationHealthSnapshot extends ReportAutomationHealth {
  persona: ReportPersona;
  capturedAt: string;
  capturedDate: string;
}

export interface ReportAutomationHealthTrend {
  direction: ReportAutomationHealthTrendDirection;
  variant: ReportAutomationHealthTrendVariant;
  label: string;
  detail: string;
  currentScore: number;
  previousScore: number | null;
  delta: number;
  previousCapturedAt: string | null;
}

export const reportPersonaWorkspaces: ReportPersonaWorkspace[] = [
  {
    persona: "owner",
    title: "Owner workspace",
    navLabel: "Owner Reports",
    focus: "Cash, profit, receivables, tax, and payroll decisions.",
    primaryTab: "balances",
    icon: "briefcase",
    commandKeywords: "reports owner cash profit receivables tax automation",
    packSchedule: {
      cadence: "Weekly Monday morning plus month-end close",
      delivery: "Excel or Google Sheets pack",
      recipients: "Business owner and finance admin",
      trigger: "Refresh after bank, invoices, bills, receipts, and VAT reports are updated.",
      automation: "Send when collections, VAT, or cash warnings are open.",
    },
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
        title: "Tax filing readiness",
        trigger: "VAT due, corporate tax payable, or missing support",
        reportIds: ["vat-summary", "vat-return", "corporate-tax-estimate", "expenses-category"],
        cta: "Open tax reports",
        tab: "tax",
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
    navLabel: "Freelancer Reports",
    focus: "Client income, unpaid invoices, expenses, and monthly tax readiness.",
    primaryTab: "sales",
    icon: "users",
    commandKeywords: "reports freelancer invoices clients expenses vat automation",
    packSchedule: {
      cadence: "Weekly client follow-up plus monthly tax close",
      delivery: "Google Sheets pack for mobile review",
      recipients: "Freelancer or solo operator",
      trigger: "Refresh after invoice activity, receipt posting, and VAT summary update.",
      automation: "Send when unpaid invoices, unposted receipts, or runway alerts are open.",
    },
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
    navLabel: "Accountant Reports",
    focus: "Close workpapers, ledgers, audit trails, tax, and consolidation.",
    primaryTab: "trial",
    icon: "clipboardCheck",
    commandKeywords: "reports accountant close ledger trial balance tax automation",
    packSchedule: {
      cadence: "Month-end close plus client advisory review",
      delivery: "Excel workpaper pack and Google Sheets advisory pack",
      recipients: "Accountant, reviewer, and client owner",
      trigger: "Refresh after journals, trial balance, VAT, and comparison reports are reviewed.",
      automation: "Send when close review, tax workpaper, or advisory-pack checks are open.",
    },
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
        trigger: "VAT filing support or corporate-tax review",
        reportIds: ["vat-summary", "vat-return", "corporate-tax-estimate", "expenses-category"],
        cta: "Open tax estimate",
        tab: "tax",
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
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Tax year",
    automation: "Tax liability review",
    tab: "tax",
    roadmapPrerequisites: {
      dataSource: "Finalized P&L, deductible expense mapping, and UAE corporate tax settings.",
      workflowDependency: "Corporate Tax workspace with tax-year configuration and adjustments.",
      automationRule:
        "Flag taxable-profit thresholds, disallowed expenses, and filing-deadline risk.",
    },
    roadmapPriority: {
      score: 95,
      impactByPersona: { owner: "high", accountant: "high" },
      rationale: "High-stakes tax planning and filing visibility for owners and advisors.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Invoice line items with product/service, quantity, subtotal, and margin inputs.",
      workflowDependency: "Invoice item catalog and product/service tagging in Invoices.",
      automationRule: "Alert on low margin, top service concentration, and missing item tags.",
    },
    roadmapPriority: {
      score: 82,
      impactByPersona: { owner: "high", accountant: "medium" },
      rationale: "Improves revenue mix visibility and margin automation for owner decisions.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Inventory items, on-hand quantity, unit cost, and valuation method.",
      workflowDependency: "Inventory item master with cost and stock-count reconciliation.",
      automationRule: "Flag negative stock, stale valuation, and valuation-method mismatches.",
    },
    roadmapPriority: {
      score: 78,
      impactByPersona: { owner: "medium", accountant: "high" },
      rationale: "Unlocks stock valuation, balance sheet support, and accountant review controls.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Stock receipts, issues, transfers, and adjustments linked to each item.",
      workflowDependency: "Inventory movement ledger with reorder points and item categories.",
      automationRule: "Trigger reorder and shrinkage alerts when movement breaches thresholds.",
    },
    roadmapPriority: {
      score: 72,
      impactByPersona: { owner: "medium", accountant: "medium" },
      rationale: "Adds operational stock movement visibility after valuation foundations exist.",
    },
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
    roadmapPrerequisites: {
      dataSource:
        "Asset records with purchase date, cost, category, location, and disposal status.",
      workflowDependency: "Fixed Assets workspace with capitalization policy and asset tagging.",
      automationRule: "Review purchases above capitalization thresholds and missing asset fields.",
    },
    roadmapPriority: {
      score: 80,
      impactByPersona: { owner: "medium", accountant: "high" },
      rationale: "Creates the asset subledger needed for depreciation and close workpapers.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Fixed asset register with depreciation method, useful life, and residual value.",
      workflowDependency:
        "Fixed Assets depreciation setup and journal-posting destination accounts.",
      automationRule: "Suggest monthly depreciation journals and flag assets missing methods.",
    },
    roadmapPriority: {
      score: 74,
      impactByPersona: { accountant: "high" },
      rationale: "Turns fixed asset setup into repeatable close automation for accountants.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Approved pay runs, employee cost centers, allowances, and deductions.",
      workflowDependency: "Payroll workspace with employee profiles and pay-run approvals.",
      automationRule:
        "Flag payroll variance, missing approvals, and unexpected employee-cost movement.",
    },
    roadmapPriority: {
      score: 86,
      impactByPersona: { owner: "high", accountant: "medium" },
      rationale: "Payroll is a high-frequency cost center with strong owner cash-flow impact.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Payroll runs with WPS employee identifiers, bank routing, and SIF fields.",
      workflowDependency: "Payroll WPS configuration with employee bank validation.",
      automationRule: "Block SIF export when required WPS or bank fields are incomplete.",
    },
    roadmapPriority: {
      score: 88,
      impactByPersona: { owner: "high", accountant: "high" },
      rationale: "UAE payroll compliance and SIF readiness are critical automation gaps.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Submitted claims, receipts, approval state, and reimbursement account mapping.",
      workflowDependency:
        "Expense Claims workflow with approver routing and reimbursement posting.",
      automationRule: "Route stale claims, duplicate receipts, and policy exceptions for review.",
    },
    roadmapPriority: {
      score: 70,
      impactByPersona: { owner: "medium", accountant: "medium" },
      rationale: "Improves spend governance once receipts and approval routing are active.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Close tasks, reconciliations, trial-balance checks, and reviewer assignments.",
      workflowDependency: "Month-End workspace with task templates and period lock controls.",
      automationRule: "Escalate overdue close tasks and unresolved reconciliation exceptions.",
    },
    roadmapPriority: {
      score: 92,
      impactByPersona: { accountant: "high" },
      rationale:
        "Month-end status is the strongest accountant workflow unlock for close automation.",
    },
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
    roadmapPrerequisites: {
      dataSource: "User activity logs, journal changes, invoice/bill edits, and approval events.",
      workflowDependency: "History activity stream with entity-level mutation tracking.",
      automationRule: "Summarize unusual edits, privileged actions, and post-close changes.",
    },
    roadmapPriority: {
      score: 76,
      impactByPersona: { accountant: "high" },
      rationale: "Audit evidence improves reviewer confidence and post-close exception handling.",
    },
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
    roadmapPrerequisites: {
      dataSource: "Multi-company chart mapping, ownership rules, eliminations, and period locks.",
      workflowDependency: "Financial Statements workspace with consolidation mappings.",
      automationRule: "Flag unmapped accounts, intercompany balances, and missing company closes.",
    },
    roadmapPriority: {
      score: 84,
      impactByPersona: { accountant: "high" },
      rationale: "Consolidation expands accountant advisory packs for multi-entity clients.",
    },
    href: "/financial-statements",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports consolidated statements multi company",
  },
];

export const liveReportCatalog = reportCatalog.filter((report) => report.status === "live");

export const REPORT_PERSONA_PREFERENCE_KEY = "nr_ai.report_persona";
export const REPORT_AUTOMATION_HEALTH_HISTORY_KEY = "nr_ai.report_automation_health_history";

export function parseReportPersona(value: string | null | undefined): ReportPersona | null {
  return reportPersonas.includes(value as ReportPersona) ? (value as ReportPersona) : null;
}

export function getPreferredReportPersona(): ReportPersona | null {
  if (typeof window === "undefined") return null;

  try {
    return parseReportPersona(window.localStorage.getItem(REPORT_PERSONA_PREFERENCE_KEY));
  } catch {
    return null;
  }
}

export function setPreferredReportPersona(persona: ReportPersona): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(REPORT_PERSONA_PREFERENCE_KEY, persona);
  } catch {}
}

export function clearPreferredReportPersona(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(REPORT_PERSONA_PREFERENCE_KEY);
  } catch {}
}

const reportSectionAnchors: Record<ReportSection, string> = {
  recommendations: "recommended-reports-title",
  "pack-readiness": "report-pack-readiness-title",
  "pack-automation": "report-pack-automation-title",
};

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

export function reportSectionHref(
  workspace: Pick<ReportPersonaWorkspace, "persona" | "primaryTab">,
  section: ReportSection
): string {
  return `${reportWorkspaceHref(workspace)}#${reportSectionAnchors[section]}`;
}

export function reportAutomationPlaybookHref(
  playbook: Pick<ReportAutomationPlaybook, "href" | "tab">,
  persona?: ReportPersona
): string {
  return playbook.href ?? reportsHref({ tab: playbook.tab, persona });
}

function clampReportScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateReportAutomationHealth(
  input: ReportAutomationHealthInput
): ReportAutomationHealth {
  const comparisonMetricCount = Math.max(0, input.comparisonMetricCount ?? 0);
  const comparisonWarnings = Math.max(0, input.comparisonWarningCount ?? 0);
  const automationLaneTarget = Math.max(1, input.automationLaneTarget ?? 3);
  const readinessScore = clampReportScore(input.readinessPercent);
  const automationLaneScore = clampReportScore(
    (Math.max(0, input.automationLaneCount) / automationLaneTarget) * 100
  );
  const comparisonScore = comparisonMetricCount
    ? clampReportScore(
        ((comparisonMetricCount - Math.min(comparisonWarnings, comparisonMetricCount)) /
          comparisonMetricCount) *
          100
      )
    : 100;
  const score = clampReportScore(
    readinessScore * 0.6 + automationLaneScore * 0.2 + comparisonScore * 0.2
  );
  const variant: ReportAutomationHealthVariant =
    score >= 85 ? "success" : score >= 65 ? "warning" : "danger";

  return {
    score,
    label:
      variant === "success"
        ? "Ready to automate"
        : variant === "warning"
          ? "Review signals"
          : "Needs setup",
    variant,
    readinessScore,
    automationLaneScore,
    comparisonScore,
    comparisonWarnings,
    reviewSignals:
      input.reviewSignalCount ?? comparisonWarnings + Math.max(0, input.plannedReportCount ?? 0),
  };
}

function isReportAutomationHealthVariant(value: unknown): value is ReportAutomationHealthVariant {
  return value === "success" || value === "warning" || value === "danger";
}

function normalizeHealthCapturedAt(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function parseReportAutomationHealthHistory(
  value: string | null | undefined
): ReportAutomationHealthSnapshot[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): ReportAutomationHealthSnapshot | null => {
        const persona = parseReportPersona(item?.persona);
        const score = Number(item?.score);
        const readinessScore = Number(item?.readinessScore);
        const automationLaneScore = Number(item?.automationLaneScore);
        const comparisonScore = Number(item?.comparisonScore);
        const comparisonWarnings = Number(item?.comparisonWarnings);
        const reviewSignals = Number(item?.reviewSignals);
        const capturedAt = normalizeHealthCapturedAt(item?.capturedAt);
        const variant = isReportAutomationHealthVariant(item?.variant) ? item.variant : null;

        if (
          !persona ||
          !variant ||
          !Number.isFinite(score) ||
          !Number.isFinite(readinessScore) ||
          !Number.isFinite(automationLaneScore) ||
          !Number.isFinite(comparisonScore) ||
          !Number.isFinite(comparisonWarnings) ||
          !Number.isFinite(reviewSignals)
        ) {
          return null;
        }

        return {
          persona,
          score: clampReportScore(score),
          label: String(item?.label || "Recorded"),
          variant,
          readinessScore: clampReportScore(readinessScore),
          automationLaneScore: clampReportScore(automationLaneScore),
          comparisonScore: clampReportScore(comparisonScore),
          comparisonWarnings: Math.max(0, Math.round(comparisonWarnings)),
          reviewSignals: Math.max(0, Math.round(reviewSignals)),
          capturedAt,
          capturedDate: capturedAt.slice(0, 10),
        };
      })
      .filter((item): item is ReportAutomationHealthSnapshot => Boolean(item));
  } catch {
    return [];
  }
}

export function getReportAutomationHealthHistory(): ReportAutomationHealthSnapshot[] {
  if (typeof window === "undefined") return [];

  try {
    return parseReportAutomationHealthHistory(
      window.localStorage.getItem(REPORT_AUTOMATION_HEALTH_HISTORY_KEY)
    );
  } catch {
    return [];
  }
}

export function recordReportAutomationHealthSnapshots(
  snapshots: Array<{
    persona: ReportPersona;
    health: ReportAutomationHealth;
    capturedAt?: string;
  }>
): ReportAutomationHealthSnapshot[] {
  const existing = getReportAutomationHealthHistory();
  const next = [...existing];

  for (const snapshot of snapshots) {
    const capturedAt = normalizeHealthCapturedAt(snapshot.capturedAt);
    const capturedDate = capturedAt.slice(0, 10);
    const normalized: ReportAutomationHealthSnapshot = {
      ...snapshot.health,
      persona: snapshot.persona,
      capturedAt,
      capturedDate,
    };
    const sameDayIndex = next.findIndex(
      (item) => item.persona === snapshot.persona && item.capturedDate === capturedDate
    );

    if (sameDayIndex >= 0) {
      next[sameDayIndex] = normalized;
    } else {
      next.push(normalized);
    }
  }

  const trimmed = reportPersonas.flatMap((persona) =>
    next
      .filter((item) => item.persona === persona)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .slice(-14)
  );

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(REPORT_AUTOMATION_HEALTH_HISTORY_KEY, JSON.stringify(trimmed));
    } catch {}
  }

  return trimmed;
}

export function buildReportAutomationHealthTrend(
  history: ReportAutomationHealthSnapshot[],
  persona: ReportPersona,
  current: ReportAutomationHealth,
  capturedAt = new Date().toISOString()
): ReportAutomationHealthTrend {
  const capturedDate = normalizeHealthCapturedAt(capturedAt).slice(0, 10);
  const previous = history
    .filter((item) => item.persona === persona && item.capturedDate < capturedDate)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];

  if (!previous) {
    return {
      direction: "new",
      variant: "info",
      label: "Baseline captured",
      detail: "First saved automation-health snapshot for this workspace.",
      currentScore: current.score,
      previousScore: null,
      delta: 0,
      previousCapturedAt: null,
    };
  }

  const delta = current.score - previous.score;
  const direction: ReportAutomationHealthTrendDirection =
    Math.abs(delta) < 1 ? "flat" : delta > 0 ? "up" : "down";

  return {
    direction,
    variant: direction === "up" ? "success" : direction === "down" ? "warning" : "neutral",
    label: direction === "up" ? "Improved" : direction === "down" ? "Needs attention" : "Stable",
    detail: `${delta >= 0 ? "+" : ""}${delta} points since ${previous.capturedDate}.`,
    currentScore: current.score,
    previousScore: previous.score,
    delta,
    previousCapturedAt: previous.capturedAt,
  };
}
