export const reportTabs = [
  "pl",
  "bs",
  "vat",
  "tax",
  "trial",
  "sales",
  "balances",
  "expenses",
  "payroll",
  "ledger",
  "close",
  "planning",
] as const;

export const reportPersonas = ["owner", "freelancer", "accountant"] as const;

export type ReportTab = (typeof reportTabs)[number];
export type ReportPersona = (typeof reportPersonas)[number];
export type ReportSection =
  | "automation-operations"
  | "decision-shortcuts"
  | "recommendations"
  | "automation-starters"
  | "trigger-rules"
  | "delivery-subscriptions"
  | "pack-readiness"
  | "automation-command-center"
  | "automation-rules"
  | "pack-automation";
export type ReportStatus = "live" | "api" | "planned";
export type ReportDeliveryAutomationCommand = "retry" | "review" | "queue" | "comparison";
export type ReportRoadmapImpact = "high" | "medium" | "low";
export type ReportAutomationTriggerSeverity = "critical" | "review" | "info";
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
  decisionQuestion: string;
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

export interface ReportPackTemplate {
  id: string;
  persona: ReportPersona;
  title: string;
  audience: string;
  outcome: string;
  cadence: string;
  delivery: string;
  reportIds: string[];
  comparisonFocus: string;
  automationTrigger: string;
  commandKeywords: string;
}

export interface ReportComparisonPreset {
  id: string;
  persona: ReportPersona;
  title: string;
  question: string;
  baseline: string;
  primaryTab: ReportTab;
  reportIds: string[];
  metricIds: string[];
  automationTrigger: string;
  commandKeywords: string;
}

export interface ReportAutomationStarter {
  id: string;
  persona: ReportPersona;
  title: string;
  audience: string;
  outcome: string;
  setupTime: string;
  trigger: string;
  reportIds: string[];
  playbookIds: string[];
  queueIds: string[];
  setupSteps: string[];
  primaryAction: string;
  commandKeywords: string;
}

export interface ReportDecisionShortcut {
  id: string;
  persona: ReportPersona;
  question: string;
  answer: string;
  primaryReportId: string;
  reportIds: string[];
  comparisonPresetId: string;
  automationStarterId: string;
  commandKeywords: string;
}

export interface ReportAutomationTriggerRule {
  id: string;
  persona: ReportPersona;
  title: string;
  condition: string;
  threshold: string;
  severity: ReportAutomationTriggerSeverity;
  cadence: string;
  reportIds: string[];
  automationStarterId: string;
  decisionShortcutId: string;
  actionLabel: string;
  commandKeywords: string;
}

export interface ReportDeliverySubscription {
  id: string;
  persona: ReportPersona;
  title: string;
  audience: string;
  cadence: string;
  channel: string;
  format: string;
  recipients: string;
  packTemplateId: string;
  triggerRuleIds: string[];
  reportIds: string[];
  automationStarterId: string;
  decisionShortcutId: string;
  deliveryGuardrail: string;
  commandKeywords: string;
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
  automationNavLabel: string;
  focus: string;
  automationOutcome: string;
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
    navLabel: "Owner / Solo Reports",
    automationNavLabel: "Owner / Solo Automations",
    focus:
      "Cash, profit, receivables, tax, and payroll decisions for owners and solo entrepreneurs.",
    automationOutcome:
      "Turns cash pressure, overdue customers, tax exposure, and spend guardrails into weekly owner actions.",
    primaryTab: "balances",
    icon: "briefcase",
    commandKeywords: "reports owner solo entrepreneur cash profit receivables tax automation",
    packSchedule: {
      cadence: "Weekly Monday morning plus month-end close",
      delivery: "Excel or Google Sheets pack",
      recipients: "Business owner, solo entrepreneur, and finance admin",
      trigger: "Refresh after bank, invoices, bills, receipts, and VAT reports are updated.",
      automation: "Send when collections, VAT, or cash warnings are open.",
    },
    automations: [
      {
        id: "owner-cash-collections",
        title: "Cash and collections command center",
        trigger: "Overdue receivables or cash forecast risk",
        reportIds: ["customer-balances", "ar-aging", "cash-flow-forecast", "sales-product-service"],
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
        reportIds: [
          "budget-actual",
          "expenses-category",
          "expense-claims",
          "payroll-summary",
          "wps-sif-summary",
          "vendor-balances",
          "inventory-valuation",
          "inventory-movement",
          "fixed-asset-register",
        ],
        cta: "Open planning",
        tab: "planning",
      },
    ],
  },
  {
    persona: "freelancer",
    title: "Freelancer workspace",
    navLabel: "Freelancer Reports",
    automationNavLabel: "Freelancer Automations",
    focus: "Client income, unpaid invoices, expenses, and monthly tax readiness.",
    automationOutcome:
      "Turns unpaid invoices, receipt gaps, and runway changes into mobile follow-up and monthly tax-close actions.",
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
    automationNavLabel: "Accountant Automations",
    focus: "Close workpapers, ledgers, audit trails, tax, and consolidation.",
    automationOutcome:
      "Turns close exceptions, tax workpaper gaps, audit activity, and consolidation checks into reviewer queues.",
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
        reportIds: [
          "trial-balance",
          "general-ledger",
          "account-transactions",
          "month-end-close-status",
          "inventory-valuation",
          "inventory-movement",
          "fixed-asset-register",
          "depreciation-schedule",
          "payroll-summary",
          "wps-sif-summary",
          "audit-trail",
          "consolidated-statements",
        ],
        cta: "Open close review",
        tab: "close",
      },
      {
        id: "accountant-tax-workpapers",
        title: "Tax workpaper readiness",
        trigger: "VAT filing support or corporate-tax review",
        reportIds: [
          "vat-summary",
          "vat-return",
          "corporate-tax-estimate",
          "expenses-category",
          "expense-claims",
        ],
        cta: "Open tax estimate",
        tab: "tax",
      },
      {
        id: "accountant-advisory-pack",
        title: "Client advisory pack",
        trigger: "Recurring P&L, balance sheet, cash, and comparison review",
        reportIds: [
          "profit-loss",
          "balance-sheet",
          "cash-flow",
          "period-comparison",
          "sales-product-service",
          "consolidated-statements",
        ],
        cta: "Open report pack",
        tab: "close",
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
    decisionQuestion: "Is the business profitable for the selected period?",
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
    decisionQuestion: "What does the business own, owe, and retain as of this date?",
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
    decisionQuestion: "How much VAT is payable or recoverable for this period?",
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
    decisionQuestion: "Where did cash come from and go during the period?",
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
    decisionQuestion: "Which customers owe money and how overdue are they?",
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
    decisionQuestion: "Which supplier bills are due and when should they be paid?",
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
    decisionQuestion: "Do debits and credits balance before close?",
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
    decisionQuestion: "Is the VAT return ready to file with supporting totals?",
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
    decisionQuestion: "What changed versus the prior period and why?",
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
    decisionQuestion: "How much currency exposure moved profit or balances?",
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
    decisionQuestion: "Which journal lines explain each account balance?",
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
    decisionQuestion: "What source activity makes up this account?",
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
    decisionQuestion: "What corporate tax exposure should be planned for?",
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
    decisionQuestion: "Which customers drive open receivables?",
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
    decisionQuestion: "Which vendors drive open payables?",
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
    decisionQuestion: "Which invoices are draft, sent, overdue, or paid?",
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
    decisionQuestion: "Where is performance over or under budget?",
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
    decisionQuestion: "How long can the business cover upcoming cash needs?",
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
    decisionQuestion: "Which customers drive revenue and concentration risk?",
    tab: "sales",
    commandIcon: "users",
    commandKeywords: "reports revenue customer concentration sales",
  },
  {
    id: "sales-product-service",
    name: "Sales by Product/Service",
    category: "Sales",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Sales mix",
    automation: "Service concentration",
    decisionQuestion: "Which products or services drive the sales mix?",
    tab: "sales",
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
    decisionQuestion: "Which vendors drive spending this period?",
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
    decisionQuestion: "Which categories are pushing costs over plan?",
    tab: "expenses",
    commandIcon: "receipt",
    commandKeywords: "reports expenses categories spend budget",
  },
  {
    id: "inventory-valuation",
    name: "Inventory Valuation",
    category: "Inventory",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Stock risk",
    decisionQuestion: "What stock value is on hand right now?",
    tab: "balances",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports inventory valuation stock",
  },
  {
    id: "inventory-movement",
    name: "Inventory Movement",
    category: "Inventory",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Period movement",
    automation: "Reorder alerts",
    decisionQuestion: "What stock moved in or out during the period?",
    tab: "balances",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports inventory movement reorder",
  },
  {
    id: "fixed-asset-register",
    name: "Fixed Asset Register",
    category: "Assets",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Capitalization review",
    decisionQuestion: "Which assets are active and what are they worth?",
    tab: "balances",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports fixed assets register capitalization",
  },
  {
    id: "depreciation-schedule",
    name: "Depreciation Schedule",
    category: "Assets",
    status: "live",
    personas: ["accountant"],
    comparison: "Period",
    automation: "Posting suggestions",
    decisionQuestion: "What depreciation should be posted this period?",
    tab: "balances",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports depreciation fixed assets posting",
  },
  {
    id: "payroll-summary",
    name: "Payroll Summary",
    category: "Payroll",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Pay period",
    automation: "Variance checks",
    decisionQuestion: "What payroll cost and headcount moved this period?",
    tab: "payroll",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports payroll summary wages",
  },
  {
    id: "wps-sif-summary",
    name: "WPS / SIF Summary",
    category: "Payroll",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Pay run",
    automation: "WPS readiness",
    decisionQuestion: "Is the payroll run ready for WPS/SIF submission?",
    tab: "payroll",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports wps sif payroll readiness",
  },
  {
    id: "expense-claims",
    name: "Expense Claims",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Claim status",
    automation: "Approval routing",
    decisionQuestion: "Which employee claims need approval or payment?",
    tab: "expenses",
    commandIcon: "receipt",
    commandKeywords: "reports expense claims approval",
  },
  {
    id: "month-end-close-status",
    name: "Month-End Close Status",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Close period",
    automation: "Close checklist",
    decisionQuestion: "What close tasks are complete or blocked?",
    tab: "close",
    commandIcon: "book",
    commandKeywords: "reports month end close checklist accountant",
  },
  {
    id: "audit-trail",
    name: "Audit Trail",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Activity period",
    automation: "Risk summary",
    decisionQuestion: "Which user activities need audit review?",
    tab: "close",
    commandIcon: "book",
    commandKeywords: "reports audit trail history risk",
  },
  {
    id: "consolidated-statements",
    name: "Consolidated Statements",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Multi-entity roll-up",
    automation: "Review flags",
    decisionQuestion: "How do entities roll up into one group view?",
    tab: "close",
    commandIcon: "fileSpreadsheet",
    commandKeywords: "reports consolidated statements multi company",
  },
];

export const reportPackTemplates: ReportPackTemplate[] = [
  {
    id: "owner-weekly-command-pack",
    persona: "owner",
    title: "Owner weekly command pack",
    audience: "Owner, solo entrepreneur, and finance admin",
    outcome: "Weekly cash, profit, overdue customer, VAT, and spend decisions in one pack.",
    cadence: "Every Monday morning",
    delivery: "Excel or Google Sheets management pack",
    reportIds: [
      "profit-loss",
      "customer-balances",
      "ar-aging",
      "cash-flow-forecast",
      "budget-actual",
      "vat-summary",
      "sales-product-service",
    ],
    comparisonFocus: "Prior period, overdue balances, forecast risk, and budget variance.",
    automationTrigger:
      "Send when overdue receivables, cash warnings, VAT due, or spend alerts open.",
    commandKeywords: "owner solo entrepreneur weekly cash profit collections vat budget pack",
  },
  {
    id: "owner-tax-cash-pack",
    persona: "owner",
    title: "Owner tax and cash readiness pack",
    audience: "Business owner and tax preparer",
    outcome: "Keeps VAT, corporate tax, expense support, and cash exposure ready before filing.",
    cadence: "Monthly plus tax-period close",
    delivery: "Tax-ready workbook pack",
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "expenses-category",
      "cash-flow-forecast",
    ],
    comparisonFocus: "Tax period, payable movement, deductible spend, and cash runway.",
    automationTrigger:
      "Send when VAT payable, corporate-tax exposure, missing support, or cash pressure changes.",
    commandKeywords: "owner tax vat corporate tax cash readiness filing pack",
  },
  {
    id: "freelancer-client-income-pack",
    persona: "freelancer",
    title: "Freelancer client income pack",
    audience: "Freelancer or solo operator",
    outcome: "Turns unpaid invoices, client concentration, profit, and runway into follow-up work.",
    cadence: "Weekly client follow-up",
    delivery: "Mobile-friendly Google Sheets pack",
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "customer-balances",
      "profit-loss",
      "cash-flow-forecast",
    ],
    comparisonFocus: "Unpaid invoice status, client revenue mix, profit movement, and runway.",
    automationTrigger: "Send when invoices become overdue or client concentration/risk changes.",
    commandKeywords: "freelancer client income invoices unpaid runway follow up pack",
  },
  {
    id: "freelancer-monthly-tax-pack",
    persona: "freelancer",
    title: "Freelancer monthly tax close pack",
    audience: "Freelancer and bookkeeper",
    outcome: "Collects income, expense, VAT, and cash signals needed for a light monthly close.",
    cadence: "Month-end tax close",
    delivery: "Google Sheets close pack",
    reportIds: [
      "profit-loss",
      "expenses-vendor",
      "expenses-category",
      "vat-summary",
      "cash-flow-forecast",
    ],
    comparisonFocus: "Monthly income, spend category movement, VAT readiness, and cash forecast.",
    automationTrigger: "Send when receipt gaps, VAT-ready expenses, or runway warnings are open.",
    commandKeywords: "freelancer monthly tax close expenses vat receipts cash pack",
  },
  {
    id: "accountant-close-workpaper-pack",
    persona: "accountant",
    title: "Accountant close workpaper pack",
    audience: "Accountant, reviewer, and controller",
    outcome:
      "Bundles trial balance, ledger drilldowns, close status, audit risk, and consolidation.",
    cadence: "Month-end close",
    delivery: "Excel workpaper pack",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    comparisonFocus: "Close period, account drilldown, activity risk, and multi-entity roll-up.",
    automationTrigger: "Send when close checks, ledger source gaps, audit risk, or FX checks open.",
    commandKeywords: "accountant close workpaper trial balance ledger audit consolidation pack",
  },
  {
    id: "accountant-advisory-review-pack",
    persona: "accountant",
    title: "Accountant advisory review pack",
    audience: "Accountant and client owner",
    outcome: "Presents P&L, balance sheet, cash, sales mix, budget variance, and consolidation.",
    cadence: "Monthly advisory review",
    delivery: "Client-ready Excel or Google Sheets pack",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "sales-product-service",
      "consolidated-statements",
    ],
    comparisonFocus: "Current vs prior period, cash movement, budget variance, and sales mix.",
    automationTrigger: "Send when comparison warnings or advisory review actions are open.",
    commandKeywords: "accountant advisory client review pnl balance sheet cash budget pack",
  },
];

export const reportComparisonPresets: ReportComparisonPreset[] = [
  {
    id: "owner-profit-cash-movement",
    persona: "owner",
    title: "Owner profit and cash movement",
    question: "Did revenue, profit, cash pressure, or spend move enough to need action?",
    baseline: "Current period vs prior period with budget and cash context.",
    primaryTab: "pl",
    reportIds: ["profit-loss", "period-comparison", "cash-flow-forecast", "budget-actual"],
    metricIds: ["revenue", "net-profit", "expense-spend"],
    automationTrigger: "Route unfavorable profit or spend movement to owner automation actions.",
    commandKeywords: "owner profit cash movement revenue expense budget comparison",
  },
  {
    id: "owner-tax-collections-pressure",
    persona: "owner",
    title: "Owner tax and collections pressure",
    question: "Are tax payable, invoice value, or overdue customer balances increasing together?",
    baseline: "Current tax period and invoice activity against the prior period.",
    primaryTab: "vat",
    reportIds: ["vat-summary", "vat-return", "invoice-status", "customer-balances", "ar-aging"],
    metricIds: ["vat-due", "invoice-value", "revenue"],
    automationTrigger: "Escalate VAT payable or invoice movement into tax and collections lanes.",
    commandKeywords: "owner tax vat collections invoices overdue comparison",
  },
  {
    id: "freelancer-client-income-movement",
    persona: "freelancer",
    title: "Freelancer client income movement",
    question: "Which client income, invoice, or profit movement needs follow-up?",
    baseline: "Current client and invoice activity vs the prior period.",
    primaryTab: "sales",
    reportIds: ["invoice-status", "revenue-customer", "customer-balances", "profit-loss"],
    metricIds: ["invoice-value", "revenue", "net-profit"],
    automationTrigger: "Send unpaid invoice or client concentration movement to follow-up.",
    commandKeywords: "freelancer client income invoice profit comparison follow up",
  },
  {
    id: "freelancer-tax-spend-runway",
    persona: "freelancer",
    title: "Freelancer tax, spend, and runway",
    question: "Are expenses, VAT, or profit changing enough to affect runway?",
    baseline: "Monthly tax close vs the prior month with cash forecast context.",
    primaryTab: "expenses",
    reportIds: ["expenses-category", "expenses-vendor", "vat-summary", "cash-flow-forecast"],
    metricIds: ["expense-spend", "vat-due", "net-profit"],
    automationTrigger: "Create receipt, VAT, or runway review work when movement is unfavorable.",
    commandKeywords: "freelancer tax spend expenses vat runway comparison",
  },
  {
    id: "accountant-close-review-movement",
    persona: "accountant",
    title: "Accountant close review movement",
    question: "Did ledger activity, profit, or consolidation movement create close review work?",
    baseline: "Close period activity vs the previous close period.",
    primaryTab: "close",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "month-end-close-status",
      "consolidated-statements",
    ],
    metricIds: ["ledger-activity", "net-profit", "consolidated-net-profit"],
    automationTrigger: "Route ledger and consolidation movement into reviewer queues.",
    commandKeywords: "accountant close ledger consolidation movement comparison review",
  },
  {
    id: "accountant-operational-advisory-movement",
    persona: "accountant",
    title: "Accountant operational advisory movement",
    question: "Which payroll, inventory, or group performance movements need advisory notes?",
    baseline: "Operational movement vs prior period for advisory review.",
    primaryTab: "payroll",
    reportIds: [
      "payroll-summary",
      "inventory-movement",
      "consolidated-statements",
      "period-comparison",
    ],
    metricIds: ["payroll-cost", "inventory-movement", "consolidated-net-profit"],
    automationTrigger: "Add payroll, stock, or consolidation movement to advisory pack review.",
    commandKeywords: "accountant advisory payroll inventory consolidated comparison movement",
  },
];

export const reportAutomationStarters: ReportAutomationStarter[] = [
  {
    id: "owner-cash-control-autopilot",
    persona: "owner",
    title: "Owner cash-control autopilot",
    audience: "Owner, solo entrepreneur, or finance admin",
    outcome:
      "Turns cash forecast pressure, overdue customers, and sales-mix changes into a weekly command pack.",
    setupTime: "10-minute setup",
    trigger: "Run after invoices, payments, bank activity, and sales lines refresh.",
    reportIds: [
      "customer-balances",
      "ar-aging",
      "cash-flow-forecast",
      "sales-product-service",
      "profit-loss",
    ],
    playbookIds: ["owner-cash-collections"],
    queueIds: ["collections", "planning-risk", "sales-mix"],
    setupSteps: [
      "Connect invoice and bank refreshes.",
      "Schedule the owner weekly command pack.",
      "Route overdue balances to payment chasing.",
    ],
    primaryAction: "Launch cash autopilot",
    commandKeywords: "owner solo entrepreneur cash collections autopilot overdue invoices",
  },
  {
    id: "owner-tax-spend-autopilot",
    persona: "owner",
    title: "Owner tax and spend autopilot",
    audience: "Owner, solo entrepreneur, and tax preparer",
    outcome:
      "Keeps VAT, corporate tax, vendor balances, payroll, and budget variance in one review lane.",
    setupTime: "15-minute setup",
    trigger: "Run before VAT close, payroll approval, or weekly spend review.",
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "budget-actual",
      "vendor-balances",
      "payroll-summary",
    ],
    playbookIds: ["owner-vat-readiness", "owner-spend-guardrails"],
    queueIds: ["vat-readiness", "corporate-tax", "bill-pay", "payroll-wps-review"],
    setupSteps: [
      "Confirm VAT and corporate-tax settings.",
      "Enable spend and payroll variance checks.",
      "Send exceptions to the tax and spend pack.",
    ],
    primaryAction: "Launch tax autopilot",
    commandKeywords: "owner tax vat corporate tax spend budget payroll autopilot",
  },
  {
    id: "freelancer-client-chase-autopilot",
    persona: "freelancer",
    title: "Freelancer client-chase autopilot",
    audience: "Freelancer or solo operator",
    outcome:
      "Turns unpaid invoices, customer revenue concentration, and runway changes into mobile follow-up work.",
    setupTime: "8-minute setup",
    trigger: "Run when invoices are sent, become overdue, or client revenue moves sharply.",
    reportIds: ["invoice-status", "revenue-customer", "customer-balances", "cash-flow-forecast"],
    playbookIds: ["freelancer-invoice-followup", "freelancer-runway-snapshot"],
    queueIds: ["collections", "planning-risk"],
    setupSteps: [
      "Choose client follow-up cadence.",
      "Connect unpaid invoice reminders.",
      "Attach the runway snapshot to the weekly pack.",
    ],
    primaryAction: "Launch client autopilot",
    commandKeywords: "freelancer client chase invoices unpaid runway autopilot",
  },
  {
    id: "freelancer-tax-close-autopilot",
    persona: "freelancer",
    title: "Freelancer monthly tax-close autopilot",
    audience: "Freelancer and bookkeeper",
    outcome:
      "Collects receipt gaps, VAT movement, expense categories, and profit movement before month end.",
    setupTime: "12-minute setup",
    trigger: "Run when receipts are uploaded or the monthly tax-close pack is due.",
    reportIds: ["expenses-vendor", "expenses-category", "vat-summary", "profit-loss"],
    playbookIds: ["freelancer-monthly-tax-close"],
    queueIds: ["receipt-posting", "vat-readiness", "planning-risk"],
    setupSteps: [
      "Enable receipt posting reminders.",
      "Review expense category movement.",
      "Send tax-close exceptions to the monthly pack.",
    ],
    primaryAction: "Launch tax-close autopilot",
    commandKeywords: "freelancer receipts expenses vat monthly tax close autopilot",
  },
  {
    id: "accountant-close-review-autopilot",
    persona: "accountant",
    title: "Accountant close-review autopilot",
    audience: "Accountant, reviewer, and controller",
    outcome:
      "Routes trial-balance differences, ledger source gaps, close checks, audit activity, and consolidation review.",
    setupTime: "20-minute setup",
    trigger: "Run when the close period starts or journals are posted after review.",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    playbookIds: ["accountant-close-review"],
    queueIds: [
      "close-review",
      "month-end-close",
      "audit-trail-review",
      "consolidated-statements-review",
    ],
    setupSteps: [
      "Lock the close period and trial-balance refresh.",
      "Route ledger source gaps to reviewer queues.",
      "Attach audit and consolidation checks to the workpaper pack.",
    ],
    primaryAction: "Launch close autopilot",
    commandKeywords: "accountant close review trial balance ledger audit consolidation autopilot",
  },
  {
    id: "accountant-advisory-pack-autopilot",
    persona: "accountant",
    title: "Accountant advisory-pack autopilot",
    audience: "Accountant and client owner",
    outcome:
      "Builds advisory notes from P&L movement, cash, budget, payroll, inventory, and consolidation signals.",
    setupTime: "18-minute setup",
    trigger: "Run after month-end close or before a client advisory review.",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "payroll-summary",
      "inventory-movement",
      "consolidated-statements",
    ],
    playbookIds: ["accountant-advisory-pack"],
    queueIds: [
      "planning-risk",
      "sales-mix",
      "payroll-wps-review",
      "inventory-movement-review",
      "consolidated-statements-review",
    ],
    setupSteps: [
      "Select the client advisory cadence.",
      "Attach comparison and operations movements.",
      "Send review notes with the advisory pack.",
    ],
    primaryAction: "Launch advisory autopilot",
    commandKeywords: "accountant advisory client review pnl cash payroll inventory autopilot",
  },
];

export const reportDecisionShortcuts: ReportDecisionShortcut[] = [
  {
    id: "owner-next-30-days",
    persona: "owner",
    question: "Can I cover the next 30 days?",
    answer:
      "Start with cash forecast, overdue customers, payables, and profit movement before committing spend.",
    primaryReportId: "cash-flow-forecast",
    reportIds: ["cash-flow-forecast", "customer-balances", "ar-aging", "ap-aging", "profit-loss"],
    comparisonPresetId: "owner-profit-cash-movement",
    automationStarterId: "owner-cash-control-autopilot",
    commandKeywords: "owner cash runway next 30 days overdue customers payables profit",
  },
  {
    id: "owner-customers-services-attention",
    persona: "owner",
    question: "Which customers or services need attention this week?",
    answer:
      "Review overdue receivables, customer concentration, and product/service mix before follow-up.",
    primaryReportId: "customer-balances",
    reportIds: ["customer-balances", "ar-aging", "revenue-customer", "sales-product-service"],
    comparisonPresetId: "owner-tax-collections-pressure",
    automationStarterId: "owner-cash-control-autopilot",
    commandKeywords: "owner customers services attention overdue revenue mix collections",
  },
  {
    id: "owner-tax-payroll-ready",
    persona: "owner",
    question: "What should be ready before tax or payroll deadlines?",
    answer:
      "Check VAT, corporate tax exposure, payroll variance, and WPS readiness before filing or approval.",
    primaryReportId: "vat-summary",
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "payroll-summary",
      "wps-sif-summary",
    ],
    comparisonPresetId: "owner-tax-collections-pressure",
    automationStarterId: "owner-tax-spend-autopilot",
    commandKeywords: "owner tax payroll deadline vat corporate tax wps readiness",
  },
  {
    id: "freelancer-cash-chase",
    persona: "freelancer",
    question: "Who should I chase before cash gets tight?",
    answer:
      "Open unpaid invoices, customer balances, client revenue movement, and runway before sending reminders.",
    primaryReportId: "invoice-status",
    reportIds: ["invoice-status", "customer-balances", "revenue-customer", "cash-flow-forecast"],
    comparisonPresetId: "freelancer-client-income-movement",
    automationStarterId: "freelancer-client-chase-autopilot",
    commandKeywords: "freelancer chase invoices unpaid clients cash runway reminders",
  },
  {
    id: "freelancer-monthly-close-blockers",
    persona: "freelancer",
    question: "Which expenses or receipts block my monthly close?",
    answer: "Review vendor spend, category movement, VAT, and profit before closing the month.",
    primaryReportId: "expenses-category",
    reportIds: ["expenses-category", "expenses-vendor", "vat-summary", "profit-loss"],
    comparisonPresetId: "freelancer-tax-spend-runway",
    automationStarterId: "freelancer-tax-close-autopilot",
    commandKeywords: "freelancer monthly close expenses receipts vat profit blockers",
  },
  {
    id: "freelancer-client-concentration",
    persona: "freelancer",
    question: "Is one client carrying too much of my income?",
    answer:
      "Compare revenue by customer, invoice status, profit, and period movement before planning capacity.",
    primaryReportId: "revenue-customer",
    reportIds: ["revenue-customer", "invoice-status", "profit-loss", "period-comparison"],
    comparisonPresetId: "freelancer-client-income-movement",
    automationStarterId: "freelancer-client-chase-autopilot",
    commandKeywords: "freelancer client concentration income revenue capacity profit",
  },
  {
    id: "accountant-close-blockers",
    persona: "accountant",
    question: "What blocks month-end close?",
    answer:
      "Start with trial balance, ledger drilldowns, close status, audit activity, and consolidation review.",
    primaryReportId: "month-end-close-status",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-close-review-movement",
    automationStarterId: "accountant-close-review-autopilot",
    commandKeywords: "accountant month end close blockers trial balance ledger audit consolidation",
  },
  {
    id: "accountant-advisory-pack",
    persona: "accountant",
    question: "What should go into the advisory pack?",
    answer:
      "Bundle profit, balance sheet, cash, budget variance, sales mix, and consolidation movement.",
    primaryReportId: "period-comparison",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "sales-product-service",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-operational-advisory-movement",
    automationStarterId: "accountant-advisory-pack-autopilot",
    commandKeywords: "accountant advisory pack client profit cash budget consolidation",
  },
  {
    id: "accountant-operational-review",
    persona: "accountant",
    question: "Which operations need advisory notes?",
    answer:
      "Check payroll, WPS, inventory movement, fixed assets, and consolidation before client review.",
    primaryReportId: "payroll-summary",
    reportIds: [
      "payroll-summary",
      "wps-sif-summary",
      "inventory-movement",
      "fixed-asset-register",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-operational-advisory-movement",
    automationStarterId: "accountant-advisory-pack-autopilot",
    commandKeywords: "accountant operations advisory payroll wps inventory fixed assets",
  },
];

export const reportAutomationTriggerRules: ReportAutomationTriggerRule[] = [
  {
    id: "owner-cash-runway-risk",
    persona: "owner",
    title: "Cash runway risk",
    condition: "Cash forecast, overdue A/R, or open customer balances move against plan.",
    threshold: "Alert when runway is below 45 days or overdue receivables increase week over week.",
    severity: "critical",
    cadence: "Daily until clear, then weekly in the owner command pack.",
    reportIds: ["cash-flow-forecast", "customer-balances", "ar-aging", "profit-loss"],
    automationStarterId: "owner-cash-control-autopilot",
    decisionShortcutId: "owner-next-30-days",
    actionLabel: "Review cash risk",
    commandKeywords: "owner cash runway risk overdue receivables threshold alert",
  },
  {
    id: "owner-tax-deadline-exposure",
    persona: "owner",
    title: "Tax deadline exposure",
    condition: "VAT payable, corporate-tax estimate, or filing support changes before deadline.",
    threshold:
      "Alert when payable tax exists, filing support is missing, or deadline is within 14 days.",
    severity: "critical",
    cadence: "Daily during tax-period close.",
    reportIds: ["vat-summary", "vat-return", "corporate-tax-estimate", "expenses-category"],
    automationStarterId: "owner-tax-spend-autopilot",
    decisionShortcutId: "owner-tax-payroll-ready",
    actionLabel: "Review tax exposure",
    commandKeywords: "owner tax deadline exposure vat corporate tax filing alert",
  },
  {
    id: "owner-spend-variance-alert",
    persona: "owner",
    title: "Spend variance alert",
    condition: "Expense categories, vendor balances, payroll, or inventory pressure exceed plan.",
    threshold: "Alert when spend is 10% over budget or vendor/payroll/inventory pressure is open.",
    severity: "review",
    cadence: "Weekly before owner pack delivery.",
    reportIds: [
      "budget-actual",
      "expenses-category",
      "vendor-balances",
      "payroll-summary",
      "inventory-valuation",
    ],
    automationStarterId: "owner-tax-spend-autopilot",
    decisionShortcutId: "owner-next-30-days",
    actionLabel: "Review spend variance",
    commandKeywords: "owner spend variance budget vendor payroll inventory alert",
  },
  {
    id: "freelancer-overdue-client-chase",
    persona: "freelancer",
    title: "Overdue client chase",
    condition: "Unpaid invoices or customer balances cross follow-up timing.",
    threshold:
      "Alert when any invoice is overdue by 7 days or a client balance grows week over week.",
    severity: "critical",
    cadence: "Daily until invoice follow-up is sent.",
    reportIds: ["invoice-status", "customer-balances", "revenue-customer"],
    automationStarterId: "freelancer-client-chase-autopilot",
    decisionShortcutId: "freelancer-cash-chase",
    actionLabel: "Chase client",
    commandKeywords: "freelancer overdue client chase invoices unpaid threshold alert",
  },
  {
    id: "freelancer-receipt-gap-close",
    persona: "freelancer",
    title: "Receipt gap close",
    condition: "Unposted receipts, vendor spend, or VAT-ready expenses block monthly close.",
    threshold: "Alert when receipt gaps exist after month end or VAT-ready expenses need support.",
    severity: "review",
    cadence: "Weekly, then daily during month-end close.",
    reportIds: ["expenses-vendor", "expenses-category", "vat-summary", "profit-loss"],
    automationStarterId: "freelancer-tax-close-autopilot",
    decisionShortcutId: "freelancer-monthly-close-blockers",
    actionLabel: "Close receipt gaps",
    commandKeywords: "freelancer receipts gap monthly close expenses vat alert",
  },
  {
    id: "freelancer-client-concentration-warning",
    persona: "freelancer",
    title: "Client concentration warning",
    condition: "One client carries too much income or profit movement.",
    threshold: "Alert when one customer contributes more than 50% of current-period revenue.",
    severity: "info",
    cadence: "Weekly with client income pack.",
    reportIds: ["revenue-customer", "invoice-status", "profit-loss", "period-comparison"],
    automationStarterId: "freelancer-client-chase-autopilot",
    decisionShortcutId: "freelancer-client-concentration",
    actionLabel: "Review concentration",
    commandKeywords: "freelancer client concentration revenue warning income alert",
  },
  {
    id: "accountant-close-exception-review",
    persona: "accountant",
    title: "Close exception review",
    condition:
      "Trial balance, ledger source gaps, or close checklist items need reviewer attention.",
    threshold:
      "Alert when trial balance is out, ledger source is missing, or any close task is blocked.",
    severity: "critical",
    cadence: "Daily during close.",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
    ],
    automationStarterId: "accountant-close-review-autopilot",
    decisionShortcutId: "accountant-close-blockers",
    actionLabel: "Review close exceptions",
    commandKeywords: "accountant close exception trial balance ledger checklist alert",
  },
  {
    id: "accountant-tax-workpaper-gap",
    persona: "accountant",
    title: "Tax workpaper gap",
    condition: "VAT filing support, corporate-tax estimate, or expense evidence needs review.",
    threshold: "Alert when tax payable exists and supporting reports are not reviewed.",
    severity: "review",
    cadence: "Daily during tax workpaper review.",
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "expenses-category",
      "expense-claims",
    ],
    automationStarterId: "accountant-close-review-autopilot",
    decisionShortcutId: "accountant-close-blockers",
    actionLabel: "Review tax workpapers",
    commandKeywords: "accountant tax workpaper gap vat corporate tax expense alert",
  },
  {
    id: "accountant-advisory-movement-note",
    persona: "accountant",
    title: "Advisory movement note",
    condition: "Operational movement needs a client-facing advisory note.",
    threshold: "Alert when payroll, inventory, budget, or consolidation movement changes by 10%.",
    severity: "info",
    cadence: "Monthly before advisory pack send.",
    reportIds: [
      "period-comparison",
      "payroll-summary",
      "inventory-movement",
      "budget-actual",
      "consolidated-statements",
    ],
    automationStarterId: "accountant-advisory-pack-autopilot",
    decisionShortcutId: "accountant-advisory-pack",
    actionLabel: "Draft advisory note",
    commandKeywords: "accountant advisory movement payroll inventory budget consolidation alert",
  },
];

export const reportDeliverySubscriptions: ReportDeliverySubscription[] = [
  {
    id: "owner-weekly-executive-delivery",
    persona: "owner",
    title: "Owner weekly executive delivery",
    audience: "Business owner, solo entrepreneur, and finance admin",
    cadence: "Every Monday at 8:00 AM after bank, invoice, and receipt refresh",
    channel: "Google Sheets plus email summary",
    format: "Management pack workbook",
    recipients: "Owner, finance admin, and tax preparer when tax warnings are open",
    packTemplateId: "owner-weekly-command-pack",
    triggerRuleIds: ["owner-cash-runway-risk", "owner-spend-variance-alert"],
    reportIds: [
      "profit-loss",
      "customer-balances",
      "ar-aging",
      "cash-flow-forecast",
      "budget-actual",
      "vat-summary",
    ],
    automationStarterId: "owner-cash-control-autopilot",
    decisionShortcutId: "owner-next-30-days",
    deliveryGuardrail:
      "Hold delivery until cash, collections, and spend alerts are reviewed or explicitly approved.",
    commandKeywords:
      "owner weekly executive delivery subscription scheduled send email google sheets cash profit",
  },
  {
    id: "owner-tax-deadline-delivery",
    persona: "owner",
    title: "Owner tax deadline delivery",
    audience: "Owner and tax preparer",
    cadence: "Monthly plus 14 days before VAT or corporate tax deadlines",
    channel: "Excel workbook with email checklist",
    format: "Tax-ready workbook pack",
    recipients: "Owner, tax preparer, and finance admin",
    packTemplateId: "owner-tax-cash-pack",
    triggerRuleIds: ["owner-tax-deadline-exposure", "owner-spend-variance-alert"],
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "expenses-category",
      "cash-flow-forecast",
    ],
    automationStarterId: "owner-tax-spend-autopilot",
    decisionShortcutId: "owner-tax-payroll-ready",
    deliveryGuardrail:
      "Block auto-send when filing support, payroll readiness, or deductible spend evidence is missing.",
    commandKeywords:
      "owner tax deadline delivery subscription vat corporate tax payroll email workbook",
  },
  {
    id: "freelancer-client-chase-delivery",
    persona: "freelancer",
    title: "Freelancer client chase delivery",
    audience: "Freelancer or solo operator",
    cadence: "Every weekday morning while invoices are overdue, otherwise weekly",
    channel: "Mobile Google Sheets link and email nudge",
    format: "Client follow-up digest",
    recipients: "Freelancer or solo operator",
    packTemplateId: "freelancer-client-income-pack",
    triggerRuleIds: ["freelancer-overdue-client-chase", "freelancer-client-concentration-warning"],
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "customer-balances",
      "profit-loss",
      "cash-flow-forecast",
    ],
    automationStarterId: "freelancer-client-chase-autopilot",
    decisionShortcutId: "freelancer-cash-chase",
    deliveryGuardrail:
      "Send only after invoice status refresh confirms current balances and no draft reminders are pending.",
    commandKeywords:
      "freelancer client chase delivery subscription invoices overdue mobile google sheets",
  },
  {
    id: "freelancer-monthly-close-delivery",
    persona: "freelancer",
    title: "Freelancer monthly close delivery",
    audience: "Freelancer and bookkeeper",
    cadence: "Month-end plus three days before tax-close cutoff",
    channel: "Google Sheets close pack",
    format: "Monthly tax-close pack",
    recipients: "Freelancer and bookkeeper",
    packTemplateId: "freelancer-monthly-tax-pack",
    triggerRuleIds: ["freelancer-receipt-gap-close", "freelancer-client-concentration-warning"],
    reportIds: [
      "profit-loss",
      "expenses-vendor",
      "expenses-category",
      "vat-summary",
      "cash-flow-forecast",
    ],
    automationStarterId: "freelancer-tax-close-autopilot",
    decisionShortcutId: "freelancer-monthly-close-blockers",
    deliveryGuardrail:
      "Hold delivery while receipt gaps, VAT-ready expense support, or material client concentration notes are open.",
    commandKeywords:
      "freelancer monthly close delivery subscription receipts expenses vat google sheets",
  },
  {
    id: "accountant-close-workpaper-delivery",
    persona: "accountant",
    title: "Accountant close workpaper delivery",
    audience: "Accountant, reviewer, and controller",
    cadence: "Daily during close and final send after reviewer sign-off",
    channel: "Excel workpaper pack",
    format: "Close review workbook",
    recipients: "Accountant, reviewer, and controller",
    packTemplateId: "accountant-close-workpaper-pack",
    triggerRuleIds: ["accountant-close-exception-review", "accountant-tax-workpaper-gap"],
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    automationStarterId: "accountant-close-review-autopilot",
    decisionShortcutId: "accountant-close-blockers",
    deliveryGuardrail:
      "Block final delivery until trial-balance differences, ledger source gaps, and tax workpaper issues are cleared.",
    commandKeywords:
      "accountant close workpaper delivery subscription trial balance ledger reviewer excel",
  },
  {
    id: "accountant-advisory-pack-delivery",
    persona: "accountant",
    title: "Accountant advisory pack delivery",
    audience: "Accountant and client owner",
    cadence: "Monthly after close plus one business day before advisory review",
    channel: "Google Sheets advisory pack with email summary",
    format: "Client advisory pack",
    recipients: "Accountant, reviewer, and client owner",
    packTemplateId: "accountant-advisory-review-pack",
    triggerRuleIds: ["accountant-advisory-movement-note", "accountant-close-exception-review"],
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "sales-product-service",
      "consolidated-statements",
    ],
    automationStarterId: "accountant-advisory-pack-autopilot",
    decisionShortcutId: "accountant-advisory-pack",
    deliveryGuardrail:
      "Hold client delivery until advisory movement notes and close exceptions have owner-ready explanations.",
    commandKeywords:
      "accountant advisory delivery subscription client pack google sheets email comparison",
  },
];

export const liveReportCatalog = reportCatalog.filter((report) => report.status === "live");

export const REPORT_PERSONA_PREFERENCE_KEY = "nr_ai.report_persona";
export const REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY = "nr_ai.report_workflow_search";
export const REPORT_DELIVERY_AUTOMATION_COMMAND_KEY = "nr_ai.report_delivery_automation_command";
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

function reportWorkflowSearchPreferenceKey(persona: ReportPersona | "all"): string {
  return `${REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY}.${persona}`;
}

export function getPreferredReportWorkflowSearch(persona: ReportPersona | "all" = "all"): string {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(reportWorkflowSearchPreferenceKey(persona)) ?? "";
  } catch {
    return "";
  }
}

export function setPreferredReportWorkflowSearch(
  search: string,
  persona: ReportPersona | "all" = "all"
): void {
  if (typeof window === "undefined") return;

  try {
    const trimmed = search.trim().slice(0, 120);
    const key = reportWorkflowSearchPreferenceKey(persona);
    if (trimmed) {
      window.localStorage.setItem(key, trimmed);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {}
}

export function clearPreferredReportWorkflowSearch(persona: ReportPersona | "all" = "all"): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(reportWorkflowSearchPreferenceKey(persona));
  } catch {}
}

export function parseReportDeliveryAutomationCommand(
  value: string | null | undefined
): ReportDeliveryAutomationCommand | null {
  return value === "retry" || value === "review" || value === "queue" || value === "comparison"
    ? value
    : null;
}

function reportDeliveryAutomationCommandKey(persona: ReportPersona): string {
  return `${REPORT_DELIVERY_AUTOMATION_COMMAND_KEY}.${persona}`;
}

export function getPreferredReportDeliveryAutomationCommand(
  persona: ReportPersona
): ReportDeliveryAutomationCommand | null {
  if (typeof window === "undefined") return null;

  try {
    return parseReportDeliveryAutomationCommand(
      window.localStorage.getItem(reportDeliveryAutomationCommandKey(persona))
    );
  } catch {
    return null;
  }
}

export function setPreferredReportDeliveryAutomationCommand(
  persona: ReportPersona,
  command: ReportDeliveryAutomationCommand
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(reportDeliveryAutomationCommandKey(persona), command);
  } catch {}
}

const reportSectionAnchors: Record<ReportSection, string> = {
  "automation-operations": "report-automation-operations-title",
  "decision-shortcuts": "decision-shortcuts-title",
  recommendations: "recommended-reports-title",
  "automation-starters": "automation-starters-title",
  "trigger-rules": "trigger-rules-title",
  "delivery-subscriptions": "report-delivery-subscriptions-title",
  "pack-readiness": "report-pack-readiness-title",
  "automation-command-center": "automation-command-center-title",
  "automation-rules": "report-automation-rules-title",
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

export function reportPackTemplateHref(
  template: Pick<ReportPackTemplate, "id" | "persona">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === template.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: template.persona })}#report-pack-template-${
    template.id
  }`;
}

export function reportComparisonPresetHref(
  preset: Pick<ReportComparisonPreset, "persona" | "primaryTab">
): string {
  return `${reportsHref({ tab: preset.primaryTab, persona: preset.persona })}#period-comparison-title`;
}

export function reportAutomationStarterHref(
  starter: Pick<ReportAutomationStarter, "id" | "persona">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === starter.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: starter.persona })}#report-automation-starter-${
    starter.id
  }`;
}

export function reportDecisionShortcutHref(
  shortcut: Pick<ReportDecisionShortcut, "id" | "persona" | "primaryReportId">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === shortcut.persona);
  const report = reportCatalog.find((item) => item.id === shortcut.primaryReportId);
  return `${reportsHref({ tab: report?.tab ?? workspace?.primaryTab, persona: shortcut.persona })}#report-decision-shortcut-${
    shortcut.id
  }`;
}

export function reportAutomationTriggerRuleHref(
  rule: Pick<ReportAutomationTriggerRule, "id" | "persona" | "reportIds">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === rule.persona);
  const primaryReport = rule.reportIds
    .map((reportId) => reportCatalog.find((item) => item.id === reportId))
    .find((report): report is ReportCatalogItem => Boolean(report));
  return `${reportsHref({ tab: primaryReport?.tab ?? workspace?.primaryTab, persona: rule.persona })}#report-trigger-rule-${
    rule.id
  }`;
}

export function reportDeliverySubscriptionHref(
  subscription: Pick<ReportDeliverySubscription, "id" | "persona">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === subscription.persona);
  return `${reportsHref({
    tab: workspace?.primaryTab,
    persona: subscription.persona,
  })}#report-delivery-subscription-${subscription.id}`;
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
