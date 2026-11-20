// Workspace report-pack workbook builder covering every live report (buildWorkspaceReportPack).
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import { translateNow } from "@/lib/i18n";
import {
  type ExportData,
  prepareAgingReportsForExport,
  prepareAuditTrailForExport,
  prepareBalanceSheetForExport,
  prepareBalanceSummaryReportsForExport,
  prepareCashFlowStatementForExport,
  prepareConsolidatedStatementsForExport,
  prepareCorporateTaxEstimateForExport,
  prepareCostCenterProfitabilityForExport,
  prepareExpenseReportsForExport,
  prepareFxGainsLossesForExport,
  prepareInvoiceStatusForExport,
  prepareLedgerReportsForExport,
  prepareMonthEndCloseStatusForExport,
  preparePayrollReportsForExport,
  preparePeriodComparisonForExport,
  preparePlanningReportsForExport,
  prepareProfitLossForExport,
  prepareTrialBalanceForExport,
  prepareVATSummaryForExport,
} from "@/lib/export";
import {
  type ReportWorkflowGapFilter,
  buildReportAutomationHealthTrend,
  reportPersonaHref,
  reportSectionHref,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportWorkspaceHref,
  reportsHref,
} from "@/lib/reportCatalog";
import {
  buildReportCoverageMap,
  formatComparisonExportValue,
  formatComparisonPercent,
  matchesReportPersona,
  reportStatusMeta,
  triggerSeverityMeta,
} from "../shared";
import { format } from "date-fns";
import { prepareVat201ForExport } from "@/lib/vat201-export";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsComparisonsAndCloseState } from "./useReportsComparisonsAndClose";
import type { ReportsAutomationQueueState } from "./useReportsAutomationQueue";
import type { ReportsDerivedReportsState } from "./useReportsDerivedReports";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsAutomationOverviewState } from "./useReportsAutomationOverview";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";
import type { ReportsDeliveryStateState } from "./useReportsDeliveryState";

type UseReportsWorkspacePackDeps = Pick<
  ReportsDataQueriesState &
    ReportsComparisonsAndCloseState &
    ReportsAutomationQueueState &
    ReportsDerivedReportsState &
    ReportsWorkspaceStateState &
    ReportsAutomationOverviewState &
    ReportsWorkspaceSummariesState &
    ReportsDeliveryStateState,
  | "advancedPeriodComparison"
  | "agingReport"
  | "auditTrailReport"
  | "automationQueue"
  | "balanceReport"
  | "balanceSheet"
  | "billAgingReport"
  | "cashFlowStatement"
  | "comparisonCurrentLabel"
  | "comparisonPreviousLabel"
  | "comparisonRows"
  | "consolidatedStatementsReport"
  | "corporateTaxEstimate"
  | "costCenterProfitability"
  | "dateRange"
  | "expenseReport"
  | "fxGainsLosses"
  | "invoiceStatusReport"
  | "ledgerReport"
  | "monthEndCloseExportReport"
  | "payrollReport"
  | "personaReportRecommendations"
  | "planningReport"
  | "profitLoss"
  | "reportAccountantHandoffSummaries"
  | "reportAutomationHealthHistory"
  | "reportAutomationOperationSummaries"
  | "reportAutomationRules"
  | "reportAutomationStarterSummaries"
  | "reportAutomationTriggerRuleSummaries"
  | "reportComparisonPresetSummaries"
  | "reportDecisionShortcutSummaries"
  | "reportDeliverySubscriptionSummaries"
  | "reportPackDeliveryReadiness"
  | "reportPackTemplateSummaries"
  | "reportRoadmap"
  | "reportWorkflowContextSearchLabel"
  | "selectedCompany"
  | "trialBalance"
  | "vatReturns"
  | "vatSummary"
>;

export function useReportsWorkspacePack({
  advancedPeriodComparison,
  agingReport,
  auditTrailReport,
  automationQueue,
  balanceReport,
  balanceSheet,
  billAgingReport,
  cashFlowStatement,
  comparisonCurrentLabel,
  comparisonPreviousLabel,
  comparisonRows,
  consolidatedStatementsReport,
  corporateTaxEstimate,
  costCenterProfitability,
  dateRange,
  expenseReport,
  fxGainsLosses,
  invoiceStatusReport,
  ledgerReport,
  monthEndCloseExportReport,
  payrollReport,
  personaReportRecommendations,
  planningReport,
  profitLoss,
  reportAccountantHandoffSummaries,
  reportAutomationHealthHistory,
  reportAutomationOperationSummaries,
  reportAutomationRules,
  reportAutomationStarterSummaries,
  reportAutomationTriggerRuleSummaries,
  reportComparisonPresetSummaries,
  reportDecisionShortcutSummaries,
  reportDeliverySubscriptionSummaries,
  reportPackDeliveryReadiness,
  reportPackTemplateSummaries,
  reportRoadmap,
  reportWorkflowContextSearchLabel,
  selectedCompany,
  trialBalance,
  vatReturns,
  vatSummary,
}: UseReportsWorkspacePackDeps) {
  const exportDateRangeSuffix =
    dateRange.from && dateRange.to
      ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const buildWorkspaceReportPack = (
    workspace: ReportsWorkspaceSummariesState["workspaceSummaries"][number]
  ): ExportData[] => {
    const workspaceReportIds = new Set(workspace.reports.map((report) => report.id));
    const workbookReportIds = new Set<string>();
    const workbookSheets: ExportData[] = [];

    const addSheets = (reportIds: string[], sheets: ExportData | ExportData[]) => {
      const includedReportIds = reportIds.filter((reportId) => workspaceReportIds.has(reportId));
      if (!includedReportIds.length) return;
      includedReportIds.forEach((reportId) => workbookReportIds.add(reportId));
      workbookSheets.push(...(Array.isArray(sheets) ? sheets : [sheets]));
    };

    const latestVatReturn =
      vatReturns
        .slice()
        .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())[0] ??
      null;
    const vatReturnRegister: ExportData = {
      sheetName: "VAT Return Register",
      columns: [
        { header: "Period Start", key: "periodStart", width: 14 },
        { header: "Period End", key: "periodEnd", width: 14 },
        { header: "Due Date", key: "dueDate", width: 14 },
        { header: "Status", key: "status", width: 16 },
        { header: "Output VAT (AED)", key: "outputVat", width: 18 },
        { header: "Recoverable VAT (AED)", key: "recoverableVat", width: 20 },
        { header: "Payable VAT (AED)", key: "payableVat", width: 18 },
        { header: "FTA Reference", key: "ftaReference", width: 24 },
        { header: "Payment Status", key: "paymentStatus", width: 18 },
        { header: "Payment Amount (AED)", key: "paymentAmount", width: 22 },
      ],
      rows: vatReturns.map((vatReturn) => ({
        periodStart: vatReturn.periodStart,
        periodEnd: vatReturn.periodEnd,
        dueDate: vatReturn.dueDate,
        status: vatReturn.status,
        outputVat: vatReturn.box12TotalDueTax,
        recoverableVat: vatReturn.box13RecoverableTax,
        payableVat: vatReturn.box14PayableTax,
        ftaReference: vatReturn.ftaReferenceNumber ?? "",
        paymentStatus: vatReturn.paymentStatus ?? "",
        paymentAmount: vatReturn.paymentAmount ?? "",
      })),
    };
    const periodComparisonRows = comparisonRows.filter((row) =>
      matchesReportPersona(row.personas, workspace.persona)
    );

    addSheets(["profit-loss"], prepareProfitLossForExport(profitLoss));
    addSheets(
      ["cost-center-profitability"],
      prepareCostCenterProfitabilityForExport(costCenterProfitability)
    );
    addSheets(["balance-sheet"], prepareBalanceSheetForExport(balanceSheet));
    addSheets(["cash-flow"], prepareCashFlowStatementForExport(cashFlowStatement));
    addSheets(["vat-summary"], prepareVATSummaryForExport(vatSummary));
    addSheets(
      ["vat-return"],
      [
        vatReturnRegister,
        ...(latestVatReturn ? prepareVat201ForExport(latestVatReturn, selectedCompany) : []),
      ]
    );
    addSheets(
      ["period-comparison"],
      preparePeriodComparisonForExport(
        periodComparisonRows.length ? periodComparisonRows : advancedPeriodComparison
      )
    );
    addSheets(
      ["ar-aging", "ap-aging"],
      prepareAgingReportsForExport({ receivables: agingReport, payables: billAgingReport })
    );
    addSheets(
      ["corporate-tax-estimate"],
      prepareCorporateTaxEstimateForExport(corporateTaxEstimate)
    );
    addSheets(["fx-gains-losses"], prepareFxGainsLossesForExport(fxGainsLosses));
    addSheets(["trial-balance"], prepareTrialBalanceForExport(trialBalance));
    addSheets(
      ["invoice-status", "revenue-customer", "sales-product-service"],
      prepareInvoiceStatusForExport(invoiceStatusReport)
    );
    addSheets(
      [
        "customer-balances",
        "vendor-balances",
        "inventory-valuation",
        "inventory-movement",
        "fixed-asset-register",
        "depreciation-schedule",
      ],
      prepareBalanceSummaryReportsForExport(balanceReport)
    );
    addSheets(
      ["expenses-vendor", "expenses-category", "expense-claims"],
      prepareExpenseReportsForExport(expenseReport)
    );
    addSheets(
      ["payroll-summary", "wps-sif-summary"],
      preparePayrollReportsForExport(payrollReport)
    );
    addSheets(
      ["general-ledger", "account-transactions"],
      prepareLedgerReportsForExport(ledgerReport)
    );
    addSheets(
      ["month-end-close-status"],
      prepareMonthEndCloseStatusForExport(monthEndCloseExportReport)
    );
    addSheets(["audit-trail"], prepareAuditTrailForExport(auditTrailReport));
    addSheets(
      ["consolidated-statements"],
      prepareConsolidatedStatementsForExport(consolidatedStatementsReport)
    );
    addSheets(
      ["budget-actual", "cash-flow-forecast"],
      preparePlanningReportsForExport(planningReport)
    );

    const packCoverageMap = buildReportCoverageMap(workspace.reports, workbookReportIds);
    const packDecisionShortcuts = reportDecisionShortcutSummaries.filter(
      (shortcut) => shortcut.persona === workspace.persona
    );
    const packTemplates = reportPackTemplateSummaries.filter(
      (template) => template.persona === workspace.persona
    );
    const packAutomationStarters = reportAutomationStarterSummaries.filter(
      (starter) => starter.persona === workspace.persona
    );
    const packTriggerRules = reportAutomationTriggerRuleSummaries.filter(
      (rule) => rule.persona === workspace.persona
    );
    const packDeliverySubscriptions = reportDeliverySubscriptionSummaries.filter(
      (subscription) => subscription.persona === workspace.persona
    );
    const packSignals = automationQueue.filter((item) =>
      matchesReportPersona(item.personas, workspace.persona)
    );
    const openPackSignals = packSignals.filter((item) => item.count > 0);
    const openPackWorkItemCount = packSignals.reduce((sum, item) => sum + item.count, 0);
    const packAmountAtRisk = packSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const packComparisonRows = comparisonRows.filter((row) =>
      matchesReportPersona(row.personas, workspace.persona)
    );
    const packComparisonPresets = reportComparisonPresetSummaries.filter(
      (preset) => preset.persona === workspace.persona
    );
    const packRecommendations =
      personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
        ?.recommendations ?? [];
    const packAutomationRules = reportAutomationRules.filter(
      (rule) => rule.workspace.persona === workspace.persona
    );
    const packReadiness =
      reportPackDeliveryReadiness.find((item) => item.workspace.persona === workspace.persona) ??
      null;
    const packHealthTrend = packReadiness
      ? buildReportAutomationHealthTrend(
          reportAutomationHealthHistory,
          workspace.persona,
          packReadiness.automationHealth
        )
      : null;
    const packRoadmap =
      reportRoadmap.find((item) => item.workspace.persona === workspace.persona) ?? null;
    const packReadyAutomationRules = packAutomationRules.filter(
      (rule) => rule.status === "Ready to auto-send"
    ).length;
    const packReviewAutomationRules = packAutomationRules.filter(
      (rule) => rule.openWorkItemCount > 0
    ).length;
    const packSetupAutomationRules = packAutomationRules.filter(
      (rule) => rule.status === translateNow("reportCenter.setupNeeded")
    ).length;
    const packRuleOpenWorkItemCount = packAutomationRules.reduce(
      (sum, rule) => sum + rule.openWorkItemCount,
      0
    );
    const packRuleAmountAtRisk = packAutomationRules.reduce(
      (sum, rule) => sum + rule.amountAtRisk,
      0
    );
    const packRuleComparisonMetricCount = packAutomationRules.reduce(
      (sum, rule) => sum + rule.comparisonMetricCount,
      0
    );
    const packRuleReportBundleCount = new Set(
      packAutomationRules.flatMap((rule) => rule.linkedReports.map((report) => report.id))
    ).size;
    const packAutoSendCoveragePercent =
      packAutomationRules.length > 0
        ? Math.round((packReadyAutomationRules / packAutomationRules.length) * 100)
        : 0;
    const packOperations =
      reportAutomationOperationSummaries.find(
        (item) => item.workspace.persona === workspace.persona
      ) ?? null;
    const packHandoff =
      reportAccountantHandoffSummaries.find(
        (item) => item.workspace.persona === workspace.persona
      ) ?? null;
    const packPriorityGap: ReportWorkflowGapFilter | null =
      packHandoff?.priorityGap ??
      (packOperations
        ? packOperations.failedRunCount > 0 || packOperations.deliveryGapCount > 0
          ? "delivery-gaps"
          : packOperations.automationRuleGapCount > 0 || packOperations.openWorkItemCount > 0
            ? "rule-gaps"
            : packOperations.reportGapCount > 0
              ? "report-gaps"
              : null
        : null);
    const packSharedContextHref =
      packHandoff?.shareHref ??
      reportWorkflowContextHref({
        persona: workspace.persona,
        tab: workspace.primaryTab,
        search: reportWorkflowContextSearchLabel,
        gap: packPriorityGap,
      });
    const packGapHref =
      packHandoff?.gapHref ??
      reportWorkflowContextHref({
        persona: workspace.persona,
        tab: workspace.primaryTab,
        search: reportWorkflowContextSearchLabel,
        gap: packPriorityGap,
      });
    const packPriorityGapLabel =
      packHandoff?.priorityGapLabel ??
      (packPriorityGap ? reportWorkflowGapFilterLabels[packPriorityGap] : "No open gap");
    const operationsWorkflow = reportSectionHref(workspace, "automation-operations");
    const commandCenterWorkflow = reportSectionHref(workspace, "automation-command-center");
    const deliveryWorkflow = reportSectionHref(workspace, "delivery-subscriptions");

    const packIndex: ExportData = {
      sheetName: "Pack Index",
      columns: [
        { header: "Report", key: "report", width: 32 },
        { header: "Decision Question", key: "decisionQuestion", width: 58 },
        { header: "Status", key: "status", width: 14 },
        { header: "Comparison", key: "comparison", width: 24 },
        { header: "Automation", key: "automation", width: 28 },
        { header: "Delivery", key: "delivery", width: 22 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: workspace.reports.map((report) => ({
        report: report.name,
        decisionQuestion: report.decisionQuestion,
        status: reportStatusMeta[report.status].label,
        comparison: report.comparison,
        automation: report.automation,
        delivery: workbookReportIds.has(report.id)
          ? translateNow("reportCenter.includedInWorkbook")
          : "Open workflow",
        workflow: reportPersonaHref(report, workspace.persona) ?? reportWorkspaceHref(workspace),
      })),
    };

    const operationsControl: ExportData = {
      sheetName: "Operations Control",
      columns: [
        { header: "Field", key: "field", width: 34 },
        { header: "Value", key: "value", width: 70 },
        { header: "Workflow", key: "workflow", width: 48 },
      ],
      rows: [
        { field: "Workspace", value: workspace.title, workflow: reportWorkspaceHref(workspace) },
        { field: "Persona", value: workspace.persona, workflow: operationsWorkflow },
        {
          field: "Operations status",
          value: packOperations?.status ?? translateNow("firm.notAvailable"),
          workflow: operationsWorkflow,
        },
        {
          field: "Next action",
          value: packOperations?.nextAction.label ?? translateNow("firm.notAvailable"),
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Next action detail",
          value: packOperations?.nextAction.detail ?? translateNow("firm.notAvailable"),
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Automation health",
          value: packOperations
            ? `${packOperations.automationScore}/100`
            : packReadiness
              ? `${packReadiness.automationHealth.score}/100`
              : translateNow("firm.notAvailable"),
          workflow: operationsWorkflow,
        },
        {
          field: "Reports ready",
          value: packOperations
            ? `${packOperations.readyReportCount}/${packOperations.reportCount}`
            : `${workspace.readyReports}/${workspace.reports.length}`,
          workflow: reportWorkspaceHref(workspace),
        },
        {
          field: "Auto-send rules ready",
          value: packOperations
            ? `${packOperations.readyRuleCount}/${packOperations.automationRuleCount}`
            : `${packReadyAutomationRules}/${packAutomationRules.length}`,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Deliveries ready",
          value: packOperations
            ? `${packOperations.readyDeliveryCount}/${packOperations.deliverySubscriptionCount}`
            : `${
                packDeliverySubscriptions.filter(
                  (subscription) => subscription.status === translateNow("reportCenter.readyToSend")
                ).length
              }/${packDeliverySubscriptions.length}`,
          workflow: deliveryWorkflow,
        },
        {
          field: "Failed delivery runs",
          value: packOperations?.failedRunCount ?? 0,
          workflow: deliveryWorkflow,
        },
        {
          field: "Open work items",
          value: packOperations?.openWorkItemCount ?? packRuleOpenWorkItemCount,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Amount at risk",
          value: `AED ${(packOperations?.amountAtRisk ?? packRuleAmountAtRisk).toFixed(2)}`,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Comparison warnings",
          value:
            packOperations?.comparisonWarnings ??
            packReadiness?.automationHealth.comparisonWarnings ??
            0,
          workflow: reportSectionHref(workspace, "recommendations"),
        },
        {
          field: "Recommended actions",
          value: packOperations?.recommendationCount ?? packRecommendations.length,
          workflow: reportSectionHref(workspace, "recommendations"),
        },
      ],
    };

    const accountantHandoff: ExportData = {
      sheetName: "Accountant Handoff",
      columns: [
        { header: "Workspace", key: "workspace", width: 30 },
        { header: "Persona", key: "persona", width: 18 },
        { header: "Status", key: "status", width: 24 },
        { header: "Priority Gap", key: "priorityGap", width: 24 },
        { header: "Reports Ready", key: "reportsReady", width: 18 },
        { header: "Rules Ready", key: "rulesReady", width: 18 },
        { header: "Deliveries Ready", key: "deliveriesReady", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Shared Context", key: "sharedContext", width: 54 },
        { header: "Gap Workflow", key: "gapWorkflow", width: 54 },
        { header: "Next Action", key: "nextAction", width: 30 },
        { header: "Next Action Detail", key: "nextActionDetail", width: 78 },
        { header: "Next Action Workflow", key: "nextActionWorkflow", width: 54 },
      ],
      rows: [
        {
          workspace: workspace.title,
          persona: workspace.persona,
          status: packOperations?.status ?? translateNow("firm.notAvailable"),
          priorityGap: packPriorityGapLabel,
          reportsReady: packOperations
            ? `${packOperations.readyReportCount}/${packOperations.reportCount}`
            : `${workspace.readyReports}/${workspace.reports.length}`,
          rulesReady: packOperations
            ? `${packOperations.readyRuleCount}/${packOperations.automationRuleCount}`
            : `${packReadyAutomationRules}/${packAutomationRules.length}`,
          deliveriesReady: packOperations
            ? `${packOperations.readyDeliveryCount}/${packOperations.deliverySubscriptionCount}`
            : `${
                packDeliverySubscriptions.filter(
                  (subscription) => subscription.status === translateNow("reportCenter.readyToSend")
                ).length
              }/${packDeliverySubscriptions.length}`,
          amountAtRisk: `AED ${(packOperations?.amountAtRisk ?? packRuleAmountAtRisk).toFixed(2)}`,
          sharedContext: packSharedContextHref,
          gapWorkflow: packGapHref,
          nextAction: packOperations?.nextAction.label ?? translateNow("firm.notAvailable"),
          nextActionDetail: packOperations?.nextAction.detail ?? translateNow("firm.notAvailable"),
          nextActionWorkflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
      ],
    };

    const packSummary: ExportData = {
      sheetName: "Pack Summary",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 80 },
      ],
      rows: [
        { metric: "Workspace", value: workspace.title },
        { metric: "Persona", value: workspace.persona },
        { metric: "Pack automation outcome", value: workspace.automationOutcome },
        { metric: "Current period", value: comparisonCurrentLabel },
        { metric: "Prior period", value: comparisonPreviousLabel },
        {
          metric: "Pack status",
          value:
            openPackSignals.length > 0
              ? translateNow("reportCenter.reviewBeforeSend")
              : translateNow("reportCenter.readyToSend"),
        },
        {
          metric: "Operations status",
          value: packOperations?.status ?? translateNow("firm.notAvailable"),
        },
        {
          metric: "Operations next action",
          value: packOperations?.nextAction.label ?? translateNow("firm.notAvailable"),
        },
        { metric: "Workspace reports", value: workspace.reports.length },
        { metric: "Ready reports", value: workspace.readyReports },
        { metric: "Coverage categories", value: packCoverageMap.length },
        { metric: "Decision shortcuts", value: packDecisionShortcuts.length },
        { metric: "Automation starters", value: packAutomationStarters.length },
        { metric: "Trigger rules", value: packTriggerRules.length },
        { metric: "Delivery subscriptions", value: packDeliverySubscriptions.length },
        { metric: "Pack templates", value: packTemplates.length },
        { metric: "Planned report gaps", value: packRoadmap?.plannedReportCount ?? 0 },
        { metric: "Roadmap prerequisites", value: packRoadmap?.prerequisiteCount ?? 0 },
        {
          metric: "Roadmap status",
          value: packRoadmap?.roadmapStatus ?? translateNow("firm.notAvailable"),
        },
        {
          metric: "Top roadmap priority",
          value: packRoadmap?.topPriorityReport
            ? `${packRoadmap.topPriorityReport.name} (${packRoadmap.topPriorityScore})`
            : translateNow("firm.notAvailable"),
        },
        { metric: "Workbook sheets", value: workbookSheets.length },
        { metric: "Comparison metrics", value: packComparisonRows.length },
        { metric: "Comparison presets", value: packComparisonPresets.length },
        { metric: "Recommended actions", value: packRecommendations.length },
        { metric: "Auto-send coverage", value: `${packAutoSendCoveragePercent}%` },
        { metric: "Ready auto-send rules", value: packReadyAutomationRules },
        { metric: "Rules needing review", value: packReviewAutomationRules },
        { metric: "Setup-needed rules", value: packSetupAutomationRules },
        { metric: "Delivery checks", value: packReadiness?.checks.length ?? 0 },
        { metric: "Checks needing review", value: packReadiness?.reviewCount ?? 0 },
        {
          metric: "Automation health",
          value: packReadiness
            ? `${packReadiness.automationHealth.score}/100 - ${packReadiness.automationHealth.label}`
            : translateNow("firm.notAvailable"),
        },
        {
          metric: "Automation health review signals",
          value: packReadiness?.automationHealth.reviewSignals ?? 0,
        },
        {
          metric: "Automation health trend",
          value: packHealthTrend
            ? `${packHealthTrend.label} (${packHealthTrend.detail})`
            : translateNow("firm.notAvailable"),
        },
        { metric: "Open automation signals", value: openPackSignals.length },
        { metric: "Open work items", value: openPackWorkItemCount },
        { metric: "Amount at risk", value: `AED ${packAmountAtRisk.toFixed(2)}` },
      ],
    };

    const coverageMap: ExportData = {
      sheetName: "Coverage Map",
      columns: [
        { header: "Category", key: "category", width: 24 },
        { header: "Reports", key: "reports", width: 14 },
        { header: "Live", key: "live", width: 10 },
        { header: "API Ready", key: "apiReady", width: 12 },
        { header: "Planned", key: "planned", width: 12 },
        { header: "Workbook Sheets", key: "workbookSheets", width: 16 },
        { header: "Comparison Types", key: "comparisonTypes", width: 58 },
        { header: "Automation Hooks", key: "automationHooks", width: 72 },
        { header: "Personas", key: "personas", width: 30 },
        { header: "Report List", key: "reportList", width: 72 },
        { header: "Decision Questions", key: "decisionQuestions", width: 90 },
      ],
      rows: packCoverageMap.map((coverage) => ({
        category: coverage.category,
        reports: coverage.reports.length,
        live: coverage.liveCount,
        apiReady: coverage.apiReadyCount,
        planned: coverage.plannedCount,
        workbookSheets: coverage.workbookCount,
        comparisonTypes: coverage.comparisonTypes.join(", "),
        automationHooks: coverage.automationHooks.join(", "),
        personas: coverage.personas.join(", "),
        reportList: coverage.reports.map((report) => report.name).join(", "),
        decisionQuestions: coverage.reports.map((report) => report.decisionQuestion).join(" | "),
      })),
    };

    const packTemplatesSheet: ExportData = {
      sheetName: "Pack Templates",
      columns: [
        { header: "Template", key: "template", width: 34 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Outcome", key: "outcome", width: 70 },
        { header: "Cadence", key: "cadence", width: 34 },
        { header: "Delivery", key: "delivery", width: 38 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Categories", key: "categories", width: 34 },
        { header: "Comparison Focus", key: "comparisonFocus", width: 58 },
        { header: "Automation Trigger", key: "automationTrigger", width: 70 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packTemplates.map((template) => ({
        template: template.title,
        audience: template.audience,
        outcome: template.outcome,
        cadence: template.cadence,
        delivery: template.delivery,
        reports: template.reports.map((report) => report.name).join(", "),
        readyReports: `${template.readyCount}/${template.reports.length}`,
        categories: template.categories.join(", "),
        comparisonFocus: template.comparisonFocus,
        automationTrigger: template.automationTrigger,
        workflow: template.href,
      })),
    };

    const decisionShortcutsSheet: ExportData = {
      sheetName: "Decision Shortcuts",
      columns: [
        { header: "Question", key: "question", width: 46 },
        { header: "Answer", key: "answer", width: 80 },
        { header: "Primary Report", key: "primaryReport", width: 30 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Comparison Preset", key: "comparisonPreset", width: 36 },
        { header: "Automation Starter", key: "automationStarter", width: 38 },
        { header: "Report Workflow", key: "reportWorkflow", width: 42 },
        { header: "Shortcut Workflow", key: "shortcutWorkflow", width: 42 },
      ],
      rows: packDecisionShortcuts.map((shortcut) => ({
        question: shortcut.question,
        answer: shortcut.answer,
        primaryReport: shortcut.primaryReport.name,
        reports: shortcut.reports.map((report) => report.name).join(", "),
        comparisonPreset: shortcut.comparisonPreset?.title ?? "",
        automationStarter: shortcut.automationStarter?.title ?? "",
        reportWorkflow: shortcut.primaryReportHref,
        shortcutWorkflow: shortcut.href,
      })),
    };

    const automationStartersSheet: ExportData = {
      sheetName: "Automation Starters",
      columns: [
        { header: "Starter", key: "starter", width: 34 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Outcome", key: "outcome", width: 72 },
        { header: "Setup Time", key: "setupTime", width: 18 },
        { header: "Trigger", key: "trigger", width: 60 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Playbooks", key: "playbooks", width: 56 },
        { header: "Queue Signals", key: "queueSignals", width: 56 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Setup Steps", key: "setupSteps", width: 72 },
        { header: "Primary Action", key: "primaryAction", width: 28 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packAutomationStarters.map((starter) => ({
        starter: starter.title,
        audience: starter.audience,
        outcome: starter.outcome,
        setupTime: starter.setupTime,
        trigger: starter.trigger,
        readyReports: `${starter.readyCount}/${starter.reports.length}`,
        reports: starter.reports.map((report) => report.name).join(", "),
        playbooks: starter.playbooks.map((playbook) => playbook.title).join(", "),
        queueSignals: starter.queueSignals.map((signal) => signal.title).join(", "),
        openWorkItemCount: starter.openWorkItemCount,
        amountAtRisk: `AED ${starter.amountAtRisk.toFixed(2)}`,
        setupSteps: starter.setupSteps.join(" | "),
        primaryAction: starter.primaryAction,
        workflow: starter.href,
      })),
    };

    const triggerRulesSheet: ExportData = {
      sheetName: "Trigger Rules",
      columns: [
        { header: "Rule", key: "rule", width: 34 },
        { header: "Severity", key: "severity", width: 16 },
        { header: "Condition", key: "condition", width: 70 },
        { header: "Threshold", key: "threshold", width: 74 },
        { header: "Cadence", key: "cadence", width: 42 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Decision Shortcut", key: "decisionShortcut", width: 42 },
        { header: "Automation Starter", key: "automationStarter", width: 42 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Action", key: "action", width: 28 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packTriggerRules.map((rule) => ({
        rule: rule.title,
        severity: triggerSeverityMeta[rule.severity].label,
        condition: rule.condition,
        threshold: rule.threshold,
        cadence: rule.cadence,
        reports: rule.reports.map((report) => report.name).join(", "),
        decisionShortcut: rule.decisionShortcut?.question ?? "",
        automationStarter: rule.automationStarter?.title ?? "",
        openWorkItemCount: rule.openWorkItemCount,
        amountAtRisk: `AED ${rule.amountAtRisk.toFixed(2)}`,
        action: rule.actionLabel,
        workflow: rule.href,
      })),
    };

    const deliverySubscriptionsSheet: ExportData = {
      sheetName: "Delivery Subscriptions",
      columns: [
        { header: "Subscription", key: "subscription", width: 38 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Cadence", key: "cadence", width: 54 },
        { header: "Channel", key: "channel", width: 36 },
        { header: "Format", key: "format", width: 32 },
        { header: "Recipients", key: "recipients", width: 58 },
        { header: "Pack Template", key: "packTemplate", width: 38 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Trigger Rules", key: "triggerRules", width: 64 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Delivery Guardrail", key: "deliveryGuardrail", width: 78 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packDeliverySubscriptions.map((subscription) => ({
        subscription: subscription.title,
        audience: subscription.audience,
        cadence: subscription.cadence,
        channel: subscription.channel,
        format: subscription.format,
        recipients: subscription.recipients,
        packTemplate: subscription.packTemplate?.title ?? "",
        readyReports: `${subscription.readyCount}/${subscription.reports.length}`,
        triggerRules: subscription.triggerRules.map((rule) => rule.title).join(", "),
        openWorkItemCount: subscription.openWorkItemCount,
        amountAtRisk: `AED ${subscription.amountAtRisk.toFixed(2)}`,
        deliveryGuardrail: subscription.deliveryGuardrail,
        workflow: subscription.href,
      })),
    };

    const recommendedActions: ExportData = {
      sheetName: "Recommended Actions",
      columns: [
        { header: "Priority", key: "priority", width: 12 },
        { header: "Action", key: "action", width: 32 },
        { header: "Trigger", key: "trigger", width: 60 },
        { header: "Signal", key: "signal", width: 20 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: packRecommendations.map((recommendation, index) => ({
        priority: index + 1,
        action: recommendation.title,
        trigger: recommendation.detail,
        signal: recommendation.badge,
        amount:
          typeof recommendation.amount === "number"
            ? `AED ${recommendation.amount.toFixed(2)}`
            : "",
        workflow:
          recommendation.href ??
          (recommendation.tab
            ? reportsHref({ tab: recommendation.tab, persona: workspace.persona })
            : reportWorkspaceHref(workspace)),
      })),
    };

    const reportRoadmapSheet: ExportData = {
      sheetName: "Report Roadmap",
      columns: [
        { header: "Report", key: "report", width: 32 },
        { header: "Status", key: "status", width: 18 },
        { header: "Priority Score", key: "priorityScore", width: 16 },
        { header: "Persona Impact", key: "personaImpact", width: 18 },
        { header: "Priority Rationale", key: "priorityRationale", width: 56 },
        { header: "Category", key: "category", width: 24 },
        { header: "Comparison", key: "comparison", width: 28 },
        { header: "Automation Unlock", key: "automation", width: 34 },
        { header: "Data Source Needed", key: "dataSource", width: 46 },
        { header: "Workflow Dependency", key: "workflowDependency", width: 50 },
        { header: "Automation Rule Needed", key: "automationRule", width: 50 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: workspace.reports
        .slice()
        .sort((a, b) => {
          const aPlanned = a.status === "planned" ? 0 : 1;
          const bPlanned = b.status === "planned" ? 0 : 1;
          return (
            aPlanned - bPlanned ||
            (b.roadmapPriority?.score ?? 0) - (a.roadmapPriority?.score ?? 0) ||
            a.name.localeCompare(b.name)
          );
        })
        .map((report) => ({
          report: report.name,
          status: reportStatusMeta[report.status].label,
          priorityScore: report.roadmapPriority?.score ?? "",
          personaImpact: report.roadmapPriority?.impactByPersona[workspace.persona] ?? "",
          priorityRationale: report.roadmapPriority?.rationale ?? "",
          category: report.category,
          comparison: report.comparison,
          automation: report.automation,
          dataSource: report.roadmapPrerequisites?.dataSource ?? "",
          workflowDependency: report.roadmapPrerequisites?.workflowDependency ?? "",
          automationRule: report.roadmapPrerequisites?.automationRule ?? "",
          workflow: reportPersonaHref(report, workspace.persona) ?? reportWorkspaceHref(workspace),
        })),
    };

    const automationCommandCenter: ExportData = {
      sheetName: "Automation Command Center",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 80 },
      ],
      rows: [
        { metric: "Workspace", value: workspace.title },
        { metric: "Persona", value: workspace.persona },
        { metric: "Automation outcome", value: workspace.automationOutcome },
        { metric: "Total automation rules", value: packAutomationRules.length },
        { metric: "Delivery subscriptions", value: packDeliverySubscriptions.length },
        { metric: "Ready auto-send rules", value: packReadyAutomationRules },
        { metric: "Rules needing review", value: packReviewAutomationRules },
        { metric: "Setup-needed rules", value: packSetupAutomationRules },
        { metric: "Auto-send coverage", value: `${packAutoSendCoveragePercent}%` },
        { metric: "Open rule work items", value: packRuleOpenWorkItemCount },
        { metric: "Rule amount at risk", value: `AED ${packRuleAmountAtRisk.toFixed(2)}` },
        { metric: "Comparison metrics linked", value: packRuleComparisonMetricCount },
        { metric: "Report bundle coverage", value: packRuleReportBundleCount },
        {
          metric: "Pack delivery status",
          value: packReadiness?.status ?? translateNow("firm.notAvailable"),
        },
        {
          metric: "Pack checks needing review",
          value: packReadiness?.reviewCount ?? 0,
        },
      ],
    };

    const automationHealth: ExportData = {
      sheetName: "Automation Health",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 42 },
      ],
      rows: packReadiness
        ? [
            { metric: "Workspace", value: workspace.title },
            {
              metric: "Score",
              value: `${packReadiness.automationHealth.score}/100`,
            },
            { metric: "Status", value: packReadiness.automationHealth.label },
            {
              metric: "Pack readiness score",
              value: `${packReadiness.automationHealth.readinessScore}/100`,
            },
            {
              metric: "Automation lane score",
              value: `${packReadiness.automationHealth.automationLaneScore}/100`,
            },
            {
              metric: "Comparison signal score",
              value: `${packReadiness.automationHealth.comparisonScore}/100`,
            },
            {
              metric: "Comparison warnings",
              value: packReadiness.automationHealth.comparisonWarnings,
            },
            {
              metric: "Review signals",
              value: packReadiness.automationHealth.reviewSignals,
            },
          ]
        : [],
    };

    const automationHealthTrend: ExportData = {
      sheetName: "Automation Health Trend",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 52 },
      ],
      rows: packHealthTrend
        ? [
            { metric: "Workspace", value: workspace.title },
            { metric: "Trend", value: packHealthTrend.label },
            { metric: "Current score", value: packHealthTrend.currentScore },
            {
              metric: "Previous score",
              value: packHealthTrend.previousScore ?? "Baseline",
            },
            { metric: "Delta", value: packHealthTrend.delta },
            { metric: "Detail", value: packHealthTrend.detail },
            {
              metric: "Previous captured at",
              value: packHealthTrend.previousCapturedAt ?? "",
            },
          ]
        : [],
    };

    const deliveryChecklist: ExportData = {
      sheetName: "Delivery Checklist",
      columns: [
        { header: "Check", key: "check", width: 34 },
        { header: "Status", key: "status", width: 18 },
        { header: "Detail", key: "detail", width: 70 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows:
        packReadiness?.checks.map((check) => ({
          check: check.label,
          status: check.status,
          detail: check.detail,
          workflow: check.workflow,
        })) ?? [],
    };

    const comparisonSnapshot: ExportData = {
      sheetName: "Comparison Snapshot",
      columns: [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Signal", key: "signal", width: 22 },
        { header: "Current", key: "current", width: 18 },
        { header: "Baseline", key: "prior", width: 18 },
        { header: "Change", key: "change", width: 18 },
        { header: "Change %", key: "changePercent", width: 16 },
        { header: "Status", key: "status", width: 18 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: packComparisonRows.map((row) => {
        const status =
          Math.abs(row.delta) < 0.005
            ? "Stable"
            : row.favorable === "neutral"
              ? "Context"
              : (row.favorable === "increase" ? row.delta > 0 : row.delta < 0)
                ? "Favorable"
                : "Review";

        return {
          metric: row.label,
          signal: row.signal,
          current: formatComparisonExportValue(row, row.current),
          prior: formatComparisonExportValue(row, row.previous),
          change: formatComparisonExportValue(row, row.delta),
          changePercent: formatComparisonPercent(row.percentChange),
          status,
          workflow: reportsHref({ tab: row.tab, persona: workspace.persona }),
        };
      }),
    };

    const comparisonPresetsSheet: ExportData = {
      sheetName: "Comparison Presets",
      columns: [
        { header: "Preset", key: "preset", width: 34 },
        { header: "Question", key: "question", width: 70 },
        { header: "Baseline", key: "baseline", width: 56 },
        { header: "Metrics", key: "metrics", width: 56 },
        { header: "Warnings", key: "warnings", width: 12 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Automation Trigger", key: "automationTrigger", width: 70 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packComparisonPresets.map((preset) => ({
        preset: preset.title,
        question: preset.question,
        baseline: preset.baseline,
        metrics: preset.metrics.map((row) => row.label).join(", "),
        warnings: preset.warningCount,
        reports: preset.reports.map((report) => report.name).join(", "),
        automationTrigger: preset.automationTrigger,
        workflow: preset.href,
      })),
    };

    const automationPlaybooks: ExportData = {
      sheetName: "Automation Playbooks",
      columns: [
        { header: "Playbook", key: "playbook", width: 34 },
        { header: "Trigger", key: "trigger", width: 42 },
        { header: "Cadence", key: "cadence", width: 38 },
        { header: "Recipients", key: "recipients", width: 42 },
        { header: "Reports", key: "reports", width: 60 },
        { header: "Rule Status", key: "status", width: 24 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Comparison Metrics", key: "comparisonMetricCount", width: 20 },
        { header: "Action", key: "action", width: 24 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: packAutomationRules.map((rule) => ({
        playbook: rule.playbook.title,
        trigger: rule.playbook.trigger,
        cadence: workspace.packSchedule.cadence,
        recipients: workspace.packSchedule.recipients,
        reports: rule.linkedReports.map((report) => report.name).join(", "),
        status: rule.status,
        openWorkItemCount: rule.openWorkItemCount,
        amountAtRisk: `AED ${rule.amountAtRisk.toFixed(2)}`,
        comparisonMetricCount: rule.comparisonMetricCount,
        action: rule.playbook.cta,
        workflow: rule.targetWorkflow,
      })),
    };

    const packAutomationStatus: ExportData = {
      sheetName: "Pack Automation Status",
      columns: [
        { header: "Signal", key: "signal", width: 26 },
        { header: "Detail", key: "detail", width: 54 },
        { header: "Open Count", key: "count", width: 14 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Status", key: "status", width: 20 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: packSignals.map((item) => ({
        signal: item.title,
        detail: item.detail,
        count: item.count,
        amount:
          typeof item.amount === "number"
            ? `${item.currency ?? "AED"} ${item.amount.toFixed(2)}`
            : "",
        status: item.count > 0 ? translateNow("reportCenter.reviewBeforeSend") : "Clear",
        workflow:
          item.href ?? (item.tab ? reportsHref({ tab: item.tab, persona: workspace.persona }) : ""),
      })),
    };

    const packCadence: ExportData = {
      sheetName: "Pack Cadence",
      columns: [
        { header: "Field", key: "field", width: 24 },
        { header: "Value", key: "value", width: 80 },
      ],
      rows: [
        { field: "Workspace", value: workspace.title },
        { field: "Persona", value: workspace.persona },
        { field: "Cadence", value: workspace.packSchedule.cadence },
        { field: "Delivery", value: workspace.packSchedule.delivery },
        { field: "Recipients", value: workspace.packSchedule.recipients },
        { field: "Refresh trigger", value: workspace.packSchedule.trigger },
        { field: "Automation rule", value: workspace.packSchedule.automation },
        { field: "Automation outcome", value: workspace.automationOutcome },
      ],
    };

    return [
      packIndex,
      packSummary,
      operationsControl,
      accountantHandoff,
      coverageMap,
      decisionShortcutsSheet,
      packTemplatesSheet,
      automationStartersSheet,
      triggerRulesSheet,
      deliverySubscriptionsSheet,
      recommendedActions,
      reportRoadmapSheet,
      automationCommandCenter,
      automationHealth,
      automationHealthTrend,
      deliveryChecklist,
      comparisonSnapshot,
      comparisonPresetsSheet,
      packCadence,
      packAutomationStatus,
      automationPlaybooks,
      ...workbookSheets,
    ];
  };

  return { exportDateRangeSuffix, buildWorkspaceReportPack };
}

export type ReportsWorkspacePackState = ReturnType<typeof useReportsWorkspacePack>;
