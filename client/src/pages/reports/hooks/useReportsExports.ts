// Excel / Google Sheets export handlers and workspace panel layout helpers.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import { ReportWorkspaceTab, reportsWorkspaceHref } from "../shared";
import { translateNow, formatMessage, useI18n } from "@/lib/i18n";
import { formatDateRange } from "@/lib/format-date";
import {
  exportToExcel,
  exportToGoogleSheets,
  prepareAuditTrailForExport,
  prepareBalanceSheetForExport,
  prepareBalanceSummaryReportsForExport,
  prepareConsolidatedStatementsForExport,
  prepareCorporateTaxEstimateForExport,
  prepareExpenseReportsForExport,
  prepareInvoiceStatusForExport,
  prepareLedgerReportsForExport,
  prepareMonthEndCloseStatusForExport,
  preparePayrollReportsForExport,
  preparePlanningReportsForExport,
  prepareProfitLossForExport,
  prepareTrialBalanceForExport,
  prepareVATSummaryForExport,
} from "@/lib/export";
import { format } from "date-fns";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsComparisonsAndCloseState } from "./useReportsComparisonsAndClose";
import type { ReportsDerivedReportsState } from "./useReportsDerivedReports";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsWorkspacePackState } from "./useReportsWorkspacePack";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";

type UseReportsExportsDeps = Pick<
  ReportsWorkspaceStateState &
    ReportsComparisonsAndCloseState &
    ReportsDerivedReportsState &
    ReportsDataQueriesState &
    ReportsWorkspacePackState &
    ReportsWorkspaceSummariesState,
  | "activeReportViewerOption"
  | "activeReportWorkspaceTab"
  | "activeTab"
  | "auditTrailReport"
  | "balanceReport"
  | "balanceSheet"
  | "buildWorkspaceReportPack"
  | "consolidatedStatementsReport"
  | "corporateTaxEstimate"
  | "dateRange"
  | "effectiveReportPersona"
  | "expenseReport"
  | "exportDateRangeSuffix"
  | "invoiceStatusReport"
  | "ledgerReport"
  | "monthEndCloseExportReport"
  | "monthEndPeriod"
  | "monthEndPeriodLabel"
  | "payableAgingExportSheets"
  | "payrollReport"
  | "planningReport"
  | "profitLoss"
  | "receivableAgingExportSheets"
  | "selectedCompanyId"
  | "selectedReportId"
  | "setIsExporting"
  | "toast"
  | "trialBalance"
  | "vatSummary"
>;

export function useReportsExports({
  activeReportViewerOption,
  activeReportWorkspaceTab,
  activeTab,
  auditTrailReport,
  balanceReport,
  balanceSheet,
  buildWorkspaceReportPack,
  consolidatedStatementsReport,
  corporateTaxEstimate,
  dateRange,
  effectiveReportPersona,
  expenseReport,
  exportDateRangeSuffix,
  invoiceStatusReport,
  ledgerReport,
  monthEndCloseExportReport,
  monthEndPeriod,
  monthEndPeriodLabel,
  payableAgingExportSheets,
  payrollReport,
  planningReport,
  profitLoss,
  receivableAgingExportSheets,
  selectedCompanyId,
  selectedReportId,
  setIsExporting,
  toast,
  trialBalance,
  vatSummary,
}: UseReportsExportsDeps) {
  const handleExportWorkspacePack = async (
    workspace: ReportsWorkspaceSummariesState["workspaceSummaries"][number]
  ) => {
    setIsExporting(true);
    try {
      await exportToExcel(
        buildWorkspaceReportPack(workspace),
        `${workspace.persona}_report_pack${exportDateRangeSuffix}`
      );
      toast({
        title: translateNow("toasts.reportPackExported"),
        description: formatMessage(translateNow("toasts.exportedToExcel"), {
          title: workspace.title,
        }),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: error?.message || translateNow("toasts.failedToExportReportPack"),
      });
    } finally {
      setIsExporting(false);
    }
  };
  const handleExportWorkspacePackToSheets = async (
    workspace: ReportsWorkspaceSummariesState["workspaceSummaries"][number]
  ) => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeTitle =
      dateRange.from && dateRange.to
        ? ` (${formatDateRange(dateRange.from, dateRange.to, useI18n.getState().locale, { plain: true })})`
        : "";

    const result = await exportToGoogleSheets(
      buildWorkspaceReportPack(workspace),
      `${workspace.title}${dateRangeTitle}`,
      selectedCompanyId
    );

    setIsExporting(false);

    if (result?.success) {
      toast({
        title: translateNow("toasts.reportPackExported"),
        description: formatMessage(translateNow("toasts.exportedToGoogleSheetsOpening"), {
          title: workspace.title,
        }),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: result?.error || translateNow("toasts.failedToExportReportPackToGoogle"),
      });
    }
  };
  const handleExportExcel = () => {
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    if (activeTab === "pl" && profitLoss) {
      exportToExcel([prepareProfitLossForExport(profitLoss)], `profit_loss${dateRangeStr}`);
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("toasts.profitLossExportedToExcel"),
      });
    } else if (activeTab === "bs" && balanceSheet) {
      exportToExcel([prepareBalanceSheetForExport(balanceSheet)], `balance_sheet${dateRangeStr}`);
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedBalanceSheet"),
      });
    } else if (activeTab === "vat" && vatSummary) {
      exportToExcel([prepareVATSummaryForExport(vatSummary)], `vat_summary${dateRangeStr}`);
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("toasts.vatSummaryExportedToExcel"),
      });
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      exportToExcel(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `corporate_tax_estimate${dateRangeStr}`
      );
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("toasts.corporateTaxEstimateExportedToExcel"),
      });
    } else if (activeTab === "trial" && trialBalance) {
      exportToExcel([prepareTrialBalanceForExport(trialBalance)], `trial_balance${dateRangeStr}`);
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedTrialBalance"),
      });
    } else if (activeTab === "sales") {
      if (selectedReportId === "ar-aging") {
        exportToExcel(receivableAgingExportSheets, `ar_aging${dateRangeStr}`);
        toast({
          title: translateNow("toasts.exportSuccessful"),
          description: translateNow("toasts.aRAgingExportedToExcel"),
        });
      } else {
        exportToExcel(
          prepareInvoiceStatusForExport(invoiceStatusReport),
          `invoice_status${dateRangeStr}`
        );
        toast({
          title: translateNow("toasts.exportSuccessful"),
          description: translateNow("reportCenter.exportedInvoiceStatus"),
        });
      }
    } else if (activeTab === "balances") {
      if (selectedReportId === "ap-aging") {
        exportToExcel(payableAgingExportSheets, `ap_aging${dateRangeStr}`);
        toast({
          title: translateNow("toasts.exportSuccessful"),
          description: translateNow("toasts.aPAgingExportedToExcel"),
        });
      } else {
        exportToExcel(
          prepareBalanceSummaryReportsForExport(balanceReport),
          `balance_reports${dateRangeStr}`
        );
        toast({
          title: translateNow("toasts.exportSuccessful"),
          description: translateNow("reportCenter.exportedBalanceReports"),
        });
      }
    } else if (activeTab === "expenses") {
      exportToExcel(
        prepareExpenseReportsForExport(expenseReport),
        `expense_reports${dateRangeStr}`
      );
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedExpenseReports"),
      });
    } else if (activeTab === "payroll") {
      exportToExcel(
        preparePayrollReportsForExport(payrollReport),
        `payroll_reports${dateRangeStr}`
      );
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedPayrollReports"),
      });
    } else if (activeTab === "ledger") {
      exportToExcel(prepareLedgerReportsForExport(ledgerReport), `general_ledger${dateRangeStr}`);
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedGeneralLedger"),
      });
    } else if (activeTab === "close") {
      exportToExcel(
        [
          ...prepareMonthEndCloseStatusForExport(monthEndCloseExportReport),
          ...prepareAuditTrailForExport(auditTrailReport),
          ...prepareConsolidatedStatementsForExport(consolidatedStatementsReport),
        ],
        `close_reports_${monthEndPeriod}${dateRangeStr}`
      );
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("toasts.closeReportsExportedToExcel"),
      });
    } else if (activeTab === "planning") {
      exportToExcel(
        preparePlanningReportsForExport(planningReport),
        `planning_reports${dateRangeStr}`
      );
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("reportCenter.exportedPlanningReports"),
      });
    }
  };
  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? ` (${formatDateRange(dateRange.from, dateRange.to, useI18n.getState().locale, { plain: true })})`
        : "";

    let result;
    if (activeTab === "pl" && profitLoss) {
      result = await exportToGoogleSheets(
        [prepareProfitLossForExport(profitLoss)],
        `Profit & Loss${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "bs" && balanceSheet) {
      result = await exportToGoogleSheets(
        [prepareBalanceSheetForExport(balanceSheet)],
        `Balance Sheet${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "vat" && vatSummary) {
      result = await exportToGoogleSheets(
        [prepareVATSummaryForExport(vatSummary)],
        `VAT Summary${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      result = await exportToGoogleSheets(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `Corporate Tax Estimate${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "trial" && trialBalance) {
      result = await exportToGoogleSheets(
        [prepareTrialBalanceForExport(trialBalance)],
        `Trial Balance${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "sales") {
      result = await exportToGoogleSheets(
        selectedReportId === "ar-aging"
          ? receivableAgingExportSheets
          : prepareInvoiceStatusForExport(invoiceStatusReport),
        // i18n-ignore: export file name, not UI copy
        `${selectedReportId === "ar-aging" ? "A/R Aging" : "Invoice Status"}${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "balances") {
      result = await exportToGoogleSheets(
        selectedReportId === "ap-aging"
          ? payableAgingExportSheets
          : prepareBalanceSummaryReportsForExport(balanceReport),
        // i18n-ignore: export file name, not UI copy
        `${selectedReportId === "ap-aging" ? "A/P Aging" : "Balance Reports"}${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "expenses") {
      result = await exportToGoogleSheets(
        prepareExpenseReportsForExport(expenseReport),
        `Expense Reports${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "payroll") {
      result = await exportToGoogleSheets(
        preparePayrollReportsForExport(payrollReport),
        `Payroll Reports${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "ledger") {
      result = await exportToGoogleSheets(
        prepareLedgerReportsForExport(ledgerReport),
        `General Ledger${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "close") {
      result = await exportToGoogleSheets(
        [
          ...prepareMonthEndCloseStatusForExport(monthEndCloseExportReport),
          ...prepareAuditTrailForExport(auditTrailReport),
          ...prepareConsolidatedStatementsForExport(consolidatedStatementsReport),
        ],
        `Close Reports (${monthEndPeriodLabel})`,
        selectedCompanyId
      );
    } else if (activeTab === "planning") {
      result = await exportToGoogleSheets(
        preparePlanningReportsForExport(planningReport),
        `Planning Reports${dateRangeStr}`,
        selectedCompanyId
      );
    }

    setIsExporting(false);

    if (result?.success) {
      toast({
        title: translateNow("toasts.exportSuccessful"),
        description: translateNow("toasts.reportExportedToGoogleSheetsOpening"),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: result?.error || translateNow("toasts.failedToExportToGoogleSheets"),
      });
    }
  };
  const reportWorkspacePanelClass = (tab: ReportWorkspaceTab, className: string) =>
    activeReportWorkspaceTab === tab ? className : `${className} hidden`;
  const backToReportsHref = reportsWorkspaceHref({
    persona: activeReportViewerOption?.persona ?? effectiveReportPersona,
    workspace: "reports",
  });

  return {
    handleExportWorkspacePack,
    handleExportWorkspacePackToSheets,
    handleExportExcel,
    handleExportGoogleSheets,
    reportWorkspacePanelClass,
    backToReportsHref,
  };
}

export type ReportsExportsState = ReturnType<typeof useReportsExports>;
