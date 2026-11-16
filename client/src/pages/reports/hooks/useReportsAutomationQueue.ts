// Automation work queue, automation starters and trigger rules.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import { translateNow } from "@/lib/i18n";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ClipboardCheck,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { AutomationQueueItem, matchesReportPersona } from "../shared";
import {
  type ReportCatalogItem,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportCatalog,
  reportPersonaHref,
} from "@/lib/reportCatalog";
import { useMemo } from "react";
import type { ReportsComparisonsAndCloseState } from "./useReportsComparisonsAndClose";
import type { ReportsDerivedReportsState } from "./useReportsDerivedReports";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";

type UseReportsAutomationQueueDeps = Pick<
  ReportsComparisonsAndCloseState &
    ReportsDerivedReportsState &
    ReportsDataQueriesState &
    ReportsWorkspaceStateState &
    ReportsWorkspaceSummariesState,
  | "auditTrailReport"
  | "balanceReport"
  | "consolidatedStatementsReport"
  | "corporateTaxEstimate"
  | "depreciationScheduleReport"
  | "expenseClaimReport"
  | "expenseReport"
  | "fixedAssetRegisterReport"
  | "inventoryMovementReport"
  | "inventoryValuationReport"
  | "ledgerReport"
  | "matchesReportWorkflowSearch"
  | "monthEndPeriodLabel"
  | "monthEndReviewChecks"
  | "payrollReport"
  | "personaFilter"
  | "planningReport"
  | "productServiceTopShare"
  | "reportDecisionShortcutSummaries"
  | "topProductServiceSalesRow"
  | "trialBalanceSummary"
  | "vatSummary"
  | "workspaceSummaries"
>;

export function useReportsAutomationQueue({
  auditTrailReport,
  balanceReport,
  consolidatedStatementsReport,
  corporateTaxEstimate,
  depreciationScheduleReport,
  expenseClaimReport,
  expenseReport,
  fixedAssetRegisterReport,
  inventoryMovementReport,
  inventoryValuationReport,
  ledgerReport,
  matchesReportWorkflowSearch,
  monthEndPeriodLabel,
  monthEndReviewChecks,
  payrollReport,
  personaFilter,
  planningReport,
  productServiceTopShare,
  reportDecisionShortcutSummaries,
  topProductServiceSalesRow,
  trialBalanceSummary,
  vatSummary,
  workspaceSummaries,
}: UseReportsAutomationQueueDeps) {
  const automationQueue = useMemo<AutomationQueueItem[]>(() => {
    const vatNet = vatSummary?.netVATPayable ?? 0;
    const corporateTaxPayable = corporateTaxEstimate?.taxPayable ?? 0;
    const closeReviewCount = ledgerReport.reviewEntries + (trialBalanceSummary.isBalanced ? 0 : 1);
    const planningRiskCount =
      (planningReport.cashWarning === translateNow("onTrack") ? 0 : 1) +
      planningReport.overBudgetLines;

    return [
      {
        id: "collections",
        title: "Collections follow-up",
        signal: "Overdue customers",
        detail: "Route overdue receivables into payment chasing.",
        count: balanceReport.overdueCustomerCount,
        amount: balanceReport.customerOverdueAed,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Users,
        actionLabel: "Open queue",
        href: "/payment-chasing",
      },
      {
        id: "bill-pay",
        title: "Bill pay timing",
        signal: "Overdue vendors",
        detail: "Review vendor balances and payable timing.",
        count: balanceReport.overdueVendorCount,
        amount: balanceReport.vendorOverdueAed,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Wallet,
        actionLabel: "Open bills",
        href: "/bill-pay?tab=summary",
      },
      {
        id: "inventory-risk",
        title: "Inventory valuation",
        signal:
          inventoryValuationReport.reviewCount > 0
            ? translateNow("reportCenter.signalStockReview")
            : "Inventory valued",
        detail:
          inventoryValuationReport.reviewCount > 0
            ? `${inventoryValuationReport.reviewCount} products need stock, reorder, or costing review.`
            : `${inventoryValuationReport.activeProductCount} active products valued for the balance report.`,
        count: inventoryValuationReport.reviewCount,
        amount: inventoryValuationReport.totalStockValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open inventory",
        href: "/inventory",
      },
      {
        id: "inventory-movement-review",
        title: "Inventory movement",
        signal:
          inventoryMovementReport.movementCount > 0
            ? translateNow("reportCenter.signalStockMovement")
            : "No stock movement",
        detail:
          inventoryMovementReport.reorderSignalCount > 0
            ? `${inventoryMovementReport.reorderSignalCount} products need reorder or negative-stock review after recent movement.`
            : `${inventoryMovementReport.movementCount} movements across ${inventoryMovementReport.productCount} products in this period.`,
        count: inventoryMovementReport.reorderSignalCount,
        amount: inventoryMovementReport.outboundValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open movements",
        href: "/inventory",
      },
      {
        id: "fixed-asset-review",
        title: "Fixed asset register",
        signal:
          fixedAssetRegisterReport.reviewCount > 0
            ? translateNow("reportCenter.signalAssetReview")
            : "Asset register ready",
        detail:
          fixedAssetRegisterReport.capitalizationReviewCount > 0
            ? `${fixedAssetRegisterReport.capitalizationReviewCount} assets need capitalization journal review.`
            : `${fixedAssetRegisterReport.totalAssets} active assets with depreciation and NBV tracked.`,
        count: fixedAssetRegisterReport.reviewCount,
        amount: fixedAssetRegisterReport.totalNetBookValue,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Building2,
        actionLabel: "Open fixed assets",
        href: "/fixed-assets",
      },
      {
        id: "depreciation-posting",
        title: "Depreciation schedule",
        signal:
          depreciationScheduleReport.reviewCount > 0
            ? translateNow("reportCenter.signalDepreciationSetup")
            : "Depreciation ready",
        detail:
          depreciationScheduleReport.reviewCount > 0
            ? `${depreciationScheduleReport.reviewCount} assets need useful-life, date, or cost review before posting.`
            : `${depreciationScheduleReport.readyToPostCount} assets have ${monthEndPeriodLabel} depreciation suggestions.`,
        count: depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount,
        amount: depreciationScheduleReport.periodDepreciationAed,
        currency: "AED",
        personas: ["freelancer", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open fixed assets",
        href: "/fixed-assets",
      },
      {
        id: "receipt-posting",
        title: "Receipt posting",
        signal: "Receipts waiting",
        detail: "Clear OCR and posting exceptions before close.",
        count: expenseReport.unpostedReceipts,
        personas: ["owner", "freelancer", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open expenses",
        tab: "expenses",
      },
      {
        id: "expense-claims-review",
        title: "Expense claims",
        signal:
          expenseClaimReport.reviewCount > 0
            ? translateNow("reportCenter.signalClaimQueueOpen")
            : "Expense claims clear",
        detail:
          expenseClaimReport.submittedCount > 0
            ? `${expenseClaimReport.submittedCount} submitted claims need approval.`
            : expenseClaimReport.approvedUnpaidCount > 0
              ? `${expenseClaimReport.approvedUnpaidCount} approved claims are awaiting reimbursement.`
              : "No claims are pending approval or reimbursement.",
        count: expenseClaimReport.reviewCount,
        amount: expenseClaimReport.submittedAmount + expenseClaimReport.approvedUnpaidAmount,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open claims",
        href: "/expense-claims",
      },
      {
        id: "payroll-wps-review",
        title: "Payroll and WPS",
        signal:
          payrollReport.approvalQueueCount > 0 || payrollReport.wpsMissingCount > 0
            ? translateNow("reportCenter.signalPayrollAction")
            : "Payroll ready",
        detail:
          payrollReport.approvalQueueCount > 0
            ? `${payrollReport.approvalQueueCount} calculated payroll runs need approval.`
            : payrollReport.wpsMissingCount > 0
              ? `${payrollReport.wpsMissingCount} payroll runs need SIF generation.`
              : `${payrollReport.runCount} payroll runs are summarized for owner and accountant review.`,
        count: payrollReport.approvalQueueCount + payrollReport.wpsMissingCount,
        amount: payrollReport.totalNet,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: DollarSign,
        actionLabel: "Open payroll",
        href: "/payroll",
      },
      {
        id: "vat-readiness",
        title: "VAT readiness",
        signal: vatNet >= 0 ? "VAT payable" : "VAT refund",
        detail: "Check the filing amount and supporting VAT reports.",
        count: Math.abs(vatNet) > 0.005 ? 1 : 0,
        amount: Math.abs(vatNet),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: FileText,
        actionLabel: "Open filing",
        href: "/vat-filing",
      },
      {
        id: "sales-mix",
        title: "Sales mix concentration",
        signal: topProductServiceSalesRow
          ? `${topProductServiceSalesRow.productService} leads sales`
          : "No line-item sales",
        detail: "Review product/service concentration before forecasting or pricing changes.",
        count: productServiceTopShare >= 50 ? 1 : 0,
        amount: topProductServiceSalesRow?.amountAed ?? 0,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: BarChart3,
        actionLabel: "Open sales mix",
        tab: "sales",
      },
      {
        id: "corporate-tax",
        title: "Corporate tax estimate",
        signal:
          corporateTaxPayable > 0.005
            ? translateNow("reportCenter.signalTaxPayable")
            : "No current tax due",
        detail: "Review the Corporate Tax estimate and update the workpaper before draft filing.",
        count: corporateTaxPayable > 0.005 ? 1 : 0,
        amount: Math.max(0, corporateTaxPayable),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Scale,
        actionLabel: "Open estimate",
        tab: "tax",
      },
      {
        id: "close-review",
        title: "Close review",
        signal: "Review items",
        detail: "Inspect trial-balance differences and manual ledger sources.",
        count: closeReviewCount,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open ledger",
        tab: closeReviewCount > 0 && !trialBalanceSummary.isBalanced ? "trial" : "ledger",
      },
      {
        id: "month-end-close",
        title: "Month-end close status",
        signal: "Close checklist",
        detail:
          monthEndReviewChecks > 0
            ? `${monthEndReviewChecks} close checks need review for ${monthEndPeriodLabel}.`
            : `${monthEndPeriodLabel} close checklist is complete.`,
        count: monthEndReviewChecks,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open close status",
        tab: "close",
      },
      {
        id: "audit-trail-review",
        title: "Audit trail",
        signal: auditTrailReport.highRiskCount > 0 ? "High-risk activity" : "Activity log reviewed",
        detail:
          auditTrailReport.highRiskCount > 0
            ? `${auditTrailReport.highRiskCount} delete, void, reject, or error events need reviewer attention.`
            : `${auditTrailReport.logCount} activity events summarized for reviewer evidence.`,
        count: auditTrailReport.highRiskCount,
        personas: ["accountant"],
        icon: FileText,
        actionLabel: "Open history",
        href: "/history",
      },
      {
        id: "consolidated-statements-review",
        title: "Management roll-up",
        signal:
          consolidatedStatementsReport.reviewCount > 0
            ? translateNow("reportCenter.signalConsolidationReview")
            : "Multi-entity roll-up ready",
        detail:
          consolidatedStatementsReport.reviewCount > 0
            ? `${consolidatedStatementsReport.reviewCount} entity, balance, or FX checks need review before pack delivery.`
            : `${consolidatedStatementsReport.loadedEntityCount} entities rolled up with no eliminations applied.`,
        count: consolidatedStatementsReport.reviewCount,
        amount: Math.abs(consolidatedStatementsReport.netProfit),
        currency: "AED",
        personas: ["accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open roll-up",
        tab: "close",
      },
      {
        id: "planning-risk",
        title: "Planning guardrails",
        signal: "Budget and cash alerts",
        detail: "Review cash warnings and budget variance outliers.",
        count: planningRiskCount,
        amount: Math.abs(planningReport.variance),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: AlertTriangle,
        actionLabel: "Open planning",
        tab: "planning",
      },
    ];
  }, [
    balanceReport.customerOverdueAed,
    balanceReport.overdueCustomerCount,
    balanceReport.overdueVendorCount,
    balanceReport.vendorOverdueAed,
    consolidatedStatementsReport.loadedEntityCount,
    consolidatedStatementsReport.netProfit,
    consolidatedStatementsReport.reviewCount,
    corporateTaxEstimate?.taxPayable,
    depreciationScheduleReport.periodDepreciationAed,
    depreciationScheduleReport.readyToPostCount,
    depreciationScheduleReport.reviewCount,
    expenseClaimReport.approvedUnpaidAmount,
    expenseClaimReport.approvedUnpaidCount,
    expenseClaimReport.reviewCount,
    expenseClaimReport.submittedAmount,
    expenseClaimReport.submittedCount,
    expenseReport.unpostedReceipts,
    fixedAssetRegisterReport.capitalizationReviewCount,
    fixedAssetRegisterReport.reviewCount,
    fixedAssetRegisterReport.totalAssets,
    fixedAssetRegisterReport.totalNetBookValue,
    inventoryValuationReport.activeProductCount,
    inventoryValuationReport.reviewCount,
    inventoryValuationReport.totalStockValueAed,
    inventoryMovementReport.movementCount,
    inventoryMovementReport.outboundValueAed,
    inventoryMovementReport.productCount,
    inventoryMovementReport.reorderSignalCount,
    ledgerReport.reviewEntries,
    monthEndPeriodLabel,
    monthEndReviewChecks,
    auditTrailReport.highRiskCount,
    auditTrailReport.logCount,
    payrollReport.approvalQueueCount,
    payrollReport.runCount,
    payrollReport.totalNet,
    payrollReport.wpsMissingCount,
    planningReport.cashWarning,
    planningReport.overBudgetLines,
    planningReport.variance,
    productServiceTopShare,
    topProductServiceSalesRow,
    trialBalanceSummary.isBalanced,
    vatSummary?.netVATPayable,
  ]);
  const visibleAutomationQueue = useMemo(() => {
    return automationQueue.filter((item) => matchesReportPersona(item.personas, personaFilter));
  }, [automationQueue, personaFilter]);
  const automationQueueCount = visibleAutomationQueue.reduce((sum, item) => sum + item.count, 0);
  const reportAutomationStarterSummaries = useMemo(() => {
    return reportAutomationStarters.flatMap((starter) => {
      const workspace = workspaceSummaries.find((item) => item.persona === starter.persona);
      if (!workspace) return [];

      const reports = starter.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const playbooks = starter.playbookIds
        .map((playbookId) => workspace.automations.find((playbook) => playbook.id === playbookId))
        .filter((playbook): playbook is (typeof workspace.automations)[number] =>
          Boolean(playbook)
        );
      const queueSignals = automationQueue.filter((item) => starter.queueIds.includes(item.id));
      const openSignals = queueSignals.filter((item) => item.count > 0);
      const openWorkItemCount = openSignals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = openSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...starter,
          workspace,
          reports,
          playbooks,
          queueSignals,
          openSignals,
          openWorkItemCount,
          amountAtRisk,
          readyCount,
          href: reportAutomationStarterHref(starter),
        },
      ];
    });
  }, [automationQueue, workspaceSummaries]);
  const visibleReportAutomationStarters = useMemo(() => {
    return reportAutomationStarterSummaries.filter(
      (starter) =>
        matchesReportPersona([starter.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          starter.title,
          starter.audience,
          starter.outcome,
          starter.setupTime,
          starter.trigger,
          starter.primaryAction,
          starter.commandKeywords,
          starter.reports.map((report) => report.name).join(" "),
          starter.playbooks.map((playbook) => playbook.title).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportAutomationStarterSummaries]);
  const reportAutomationTriggerRuleSummaries = useMemo(() => {
    return reportAutomationTriggerRules.flatMap((rule) => {
      const workspace = workspaceSummaries.find((item) => item.persona === rule.persona);
      if (!workspace) return [];

      const reports = rule.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const primaryReport = reports[0] ?? null;
      const automationStarter =
        reportAutomationStarterSummaries.find(
          (starter) => starter.id === rule.automationStarterId
        ) ?? null;
      const decisionShortcut =
        reportDecisionShortcutSummaries.find(
          (shortcut) => shortcut.id === rule.decisionShortcutId
        ) ?? null;
      const queueSignals =
        automationStarter?.queueSignals.filter((signal) =>
          matchesReportPersona(signal.personas, rule.persona)
        ) ?? [];
      const openSignals = queueSignals.filter((signal) => signal.count > 0);
      const openWorkItemCount = queueSignals.reduce((sum, signal) => sum + signal.count, 0);
      const amountAtRisk = queueSignals.reduce((sum, signal) => sum + (signal.amount ?? 0), 0);

      return [
        {
          ...rule,
          workspace,
          reports,
          primaryReport,
          automationStarter,
          decisionShortcut,
          queueSignals,
          openSignals,
          openWorkItemCount,
          amountAtRisk,
          href: reportAutomationTriggerRuleHref(rule),
          primaryReportHref: primaryReport
            ? (reportPersonaHref(primaryReport, rule.persona) ??
              reportAutomationTriggerRuleHref(rule))
            : reportAutomationTriggerRuleHref(rule),
          automationStarterHref: automationStarter?.href ?? reportAutomationTriggerRuleHref(rule),
          decisionShortcutHref: decisionShortcut?.href ?? reportAutomationTriggerRuleHref(rule),
        },
      ];
    });
  }, [reportAutomationStarterSummaries, reportDecisionShortcutSummaries, workspaceSummaries]);
  const visibleReportAutomationTriggerRules = useMemo(() => {
    return reportAutomationTriggerRuleSummaries.filter(
      (rule) =>
        matchesReportPersona([rule.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          rule.title,
          rule.condition,
          rule.threshold,
          rule.cadence,
          rule.actionLabel,
          rule.commandKeywords,
          rule.reports.map((report) => report.name).join(" "),
          rule.decisionShortcut?.question,
          rule.automationStarter?.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportAutomationTriggerRuleSummaries]);

  return {
    automationQueue,
    visibleAutomationQueue,
    automationQueueCount,
    reportAutomationStarterSummaries,
    visibleReportAutomationStarters,
    reportAutomationTriggerRuleSummaries,
    visibleReportAutomationTriggerRules,
  };
}

export type ReportsAutomationQueueState = ReturnType<typeof useReportsAutomationQueue>;
