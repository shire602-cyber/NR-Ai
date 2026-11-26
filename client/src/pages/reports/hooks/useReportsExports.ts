// Excel / Google Sheets export handlers and workspace panel layout helpers.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import { ReportWorkspaceTab, reportsWorkspaceHref } from "../shared";
import { unreadableReportIds } from "@/lib/reportReadState";
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
  type ExportData,
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
  | "activeCoreReportId"
  | "activeReportViewerOption"
  | "activeReportWorkspaceTab"
  | "activeTab"
  | "auditTrailReport"
  | "balanceReport"
  | "balanceSheet"
  | "buildWorkspaceReportPack"
  | "consolidatedStatementsReport"
  | "coreReportReadStates"
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
  activeCoreReportId,
  activeReportViewerOption,
  activeReportWorkspaceTab,
  activeTab,
  auditTrailReport,
  balanceReport,
  balanceSheet,
  buildWorkspaceReportPack,
  consolidatedStatementsReport,
  coreReportReadStates,
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
        `${workspace.persona}_report_pack${exportDateRangeSuffix}`,
        { reportPack: true }
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
      selectedCompanyId,
      true
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
  const handleExportExcel = async () => {
    // F03: refuse exports when the active report's data could not be loaded (never export AED 0.00).
    const unreadable = unreadableReportIds(
      activeCoreReportId ? [activeCoreReportId] : [],
      coreReportReadStates
    );
    if (
      unreadable.length > 0 ||
      (activeCoreReportId && coreReportReadStates[activeCoreReportId] === "error")
    ) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: translateNow("reportCenter.dataLoadError"),
      });
      return;
    }
    setIsExporting(true);
    try {
      const dateRangeStr =
        dateRange.from && dateRange.to
          ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
          : "";

      const download = async (sheets: ExportData[], filename: string, descriptionKey: string) => {
        await exportToExcel(sheets, `${filename}${dateRangeStr}`);
        toast({
          title: translateNow("toasts.exportSuccessful"),
          description: translateNow(descriptionKey),
        });
      };

      if (activeTab === "pl" && profitLoss) {
        await download(
          [prepareProfitLossForExport(profitLoss)],
          "profit_loss",
          "toasts.profitLossExportedToExcel"
        );
      } else if (activeTab === "bs" && balanceSheet) {
        await download(
          [prepareBalanceSheetForExport(balanceSheet)],
          "balance_sheet",
          "reportCenter.exportedBalanceSheet"
        );
      } else if (activeTab === "vat" && vatSummary) {
        await download(
          [prepareVATSummaryForExport(vatSummary)],
          "vat_summary",
          "toasts.vatSummaryExportedToExcel"
        );
      } else if (activeTab === "tax" && corporateTaxEstimate) {
        await download(
          prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
          "corporate_tax_estimate",
          "toasts.corporateTaxEstimateExportedToExcel"
        );
      } else if (activeTab === "trial" && trialBalance) {
        await download(
          [prepareTrialBalanceForExport(trialBalance)],
          "trial_balance",
          "reportCenter.exportedTrialBalance"
        );
      } else if (activeTab === "sales") {
        if (selectedReportId === "ar-aging") {
          await download(receivableAgingExportSheets, "ar_aging", "toasts.aRAgingExportedToExcel");
        } else {
          await download(
            prepareInvoiceStatusForExport(invoiceStatusReport),
            "invoice_status",
            "reportCenter.exportedInvoiceStatus"
          );
        }
      } else if (activeTab === "balances") {
        if (selectedReportId === "ap-aging") {
          await download(payableAgingExportSheets, "ap_aging", "toasts.aPAgingExportedToExcel");
        } else {
          await download(
            prepareBalanceSummaryReportsForExport(balanceReport),
            "balance_reports",
            "reportCenter.exportedBalanceReports"
          );
        }
      } else if (activeTab === "expenses") {
        await download(
          prepareExpenseReportsForExport(expenseReport),
          "expense_reports",
          "reportCenter.exportedExpenseReports"
        );
      } else if (activeTab === "payroll") {
        await download(
          preparePayrollReportsForExport(payrollReport),
          "payroll_reports",
          "reportCenter.exportedPayrollReports"
        );
      } else if (activeTab === "ledger") {
        await download(
          prepareLedgerReportsForExport(ledgerReport),
          "general_ledger",
          "reportCenter.exportedGeneralLedger"
        );
      } else if (activeTab === "close") {
        await download(
          [
            ...prepareMonthEndCloseStatusForExport(monthEndCloseExportReport),
            ...prepareAuditTrailForExport(auditTrailReport),
            ...prepareConsolidatedStatementsForExport(consolidatedStatementsReport),
          ],
          `close_reports_${monthEndPeriod}`,
          "toasts.closeReportsExportedToExcel"
        );
      } else if (activeTab === "planning") {
        await download(
          preparePlanningReportsForExport(planningReport),
          "planning_reports",
          "reportCenter.exportedPlanningReports"
        );
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsExporting(false);
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
