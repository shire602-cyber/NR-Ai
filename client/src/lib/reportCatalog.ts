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
  | "role-setup"
  | "role-workflows"
  | "management-briefs"
  | "report-suites"
  | "quick-access"
  | "saved-views"
  | "workflow-finder"
  | "automation-operations"
  | "automation-impact"
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
export type ReportWorkflowGapFilter = "report-gaps" | "rule-gaps" | "delivery-gaps";
export const reportWorkflowGapFilterLabels: Record<ReportWorkflowGapFilter, string> = {
  "report-gaps": "Report gaps",
  "rule-gaps": "Rule gaps",
  "delivery-gaps": "Delivery gaps",
};
export type ReportRoadmapImpact = "high" | "medium" | "low";
export type ReportAutomationTriggerSeverity = "critical" | "review" | "info";
export type ReportAutomationRunbookPhase = "signal" | "review" | "deliver";
export type ReportAutomationHealthVariant = "success" | "warning" | "danger";
export type ReportAutomationHealthTrendDirection = "up" | "down" | "flat" | "new";
export type ReportAutomationHealthTrendVariant = "success" | "warning" | "neutral" | "info";
export type ReportProductDepthAreaId =
  | "report-discovery"
  | "role-workflows"
  | "report-automation"
  | "advisory-management"
  | "accounting-data-depth";
export type ReportProductDepthStatus = "working" | "hardening" | "data-needed";
export type ReportEvidenceCheckpointStatus = "current-proxy" | "missing-source" | "guardrail";
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

export interface ReportAutomationRunbookStep {
  id: string;
  phase: ReportAutomationRunbookPhase;
  title: string;
  outcome: string;
  actionLabel: string;
  href: string;
  reportIds: string[];
  triggerRuleIds: string[];
  workflowStepIds: string[];
  comparisonPresetIds: string[];
  automationStarterIds: string[];
  deliverySubscriptionIds: string[];
  decisionShortcutIds: string[];
  savedViewIds: string[];
  reportSuiteIds: string[];
}

export interface ReportQuickAccessProfile {
  id: string;
  persona: ReportPersona;
  title: string;
  outcome: string;
  reportIds: string[];
  comparisonPresetId: string;
  automationStarterId: string;
  deliverySubscriptionId: string;
  commandKeywords: string;
}

export interface ReportSavedViewProfile {
  id: string;
  persona: ReportPersona;
  title: string;
  description: string;
  reportId: string;
  dateRangePreset: string;
  comparisonPeriod: string;
  basis: string;
  currency: string;
  dimension: string;
  exportFormat: string;
  automationTrigger: string;
  comparisonPresetId: string;
  automationStarterId: string;
  commandKeywords: string;
}

export interface ReportSuiteProfile {
  id: string;
  persona: ReportPersona;
  title: string;
  outcome: string;
  workflow: string;
  reportIds: string[];
  comparisonPresetId: string;
  packTemplateId: string;
  automationStarterId: string;
  deliverySubscriptionId: string;
  triggerRuleIds: string[];
  decisionShortcutId: string;
  savedViewIds: string[];
  primaryAction: string;
  commandKeywords: string;
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

export interface ReportManagementBriefNarrativeSection {
  id: string;
  title: string;
  prompt: string;
  sourceReportIds: string[];
  comparisonMetricIds: string[];
}

export interface ReportManagementBriefDimension {
  id: string;
  label: string;
  reportId: string;
  dimension: string;
  question: string;
}

export interface ReportManagementBriefKpiWidget {
  id: string;
  label: string;
  metricId: string;
  display: "currency" | "percent" | "count" | "days";
  question: string;
}

export interface ReportManagementBriefBatchAction {
  label: string;
  detail: string;
}

export interface ReportManagementBriefProfile {
  id: string;
  persona: ReportPersona;
  title: string;
  audience: string;
  outcome: string;
  reportSuiteId: string;
  packTemplateId: string;
  comparisonPresetId: string;
  automationStarterId: string;
  deliverySubscriptionId: string;
  decisionShortcutId: string;
  savedViewId: string;
  reportIds: string[];
  kpiMetricIds: string[];
  kpiWidgets: ReportManagementBriefKpiWidget[];
  narrativeSections: ReportManagementBriefNarrativeSection[];
  dimensionBreakdowns: ReportManagementBriefDimension[];
  batchAction?: ReportManagementBriefBatchAction;
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

export interface ReportAutomationOutcomeSignal {
  id: string;
  label: string;
  reportIds: string[];
  currentProxy: string;
  missingCounter: string;
  guardrail: string;
}

export interface ReportAutomationImpactProfile {
  persona: ReportPersona;
  title: string;
  outcome: string;
  manualWorkLabel: string;
  timeSavedLabel: string;
  itemUnitLabel: string;
  hoursPerReadyRule: number;
  hoursPerReadyDelivery: number;
  hoursPerReadyReport: number;
  itemsPerReadyRule: number;
  itemsPerReadyDelivery: number;
  reportIds: string[];
  automationStarterIds: string[];
  triggerRuleIds: string[];
  evidence: Array<{
    label: string;
    detail: string;
  }>;
  outcomeSignals: ReportAutomationOutcomeSignal[];
  commandKeywords: string;
}

export interface ReportAutomationImpactInput {
  readyRuleCount: number;
  readyDeliveryCount: number;
  readyReportCount: number;
  openWorkItemCount?: number;
  recommendationCount?: number;
  amountAtRisk?: number;
}

export interface ReportAutomationImpactEstimate {
  estimatedMonthlyHoursSaved: number;
  estimatedAutomatedItemCount: number;
  reviewItemCount: number;
  amountAtRisk: number;
  coverageScore: number;
  status: "compounding" | "review" | "setup";
  statusLabel: string;
  summary: string;
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

export interface ReportWorkspaceSetupStep {
  id: string;
  title: string;
  outcome: string;
  section: ReportSection;
  command: ReportDeliveryAutomationCommand;
  reportIds: string[];
  comparisonPresetId?: string;
  automationStarterId?: string;
  deliverySubscriptionId?: string;
}

export interface ReportRoleWorkflowStep {
  id: string;
  title: string;
  outcome: string;
  cadence: string;
  primaryAction: string;
  section: ReportSection;
  reportIds: string[];
  comparisonPresetId: string;
  automationStarterId: string;
  deliverySubscriptionId: string;
  decisionShortcutId: string;
  savedViewId: string;
  reportSuiteId: string;
  commandKeywords: string;
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
  setupChecklist: ReportWorkspaceSetupStep[];
  workflowSteps: ReportRoleWorkflowStep[];
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

export interface ReportProductDepthSubgoal {
  id: string;
  title: string;
  outcome: string;
  status: ReportProductDepthStatus;
  personas: ReportPersona[];
  reportIds: string[];
  comparisonPresetIds: string[];
  automationStarterIds: string[];
  triggerRuleIds: string[];
  deliverySubscriptionIds: string[];
  decisionShortcutIds: string[];
  savedViewIds: string[];
  reportSuiteIds: string[];
  workflowSearch: string;
  evidence: string;
  nextAction: string;
  dataDependency?: string;
  evidenceCheckpoints?: ReportEvidenceCheckpoint[];
  sourceDrilldownTargets?: ReportSourceDrilldownTarget[];
  requiredSourceRecords?: ReportDataDepthSourceRecord[];
}

export interface ReportEvidenceCheckpoint {
  id: string;
  status: ReportEvidenceCheckpointStatus;
  label: string;
  detail: string;
}

export interface ReportSourceDrilldownTarget {
  id: string;
  title: string;
  personas: ReportPersona[];
  href: string;
  reportIds: string[];
  sourceEntities: string[];
  availableEvidence: string;
  universalLinkGap: string;
}

export interface ReportDataDepthSourceRecord {
  id: string;
  label: string;
  systemOfRecord: string;
  unlocks: string;
}

export interface ReportProductDepthArea {
  id: ReportProductDepthAreaId;
  title: string;
  objective: string;
  status: ReportProductDepthStatus;
  commandKeywords: string;
  subgoals: ReportProductDepthSubgoal[];
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
    setupChecklist: [
      {
        id: "owner-open-command-reports",
        title: "Open owner command reports",
        outcome: "Start with cash, customer, profit, tax, and budget reports in one board.",
        section: "quick-access",
        command: "review",
        reportIds: [
          "cash-flow-forecast",
          "customer-balances",
          "ar-aging",
          "profit-loss",
          "vat-summary",
          "budget-actual",
        ],
      },
      {
        id: "owner-compare-profit-cash",
        title: "Compare profit and cash movement",
        outcome: "Review current-vs-prior movement before spend, collections, or tax decisions.",
        section: "recommendations",
        command: "comparison",
        reportIds: ["profit-loss", "period-comparison", "cash-flow-forecast"],
        comparisonPresetId: "owner-profit-cash-movement",
      },
      {
        id: "owner-start-cash-autopilot",
        title: "Start cash control autopilot",
        outcome: "Turn overdue customers and runway risk into owner actions.",
        section: "automation-starters",
        command: "review",
        reportIds: ["customer-balances", "ar-aging", "cash-flow-forecast"],
        automationStarterId: "owner-cash-control-autopilot",
      },
      {
        id: "owner-schedule-executive-pack",
        title: "Schedule weekly executive pack",
        outcome: "Send owner reports when collections, VAT, or cash warnings are open.",
        section: "delivery-subscriptions",
        command: "queue",
        reportIds: ["profit-loss", "cash-flow-forecast", "customer-balances", "vat-summary"],
        deliverySubscriptionId: "owner-weekly-executive-delivery",
      },
    ],
    workflowSteps: [
      {
        id: "owner-review-cash-runway",
        title: "Review cash runway and collections",
        outcome: "Know the next cash pressure, overdue customer work, and revenue movement.",
        cadence: "Weekly",
        primaryAction: "Open cash workflow",
        section: "quick-access",
        reportIds: [
          "cash-flow-forecast",
          "customer-balances",
          "ar-aging",
          "profit-loss",
          "sales-product-service",
        ],
        comparisonPresetId: "owner-profit-cash-movement",
        automationStarterId: "owner-cash-control-autopilot",
        deliverySubscriptionId: "owner-weekly-executive-delivery",
        decisionShortcutId: "owner-next-30-days",
        savedViewId: "owner-cash-runway-view",
        reportSuiteId: "owner-cash-control-suite",
        commandKeywords: "owner weekly cash runway collections overdue customer revenue movement",
      },
      {
        id: "owner-check-tax-payroll",
        title: "Check tax, payroll, and spend exposure",
        outcome:
          "Confirm tax funding, payroll readiness, and vendor pressure before cash is committed.",
        cadence: "Weekly before pay run and filing windows",
        primaryAction: "Open tax workflow",
        section: "recommendations",
        reportIds: [
          "vat-summary",
          "vat-return",
          "corporate-tax-estimate",
          "budget-actual",
          "vendor-balances",
          "payroll-summary",
        ],
        comparisonPresetId: "owner-tax-collections-pressure",
        automationStarterId: "owner-tax-spend-autopilot",
        deliverySubscriptionId: "owner-tax-deadline-delivery",
        decisionShortcutId: "owner-tax-payroll-ready",
        savedViewId: "owner-tax-spend-view",
        reportSuiteId: "owner-tax-spend-suite",
        commandKeywords: "owner tax payroll vat corporate tax spend exposure vendor budget",
      },
      {
        id: "owner-clear-operations-approvals",
        title: "Clear operations approval queues",
        outcome:
          "Review payables, claims, inventory, assets, and payroll queues before approvals move.",
        cadence: "Twice weekly",
        primaryAction: "Open operations workflow",
        section: "automation-operations",
        reportIds: [
          "vendor-balances",
          "ap-aging",
          "expense-claims",
          "inventory-valuation",
          "fixed-asset-register",
          "payroll-summary",
        ],
        comparisonPresetId: "owner-operations-payroll-assets-movement",
        automationStarterId: "owner-tax-spend-autopilot",
        deliverySubscriptionId: "owner-tax-deadline-delivery",
        decisionShortcutId: "owner-automation-readiness",
        savedViewId: "owner-operations-control-view",
        reportSuiteId: "owner-tax-spend-suite",
        commandKeywords: "owner operations approvals payables claims inventory assets payroll",
      },
      {
        id: "owner-send-executive-pack",
        title: "Send the executive pack",
        outcome:
          "Deliver the weekly owner pack after cash, tax, and operations exceptions are reviewed.",
        cadence: "Monday morning and month-end",
        primaryAction: "Queue owner pack",
        section: "delivery-subscriptions",
        reportIds: [
          "profit-loss",
          "cash-flow-forecast",
          "customer-balances",
          "vat-summary",
          "budget-actual",
        ],
        comparisonPresetId: "owner-profit-cash-movement",
        automationStarterId: "owner-cash-control-autopilot",
        deliverySubscriptionId: "owner-weekly-executive-delivery",
        decisionShortcutId: "owner-customers-services-attention",
        savedViewId: "owner-cash-runway-view",
        reportSuiteId: "owner-cash-control-suite",
        commandKeywords: "owner executive pack weekly delivery cash tax operations reviewed",
      },
    ],
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
    setupChecklist: [
      {
        id: "freelancer-open-client-reports",
        title: "Open freelancer client reports",
        outcome:
          "Start with unpaid invoices, client revenue, service mix, cash, and tax readiness.",
        section: "quick-access",
        command: "review",
        reportIds: [
          "invoice-status",
          "revenue-customer",
          "sales-product-service",
          "customer-balances",
          "cash-flow-forecast",
          "vat-summary",
        ],
      },
      {
        id: "freelancer-compare-client-income",
        title: "Compare client income movement",
        outcome: "Spot concentration, unpaid work, and revenue movement before follow-up.",
        section: "recommendations",
        command: "comparison",
        reportIds: ["invoice-status", "revenue-customer", "period-comparison"],
        comparisonPresetId: "freelancer-client-income-movement",
      },
      {
        id: "freelancer-start-client-chase",
        title: "Start client chase autopilot",
        outcome: "Turn overdue client invoices into mobile follow-up tasks.",
        section: "automation-starters",
        command: "review",
        reportIds: ["invoice-status", "customer-balances", "ar-aging"],
        automationStarterId: "freelancer-client-chase-autopilot",
      },
      {
        id: "freelancer-schedule-client-pack",
        title: "Schedule client chase pack",
        outcome: "Send mobile client income and tax-readiness packs before review windows.",
        section: "delivery-subscriptions",
        command: "queue",
        reportIds: ["invoice-status", "revenue-customer", "cash-flow-forecast", "vat-summary"],
        deliverySubscriptionId: "freelancer-client-chase-delivery",
      },
    ],
    workflowSteps: [
      {
        id: "freelancer-chase-client-cash",
        title: "Chase client cash",
        outcome: "Prioritize unpaid invoices, client concentration, and next follow-up actions.",
        cadence: "Weekly and before project milestones",
        primaryAction: "Open client workflow",
        section: "quick-access",
        reportIds: [
          "invoice-status",
          "revenue-customer",
          "customer-balances",
          "ar-aging",
          "cash-flow-forecast",
        ],
        comparisonPresetId: "freelancer-client-income-movement",
        automationStarterId: "freelancer-client-chase-autopilot",
        deliverySubscriptionId: "freelancer-client-chase-delivery",
        decisionShortcutId: "freelancer-cash-chase",
        savedViewId: "freelancer-client-income-view",
        reportSuiteId: "freelancer-client-income-suite",
        commandKeywords: "freelancer client cash chase unpaid invoices follow up concentration",
      },
      {
        id: "freelancer-close-monthly-tax",
        title: "Close monthly tax work",
        outcome: "Clear expenses, receipt gaps, VAT exposure, and monthly profit movement.",
        cadence: "Month-end",
        primaryAction: "Open tax-close workflow",
        section: "recommendations",
        reportIds: [
          "expenses-category",
          "expenses-vendor",
          "vat-summary",
          "vat-return",
          "corporate-tax-estimate",
          "profit-loss",
        ],
        comparisonPresetId: "freelancer-tax-spend-runway",
        automationStarterId: "freelancer-tax-close-autopilot",
        deliverySubscriptionId: "freelancer-monthly-close-delivery",
        decisionShortcutId: "freelancer-monthly-close-blockers",
        savedViewId: "freelancer-tax-close-view",
        reportSuiteId: "freelancer-tax-close-suite",
        commandKeywords: "freelancer monthly tax close expenses receipts vat profit",
      },
      {
        id: "freelancer-review-obligations",
        title: "Review obligations and assets",
        outcome:
          "Check payables, budget pressure, claims, and asset depreciation before month close.",
        cadence: "Weekly in the last half of the month",
        primaryAction: "Open obligations workflow",
        section: "automation-operations",
        reportIds: [
          "vendor-balances",
          "ap-aging",
          "budget-actual",
          "fixed-asset-register",
          "depreciation-schedule",
          "expense-claims",
        ],
        comparisonPresetId: "freelancer-tax-payables-assets-movement",
        automationStarterId: "freelancer-tax-close-autopilot",
        deliverySubscriptionId: "freelancer-monthly-close-delivery",
        decisionShortcutId: "freelancer-tax-ready-this-month",
        savedViewId: "freelancer-obligations-view",
        reportSuiteId: "freelancer-tax-close-suite",
        commandKeywords: "freelancer obligations payables budget claims assets depreciation",
      },
      {
        id: "freelancer-send-client-close-pack",
        title: "Send the client and close pack",
        outcome: "Send client follow-up and monthly close reports after blockers are reviewed.",
        cadence: "Weekly client chase plus month-end",
        primaryAction: "Queue freelancer pack",
        section: "delivery-subscriptions",
        reportIds: [
          "invoice-status",
          "revenue-customer",
          "cash-flow-forecast",
          "expenses-category",
          "vat-summary",
        ],
        comparisonPresetId: "freelancer-client-income-movement",
        automationStarterId: "freelancer-client-chase-autopilot",
        deliverySubscriptionId: "freelancer-client-chase-delivery",
        decisionShortcutId: "freelancer-client-concentration",
        savedViewId: "freelancer-client-income-view",
        reportSuiteId: "freelancer-client-income-suite",
        commandKeywords: "freelancer client close pack delivery invoice tax reviewed",
      },
    ],
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
    setupChecklist: [
      {
        id: "accountant-open-close-reports",
        title: "Open accountant close reports",
        outcome: "Start with trial balance, ledger, VAT, close status, audit, and consolidation.",
        section: "quick-access",
        command: "review",
        reportIds: [
          "trial-balance",
          "general-ledger",
          "account-transactions",
          "vat-return",
          "month-end-close-status",
          "audit-trail",
        ],
      },
      {
        id: "accountant-compare-close-review",
        title: "Compare close review movement",
        outcome: "Explain current-vs-prior close, tax, and advisory movements before handoff.",
        section: "recommendations",
        command: "comparison",
        reportIds: ["trial-balance", "period-comparison", "profit-loss"],
        comparisonPresetId: "accountant-close-review-movement",
      },
      {
        id: "accountant-start-close-autopilot",
        title: "Start close review autopilot",
        outcome: "Route imbalance, ledger-source gaps, and risky edits into reviewer queues.",
        section: "automation-starters",
        command: "review",
        reportIds: ["trial-balance", "general-ledger", "audit-trail"],
        automationStarterId: "accountant-close-review-autopilot",
      },
      {
        id: "accountant-schedule-workpaper-pack",
        title: "Schedule close workpaper pack",
        outcome: "Deliver workpapers only after close exceptions and tax gaps are reviewed.",
        section: "delivery-subscriptions",
        command: "queue",
        reportIds: ["trial-balance", "general-ledger", "vat-return", "month-end-close-status"],
        deliverySubscriptionId: "accountant-close-workpaper-delivery",
      },
    ],
    workflowSteps: [
      {
        id: "accountant-run-close-review",
        title: "Run close workpaper review",
        outcome: "Review trial balance, ledger sources, audit activity, and close exceptions.",
        cadence: "Daily during close",
        primaryAction: "Open close workflow",
        section: "quick-access",
        reportIds: [
          "trial-balance",
          "general-ledger",
          "account-transactions",
          "month-end-close-status",
          "audit-trail",
        ],
        comparisonPresetId: "accountant-close-review-movement",
        automationStarterId: "accountant-close-review-autopilot",
        deliverySubscriptionId: "accountant-close-workpaper-delivery",
        decisionShortcutId: "accountant-close-blockers",
        savedViewId: "accountant-close-review-view",
        reportSuiteId: "accountant-close-suite",
        commandKeywords: "accountant close workpaper review trial balance ledger audit exceptions",
      },
      {
        id: "accountant-clear-tax-asset-review",
        title: "Clear tax and asset review",
        outcome: "Check VAT, corporate tax, payables, payroll, depreciation, and claims.",
        cadence: "Before reviewer handoff",
        primaryAction: "Open tax workpapers",
        section: "recommendations",
        reportIds: [
          "vat-summary",
          "vat-return",
          "corporate-tax-estimate",
          "vendor-balances",
          "fixed-asset-register",
          "depreciation-schedule",
          "expense-claims",
        ],
        comparisonPresetId: "accountant-tax-payables-asset-review",
        automationStarterId: "accountant-close-review-autopilot",
        deliverySubscriptionId: "accountant-close-workpaper-delivery",
        decisionShortcutId: "accountant-operational-review",
        savedViewId: "accountant-tax-asset-review-view",
        reportSuiteId: "accountant-close-suite",
        commandKeywords: "accountant tax asset review vat corporate tax depreciation claims",
      },
      {
        id: "accountant-prepare-advisory-notes",
        title: "Prepare advisory notes",
        outcome:
          "Explain profit, cash, payroll, inventory, and consolidation movements for the client.",
        cadence: "After close review",
        primaryAction: "Open advisory workflow",
        section: "automation-operations",
        reportIds: [
          "profit-loss",
          "balance-sheet",
          "period-comparison",
          "cash-flow",
          "payroll-summary",
          "inventory-valuation",
          "consolidated-statements",
        ],
        comparisonPresetId: "accountant-operational-advisory-movement",
        automationStarterId: "accountant-advisory-pack-autopilot",
        deliverySubscriptionId: "accountant-advisory-pack-delivery",
        decisionShortcutId: "accountant-advisory-pack",
        savedViewId: "accountant-advisory-view",
        reportSuiteId: "accountant-advisory-suite",
        commandKeywords:
          "accountant advisory notes profit cash payroll inventory consolidation client",
      },
      {
        id: "accountant-send-client-pack",
        title: "Send client workpaper and advisory pack",
        outcome:
          "Deliver close workpapers or advisory reports after handoff gaps and review queues are clear.",
        cadence: "Month-end and advisory review",
        primaryAction: "Queue accountant pack",
        section: "delivery-subscriptions",
        reportIds: [
          "trial-balance",
          "general-ledger",
          "profit-loss",
          "period-comparison",
          "consolidated-statements",
        ],
        comparisonPresetId: "accountant-close-review-movement",
        automationStarterId: "accountant-close-review-autopilot",
        deliverySubscriptionId: "accountant-close-workpaper-delivery",
        decisionShortcutId: "accountant-pack-ready-to-send",
        savedViewId: "accountant-close-review-view",
        reportSuiteId: "accountant-close-suite",
        commandKeywords: "accountant client pack workpaper advisory delivery handoff reviewed",
      },
    ],
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

export const reportQuickAccessProfiles: ReportQuickAccessProfile[] = [
  {
    id: "owner-command-reports",
    persona: "owner",
    title: "Owner command reports",
    outcome:
      "Cash, customers, profit, tax, spend, operations, payroll, and asset reports for the owner or solo entrepreneur command board.",
    reportIds: [
      "cash-flow-forecast",
      "customer-balances",
      "ar-aging",
      "profit-loss",
      "vat-summary",
      "budget-actual",
      "balance-sheet",
      "cash-flow",
      "ap-aging",
      "vat-return",
      "period-comparison",
      "corporate-tax-estimate",
      "vendor-balances",
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
    ],
    comparisonPresetId: "owner-profit-cash-movement",
    automationStarterId: "owner-cash-control-autopilot",
    deliverySubscriptionId: "owner-weekly-executive-delivery",
    commandKeywords:
      "owner solo entrepreneur quick access reports cash customers profit tax budget",
  },
  {
    id: "freelancer-client-reports",
    persona: "freelancer",
    title: "Freelancer client reports",
    outcome:
      "Unpaid invoices, client revenue, service mix, balances, cash runway, tax readiness, payables, assets, and claims for mobile work.",
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "customer-balances",
      "cash-flow-forecast",
      "vat-summary",
      "balance-sheet",
      "expenses-category",
      "vat-return",
      "corporate-tax-estimate",
      "profit-loss",
      "cash-flow",
      "ar-aging",
      "ap-aging",
      "period-comparison",
      "vendor-balances",
      "budget-actual",
      "expenses-vendor",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
    ],
    comparisonPresetId: "freelancer-client-income-movement",
    automationStarterId: "freelancer-client-chase-autopilot",
    deliverySubscriptionId: "freelancer-client-chase-delivery",
    commandKeywords: "freelancer quick access reports invoices clients expenses cash runway vat",
  },
  {
    id: "accountant-close-reports",
    persona: "accountant",
    title: "Accountant close reports",
    outcome:
      "Trial balance, ledger, VAT, close, audit, consolidation, advisory, tax, operations, payroll, and asset reports for review work.",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "vat-return",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
      "profit-loss",
      "balance-sheet",
      "vat-summary",
      "cash-flow",
      "ar-aging",
      "ap-aging",
      "period-comparison",
      "fx-gains-losses",
      "corporate-tax-estimate",
      "customer-balances",
      "vendor-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "depreciation-schedule",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
    ],
    comparisonPresetId: "accountant-close-review-movement",
    automationStarterId: "accountant-close-review-autopilot",
    deliverySubscriptionId: "accountant-close-workpaper-delivery",
    commandKeywords:
      "accountant quick access reports trial balance ledger vat close audit consolidation",
  },
];

export const reportSavedViewProfiles: ReportSavedViewProfile[] = [
  {
    id: "owner-cash-runway-view",
    persona: "owner",
    title: "Owner cash runway view",
    description:
      "Forecast cash, overdue customers, and runway movement before weekly spend decisions.",
    reportId: "cash-flow-forecast",
    dateRangePreset: "Next 13 weeks",
    comparisonPeriod: "Prior 13-week forecast",
    basis: "Cash basis",
    currency: "AED",
    dimension: "Customer and due bucket",
    exportFormat: "Google Sheets pack",
    automationTrigger: "Warn when projected balance falls below upcoming payroll and bill needs.",
    comparisonPresetId: "owner-profit-cash-movement",
    automationStarterId: "owner-cash-control-autopilot",
    commandKeywords: "owner saved report view cash runway forecast overdue customers weekly spend",
  },
  {
    id: "owner-tax-spend-view",
    persona: "owner",
    title: "Owner tax and spend view",
    description:
      "Review VAT, corporate tax, vendor balances, and budget movement before filing or payroll.",
    reportId: "budget-actual",
    dateRangePreset: "Current tax period",
    comparisonPeriod: "Previous tax period",
    basis: "Accrual basis",
    currency: "AED",
    dimension: "Category and vendor",
    exportFormat: "Excel workbook",
    automationTrigger: "Create owner review when VAT payable, payroll, or budget variance moves.",
    comparisonPresetId: "owner-tax-collections-pressure",
    automationStarterId: "owner-tax-spend-autopilot",
    commandKeywords: "owner saved report view tax spend vat budget vendor payroll",
  },
  {
    id: "owner-operations-control-view",
    persona: "owner",
    title: "Owner operations control view",
    description:
      "Monitor payables, payroll, inventory, assets, and claims before cash gets committed.",
    reportId: "vendor-balances",
    dateRangePreset: "This month",
    comparisonPeriod: "Previous month and open bills",
    basis: "Accrual basis",
    currency: "AED",
    dimension: "Vendor, payroll run, and asset category",
    exportFormat: "Operations workbook",
    automationTrigger:
      "Queue owner review when payables, payroll, inventory, assets, or claims move outside guardrails.",
    comparisonPresetId: "owner-operations-payroll-assets-movement",
    automationStarterId: "owner-tax-spend-autopilot",
    commandKeywords: "owner saved report view operations payables payroll inventory assets claims",
  },
  {
    id: "freelancer-client-income-view",
    persona: "freelancer",
    title: "Freelancer client income view",
    description: "Track unpaid invoices, revenue concentration, and client follow-up from mobile.",
    reportId: "invoice-status",
    dateRangePreset: "Last 30 days",
    comparisonPeriod: "Previous 30 days",
    basis: "Invoice basis",
    currency: "AED",
    dimension: "Client",
    exportFormat: "Mobile Google Sheets pack",
    automationTrigger: "Send client-chase tasks when invoices age or concentration increases.",
    comparisonPresetId: "freelancer-client-income-movement",
    automationStarterId: "freelancer-client-chase-autopilot",
    commandKeywords: "freelancer saved report view client income invoices mobile chase",
  },
  {
    id: "freelancer-tax-close-view",
    persona: "freelancer",
    title: "Freelancer monthly tax-close view",
    description: "Close the month with expenses, receipts, VAT readiness, profit, and runway.",
    reportId: "expenses-category",
    dateRangePreset: "This month",
    comparisonPeriod: "Previous month",
    basis: "Cash plus posted receipts",
    currency: "AED",
    dimension: "Expense category",
    exportFormat: "Google Sheets tax pack",
    automationTrigger: "Request missing receipts and flag VAT-ready expenses before month end.",
    comparisonPresetId: "freelancer-tax-spend-runway",
    automationStarterId: "freelancer-tax-close-autopilot",
    commandKeywords: "freelancer saved report view monthly tax close receipts expenses vat",
  },
  {
    id: "freelancer-obligations-view",
    persona: "freelancer",
    title: "Freelancer obligations view",
    description:
      "Check payables, tax exposure, asset depreciation, budget, and claims in one pass.",
    reportId: "ap-aging",
    dateRangePreset: "This month",
    comparisonPeriod: "Previous month",
    basis: "Cash plus posted receipts",
    currency: "AED",
    dimension: "Vendor, tax period, and asset",
    exportFormat: "Mobile obligations pack",
    automationTrigger:
      "Create tax-close work when payables, depreciation, claims, or budget movement needs review.",
    comparisonPresetId: "freelancer-tax-payables-assets-movement",
    automationStarterId: "freelancer-tax-close-autopilot",
    commandKeywords: "freelancer saved report view obligations payables tax assets claims budget",
  },
  {
    id: "accountant-close-review-view",
    persona: "accountant",
    title: "Accountant close review view",
    description:
      "Review trial balance, ledger drill-down, VAT workpapers, audit activity, and close status.",
    reportId: "trial-balance",
    dateRangePreset: "Current close period",
    comparisonPeriod: "Prior close period",
    basis: "Accrual basis",
    currency: "AED",
    dimension: "Account and source",
    exportFormat: "Excel workpaper pack",
    automationTrigger: "Route imbalance, source gaps, and risky edits into reviewer queues.",
    comparisonPresetId: "accountant-close-review-movement",
    automationStarterId: "accountant-close-review-autopilot",
    commandKeywords: "accountant saved report view close review trial balance ledger audit",
  },
  {
    id: "accountant-advisory-view",
    persona: "accountant",
    title: "Accountant advisory view",
    description:
      "Package P&L movement, cash, payroll, inventory, and consolidation signals for client review.",
    reportId: "period-comparison",
    dateRangePreset: "Current month",
    comparisonPeriod: "Previous month and budget",
    basis: "Accrual basis",
    currency: "AED",
    dimension: "Client, entity, and category",
    exportFormat: "Client advisory workbook",
    automationTrigger: "Draft advisory notes when comparison or operational movements need review.",
    comparisonPresetId: "accountant-operational-advisory-movement",
    automationStarterId: "accountant-advisory-pack-autopilot",
    commandKeywords: "accountant saved report view advisory pnl cash payroll inventory client",
  },
  {
    id: "accountant-tax-asset-review-view",
    persona: "accountant",
    title: "Accountant tax and asset review view",
    description:
      "Review VAT, corporate tax, payables, payroll, depreciation, and claims before close handoff.",
    reportId: "corporate-tax-estimate",
    dateRangePreset: "Current close period",
    comparisonPeriod: "Prior close period",
    basis: "Accrual basis",
    currency: "AED",
    dimension: "Tax workpaper, vendor, payroll run, and asset",
    exportFormat: "Tax and asset workpaper pack",
    automationTrigger:
      "Route tax, payable, payroll, claim, and depreciation movements into reviewer notes.",
    comparisonPresetId: "accountant-tax-payables-asset-review",
    automationStarterId: "accountant-close-review-autopilot",
    commandKeywords:
      "accountant saved report view tax assets corporate tax payables payroll depreciation claims",
  },
];

export const reportSuiteProfiles: ReportSuiteProfile[] = [
  {
    id: "owner-cash-control-suite",
    persona: "owner",
    title: "Owner cash control suite",
    outcome:
      "A weekly command view for cash runway, overdue customers, profit movement, and sales mix.",
    workflow: "Cash control and collections",
    reportIds: [
      "cash-flow-forecast",
      "customer-balances",
      "ar-aging",
      "profit-loss",
      "sales-product-service",
    ],
    comparisonPresetId: "owner-profit-cash-movement",
    packTemplateId: "owner-weekly-command-pack",
    automationStarterId: "owner-cash-control-autopilot",
    deliverySubscriptionId: "owner-weekly-executive-delivery",
    triggerRuleIds: ["owner-cash-runway-risk", "owner-spend-variance-alert"],
    decisionShortcutId: "owner-next-30-days",
    savedViewIds: ["owner-cash-runway-view"],
    primaryAction: "Open cash suite",
    commandKeywords:
      "owner solo entrepreneur report suite cash control collections profit sales runway",
  },
  {
    id: "owner-tax-spend-suite",
    persona: "owner",
    title: "Owner tax and spend suite",
    outcome:
      "Tax, vendor, payroll, and budget reports grouped for filing readiness and spend control.",
    workflow: "Tax readiness and spend guardrails",
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "budget-actual",
      "vendor-balances",
      "payroll-summary",
      "expenses-category",
      "cost-center-profitability",
    ],
    comparisonPresetId: "owner-tax-collections-pressure",
    packTemplateId: "owner-tax-cash-pack",
    automationStarterId: "owner-tax-spend-autopilot",
    deliverySubscriptionId: "owner-tax-deadline-delivery",
    triggerRuleIds: ["owner-tax-deadline-exposure", "owner-spend-variance-alert"],
    decisionShortcutId: "owner-tax-payroll-ready",
    savedViewIds: ["owner-tax-spend-view", "owner-operations-control-view"],
    primaryAction: "Open tax suite",
    commandKeywords:
      "owner solo entrepreneur report suite tax spend vat corporate tax budget payroll",
  },
  {
    id: "freelancer-client-income-suite",
    persona: "freelancer",
    title: "Freelancer client income suite",
    outcome: "Mobile-first invoice, customer revenue, unpaid balance, profit, and runway reports.",
    workflow: "Client income and invoice follow-up",
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "customer-balances",
      "profit-loss",
      "balance-sheet",
      "cash-flow-forecast",
    ],
    comparisonPresetId: "freelancer-client-income-movement",
    packTemplateId: "freelancer-client-income-pack",
    automationStarterId: "freelancer-client-chase-autopilot",
    deliverySubscriptionId: "freelancer-client-chase-delivery",
    triggerRuleIds: ["freelancer-overdue-client-chase", "freelancer-client-concentration-warning"],
    decisionShortcutId: "freelancer-cash-chase",
    savedViewIds: ["freelancer-client-income-view"],
    primaryAction: "Open client suite",
    commandKeywords:
      "freelancer report suite client income invoices unpaid customers runway mobile",
  },
  {
    id: "freelancer-tax-close-suite",
    persona: "freelancer",
    title: "Freelancer tax-close suite",
    outcome:
      "Monthly profit, expense, receipt, VAT, tax, payables, asset, and runway reports for a lighter close routine.",
    workflow: "Monthly tax close",
    reportIds: [
      "profit-loss",
      "expenses-vendor",
      "expenses-category",
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
      "cash-flow-forecast",
    ],
    comparisonPresetId: "freelancer-tax-spend-runway",
    packTemplateId: "freelancer-monthly-tax-pack",
    automationStarterId: "freelancer-tax-close-autopilot",
    deliverySubscriptionId: "freelancer-monthly-close-delivery",
    triggerRuleIds: ["freelancer-receipt-gap-close", "freelancer-client-concentration-warning"],
    decisionShortcutId: "freelancer-monthly-close-blockers",
    savedViewIds: ["freelancer-tax-close-view", "freelancer-obligations-view"],
    primaryAction: "Open tax-close suite",
    commandKeywords: "freelancer report suite monthly tax close expenses receipts vat runway",
  },
  {
    id: "accountant-close-suite",
    persona: "accountant",
    title: "Accountant close suite",
    outcome:
      "Trial balance, ledger, close status, audit trail, and consolidation reports for review.",
    workflow: "Month-end close review",
    reportIds: [
      "trial-balance",
      "general-ledger",
      "account-transactions",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-close-review-movement",
    packTemplateId: "accountant-close-workpaper-pack",
    automationStarterId: "accountant-close-review-autopilot",
    deliverySubscriptionId: "accountant-close-workpaper-delivery",
    triggerRuleIds: ["accountant-close-exception-review", "accountant-tax-workpaper-gap"],
    decisionShortcutId: "accountant-close-blockers",
    savedViewIds: ["accountant-close-review-view", "accountant-tax-asset-review-view"],
    primaryAction: "Open close suite",
    commandKeywords:
      "accountant report suite close review trial balance ledger audit consolidation",
  },
  {
    id: "accountant-advisory-suite",
    persona: "accountant",
    title: "Accountant advisory suite",
    outcome: "Client-ready P&L, balance sheet, cash, budget, sales, and consolidation reports.",
    workflow: "Client advisory review",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "cost-center-profitability",
      "sales-product-service",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-operational-advisory-movement",
    packTemplateId: "accountant-advisory-review-pack",
    automationStarterId: "accountant-advisory-pack-autopilot",
    deliverySubscriptionId: "accountant-advisory-pack-delivery",
    triggerRuleIds: ["accountant-advisory-movement-note", "accountant-close-exception-review"],
    decisionShortcutId: "accountant-advisory-pack",
    savedViewIds: ["accountant-advisory-view"],
    primaryAction: "Open advisory suite",
    commandKeywords:
      "accountant report suite advisory client pnl balance sheet cash budget consolidation",
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
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
      impactByPersona: { owner: "high", freelancer: "medium", accountant: "high" },
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
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
    id: "cost-center-profitability",
    name: "Cost Center P&L",
    category: "Management",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Cost center / department",
    automation: "Cost variance review",
    decisionQuestion: "Which departments or cost centers are driving profit or loss?",
    href: "/cost-centers",
    commandIcon: "barChart",
    commandKeywords: "reports cost center department profitability pnl management",
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
    personas: ["owner", "freelancer", "accountant"],
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
    personas: ["freelancer", "accountant"],
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
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Claim status",
    automation: "Approval routing",
    decisionQuestion: "Which claims or reimbursements need approval or payment?",
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
      "balance-sheet",
      "cash-flow",
      "period-comparison",
      "customer-balances",
      "ar-aging",
      "invoice-status",
      "revenue-customer",
      "cash-flow-forecast",
      "budget-actual",
      "vat-summary",
      "sales-product-service",
      "inventory-valuation",
      "inventory-movement",
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
      "vendor-balances",
      "ap-aging",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "payroll-summary",
      "wps-sif-summary",
      "fixed-asset-register",
      "expense-claims",
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
      "sales-product-service",
      "customer-balances",
      "ar-aging",
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "period-comparison",
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
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
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
      "vat-summary",
      "vat-return",
      "fx-gains-losses",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "expenses-vendor",
      "expenses-category",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "depreciation-schedule",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
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
      "ar-aging",
      "customer-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "cost-center-profitability",
      "revenue-customer",
      "sales-product-service",
      "consolidated-statements",
    ],
    comparisonFocus: "Current vs prior period, cash movement, budget variance, and sales mix.",
    automationTrigger: "Send when comparison warnings or advisory review actions are open.",
    commandKeywords: "accountant advisory client review pnl balance sheet cash budget pack",
  },
];

export const reportManagementBriefProfiles: ReportManagementBriefProfile[] = [
  {
    id: "owner-weekly-executive-brief",
    persona: "owner",
    title: "Owner weekly executive brief",
    audience: "Owner, solo entrepreneur, and finance admin",
    outcome:
      "Turns cash runway, profit movement, customer exposure, and spend pressure into the weekly owner narrative.",
    reportSuiteId: "owner-cash-control-suite",
    packTemplateId: "owner-weekly-command-pack",
    comparisonPresetId: "owner-profit-cash-movement",
    automationStarterId: "owner-cash-control-autopilot",
    deliverySubscriptionId: "owner-weekly-executive-delivery",
    decisionShortcutId: "owner-next-30-days",
    savedViewId: "owner-cash-runway-view",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "cash-flow-forecast",
      "customer-balances",
      "ar-aging",
      "ap-aging",
      "budget-actual",
      "revenue-customer",
      "sales-product-service",
      "cost-center-profitability",
    ],
    kpiMetricIds: [
      "revenue",
      "net-profit",
      "net-margin",
      "cash-runway-days",
      "open-receivables",
      "open-payables",
      "budget-actual-variance",
      "top-customer-share",
      "top-product-service-share",
      "cost-center-net-income",
    ],
    kpiWidgets: [
      {
        id: "owner-runway-days",
        label: "Runway days",
        metricId: "cash-runway-days",
        display: "days",
        question: "How long can cash cover the current operating pace?",
      },
      {
        id: "owner-open-receivables",
        label: "Open receivables",
        metricId: "open-receivables",
        display: "currency",
        question: "How much customer cash is still outside the business?",
      },
      {
        id: "owner-net-margin",
        label: "Net margin",
        metricId: "net-margin",
        display: "percent",
        question: "Is profit quality moving in the right direction?",
      },
      {
        id: "owner-budget-variance",
        label: "Budget variance",
        metricId: "budget-actual-variance",
        display: "currency",
        question: "Which planned-vs-actual movement needs owner attention?",
      },
    ],
    narrativeSections: [
      {
        id: "owner-cash-position",
        title: "Cash position",
        prompt: "Explain runway, open receivables, open payables, and next cash pressure.",
        sourceReportIds: ["cash-flow-forecast", "customer-balances", "ar-aging", "ap-aging"],
        comparisonMetricIds: [
          "cash-runway-days",
          "projected-cash-shortfall",
          "open-receivables",
          "open-payables",
        ],
      },
      {
        id: "owner-profit-movement",
        title: "Profit movement",
        prompt: "Summarize revenue, margin, expense ratio, and budget movement for the week.",
        sourceReportIds: ["profit-loss", "period-comparison", "budget-actual"],
        comparisonMetricIds: ["revenue", "net-profit", "net-margin", "budget-actual-variance"],
      },
      {
        id: "owner-customer-mix",
        title: "Customer and service mix",
        prompt: "Call out customer concentration, service mix, and cost-center movement.",
        sourceReportIds: ["revenue-customer", "sales-product-service", "cost-center-profitability"],
        comparisonMetricIds: [
          "top-customer-share",
          "top-product-service-share",
          "cost-center-net-income",
        ],
      },
    ],
    dimensionBreakdowns: [
      {
        id: "owner-customer",
        label: "Customer concentration",
        reportId: "revenue-customer",
        dimension: "Customer",
        question: "Which customers explain revenue movement?",
      },
      {
        id: "owner-service",
        label: "Product/service mix",
        reportId: "sales-product-service",
        dimension: "Product or service",
        question: "Which services explain sales-mix movement?",
      },
      {
        id: "owner-cost-center",
        label: "Cost-center profitability",
        reportId: "cost-center-profitability",
        dimension: "Cost center",
        question: "Which departments explain profit movement?",
      },
    ],
    commandKeywords:
      "owner executive management brief cash profit runway customer service cost center narrative kpi",
  },
  {
    id: "freelancer-client-tax-brief",
    persona: "freelancer",
    title: "Freelancer client and tax brief",
    audience: "Freelancer or solo operator",
    outcome:
      "Combines client income, unpaid invoices, runway, expenses, and VAT readiness into one mobile brief.",
    reportSuiteId: "freelancer-client-income-suite",
    packTemplateId: "freelancer-client-income-pack",
    comparisonPresetId: "freelancer-client-income-movement",
    automationStarterId: "freelancer-client-chase-autopilot",
    deliverySubscriptionId: "freelancer-client-chase-delivery",
    decisionShortcutId: "freelancer-client-concentration",
    savedViewId: "freelancer-client-income-view",
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "customer-balances",
      "ar-aging",
      "cash-flow-forecast",
      "profit-loss",
      "expenses-vendor",
      "expenses-category",
      "vat-summary",
    ],
    kpiMetricIds: [
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "open-receivables",
      "cash-runway-days",
      "top-customer-share",
      "top-product-service-share",
      "net-profit",
    ],
    kpiWidgets: [
      {
        id: "freelancer-invoice-volume",
        label: "Invoice volume",
        metricId: "invoice-count",
        display: "count",
        question: "How much billable work moved through invoices this period?",
      },
      {
        id: "freelancer-paid-share",
        label: "Paid invoice share",
        metricId: "paid-invoice-share",
        display: "percent",
        question: "Are invoices turning into paid work fast enough?",
      },
      {
        id: "freelancer-client-concentration",
        label: "Top client share",
        metricId: "top-customer-share",
        display: "percent",
        question: "Is one client driving too much of income?",
      },
      {
        id: "freelancer-runway-days",
        label: "Runway days",
        metricId: "cash-runway-days",
        display: "days",
        question: "How long can current cash support solo operations?",
      },
    ],
    narrativeSections: [
      {
        id: "freelancer-client-cash",
        title: "Client cash",
        prompt: "Explain unpaid client work, invoice volume, paid share, and runway pressure.",
        sourceReportIds: ["invoice-status", "customer-balances", "ar-aging", "cash-flow-forecast"],
        comparisonMetricIds: [
          "invoice-count",
          "paid-invoice-share",
          "open-receivables",
          "cash-runway-days",
        ],
      },
      {
        id: "freelancer-income-mix",
        title: "Income mix",
        prompt: "Call out customer and service concentration before capacity decisions.",
        sourceReportIds: ["revenue-customer", "sales-product-service", "profit-loss"],
        comparisonMetricIds: ["top-customer-share", "top-product-service-share", "net-profit"],
      },
      {
        id: "freelancer-tax-readiness",
        title: "Tax readiness",
        prompt: "Summarize VAT, expenses, and monthly close blockers before sharing the pack.",
        sourceReportIds: ["vat-summary", "expenses-category", "expenses-vendor"],
        comparisonMetricIds: ["vat-due", "expense-spend", "unposted-expense-share"],
      },
    ],
    dimensionBreakdowns: [
      {
        id: "freelancer-client",
        label: "Client revenue",
        reportId: "revenue-customer",
        dimension: "Client",
        question: "Which clients explain income concentration?",
      },
      {
        id: "freelancer-service",
        label: "Service mix",
        reportId: "sales-product-service",
        dimension: "Product or service",
        question: "Which services explain income movement?",
      },
      {
        id: "freelancer-expense",
        label: "Expense category",
        reportId: "expenses-category",
        dimension: "Category",
        question: "Which expense categories need receipt or VAT review?",
      },
    ],
    commandKeywords:
      "freelancer client tax management brief invoices income runway vat expenses narrative kpi",
  },
  {
    id: "accountant-advisory-management-brief",
    persona: "accountant",
    title: "Accountant advisory management brief",
    audience: "Accountant, reviewer, and client owner",
    outcome:
      "Packages operating movement, close context, KPI signals, and dimensional review into a client-ready advisory brief.",
    reportSuiteId: "accountant-advisory-suite",
    packTemplateId: "accountant-advisory-review-pack",
    comparisonPresetId: "accountant-operational-advisory-movement",
    automationStarterId: "accountant-advisory-pack-autopilot",
    deliverySubscriptionId: "accountant-advisory-pack-delivery",
    decisionShortcutId: "accountant-advisory-pack",
    savedViewId: "accountant-advisory-view",
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "period-comparison",
      "cash-flow",
      "budget-actual",
      "cost-center-profitability",
      "sales-product-service",
      "payroll-summary",
      "inventory-valuation",
      "consolidated-statements",
    ],
    kpiMetricIds: [
      "net-margin",
      "budget-actual-variance",
      "cash-runway-days",
      "payroll-expense-share",
      "inventory-review-items",
      "consolidated-margin",
      "cost-center-net-income",
      "top-product-service-share",
    ],
    kpiWidgets: [
      {
        id: "accountant-net-margin",
        label: "Client net margin",
        metricId: "net-margin",
        display: "percent",
        question: "Does the client margin movement need advisory explanation?",
      },
      {
        id: "accountant-budget-variance",
        label: "Budget variance",
        metricId: "budget-actual-variance",
        display: "currency",
        question: "Which planned-vs-actual movement should be explained?",
      },
      {
        id: "accountant-payroll-share",
        label: "Payroll expense share",
        metricId: "payroll-expense-share",
        display: "percent",
        question: "Is payroll changing the operating expense mix?",
      },
      {
        id: "accountant-group-margin",
        label: "Group margin",
        metricId: "consolidated-margin",
        display: "percent",
        question: "Is group profitability ready for management-pack review?",
      },
    ],
    narrativeSections: [
      {
        id: "accountant-operating-performance",
        title: "Operating performance",
        prompt: "Explain margin, cash, budget, and cost-center movement for client review.",
        sourceReportIds: ["profit-loss", "cash-flow", "budget-actual", "cost-center-profitability"],
        comparisonMetricIds: [
          "net-margin",
          "cash-runway-days",
          "budget-actual-variance",
          "cost-center-net-income",
        ],
      },
      {
        id: "accountant-operational-drivers",
        title: "Operational drivers",
        prompt: "Summarize payroll, inventory, and sales-mix items that need advisory notes.",
        sourceReportIds: ["payroll-summary", "inventory-valuation", "sales-product-service"],
        comparisonMetricIds: [
          "payroll-expense-share",
          "inventory-review-items",
          "top-product-service-share",
        ],
      },
      {
        id: "accountant-group-readiness",
        title: "Group readiness",
        prompt: "Explain consolidation movement and review items before client delivery.",
        sourceReportIds: ["consolidated-statements", "balance-sheet", "period-comparison"],
        comparisonMetricIds: [
          "consolidated-margin",
          "consolidated-net-profit",
          "consolidation-review-items",
        ],
      },
    ],
    dimensionBreakdowns: [
      {
        id: "accountant-cost-center",
        label: "Cost-center profitability",
        reportId: "cost-center-profitability",
        dimension: "Cost center",
        question: "Which departments explain operating movement?",
      },
      {
        id: "accountant-payroll",
        label: "Payroll mix",
        reportId: "payroll-summary",
        dimension: "Payroll run",
        question: "Which payroll runs affect expense mix?",
      },
      {
        id: "accountant-entity",
        label: "Entity roll-up",
        reportId: "consolidated-statements",
        dimension: "Entity",
        question: "Which entities drive group movement?",
      },
    ],
    batchAction: {
      label: "Prepare client batch",
      detail:
        "Use the advisory pack delivery and handoff guardrails as the batch-ready path until multi-client queue selection is added.",
    },
    commandKeywords:
      "accountant advisory management brief client kpi dimensional cost center payroll entity batch",
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
    reportIds: [
      "profit-loss",
      "period-comparison",
      "cash-flow",
      "cash-flow-forecast",
      "budget-actual",
      "revenue-customer",
      "sales-product-service",
      "expenses-category",
      "cost-center-profitability",
    ],
    metricIds: [
      "revenue",
      "net-profit",
      "net-margin",
      "expense-ratio",
      "revenue-expense-coverage",
      "break-even-gap",
      "burn-rate",
      "cash-runway-days",
      "projected-cash-shortfall",
      "cash-risk-week-count",
      "operating-cash-flow",
      "budget-actual-variance",
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "open-receivables",
      "open-invoice-count",
      "average-open-invoice-value",
      "open-invoice-value-share",
      "due-soon-invoice-count",
      "due-soon-invoice-value",
      "average-due-soon-invoice-value",
      "due-soon-invoice-share",
      "open-invoice-share",
      "overdue-receivables",
      "overdue-receivable-share",
      "overdue-invoice-count",
      "average-overdue-invoice-value",
      "average-overdue-invoice-days",
      "overdue-invoice-share",
      "open-payables",
      "open-bill-value-share",
      "open-cash-gap",
      "open-cash-coverage",
      "open-workload-gap",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "due-soon-cash-gap",
      "due-soon-cash-coverage",
      "due-soon-workload-gap",
      "open-bill-share",
      "overdue-payables",
      "overdue-cash-gap",
      "overdue-cash-coverage",
      "overdue-workload-gap",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "working-capital-proxy",
      "collection-days",
      "payable-days",
      "cash-conversion-gap",
      "top-customer-share",
      "top-product-service-share",
      "expense-spend",
      "receipt-count",
      "average-receipt-value",
      "vendor-bill-value",
      "vendor-bill-count",
      "average-bill-value",
      "top-vendor-share",
      "paid-bill-share",
      "unposted-expense-share",
      "unposted-receipt-count",
      "unposted-receipt-value",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "cost-center-net-income",
    ],
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
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "invoice-status",
      "customer-balances",
      "ar-aging",
    ],
    metricIds: [
      "vat-due",
      "corporate-tax-payable",
      "total-tax-exposure",
      "tax-exposure-rate",
      "tax-reserve-coverage",
      "tax-funding-gap",
      "tax-adjusted-runway-days",
      "invoice-value",
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "open-receivables",
      "open-invoice-count",
      "average-open-invoice-value",
      "open-invoice-value-share",
      "due-soon-invoice-count",
      "due-soon-invoice-value",
      "average-due-soon-invoice-value",
      "due-soon-invoice-share",
      "open-invoice-share",
      "overdue-receivables",
      "overdue-receivable-share",
      "overdue-invoice-count",
      "average-overdue-invoice-value",
      "average-overdue-invoice-days",
      "overdue-invoice-share",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "working-capital-proxy",
      "collection-days",
      "revenue",
    ],
    automationTrigger: "Escalate VAT payable or invoice movement into tax and collections lanes.",
    commandKeywords: "owner tax vat collections invoices overdue comparison",
  },
  {
    id: "owner-operations-payroll-assets-movement",
    persona: "owner",
    title: "Owner operations, payroll, and assets",
    question: "Did payroll, inventory, assets, or vendor pressure move enough to review?",
    baseline: "Current operations movement vs prior period with balance-sheet context.",
    primaryTab: "balances",
    reportIds: [
      "balance-sheet",
      "vendor-balances",
      "ap-aging",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
      "expenses-vendor",
    ],
    metricIds: [
      "liability-asset-ratio",
      "debt-to-equity-ratio",
      "payroll-cost",
      "payroll-run-count",
      "payroll-deduction-share",
      "average-payroll-run-value",
      "payroll-covered-employees",
      "payroll-cost-per-covered-employee",
      "payroll-approval-queue-count",
      "payroll-approval-queue-value",
      "payroll-readiness-queue-count",
      "payroll-readiness-queue-value",
      "wps-missing-run-count",
      "wps-missing-run-value",
      "payroll-expense-share",
      "wps-ready-share",
      "open-payables",
      "open-bill-value-share",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "open-bill-share",
      "overdue-payables",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "working-capital-proxy",
      "payable-days",
      "inventory-movement",
      "inventory-review-items",
      "inventory-review-share",
      "inventory-review-value",
      "fixed-asset-review-items",
      "fixed-asset-review-share",
      "fixed-asset-review-value",
      "expense-spend",
      "receipt-count",
      "average-receipt-value",
      "expense-claim-review-value",
      "expense-claim-review-count",
      "submitted-expense-claim-count",
      "submitted-expense-claim-value",
      "approved-expense-claim-count",
      "approved-expense-claim-value",
    ],
    automationTrigger:
      "Escalate payroll, vendor, asset, or stock movement into spend guardrail review.",
    commandKeywords: "owner operations payroll assets inventory vendor payable comparison movement",
  },
  {
    id: "freelancer-client-income-movement",
    persona: "freelancer",
    title: "Freelancer client income movement",
    question: "Which client income, invoice, or profit movement needs follow-up?",
    baseline: "Current client and invoice activity vs the prior period.",
    primaryTab: "sales",
    reportIds: [
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "customer-balances",
      "ar-aging",
      "profit-loss",
      "cash-flow",
      "period-comparison",
    ],
    metricIds: [
      "invoice-value",
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "open-receivables",
      "open-invoice-count",
      "average-open-invoice-value",
      "open-invoice-value-share",
      "due-soon-invoice-count",
      "due-soon-invoice-value",
      "average-due-soon-invoice-value",
      "due-soon-invoice-share",
      "open-invoice-share",
      "overdue-receivables",
      "overdue-receivable-share",
      "overdue-invoice-count",
      "average-overdue-invoice-value",
      "average-overdue-invoice-days",
      "overdue-invoice-share",
      "working-capital-proxy",
      "collection-days",
      "payable-days",
      "cash-conversion-gap",
      "top-customer-share",
      "top-product-service-share",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "revenue",
      "net-profit",
      "net-margin",
      "revenue-expense-coverage",
      "break-even-gap",
    ],
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
    metricIds: [
      "expense-spend",
      "receipt-count",
      "average-receipt-value",
      "unposted-expense-share",
      "unposted-receipt-count",
      "unposted-receipt-value",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "vat-due",
      "corporate-tax-payable",
      "total-tax-exposure",
      "tax-exposure-rate",
      "tax-reserve-coverage",
      "tax-funding-gap",
      "tax-adjusted-runway-days",
      "net-profit",
      "net-margin",
      "expense-ratio",
      "revenue-expense-coverage",
      "break-even-gap",
      "burn-rate",
      "cash-runway-days",
      "projected-cash-shortfall",
      "cash-risk-week-count",
      "operating-cash-flow",
    ],
    automationTrigger: "Create receipt, VAT, or runway review work when movement is unfavorable.",
    commandKeywords: "freelancer tax spend expenses vat runway comparison",
  },
  {
    id: "freelancer-tax-payables-assets-movement",
    persona: "freelancer",
    title: "Freelancer tax, payables, and assets",
    question: "Did tax, payables, claims, or asset depreciation change before month-end?",
    baseline: "Monthly close movement vs prior month with balance and asset context.",
    primaryTab: "balances",
    reportIds: [
      "balance-sheet",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
    ],
    metricIds: [
      "liability-asset-ratio",
      "debt-to-equity-ratio",
      "expense-spend",
      "receipt-count",
      "average-receipt-value",
      "vendor-bill-value",
      "vendor-bill-count",
      "average-bill-value",
      "top-vendor-share",
      "paid-bill-share",
      "open-payables",
      "open-bill-value-share",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "open-bill-share",
      "overdue-payables",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "working-capital-proxy",
      "payable-days",
      "vat-due",
      "corporate-tax-payable",
      "total-tax-exposure",
      "tax-exposure-rate",
      "tax-reserve-coverage",
      "tax-funding-gap",
      "tax-adjusted-runway-days",
      "budget-actual-variance",
      "expense-claim-review-value",
      "expense-claim-review-count",
      "submitted-expense-claim-count",
      "submitted-expense-claim-value",
      "approved-expense-claim-count",
      "approved-expense-claim-value",
      "unposted-expense-share",
      "unposted-receipt-count",
      "unposted-receipt-value",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "fixed-asset-review-items",
      "fixed-asset-review-share",
      "fixed-asset-review-value",
      "depreciation-review-items",
      "depreciation-review-value",
      "depreciation-ready-items",
      "depreciation-ready-share",
      "depreciation-estimate",
    ],
    automationTrigger:
      "Create tax-close tasks when payable, claim, depreciation, or budget movement needs review.",
    commandKeywords:
      "freelancer tax payables assets depreciation claims budget comparison month end",
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
      "account-transactions",
      "audit-trail",
      "fx-gains-losses",
      "vat-summary",
      "month-end-close-status",
      "consolidated-statements",
    ],
    metricIds: [
      "ledger-activity",
      "manual-ledger-share",
      "month-end-open-checks",
      "month-end-readiness",
      "audit-high-risk-event-count",
      "audit-high-risk-event-share",
      "audit-review-event-count",
      "audit-review-event-share",
      "fx-unrealized-exposure",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "net-profit",
      "consolidated-revenue",
      "consolidated-expenses",
      "consolidated-net-profit",
      "consolidated-margin",
      "consolidation-review-items",
    ],
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
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "ar-aging",
      "customer-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "inventory-valuation",
      "payroll-summary",
      "wps-sif-summary",
      "inventory-movement",
      "consolidated-statements",
      "period-comparison",
    ],
    metricIds: [
      "payroll-cost",
      "payroll-run-count",
      "payroll-deduction-share",
      "average-payroll-run-value",
      "payroll-covered-employees",
      "payroll-cost-per-covered-employee",
      "payroll-approval-queue-count",
      "payroll-approval-queue-value",
      "payroll-readiness-queue-count",
      "payroll-readiness-queue-value",
      "wps-missing-run-count",
      "wps-missing-run-value",
      "payroll-expense-share",
      "wps-ready-share",
      "inventory-movement",
      "inventory-review-items",
      "inventory-review-share",
      "inventory-review-value",
      "burn-rate",
      "cash-runway-days",
      "projected-cash-shortfall",
      "cash-risk-week-count",
      "operating-cash-flow",
      "budget-actual-variance",
      "net-margin",
      "expense-ratio",
      "revenue-expense-coverage",
      "break-even-gap",
      "liability-asset-ratio",
      "debt-to-equity-ratio",
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "open-receivables",
      "open-invoice-count",
      "average-open-invoice-value",
      "open-invoice-value-share",
      "due-soon-invoice-count",
      "due-soon-invoice-value",
      "average-due-soon-invoice-value",
      "due-soon-invoice-share",
      "open-invoice-share",
      "overdue-receivables",
      "overdue-receivable-share",
      "overdue-invoice-count",
      "average-overdue-invoice-value",
      "average-overdue-invoice-days",
      "overdue-invoice-share",
      "open-payables",
      "open-bill-value-share",
      "open-cash-gap",
      "open-cash-coverage",
      "open-workload-gap",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "due-soon-cash-gap",
      "due-soon-cash-coverage",
      "due-soon-workload-gap",
      "open-bill-share",
      "overdue-payables",
      "overdue-cash-gap",
      "overdue-cash-coverage",
      "overdue-workload-gap",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "working-capital-proxy",
      "collection-days",
      "payable-days",
      "cash-conversion-gap",
      "top-customer-share",
      "top-product-service-share",
      "cost-center-net-income",
      "cost-center-expenses",
      "receipt-count",
      "average-receipt-value",
      "unposted-expense-share",
      "unposted-receipt-count",
      "unposted-receipt-value",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "consolidated-net-profit",
    ],
    automationTrigger: "Add payroll, stock, or consolidation movement to advisory pack review.",
    commandKeywords: "accountant advisory payroll inventory consolidated comparison movement",
  },
  {
    id: "accountant-tax-payables-asset-review",
    persona: "accountant",
    title: "Accountant tax, payables, and asset review",
    question: "Which tax, payable, payroll, claim, or asset movements need reviewer notes?",
    baseline: "Current close workpaper movement vs the previous close period.",
    primaryTab: "balances",
    reportIds: [
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "inventory-valuation",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
      "payroll-summary",
      "wps-sif-summary",
    ],
    metricIds: [
      "vat-due",
      "corporate-tax-payable",
      "total-tax-exposure",
      "tax-exposure-rate",
      "tax-reserve-coverage",
      "tax-funding-gap",
      "tax-adjusted-runway-days",
      "vendor-bill-value",
      "vendor-bill-count",
      "average-bill-value",
      "top-vendor-share",
      "paid-bill-share",
      "open-payables",
      "open-bill-value-share",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "open-bill-share",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "payable-days",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "expense-claim-review-value",
      "expense-claim-review-count",
      "submitted-expense-claim-count",
      "submitted-expense-claim-value",
      "approved-expense-claim-count",
      "approved-expense-claim-value",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "fixed-asset-review-items",
      "fixed-asset-review-share",
      "fixed-asset-review-value",
      "depreciation-review-items",
      "depreciation-review-value",
      "depreciation-ready-items",
      "depreciation-ready-share",
      "depreciation-estimate",
      "payroll-cost",
      "payroll-run-count",
      "payroll-deduction-share",
      "average-payroll-run-value",
      "payroll-covered-employees",
      "payroll-cost-per-covered-employee",
      "payroll-approval-queue-count",
      "payroll-approval-queue-value",
      "payroll-readiness-queue-count",
      "payroll-readiness-queue-value",
      "wps-missing-run-count",
      "wps-missing-run-value",
      "wps-ready-share",
    ],
    automationTrigger:
      "Add tax, payable, payroll, and asset movement to close-review and advisory notes.",
    commandKeywords:
      "accountant tax payables assets depreciation payroll claims comparison close review",
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
      "balance-sheet",
      "cash-flow",
      "period-comparison",
      "invoice-status",
      "revenue-customer",
      "customer-balances",
      "ar-aging",
      "ap-aging",
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
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "vendor-balances",
      "payroll-summary",
      "wps-sif-summary",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "expense-claims",
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
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "ar-aging",
      "period-comparison",
      "invoice-status",
      "revenue-customer",
      "sales-product-service",
      "customer-balances",
      "cash-flow-forecast",
    ],
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
    reportIds: [
      "expenses-vendor",
      "expenses-category",
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
      "profit-loss",
    ],
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
      "vat-summary",
      "ar-aging",
      "ap-aging",
      "vat-return",
      "fx-gains-losses",
      "corporate-tax-estimate",
      "vendor-balances",
      "expenses-vendor",
      "expenses-category",
      "inventory-valuation",
      "fixed-asset-register",
      "depreciation-schedule",
      "wps-sif-summary",
      "expense-claims",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    playbookIds: ["accountant-close-review", "accountant-tax-workpapers"],
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
      "customer-balances",
      "invoice-status",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "payroll-summary",
      "cost-center-profitability",
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

export const reportAutomationImpactProfiles: ReportAutomationImpactProfile[] = [
  {
    persona: "owner",
    title: "Owner automation impact",
    outcome:
      "Shows how report packs turn cash control, tax readiness, and spend guardrails into fewer manual owner reviews.",
    manualWorkLabel: "Manual cash, tax, and spend checks avoided",
    timeSavedLabel: "Estimated owner/admin hours saved monthly",
    itemUnitLabel: "cash, tax, and spend actions",
    hoursPerReadyRule: 1.4,
    hoursPerReadyDelivery: 2.2,
    hoursPerReadyReport: 0.18,
    itemsPerReadyRule: 7,
    itemsPerReadyDelivery: 5,
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "vat-summary",
      "cash-flow",
      "customer-balances",
      "ar-aging",
      "ap-aging",
      "vat-return",
      "period-comparison",
      "corporate-tax-estimate",
      "vendor-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
    ],
    automationStarterIds: ["owner-cash-control-autopilot", "owner-tax-spend-autopilot"],
    triggerRuleIds: [
      "owner-cash-runway-risk",
      "owner-tax-deadline-exposure",
      "owner-spend-variance-alert",
    ],
    evidence: [
      {
        label: "Collections",
        detail: "Overdue balances and cash-pressure reports route to payment chasing.",
      },
      {
        label: "Tax readiness",
        detail: "VAT and corporate-tax reports feed filing checks before deadlines.",
      },
      {
        label: "Spend guardrails",
        detail: "Budget, vendor, payroll, and inventory movement become owner review queues.",
      },
    ],
    outcomeSignals: [
      {
        id: "owner-payments-recovered",
        label: "Payments recovered",
        reportIds: ["invoice-status", "customer-balances", "ar-aging", "cash-flow-forecast"],
        currentProxy:
          "Open receivables, overdue invoices, and cash runway pressure indicate where chasing is active.",
        missingCounter:
          "Persist reminders sent, customer responses, and invoice payments collected after automation.",
        guardrail:
          "Treat this as collections pressure and follow-up coverage, not proven recovered cash.",
      },
      {
        id: "owner-documents-cleared",
        label: "Documents cleared",
        reportIds: ["expenses-vendor", "expenses-category", "vat-return", "expense-claims"],
        currentProxy:
          "Expense, VAT, and claim review queues indicate document cleanup handled by owner workflows.",
        missingCounter:
          "Persist requested documents, uploaded evidence, reviewer acceptance, and close-out timestamps.",
        guardrail:
          "Treat this as document-review workload, not completed audit evidence collection.",
      },
      {
        id: "owner-items-auto-posted",
        label: "Items auto-posted",
        reportIds: ["expenses-category", "vendor-balances", "ap-aging"],
        currentProxy:
          "Spend and payable report queues show where auto-posting and vendor review reduce manual checks.",
        missingCounter:
          "Persist source documents posted automatically, manual overrides, and reversal outcomes.",
        guardrail:
          "Treat this as automation adoption context, not full GL posting automation coverage.",
      },
    ],
    commandKeywords:
      "owner automation impact time saved cash collections tax spend guardrails reports",
  },
  {
    persona: "freelancer",
    title: "Freelancer automation impact",
    outcome:
      "Shows how client-chase, receipt capture, and tax-close automations reduce weekly admin work.",
    manualWorkLabel: "Manual client, receipt, and tax-close tasks avoided",
    timeSavedLabel: "Estimated freelancer hours saved monthly",
    itemUnitLabel: "client, receipt, and tax-close actions",
    hoursPerReadyRule: 1.1,
    hoursPerReadyDelivery: 1.8,
    hoursPerReadyReport: 0.16,
    itemsPerReadyRule: 6,
    itemsPerReadyDelivery: 4,
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "vat-summary",
      "cash-flow",
      "ar-aging",
      "ap-aging",
      "vat-return",
      "period-comparison",
      "corporate-tax-estimate",
      "invoice-status",
      "customer-balances",
      "vendor-balances",
      "budget-actual",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
    ],
    automationStarterIds: ["freelancer-client-chase-autopilot", "freelancer-tax-close-autopilot"],
    triggerRuleIds: [
      "freelancer-overdue-client-chase",
      "freelancer-receipt-gap-close",
      "freelancer-client-concentration-warning",
    ],
    evidence: [
      {
        label: "Client follow-up",
        detail: "Unpaid invoice and client balance reports become mobile chasing work.",
      },
      {
        label: "Receipt capture",
        detail: "Expense and VAT reports keep missing receipts in the monthly close lane.",
      },
      {
        label: "Runway checks",
        detail: "Cash forecast and profit movement keep tax set-aside decisions visible.",
      },
    ],
    outcomeSignals: [
      {
        id: "freelancer-client-followups",
        label: "Client follow-ups sent",
        reportIds: ["invoice-status", "customer-balances", "ar-aging"],
        currentProxy:
          "Unpaid invoice, aging, and client balance reports identify follow-up work ready for automation.",
        missingCounter:
          "Persist client reminders sent, replies received, and invoices paid after each reminder.",
        guardrail: "Treat this as follow-up coverage, not guaranteed payment recovery.",
      },
      {
        id: "freelancer-receipts-cleared",
        label: "Receipts cleared",
        reportIds: ["expenses-category", "expenses-vendor", "vat-summary"],
        currentProxy:
          "Expense and VAT reports show missing or unposted receipt pressure during monthly close.",
        missingCounter:
          "Persist receipt requests, uploads, OCR acceptance, posting outcome, and reviewer edits.",
        guardrail: "Treat this as receipt cleanup pressure, not complete tax evidence readiness.",
      },
      {
        id: "freelancer-tax-blockers-resolved",
        label: "Tax blockers resolved",
        reportIds: ["vat-return", "corporate-tax-estimate", "profit-loss"],
        currentProxy:
          "VAT, corporate-tax, and profit reports show tax-close exposure and open review blockers.",
        missingCounter:
          "Persist blocker creation, owner acknowledgement, resolved timestamp, and filed/payment status.",
        guardrail: "Treat this as tax-close readiness, not filed tax or paid liability status.",
      },
    ],
    commandKeywords:
      "freelancer automation impact time saved invoices clients receipts tax reports",
  },
  {
    persona: "accountant",
    title: "Accountant automation impact",
    outcome:
      "Shows how close, tax, audit, and advisory report packs move work into reviewer queues across clients.",
    manualWorkLabel: "Manual close, tax, and advisory checks avoided",
    timeSavedLabel: "Estimated accountant/reviewer hours saved monthly",
    itemUnitLabel: "close, tax, and advisory actions",
    hoursPerReadyRule: 1.8,
    hoursPerReadyDelivery: 2.8,
    hoursPerReadyReport: 0.22,
    itemsPerReadyRule: 9,
    itemsPerReadyDelivery: 7,
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "vat-summary",
      "cash-flow",
      "ar-aging",
      "ap-aging",
      "trial-balance",
      "vat-return",
      "period-comparison",
      "fx-gains-losses",
      "general-ledger",
      "account-transactions",
      "corporate-tax-estimate",
      "customer-balances",
      "vendor-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "depreciation-schedule",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
    ],
    automationStarterIds: [
      "accountant-close-review-autopilot",
      "accountant-advisory-pack-autopilot",
    ],
    triggerRuleIds: [
      "accountant-close-exception-review",
      "accountant-tax-workpaper-gap",
      "accountant-advisory-movement-note",
    ],
    evidence: [
      {
        label: "Close review",
        detail: "Trial balance, ledger, and month-end reports route exceptions to reviewers.",
      },
      {
        label: "Tax workpapers",
        detail: "VAT, corporate tax, expense, and payroll reports feed workpaper readiness.",
      },
      {
        label: "Advisory packs",
        detail: "Comparison, cash, inventory, payroll, and consolidation signals become notes.",
      },
    ],
    outcomeSignals: [
      {
        id: "accountant-close-exceptions-resolved",
        label: "Close exceptions resolved",
        reportIds: ["trial-balance", "general-ledger", "month-end-close-status", "audit-trail"],
        currentProxy:
          "Close, ledger, and audit reports show reviewer queues and exception pressure.",
        missingCounter:
          "Persist exception tasks, assignees, resolution notes, reviewer approval, and final close timestamp.",
        guardrail: "Treat this as close-review workload, not proof of completed workpapers.",
      },
      {
        id: "accountant-anomalies-reviewed",
        label: "Anomalies reviewed",
        reportIds: ["audit-trail", "account-transactions", "expenses-vendor"],
        currentProxy:
          "Audit, account, and expense reports expose risky activity and unusual source rows for review.",
        missingCounter:
          "Persist anomaly decisions, false-positive flags, supporting evidence, and reviewer sign-off.",
        guardrail: "Treat this as anomaly triage, not a formal audit finding count.",
      },
      {
        id: "accountant-client-packs-sent",
        label: "Client packs sent",
        reportIds: ["period-comparison", "consolidated-statements", "profit-loss"],
        currentProxy:
          "Advisory and consolidation reports show pack readiness and client-review movement.",
        missingCounter:
          "Persist pack generation, handoff acknowledgement, delivery result, recipient opens, and resend outcomes.",
        guardrail: "Treat this as pack-readiness impact, not confirmed client advisory completion.",
      },
    ],
    commandKeywords:
      "accountant automation impact time saved close tax advisory workpapers reports",
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
      "cost-center-profitability",
    ],
    comparisonPresetId: "owner-tax-collections-pressure",
    automationStarterId: "owner-tax-spend-autopilot",
    commandKeywords: "owner tax payroll deadline vat corporate tax wps readiness",
  },
  {
    id: "owner-automation-readiness",
    persona: "owner",
    question: "Which automation queues need my approval today?",
    answer:
      "Check payroll approvals, WPS gaps, vendor pressure, stock review, assets, and claims before scheduled packs send.",
    primaryReportId: "payroll-summary",
    reportIds: [
      "payroll-summary",
      "wps-sif-summary",
      "vendor-balances",
      "ap-aging",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "expense-claims",
    ],
    comparisonPresetId: "owner-operations-payroll-assets-movement",
    automationStarterId: "owner-tax-spend-autopilot",
    commandKeywords:
      "owner automation readiness approvals payroll wps bills inventory assets claims queues",
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
    reportIds: [
      "expenses-category",
      "expenses-vendor",
      "vendor-balances",
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "budget-actual",
      "profit-loss",
    ],
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
    id: "freelancer-tax-ready-this-month",
    persona: "freelancer",
    question: "What should I fix before this month is tax-ready?",
    answer:
      "Review VAT, receipts, payables, claims, fixed assets, and depreciation before sharing the monthly tax-close pack.",
    primaryReportId: "vat-summary",
    reportIds: [
      "vat-summary",
      "vat-return",
      "expenses-category",
      "expenses-vendor",
      "vendor-balances",
      "expense-claims",
      "fixed-asset-register",
      "depreciation-schedule",
      "corporate-tax-estimate",
    ],
    comparisonPresetId: "freelancer-tax-payables-assets-movement",
    automationStarterId: "freelancer-tax-close-autopilot",
    commandKeywords:
      "freelancer tax ready month receipts vat payables claims depreciation monthly close",
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
      "cost-center-profitability",
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
      "cost-center-profitability",
      "fixed-asset-register",
      "consolidated-statements",
    ],
    comparisonPresetId: "accountant-operational-advisory-movement",
    automationStarterId: "accountant-advisory-pack-autopilot",
    commandKeywords: "accountant operations advisory payroll wps inventory fixed assets",
  },
  {
    id: "accountant-pack-ready-to-send",
    persona: "accountant",
    question: "Which report pack is not ready to send?",
    answer:
      "Review close status, audit activity, consolidation, ledger workpapers, VAT, and tax gaps before queueing scheduled packs.",
    primaryReportId: "month-end-close-status",
    reportIds: [
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
      "trial-balance",
      "general-ledger",
      "vat-return",
      "corporate-tax-estimate",
    ],
    comparisonPresetId: "accountant-close-review-movement",
    automationStarterId: "accountant-close-review-autopilot",
    commandKeywords:
      "accountant pack ready send delivery guardrails close audit consolidation tax workpapers",
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
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "period-comparison",
      "customer-balances",
      "ar-aging",
      "ap-aging",
      "invoice-status",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
    ],
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
    reportIds: [
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "expenses-vendor",
      "expenses-category",
      "expense-claims",
    ],
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
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "vendor-balances",
      "payroll-summary",
      "wps-sif-summary",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "expense-claims",
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
    reportIds: [
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "ar-aging",
      "period-comparison",
      "invoice-status",
      "customer-balances",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
    ],
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
    reportIds: [
      "profit-loss",
      "vat-summary",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "expenses-vendor",
      "expenses-category",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
      "cash-flow-forecast",
    ],
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
    reportIds: [
      "balance-sheet",
      "cash-flow",
      "period-comparison",
      "invoice-status",
      "customer-balances",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "profit-loss",
    ],
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
      "balance-sheet",
      "cash-flow",
      "trial-balance",
      "fx-gains-losses",
      "general-ledger",
      "account-transactions",
      "fixed-asset-register",
      "depreciation-schedule",
      "month-end-close-status",
      "audit-trail",
      "consolidated-statements",
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
      "ar-aging",
      "ap-aging",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "expenses-vendor",
      "expenses-category",
      "inventory-valuation",
      "fixed-asset-register",
      "depreciation-schedule",
      "wps-sif-summary",
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
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "ar-aging",
      "period-comparison",
      "customer-balances",
      "invoice-status",
      "cash-flow-forecast",
      "revenue-customer",
      "sales-product-service",
      "cost-center-profitability",
      "payroll-summary",
      "wps-sif-summary",
      "inventory-valuation",
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
      "balance-sheet",
      "cash-flow",
      "period-comparison",
      "customer-balances",
      "ar-aging",
      "invoice-status",
      "revenue-customer",
      "cash-flow-forecast",
      "budget-actual",
      "vat-summary",
      "sales-product-service",
      "inventory-valuation",
      "inventory-movement",
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
      "vendor-balances",
      "ap-aging",
      "expenses-vendor",
      "expenses-category",
      "cost-center-profitability",
      "payroll-summary",
      "wps-sif-summary",
      "fixed-asset-register",
      "expense-claims",
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
      "sales-product-service",
      "customer-balances",
      "ar-aging",
      "profit-loss",
      "balance-sheet",
      "cash-flow",
      "period-comparison",
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
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "budget-actual",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
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
      "vat-summary",
      "vat-return",
      "fx-gains-losses",
      "corporate-tax-estimate",
      "vendor-balances",
      "ap-aging",
      "expenses-vendor",
      "expenses-category",
      "inventory-valuation",
      "inventory-movement",
      "fixed-asset-register",
      "depreciation-schedule",
      "payroll-summary",
      "wps-sif-summary",
      "expense-claims",
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
      "ar-aging",
      "customer-balances",
      "invoice-status",
      "budget-actual",
      "cash-flow-forecast",
      "cost-center-profitability",
      "revenue-customer",
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

export const reportProductDepthAreas: ReportProductDepthArea[] = [
  {
    id: "report-discovery",
    title: "Find the right report",
    objective:
      "Start from report names, business questions, saved views, recommendations, or command shortcuts.",
    status: "hardening",
    commandKeywords:
      "report discovery search favorites pins recommendations guided questions drilldown report center",
    subgoals: [
      {
        id: "unified-report-center",
        title: "Unified report center",
        outcome:
          "Users can open every ready report from the catalog, workspace shortcuts, and command palette without knowing where the old page lived.",
        status: "working",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "profit-loss",
          "balance-sheet",
          "cash-flow",
          "vat-summary",
          "period-comparison",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-client-income-movement",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-client-chase-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [],
        deliverySubscriptionIds: [],
        decisionShortcutIds: [
          "owner-next-30-days",
          "freelancer-cash-chase",
          "accountant-close-blockers",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-client-income-view",
          "accountant-close-review-view",
        ],
        reportSuiteIds: [
          "owner-cash-control-suite",
          "freelancer-client-income-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "open report center ready reports command palette",
        evidence:
          "Catalog reports, ready-report shortcuts, workspaces, command-palette actions, and API contexts share the same report metadata.",
        nextAction:
          "Keep reducing standalone Advanced Reports entry points by deep-linking them through catalog actions.",
      },
      {
        id: "search-pins-recommendations",
        title: "Search, pins, and recommendations",
        outcome:
          "Users can search by business intent, keep preferred report actions pinned, and see next-best report actions ranked by signals.",
        status: "working",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: ["cash-flow-forecast", "invoice-status", "vendor-balances", "audit-trail"],
        comparisonPresetIds: [
          "owner-operations-payroll-assets-movement",
          "freelancer-tax-spend-runway",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "owner-spend-variance-alert",
          "freelancer-receipt-gap-close",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "owner-weekly-executive-delivery",
          "freelancer-monthly-close-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "owner-automation-readiness",
          "freelancer-tax-ready-this-month",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [
          "owner-operations-control-view",
          "freelancer-tax-close-view",
          "accountant-advisory-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-tax-close-suite",
          "accountant-advisory-suite",
        ],
        workflowSearch: "recommended reports pinned automation command search",
        evidence:
          "Workflow search, preferred persona/search storage, report-level favorites, recommendation cards, and pinned delivery commands run from shared catalog data.",
        nextAction:
          "Use report-open history to suggest pins automatically after enough role-specific usage data exists.",
      },
      {
        id: "guided-business-questions",
        title: "Guided business questions",
        outcome:
          "Owners, freelancers, and accountants can start from plain-language questions instead of report names.",
        status: "working",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "cash-flow-forecast",
          "customer-balances",
          "vat-summary",
          "payroll-summary",
          "invoice-status",
          "expenses-category",
          "revenue-customer",
          "month-end-close-status",
          "period-comparison",
        ],
        comparisonPresetIds: [
          "owner-tax-collections-pressure",
          "freelancer-tax-payables-assets-movement",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [],
        deliverySubscriptionIds: [],
        decisionShortcutIds: [
          "owner-next-30-days",
          "owner-customers-services-attention",
          "owner-tax-payroll-ready",
          "owner-automation-readiness",
          "freelancer-cash-chase",
          "freelancer-monthly-close-blockers",
          "freelancer-client-concentration",
          "freelancer-tax-ready-this-month",
          "accountant-close-blockers",
          "accountant-advisory-pack",
          "accountant-operational-review",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [],
        reportSuiteIds: [],
        workflowSearch: "business question decision shortcut report answer",
        evidence:
          "Decision shortcuts now cover four business questions per persona and link to reports, comparisons, and automations.",
        nextAction:
          "Promote the most-used question per persona into onboarding and dashboard default state after usage analytics exist.",
      },
      {
        id: "source-drilldowns",
        title: "Source transaction drilldowns",
        outcome:
          "Users can move from summary reports into transaction-level context when a variance or exception needs evidence.",
        status: "hardening",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "general-ledger",
          "account-transactions",
          "invoice-status",
          "expenses-vendor",
          "expenses-category",
          "audit-trail",
        ],
        comparisonPresetIds: [
          "accountant-close-review-movement",
          "freelancer-tax-spend-runway",
          "owner-tax-collections-pressure",
        ],
        automationStarterIds: [
          "accountant-close-review-autopilot",
          "freelancer-tax-close-autopilot",
          "owner-tax-spend-autopilot",
        ],
        triggerRuleIds: [
          "accountant-close-exception-review",
          "freelancer-receipt-gap-close",
          "owner-tax-deadline-exposure",
        ],
        deliverySubscriptionIds: ["accountant-close-workpaper-delivery"],
        decisionShortcutIds: ["accountant-close-blockers", "freelancer-monthly-close-blockers"],
        savedViewIds: ["accountant-close-review-view", "freelancer-tax-close-view"],
        reportSuiteIds: ["accountant-close-suite", "freelancer-tax-close-suite"],
        workflowSearch: "drilldown source transactions ledger audit invoices receipts",
        evidence:
          "Ledger, account transactions, invoice status, expense, and audit reports provide the drilldown targets for evidence review.",
        sourceDrilldownTargets: [
          {
            id: "ledger-journal-lines",
            title: "Ledger and journal lines",
            personas: ["accountant"],
            href: "/journal",
            reportIds: ["general-ledger", "account-transactions"],
            sourceEntities: ["journal entries", "ledger lines", "account activity"],
            availableEvidence:
              "General Ledger and Account Transactions users can open the journal workspace for source rows and account activity review.",
            universalLinkGap:
              "Summary metrics still need stable ledger-line IDs before every variance can deep-link to a filtered row.",
          },
          {
            id: "invoice-documents",
            title: "Invoice documents",
            personas: ["owner", "freelancer", "accountant"],
            href: "/invoices",
            reportIds: ["invoice-status"],
            sourceEntities: ["invoices", "customers", "payment status"],
            availableEvidence:
              "Invoice Status users can open invoice documents for draft, sent, overdue, and paid invoice context.",
            universalLinkGap:
              "Report rows need stable invoice IDs in every summary table before all collection signals can open the exact source row.",
          },
          {
            id: "expense-receipts",
            title: "Expense receipts",
            personas: ["owner", "freelancer", "accountant"],
            href: "/receipts",
            reportIds: ["expenses-vendor", "expenses-category"],
            sourceEntities: ["receipts", "vendors", "expense categories"],
            availableEvidence:
              "Expense by Vendor and Expense by Category users can open receipts for merchant, category, and posting evidence.",
            universalLinkGap:
              "Expense summary rows need stable receipt or ledger references before vendor/category variances can deep-link universally.",
          },
          {
            id: "audit-activity",
            title: "Audit activity",
            personas: ["accountant"],
            href: "/reports?tab=close&persona=accountant#audit-trail-title",
            reportIds: ["audit-trail"],
            sourceEntities: ["activity logs", "users", "changed entities"],
            availableEvidence:
              "Audit Trail users can open the close tab audit view for user activity, action, and entity summaries.",
            universalLinkGap:
              "Activity summaries need stable activity-log row IDs and entity references before every audit signal can open the exact event.",
          },
        ],
        nextAction:
          "Standardize source-row deep links from every summary metric to its supporting transaction table.",
        dataDependency:
          "Every summarized row needs a stable source entity ID or ledger line reference before deep links can be universal.",
      },
    ],
  },
  {
    id: "role-workflows",
    title: "Work by role",
    objective:
      "Move owners, freelancers, and accountants through the recurring report work each role needs to finish.",
    status: "hardening",
    commandKeywords:
      "role workflow owner freelancer accountant saved views handoff defaults onboarding report packs",
    subgoals: [
      {
        id: "owner-operating-rhythm",
        title: "Owner operating rhythm",
        outcome:
          "Owners can review runway, tax/payroll readiness, spend pressure, vendor exposure, inventory, assets, and approvals in one operating lane.",
        status: "working",
        personas: ["owner"],
        reportIds: [
          "cash-flow-forecast",
          "customer-balances",
          "ar-aging",
          "ap-aging",
          "vat-summary",
          "payroll-summary",
          "wps-sif-summary",
          "inventory-valuation",
          "fixed-asset-register",
          "expense-claims",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "owner-tax-collections-pressure",
          "owner-operations-payroll-assets-movement",
        ],
        automationStarterIds: ["owner-cash-control-autopilot", "owner-tax-spend-autopilot"],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "owner-tax-deadline-exposure",
          "owner-spend-variance-alert",
        ],
        deliverySubscriptionIds: ["owner-weekly-executive-delivery", "owner-tax-deadline-delivery"],
        decisionShortcutIds: [
          "owner-next-30-days",
          "owner-tax-payroll-ready",
          "owner-automation-readiness",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "owner-tax-spend-view",
          "owner-operations-control-view",
        ],
        reportSuiteIds: ["owner-cash-control-suite", "owner-tax-spend-suite"],
        workflowSearch: "owner cash runway tax payroll spend approvals",
        evidence:
          "Owner quick access, saved views, decision shortcuts, comparison presets, suites, and deliveries all point at the same operating reports.",
        nextAction:
          "Add a denser owner daily checklist that orders open approvals by cash impact and deadline.",
      },
      {
        id: "freelancer-operating-rhythm",
        title: "Freelancer operating rhythm",
        outcome:
          "Freelancers can chase clients, close monthly tax work, and clear receipt/payable cleanup from a lightweight workflow.",
        status: "working",
        personas: ["freelancer"],
        reportIds: [
          "invoice-status",
          "customer-balances",
          "revenue-customer",
          "cash-flow-forecast",
          "expenses-category",
          "expenses-vendor",
          "vendor-balances",
          "ap-aging",
          "vat-summary",
          "fixed-asset-register",
          "depreciation-schedule",
          "expense-claims",
        ],
        comparisonPresetIds: [
          "freelancer-client-income-movement",
          "freelancer-tax-spend-runway",
          "freelancer-tax-payables-assets-movement",
        ],
        automationStarterIds: [
          "freelancer-client-chase-autopilot",
          "freelancer-tax-close-autopilot",
        ],
        triggerRuleIds: [
          "freelancer-overdue-client-chase",
          "freelancer-receipt-gap-close",
          "freelancer-client-concentration-warning",
        ],
        deliverySubscriptionIds: [
          "freelancer-client-chase-delivery",
          "freelancer-monthly-close-delivery",
        ],
        decisionShortcutIds: [
          "freelancer-cash-chase",
          "freelancer-monthly-close-blockers",
          "freelancer-tax-ready-this-month",
        ],
        savedViewIds: [
          "freelancer-client-income-view",
          "freelancer-tax-close-view",
          "freelancer-obligations-view",
        ],
        reportSuiteIds: ["freelancer-client-income-suite", "freelancer-tax-close-suite"],
        workflowSearch: "freelancer client chasing monthly tax close receipts payables",
        evidence:
          "Freelancer workflow artifacts focus on client income, monthly tax close, obligations, receipts, and payables.",
        nextAction:
          "Add mobile-first task grouping for client reminders, missing receipts, and tax-close blockers.",
      },
      {
        id: "accountant-operating-rhythm",
        title: "Accountant operating rhythm",
        outcome:
          "Accountants can move through close workpapers, audit review, tax workpapers, advisory packs, and client delivery.",
        status: "working",
        personas: ["accountant"],
        reportIds: [
          "trial-balance",
          "general-ledger",
          "account-transactions",
          "vat-return",
          "corporate-tax-estimate",
          "month-end-close-status",
          "audit-trail",
          "consolidated-statements",
          "period-comparison",
        ],
        comparisonPresetIds: [
          "accountant-close-review-movement",
          "accountant-operational-advisory-movement",
          "accountant-tax-payables-asset-review",
        ],
        automationStarterIds: [
          "accountant-close-review-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "accountant-close-exception-review",
          "accountant-tax-workpaper-gap",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "accountant-close-workpaper-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "accountant-close-blockers",
          "accountant-advisory-pack",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [
          "accountant-close-review-view",
          "accountant-advisory-view",
          "accountant-tax-asset-review-view",
        ],
        reportSuiteIds: ["accountant-close-suite", "accountant-advisory-suite"],
        workflowSearch: "accountant close workpapers audit advisory client delivery",
        evidence:
          "Accountant suites and deliveries include close review, tax workpaper, audit, consolidation, and advisory reports.",
        nextAction:
          "Add portfolio-level batch controls that queue selected client packs together after guardrails pass.",
      },
      {
        id: "defaults-handoff-polish",
        title: "Defaults, saved views, and handoff polish",
        outcome:
          "Each role keeps sensible defaults, saved report views, and explicit handoff acknowledgement when scheduled delivery is blocked.",
        status: "hardening",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: ["cash-flow-forecast", "expenses-category", "trial-balance"],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-tax-spend-runway",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "freelancer-receipt-gap-close",
          "accountant-close-exception-review",
        ],
        deliverySubscriptionIds: [
          "owner-weekly-executive-delivery",
          "freelancer-monthly-close-delivery",
          "accountant-close-workpaper-delivery",
        ],
        decisionShortcutIds: [
          "owner-next-30-days",
          "freelancer-monthly-close-blockers",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-tax-close-view",
          "accountant-close-review-view",
        ],
        reportSuiteIds: [
          "owner-cash-control-suite",
          "freelancer-tax-close-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "saved views role defaults handoff acknowledgement delivery blocked",
        evidence:
          "Saved views, persona preferences, delivery settings, retry actions, and handoff acknowledgement are wired into report workflows.",
        nextAction:
          "Make handoff gaps editable inline so reviewers can resolve the missing owner/accountant action before queueing.",
      },
    ],
  },
  {
    id: "report-automation",
    title: "Automate report follow-up",
    objective:
      "Turn report movement into actions, delivery checks, retries, and automation impact tracking.",
    status: "hardening",
    commandKeywords:
      "report automation next best action task creation reminders delivery guardrails retry run history health impact",
    subgoals: [
      {
        id: "next-best-actions",
        title: "Next-best actions on report signals",
        outcome:
          "Report movement and open queues rank the next action before users manually interpret the numbers.",
        status: "working",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "cash-flow-forecast",
          "ar-aging",
          "ap-aging",
          "vat-return",
          "trial-balance",
          "inventory-valuation",
          "payroll-summary",
          "audit-trail",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-client-income-movement",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-client-chase-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "freelancer-overdue-client-chase",
          "accountant-close-exception-review",
        ],
        deliverySubscriptionIds: [],
        decisionShortcutIds: [
          "owner-next-30-days",
          "freelancer-cash-chase",
          "accountant-close-blockers",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-client-income-view",
          "accountant-close-review-view",
        ],
        reportSuiteIds: [
          "owner-cash-control-suite",
          "freelancer-client-income-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "next best action report signal queue comparison movement",
        evidence:
          "Persona recommendations combine automation queue counts and comparison movement into ranked report actions.",
        nextAction:
          "Attach one-click task creation to each ranked action when the target workflow supports a task entity.",
      },
      {
        id: "task-reminder-delivery-controls",
        title: "Tasks, reminders, guardrails, retries, and run history",
        outcome:
          "Automated packs can be queued, paused, retried, blocked by guardrails, and reviewed through run history.",
        status: "hardening",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: ["invoice-status", "vat-return", "month-end-close-status", "audit-trail"],
        comparisonPresetIds: [
          "owner-tax-collections-pressure",
          "freelancer-tax-spend-runway",
          "accountant-tax-payables-asset-review",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-tax-deadline-exposure",
          "freelancer-receipt-gap-close",
          "accountant-tax-workpaper-gap",
        ],
        deliverySubscriptionIds: [
          "owner-tax-deadline-delivery",
          "freelancer-monthly-close-delivery",
          "accountant-close-workpaper-delivery",
        ],
        decisionShortcutIds: [
          "owner-tax-payroll-ready",
          "freelancer-tax-ready-this-month",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [
          "owner-tax-spend-view",
          "freelancer-tax-close-view",
          "accountant-tax-asset-review-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-tax-close-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "task reminder delivery guardrail retry run history report pack",
        evidence:
          "Automation runbook phases, delivery subscriptions, queue actions, retry actions, persisted settings, scheduler scans, and handoff review states are connected.",
        nextAction:
          "Create durable task records from trigger rules instead of only presenting queued actions in report surfaces.",
      },
      {
        id: "automation-impact-health",
        title: "Automation impact and health",
        outcome:
          "Users see automation coverage, health trends, time saved, automated items, and amount at risk before choosing what to automate next.",
        status: "hardening",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "cash-flow-forecast",
          "invoice-status",
          "expenses-category",
          "payroll-summary",
          "month-end-close-status",
          "consolidated-statements",
        ],
        comparisonPresetIds: [
          "owner-operations-payroll-assets-movement",
          "freelancer-tax-payables-assets-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "owner-spend-variance-alert",
          "freelancer-client-concentration-warning",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "owner-weekly-executive-delivery",
          "freelancer-client-chase-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "owner-automation-readiness",
          "freelancer-client-concentration",
          "accountant-operational-review",
        ],
        savedViewIds: [
          "owner-operations-control-view",
          "freelancer-obligations-view",
          "accountant-advisory-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-client-income-suite",
          "accountant-advisory-suite",
        ],
        workflowSearch:
          "automation health time saved documents chased payments recovered anomalies resolved auto posted",
        evidence:
          "Automation impact profiles estimate saved hours/items and now separate outcome proxy signals from missing durable counters, while health snapshots track readiness, comparison warnings, and review signals.",
        nextAction:
          "Add real counters for documents chased, payments recovered, anomalies resolved, and items auto-posted as persisted automation outcomes.",
        dataDependency:
          "Automation services need durable outcome events before impact metrics can move beyond estimates and proxies.",
      },
    ],
  },
  {
    id: "advisory-management",
    title: "Prepare management packs",
    objective:
      "Package report movement into management views, advisory packs, KPIs, and accountant client delivery.",
    status: "hardening",
    commandKeywords:
      "advisory management narrative custom kpi dashboard widgets dimensional reporting bulk client packs",
    subgoals: [
      {
        id: "ai-narrative-pack-summaries",
        title: "AI narrative report-pack summaries",
        outcome:
          "Report packs should explain material movements, open risks, and recommended next actions in owner-ready language.",
        status: "data-needed",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "profit-loss",
          "balance-sheet",
          "cash-flow",
          "period-comparison",
          "budget-actual",
          "consolidated-statements",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-client-income-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-client-chase-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "freelancer-client-concentration-warning",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "owner-weekly-executive-delivery",
          "freelancer-client-chase-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "owner-next-30-days",
          "freelancer-client-concentration",
          "accountant-advisory-pack",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-client-income-view",
          "accountant-advisory-view",
        ],
        reportSuiteIds: [
          "owner-cash-control-suite",
          "freelancer-client-income-suite",
          "accountant-advisory-suite",
        ],
        workflowSearch: "AI narrative summary report pack advisory movement explanation",
        evidence:
          "Management brief profiles now define persona narrative sections, prompts, source reports, KPI metric IDs, and dimensional context on top of comparison presets, advisory suites, and delivery packs; generated prose remains data-dependent.",
        nextAction:
          "Generate draft narrative rows from comparison presets and delivery snapshots, then require reviewer approval before send.",
        dataDependency:
          "Narrative generation needs persisted pack snapshots and reviewer approval status before client delivery.",
      },
      {
        id: "custom-kpis-dashboard-widgets",
        title: "Custom KPIs and role dashboard widgets",
        outcome:
          "Owners, freelancers, and accountants should see the KPIs that match their recurring decisions without rebuilding filters.",
        status: "hardening",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "cash-flow-forecast",
          "revenue-customer",
          "sales-product-service",
          "budget-actual",
          "payroll-summary",
          "month-end-close-status",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-client-income-movement",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-client-chase-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "freelancer-overdue-client-chase",
          "accountant-close-exception-review",
        ],
        deliverySubscriptionIds: [],
        decisionShortcutIds: [
          "owner-next-30-days",
          "freelancer-cash-chase",
          "accountant-close-blockers",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-client-income-view",
          "accountant-close-review-view",
        ],
        reportSuiteIds: [],
        workflowSearch: "custom KPI dashboard widgets owner freelancer accountant",
        evidence:
          "Role workspaces, comparison metrics, management brief KPI metric IDs/widgets, automation health, and saved views already expose KPI candidates per persona.",
        nextAction:
          "Persist user-selected KPI widgets and render them on role-specific dashboards.",
      },
      {
        id: "dimensional-reporting",
        title: "Dimensional reporting",
        outcome:
          "Management reporting should break down performance by customer, product/service, vendor, category, cost center, asset, payroll, and entity.",
        status: "working",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "revenue-customer",
          "sales-product-service",
          "expenses-vendor",
          "expenses-category",
          "cost-center-profitability",
          "inventory-movement",
          "fixed-asset-register",
          "payroll-summary",
          "consolidated-statements",
        ],
        comparisonPresetIds: [
          "owner-operations-payroll-assets-movement",
          "freelancer-tax-payables-assets-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "owner-spend-variance-alert",
          "freelancer-receipt-gap-close",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "owner-tax-deadline-delivery",
          "freelancer-monthly-close-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "owner-customers-services-attention",
          "freelancer-client-concentration",
          "accountant-operational-review",
        ],
        savedViewIds: [
          "owner-operations-control-view",
          "freelancer-obligations-view",
          "accountant-advisory-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-tax-close-suite",
          "accountant-advisory-suite",
        ],
        workflowSearch: "dimensional reporting customer product vendor category cost center entity",
        evidence:
          "Customer, product/service, vendor, category, cost-center, inventory, asset, payroll, and consolidation reports are live and pack-covered, with management brief dimensional lenses mapping persona questions to the relevant breakdowns.",
        nextAction:
          "Add project, branch, class, and location dimensions only where source schemas provide stable dimension fields.",
      },
      {
        id: "accountant-bulk-generation",
        title: "Accountant bulk report generation",
        outcome:
          "Accountants should prepare close and advisory packs across selected clients without opening each client one by one.",
        status: "hardening",
        personas: ["accountant"],
        reportIds: [
          "trial-balance",
          "general-ledger",
          "month-end-close-status",
          "audit-trail",
          "consolidated-statements",
          "period-comparison",
        ],
        comparisonPresetIds: [
          "accountant-close-review-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "accountant-close-review-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: ["accountant-close-exception-review", "accountant-advisory-movement-note"],
        deliverySubscriptionIds: [
          "accountant-close-workpaper-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: ["accountant-close-blockers", "accountant-pack-ready-to-send"],
        savedViewIds: ["accountant-close-review-view", "accountant-advisory-view"],
        reportSuiteIds: ["accountant-close-suite", "accountant-advisory-suite"],
        workflowSearch: "accountant bulk report generation clients close advisory packs",
        evidence:
          "Accountant suites, delivery subscriptions, and the advisory management brief batch action point to the guarded pack-delivery path until portfolio selection controls are attached.",
        nextAction:
          "Add multi-client selection, preview counts, and batch queue confirmation for accountant pack delivery.",
      },
    ],
  },
  {
    id: "accounting-data-depth",
    title: "Strengthen accounting evidence",
    objective:
      "Track which report signals are ready today and which still need historical, statutory, or settlement data.",
    status: "data-needed",
    commandKeywords:
      "accounting data depth historical snapshots statutory consolidation cogs allocation tax payment wps settlement payroll headcount",
    subgoals: [
      {
        id: "historical-snapshots",
        title: "Historical snapshots for review signals",
        outcome:
          "Bank reconciliation, inventory, close readiness, audit risk, FX exposure, and consolidation review need persisted snapshots before trend claims.",
        status: "data-needed",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "cash-flow",
          "inventory-valuation",
          "inventory-movement",
          "month-end-close-status",
          "audit-trail",
          "fx-gains-losses",
          "consolidated-statements",
        ],
        comparisonPresetIds: [
          "owner-operations-payroll-assets-movement",
          "freelancer-tax-spend-runway",
          "accountant-close-review-movement",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-spend-variance-alert",
          "freelancer-receipt-gap-close",
          "accountant-close-exception-review",
        ],
        deliverySubscriptionIds: ["accountant-close-workpaper-delivery"],
        decisionShortcutIds: [
          "owner-automation-readiness",
          "freelancer-tax-ready-this-month",
          "accountant-close-blockers",
        ],
        savedViewIds: [
          "owner-operations-control-view",
          "freelancer-tax-close-view",
          "accountant-close-review-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-tax-close-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "historical snapshots bank inventory close audit fx consolidation",
        evidence:
          "Current reports expose point-in-time review queues; the catalog marks them as snapshot-dependent before historical trend claims.",
        evidenceCheckpoints: [
          {
            id: "historical-current-queues",
            status: "current-proxy",
            label: "Current queue signals",
            detail:
              "Bank, inventory, close, audit, FX, and consolidation reports expose current review queues and as-of snapshots.",
          },
          {
            id: "historical-period-snapshots",
            status: "missing-source",
            label: "Period snapshots",
            detail:
              "Immutable generated-at snapshots by company, period, source version, and queue type are still required.",
          },
          {
            id: "historical-trend-guardrail",
            status: "guardrail",
            label: "Trend claim guardrail",
            detail:
              "Do not describe these queues as historical trends until persisted period snapshots exist.",
          },
        ],
        nextAction:
          "Persist period snapshots for bank, inventory, close, audit-risk, FX exposure, and consolidation review queues.",
        dataDependency:
          "Each queue needs an immutable period snapshot keyed by company, period, source version, and generated-at timestamp.",
        requiredSourceRecords: [
          {
            id: "bank-reconciliation-snapshot",
            label: "Bank reconciliation snapshot",
            systemOfRecord: "Bank transactions plus reconciliation state by generated-at period",
            unlocks: "Historical reconciliation coverage and suggested-match trend claims.",
          },
          {
            id: "inventory-close-snapshot",
            label: "Inventory and close snapshot",
            systemOfRecord: "Inventory valuation rows plus month-end checklist state by period",
            unlocks: "Historical stock review and close-readiness movement.",
          },
          {
            id: "audit-fx-consolidation-snapshot",
            label: "Audit, FX, and consolidation snapshot",
            systemOfRecord: "Activity risk rows, FX exposure, and consolidation review state",
            unlocks: "Period-over-period audit risk, FX exposure, and consolidation readiness.",
          },
        ],
      },
      {
        id: "statutory-consolidation-controls",
        title: "Statutory consolidation controls",
        outcome:
          "Consolidated statements need eliminations, ownership rules, and FX translation before they can be treated as statutory consolidation.",
        status: "data-needed",
        personas: ["accountant"],
        reportIds: ["consolidated-statements", "balance-sheet", "profit-loss", "fx-gains-losses"],
        comparisonPresetIds: [
          "accountant-close-review-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "accountant-close-review-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: ["accountant-close-exception-review", "accountant-advisory-movement-note"],
        deliverySubscriptionIds: ["accountant-advisory-pack-delivery"],
        decisionShortcutIds: ["accountant-advisory-pack", "accountant-pack-ready-to-send"],
        savedViewIds: ["accountant-advisory-view"],
        reportSuiteIds: ["accountant-advisory-suite"],
        workflowSearch: "statutory consolidation eliminations ownership FX translation",
        evidence:
          "The current consolidated statements report is a management roll-up and clearly states no eliminations are applied.",
        evidenceCheckpoints: [
          {
            id: "consolidation-management-rollup",
            status: "current-proxy",
            label: "Management roll-up",
            detail:
              "Accessible-company consolidated statements show loaded-entity movement without eliminations.",
          },
          {
            id: "consolidation-statutory-controls",
            status: "missing-source",
            label: "Statutory controls",
            detail:
              "Ownership rules, intercompany mappings, elimination journals, and translation rates are not modeled yet.",
          },
          {
            id: "consolidation-statutory-guardrail",
            status: "guardrail",
            label: "Statutory claim guardrail",
            detail:
              "Keep statutory consolidation language out of reports until eliminations, ownership, and FX translation are persisted.",
          },
        ],
        nextAction:
          "Model intercompany eliminations, ownership percentages, consolidation method, and FX translation adjustments.",
        dataDependency:
          "Entity ownership, intercompany account mapping, elimination journals, and translation rates must be persisted.",
        requiredSourceRecords: [
          {
            id: "entity-ownership-register",
            label: "Entity ownership register",
            systemOfRecord:
              "Entity ownership percentages, consolidation method, and effective dates",
            unlocks: "Statutory scope and ownership-aware group reporting.",
          },
          {
            id: "intercompany-elimination-map",
            label: "Intercompany elimination map",
            systemOfRecord:
              "Mapped intercompany accounts, counterparties, and elimination journals",
            unlocks: "Eliminated receivable/payable, revenue/expense, and investment balances.",
          },
          {
            id: "fx-translation-policy",
            label: "FX translation policy",
            systemOfRecord: "Functional currencies, translation rates, and CTA treatment by period",
            unlocks: "FX-translated group statements instead of management roll-ups.",
          },
        ],
      },
      {
        id: "margin-cogs-allocation",
        title: "Product and customer margin with COGS allocation",
        outcome:
          "Revenue concentration can become margin analysis only after product/customer COGS allocation exists.",
        status: "data-needed",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "revenue-customer",
          "sales-product-service",
          "inventory-movement",
          "profit-loss",
        ],
        comparisonPresetIds: [
          "owner-profit-cash-movement",
          "freelancer-client-income-movement",
          "accountant-operational-advisory-movement",
        ],
        automationStarterIds: [
          "owner-cash-control-autopilot",
          "freelancer-client-chase-autopilot",
          "accountant-advisory-pack-autopilot",
        ],
        triggerRuleIds: [
          "owner-cash-runway-risk",
          "freelancer-client-concentration-warning",
          "accountant-advisory-movement-note",
        ],
        deliverySubscriptionIds: [
          "owner-weekly-executive-delivery",
          "freelancer-client-chase-delivery",
          "accountant-advisory-pack-delivery",
        ],
        decisionShortcutIds: [
          "owner-customers-services-attention",
          "freelancer-client-concentration",
          "accountant-advisory-pack",
        ],
        savedViewIds: [
          "owner-cash-runway-view",
          "freelancer-client-income-view",
          "accountant-advisory-view",
        ],
        reportSuiteIds: [
          "owner-cash-control-suite",
          "freelancer-client-income-suite",
          "accountant-advisory-suite",
        ],
        workflowSearch: "customer product margin COGS allocation profitability",
        evidence:
          "Revenue by Customer and Sales by Product/Service currently expose concentration movement, not gross margin.",
        evidenceCheckpoints: [
          {
            id: "margin-revenue-concentration",
            status: "current-proxy",
            label: "Revenue mix",
            detail:
              "Customer and product/service reports identify concentration movement and sales mix by period.",
          },
          {
            id: "margin-cogs-source",
            status: "missing-source",
            label: "COGS allocation",
            detail:
              "Product cost, landed cost, inventory issue, and service-cost allocation need reliable invoice-line matching.",
          },
          {
            id: "margin-claim-guardrail",
            status: "guardrail",
            label: "Gross-margin guardrail",
            detail:
              "Do not present customer or product/service concentration as margin until COGS allocation exists.",
          },
        ],
        nextAction:
          "Connect product cost, landed cost, inventory issue, and service cost allocation into customer/product profitability.",
        dataDependency:
          "COGS allocation needs reliable product/service cost mapping and invoice-line-to-cost matching.",
        requiredSourceRecords: [
          {
            id: "product-service-cost-map",
            label: "Product/service cost map",
            systemOfRecord: "Standard cost, service cost basis, and effective dates per item",
            unlocks: "Gross margin by product/service rather than revenue share only.",
          },
          {
            id: "landed-cost-and-issue-links",
            label: "Landed cost and issue links",
            systemOfRecord: "Inventory issue rows, landed cost allocation, and sales invoice links",
            unlocks: "Inventory-backed COGS allocation by sold item.",
          },
          {
            id: "customer-line-cost-allocation",
            label: "Customer line cost allocation",
            systemOfRecord:
              "Invoice lines matched to product, service, labor, and fulfillment cost",
            unlocks: "Customer profitability instead of customer revenue concentration.",
          },
        ],
      },
      {
        id: "settlement-headcount-depth",
        title: "Tax payment, WPS settlement, and payroll headcount depth",
        outcome:
          "Tax exposure, WPS readiness, and payroll coverage should become payment/settlement/headcount truth only after settlement records exist.",
        status: "data-needed",
        personas: ["owner", "freelancer", "accountant"],
        reportIds: [
          "vat-return",
          "corporate-tax-estimate",
          "payroll-summary",
          "wps-sif-summary",
          "expense-claims",
        ],
        comparisonPresetIds: [
          "owner-tax-collections-pressure",
          "freelancer-tax-payables-assets-movement",
          "accountant-tax-payables-asset-review",
        ],
        automationStarterIds: [
          "owner-tax-spend-autopilot",
          "freelancer-tax-close-autopilot",
          "accountant-close-review-autopilot",
        ],
        triggerRuleIds: [
          "owner-tax-deadline-exposure",
          "freelancer-receipt-gap-close",
          "accountant-tax-workpaper-gap",
        ],
        deliverySubscriptionIds: [
          "owner-tax-deadline-delivery",
          "freelancer-monthly-close-delivery",
          "accountant-close-workpaper-delivery",
        ],
        decisionShortcutIds: [
          "owner-tax-payroll-ready",
          "freelancer-tax-ready-this-month",
          "accountant-pack-ready-to-send",
        ],
        savedViewIds: [
          "owner-tax-spend-view",
          "freelancer-obligations-view",
          "accountant-tax-asset-review-view",
        ],
        reportSuiteIds: [
          "owner-tax-spend-suite",
          "freelancer-tax-close-suite",
          "accountant-close-suite",
        ],
        workflowSearch: "tax payment WPS settlement payroll headcount reimbursement",
        evidence:
          "Current tax and payroll reports expose exposure, readiness, and run coverage without claiming filed payment or bank settlement completion.",
        evidenceCheckpoints: [
          {
            id: "settlement-readiness-proxies",
            status: "current-proxy",
            label: "Readiness proxies",
            detail:
              "VAT, corporate tax, payroll, WPS, and expense-claim reports expose exposure, run coverage, and readiness queues.",
          },
          {
            id: "settlement-records",
            status: "missing-source",
            label: "Settlement records",
            detail:
              "Filed tax payment confirmations, WPS bank acknowledgements, and employee master history are not persisted yet.",
          },
          {
            id: "settlement-claim-guardrail",
            status: "guardrail",
            label: "Payment claim guardrail",
            detail:
              "Do not call exposures filed, WPS-ready runs settled, or payroll coverage deduplicated headcount until settlement records exist.",
          },
        ],
        nextAction:
          "Persist tax payment records, WPS bank submission/settlement status, and deduplicated employee coverage by period.",
        dataDependency:
          "Filed tax liabilities, payment confirmations, WPS bank acknowledgements, and employee master history must be modeled.",
        requiredSourceRecords: [
          {
            id: "tax-filing-payment-ledger",
            label: "Tax filing and payment ledger",
            systemOfRecord:
              "Filed VAT/corporate tax liabilities, payment confirmations, and filing periods",
            unlocks: "Filed liability and paid tax status instead of exposure-only reporting.",
          },
          {
            id: "wps-bank-acknowledgement",
            label: "WPS bank acknowledgement",
            systemOfRecord:
              "SIF submission, bank acknowledgement, rejection, and settlement status",
            unlocks: "WPS submission and settlement reporting instead of file-readiness only.",
          },
          {
            id: "employee-period-coverage",
            label: "Employee period coverage",
            systemOfRecord: "Employee master history and payroll-run membership by period",
            unlocks: "Deduplicated payroll headcount and unit-cost reporting.",
          },
        ],
      },
    ],
  },
];

export const liveReportCatalog = reportCatalog.filter((report) => report.status === "live");
export const readyReportCatalog = reportCatalog.filter((report) => report.status !== "planned");

export const REPORT_PERSONA_PREFERENCE_KEY = "nr_ai.report_persona";
export const REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY = "nr_ai.report_workflow_search";
export const REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY = "nr_ai.report_workflow_gap_filter";
export const REPORT_FAVORITE_REPORT_IDS_KEY = "nr_ai.favorite_report_ids";
export const REPORT_DELIVERY_AUTOMATION_COMMAND_KEY = "nr_ai.report_delivery_automation_command";
export const REPORT_AUTOMATION_HEALTH_HISTORY_KEY = "nr_ai.report_automation_health_history";

export function parseReportPersona(value: string | null | undefined): ReportPersona | null {
  return reportPersonas.includes(value as ReportPersona) ? (value as ReportPersona) : null;
}

export function parseReportWorkflowGapFilter(
  value: string | null | undefined
): ReportWorkflowGapFilter | null {
  return value === "report-gaps" || value === "rule-gaps" || value === "delivery-gaps"
    ? value
    : null;
}

export function normalizeReportWorkflowSearch(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, 120);
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

function reportFavoriteReportIdsKey(persona: ReportPersona | "all"): string {
  return `${REPORT_FAVORITE_REPORT_IDS_KEY}.${persona}`;
}

export function parseReportFavoriteReportIds(
  value: string | null | undefined,
  persona: ReportPersona | "all" = "all"
): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(
      readyReportCatalog
        .filter((report) => persona === "all" || report.personas.includes(persona))
        .map((report) => report.id)
    );
    const storedIds = parsed.filter(
      (item): item is string => typeof item === "string" && validIds.has(item)
    );

    return readyReportCatalog
      .filter((report) => storedIds.includes(report.id))
      .map((report) => report.id);
  } catch {
    return [];
  }
}

export function getFavoriteReportIds(persona: ReportPersona | "all" = "all"): string[] {
  if (typeof window === "undefined") return [];

  try {
    return parseReportFavoriteReportIds(
      window.localStorage.getItem(reportFavoriteReportIdsKey(persona)),
      persona
    );
  } catch {
    return [];
  }
}

export function setFavoriteReportIds(
  reportIds: string[],
  persona: ReportPersona | "all" = "all"
): string[] {
  const next = parseReportFavoriteReportIds(JSON.stringify(reportIds), persona);
  if (typeof window === "undefined") return next;

  try {
    const key = reportFavoriteReportIdsKey(persona);
    if (next.length > 0) {
      window.localStorage.setItem(key, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {}

  return next;
}

export function toggleFavoriteReportId(
  reportId: string,
  persona: ReportPersona | "all" = "all"
): string[] {
  const current = getFavoriteReportIds(persona);
  return setFavoriteReportIds(
    current.includes(reportId)
      ? current.filter((item) => item !== reportId)
      : [...current, reportId],
    persona
  );
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
    const trimmed = normalizeReportWorkflowSearch(search);
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

function reportWorkflowGapFilterPreferenceKey(persona: ReportPersona): string {
  return `${REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY}.${persona}`;
}

export function getPreferredReportWorkflowGapFilter(
  persona: ReportPersona
): ReportWorkflowGapFilter | null {
  if (typeof window === "undefined") return null;

  try {
    return parseReportWorkflowGapFilter(
      window.localStorage.getItem(reportWorkflowGapFilterPreferenceKey(persona))
    );
  } catch {
    return null;
  }
}

export function setPreferredReportWorkflowGapFilter(
  persona: ReportPersona,
  gap: ReportWorkflowGapFilter
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(reportWorkflowGapFilterPreferenceKey(persona), gap);
  } catch {}
}

export function clearPreferredReportWorkflowGapFilter(persona: ReportPersona): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(reportWorkflowGapFilterPreferenceKey(persona));
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
  "role-setup": "report-role-setup-title",
  "role-workflows": "report-role-workflows-title",
  "management-briefs": "report-management-briefs-title",
  "report-suites": "report-suites-title",
  "quick-access": "report-quick-access-title",
  "saved-views": "report-saved-views-title",
  "workflow-finder": "report-workflow-finder-title",
  "automation-operations": "report-automation-operations-title",
  "automation-impact": "report-automation-impact-title",
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

export function reportHref(
  report: Pick<ReportCatalogItem, "tab"> & { href?: string | null }
): string | undefined {
  return report.href ?? (report.tab ? reportsHref({ tab: report.tab }) : undefined);
}

export function reportPersonaHref(
  report: Pick<ReportCatalogItem, "tab"> & { href?: string | null },
  persona: ReportPersona | "all"
): string | undefined {
  return report.href ?? (report.tab ? reportsHref({ tab: report.tab, persona }) : undefined);
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

export function reportRoleWorkflowStepHref(
  workspace: Pick<ReportPersonaWorkspace, "persona" | "primaryTab">,
  step: Pick<ReportRoleWorkflowStep, "id">
): string {
  return `${reportWorkspaceHref(workspace)}#report-role-workflow-step-${step.id}`;
}

export function reportWorkflowContextHref({
  persona,
  tab,
  search,
  gap,
}: {
  persona: ReportPersona | "all";
  tab?: ReportTab;
  search?: string | null;
  gap?: ReportWorkflowGapFilter | null;
}): string {
  const workspace =
    persona === "all" ? null : reportPersonaWorkspaces.find((item) => item.persona === persona);
  const params = new URLSearchParams();
  const targetTab = tab ?? workspace?.primaryTab;
  if (targetTab) params.set("tab", targetTab);
  params.set("persona", persona);

  const workflowSearch = normalizeReportWorkflowSearch(search);
  if (workflowSearch) params.set("workflowSearch", workflowSearch);
  if (persona !== "all" && gap) {
    params.set("workflowGap", gap);
    params.set("workflowGapPersona", persona);
  }

  return `/reports?${params.toString()}#${reportSectionAnchors["workflow-finder"]}`;
}

export function reportWorkflowFinderGapHref({
  persona,
  gap,
  tab,
  search,
}: {
  persona: ReportPersona;
  gap: ReportWorkflowGapFilter;
  tab?: ReportTab;
  search?: string | null;
}): string {
  return reportWorkflowContextHref({ persona, gap, tab, search });
}

export function reportPackTemplateHref(
  template: Pick<ReportPackTemplate, "id" | "persona">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === template.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: template.persona })}#report-pack-template-${
    template.id
  }`;
}

export function reportSuiteHref(suite: Pick<ReportSuiteProfile, "id" | "persona">): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === suite.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: suite.persona })}#report-suite-${
    suite.id
  }`;
}

export function reportManagementBriefHref(
  brief: Pick<ReportManagementBriefProfile, "id" | "persona">
): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === brief.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: brief.persona })}#report-management-brief-${
    brief.id
  }`;
}

export function reportComparisonPresetHref(
  preset: Pick<ReportComparisonPreset, "persona" | "primaryTab">
): string {
  return `${reportsHref({ tab: preset.primaryTab, persona: preset.persona })}#period-comparison-title`;
}

export function reportSavedViewHref(view: Pick<ReportSavedViewProfile, "id" | "persona">): string {
  const workspace = reportPersonaWorkspaces.find((item) => item.persona === view.persona);
  return `${reportsHref({ tab: workspace?.primaryTab, persona: view.persona })}#report-saved-view-${
    view.id
  }`;
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

export function reportProductDepthAreaHref(area: Pick<ReportProductDepthArea, "id">): string {
  return `${reportsHref()}#report-product-depth-${area.id}`;
}

export function reportProductDepthSubgoalHref(
  area: Pick<ReportProductDepthArea, "id">,
  subgoal: Pick<ReportProductDepthSubgoal, "id" | "personas" | "workflowSearch" | "reportIds">
): string {
  const persona = subgoal.personas[0] ?? "all";
  const primaryReport = subgoal.reportIds
    .map((reportId) => reportCatalog.find((report) => report.id === reportId))
    .find((report): report is ReportCatalogItem => Boolean(report));
  const params = new URLSearchParams();
  if (primaryReport?.tab) params.set("tab", primaryReport.tab);
  params.set("persona", persona);
  const workflowSearch = normalizeReportWorkflowSearch(subgoal.workflowSearch);
  if (workflowSearch) params.set("workflowSearch", workflowSearch);
  params.set("productDepth", area.id);

  return `/reports?${params.toString()}#report-product-depth-subgoal-${subgoal.id}`;
}

export function reportAutomationPlaybookHref(
  playbook: Pick<ReportAutomationPlaybook, "href" | "tab">,
  persona?: ReportPersona
): string {
  return playbook.href ?? reportsHref({ tab: playbook.tab, persona });
}

function uniqueReportCatalogIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function reportCatalogIdsOverlap(firstIds: string[], secondIds: string[]): boolean {
  const secondIdSet = new Set(secondIds);
  return firstIds.some((id) => secondIdSet.has(id));
}

export function buildReportAutomationRunbookSteps(
  workspace: Pick<ReportPersonaWorkspace, "persona" | "primaryTab">,
  playbook: Pick<
    ReportAutomationPlaybook,
    "id" | "title" | "trigger" | "reportIds" | "cta" | "tab" | "href"
  >
): ReportAutomationRunbookStep[] {
  const persona = workspace.persona;
  const catalogWorkspace = reportPersonaWorkspaces.find((item) => item.persona === persona);
  const automationStarter = reportAutomationStarters.find(
    (starter) => starter.persona === persona && starter.playbookIds.includes(playbook.id)
  );
  const relatedReportIds = uniqueReportCatalogIds([
    ...playbook.reportIds,
    ...(automationStarter?.reportIds ?? []),
  ]);
  const isRelatedReportSet = (reportIds: string[]) =>
    reportCatalogIdsOverlap(relatedReportIds, reportIds);
  const relatedTriggerRules = reportAutomationTriggerRules.filter(
    (rule) =>
      rule.persona === persona &&
      (automationStarter
        ? rule.automationStarterId === automationStarter.id
        : isRelatedReportSet(rule.reportIds))
  );
  const relatedWorkflowSteps = (catalogWorkspace?.workflowSteps ?? []).filter((step) =>
    automationStarter
      ? step.automationStarterId === automationStarter.id
      : isRelatedReportSet(step.reportIds)
  );
  const relatedComparisonPresets = reportComparisonPresets.filter(
    (preset) =>
      preset.persona === persona &&
      (relatedWorkflowSteps.some((step) => step.comparisonPresetId === preset.id) ||
        isRelatedReportSet(preset.reportIds))
  );
  const relatedDeliverySubscriptions = reportDeliverySubscriptions.filter(
    (subscription) =>
      subscription.persona === persona &&
      (automationStarter
        ? subscription.automationStarterId === automationStarter.id
        : isRelatedReportSet(subscription.reportIds))
  );
  const relatedDecisionShortcuts = reportDecisionShortcuts.filter(
    (shortcut) =>
      shortcut.persona === persona &&
      (relatedWorkflowSteps.some((step) => step.decisionShortcutId === shortcut.id) ||
        (automationStarter ? shortcut.automationStarterId === automationStarter.id : false) ||
        isRelatedReportSet(shortcut.reportIds))
  );
  const relatedSavedViews = reportSavedViewProfiles.filter(
    (view) =>
      view.persona === persona &&
      (relatedWorkflowSteps.some((step) => step.savedViewId === view.id) ||
        (automationStarter ? view.automationStarterId === automationStarter.id : false) ||
        relatedReportIds.includes(view.reportId))
  );
  const relatedReportSuites = reportSuiteProfiles.filter(
    (suite) =>
      suite.persona === persona &&
      (relatedWorkflowSteps.some((step) => step.reportSuiteId === suite.id) ||
        (automationStarter ? suite.automationStarterId === automationStarter.id : false) ||
        isRelatedReportSet(suite.reportIds))
  );

  const primaryTriggerRule = relatedTriggerRules[0];
  const primaryWorkflowStep = relatedWorkflowSteps[0];
  const primaryDeliverySubscription = relatedDeliverySubscriptions[0];
  const triggerRuleIds = relatedTriggerRules.map((rule) => rule.id);
  const workflowStepIds = relatedWorkflowSteps.map((step) => step.id);
  const comparisonPresetIds = relatedComparisonPresets.map((preset) => preset.id);
  const automationStarterIds = automationStarter ? [automationStarter.id] : [];
  const deliverySubscriptionIds = relatedDeliverySubscriptions.map(
    (subscription) => subscription.id
  );
  const decisionShortcutIds = relatedDecisionShortcuts.map((shortcut) => shortcut.id);
  const savedViewIds = relatedSavedViews.map((view) => view.id);
  const reportSuiteIds = relatedReportSuites.map((suite) => suite.id);
  const playbookHref = reportAutomationPlaybookHref(playbook, persona);

  return [
    {
      id: `${playbook.id}-signal`,
      phase: "signal",
      title: "Detect report signal",
      outcome: primaryTriggerRule
        ? `${primaryTriggerRule.title} watches ${relatedReportIds.length} reports before the playbook runs.`
        : `${playbook.title} watches ${relatedReportIds.length} reports before the playbook runs.`,
      actionLabel: primaryTriggerRule?.actionLabel ?? playbook.cta,
      href: primaryTriggerRule ? reportAutomationTriggerRuleHref(primaryTriggerRule) : playbookHref,
      reportIds: relatedReportIds,
      triggerRuleIds,
      workflowStepIds,
      comparisonPresetIds,
      automationStarterIds,
      deliverySubscriptionIds,
      decisionShortcutIds,
      savedViewIds,
      reportSuiteIds,
    },
    {
      id: `${playbook.id}-review`,
      phase: "review",
      title: "Review linked workflow",
      outcome: primaryWorkflowStep
        ? primaryWorkflowStep.outcome
        : (automationStarter?.outcome ?? playbook.trigger),
      actionLabel:
        primaryWorkflowStep?.primaryAction ?? automationStarter?.primaryAction ?? playbook.cta,
      href: primaryWorkflowStep
        ? reportRoleWorkflowStepHref(workspace, primaryWorkflowStep)
        : automationStarter
          ? reportAutomationStarterHref(automationStarter)
          : playbookHref,
      reportIds: relatedReportIds,
      triggerRuleIds,
      workflowStepIds,
      comparisonPresetIds,
      automationStarterIds,
      deliverySubscriptionIds,
      decisionShortcutIds,
      savedViewIds,
      reportSuiteIds,
    },
    {
      id: `${playbook.id}-deliver`,
      phase: "deliver",
      title: "Queue guarded delivery",
      outcome: primaryDeliverySubscription
        ? `${primaryDeliverySubscription.title} uses guardrails before sending ${primaryDeliverySubscription.format}.`
        : "Open the delivery workflow to finish scheduling and guardrails.",
      actionLabel: primaryDeliverySubscription ? "Open delivery guardrail" : playbook.cta,
      href: primaryDeliverySubscription
        ? reportDeliverySubscriptionHref(primaryDeliverySubscription)
        : reportSectionHref(workspace, "delivery-subscriptions"),
      reportIds: relatedReportIds,
      triggerRuleIds,
      workflowStepIds,
      comparisonPresetIds,
      automationStarterIds,
      deliverySubscriptionIds,
      decisionShortcutIds,
      savedViewIds,
      reportSuiteIds,
    },
  ];
}

function clampReportScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeReportImpactCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function calculateReportAutomationImpact(
  profile: ReportAutomationImpactProfile,
  input: ReportAutomationImpactInput
): ReportAutomationImpactEstimate {
  const readyRuleCount = normalizeReportImpactCount(input.readyRuleCount);
  const readyDeliveryCount = normalizeReportImpactCount(input.readyDeliveryCount);
  const readyReportCount = normalizeReportImpactCount(input.readyReportCount);
  const openWorkItemCount = normalizeReportImpactCount(input.openWorkItemCount);
  const recommendationCount = normalizeReportImpactCount(input.recommendationCount);
  const amountAtRisk = normalizeReportImpactCount(input.amountAtRisk);

  const estimatedMonthlyHoursSaved = Math.round(
    readyRuleCount * profile.hoursPerReadyRule +
      readyDeliveryCount * profile.hoursPerReadyDelivery +
      readyReportCount * profile.hoursPerReadyReport
  );
  const estimatedAutomatedItemCount = Math.round(
    readyRuleCount * profile.itemsPerReadyRule +
      readyDeliveryCount * profile.itemsPerReadyDelivery +
      recommendationCount
  );
  const ruleCoverage = profile.triggerRuleIds.length
    ? Math.min(1, readyRuleCount / profile.triggerRuleIds.length)
    : 0;
  const deliveryCoverage = Math.min(1, readyDeliveryCount / 2);
  const reportCoverage = profile.reportIds.length
    ? Math.min(1, readyReportCount / profile.reportIds.length)
    : 0;
  const reviewPenalty = Math.min(0.25, openWorkItemCount * 0.03);
  const coverageScore = clampReportScore(
    (ruleCoverage * 0.45 + deliveryCoverage * 0.25 + reportCoverage * 0.3 - reviewPenalty) * 100
  );
  const status: ReportAutomationImpactEstimate["status"] =
    coverageScore >= 80 ? "compounding" : coverageScore >= 50 ? "review" : "setup";

  return {
    estimatedMonthlyHoursSaved,
    estimatedAutomatedItemCount,
    reviewItemCount: Math.round(openWorkItemCount),
    amountAtRisk,
    coverageScore,
    status,
    statusLabel:
      status === "compounding"
        ? "Impact compounding"
        : status === "review"
          ? "Review impact"
          : "Setup needed",
    summary: `${estimatedMonthlyHoursSaved} estimated hours and ${estimatedAutomatedItemCount} ${profile.itemUnitLabel} handled monthly when current rules and deliveries stay ready.`,
  };
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
