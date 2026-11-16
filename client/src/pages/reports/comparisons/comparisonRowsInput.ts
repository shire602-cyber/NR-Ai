// Inputs of the period-comparison metric builder: the hook values the memo depends on.
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged.
import type {
  ActivityLogReportRow,
  BankTransactionReportRow,
  CashFlowProjection,
  CashFlowStatementRow,
  ComparisonRange,
  ExpenseClaimReportRow,
  FixedAssetValuationRow,
  InventoryMovementReportRow,
  InvoiceReportRow,
  JournalEntryReportRow,
  MonthEndChecklistItem,
  PayrollRunReportRow,
  ReceiptReportRow,
  VarianceLine,
  VendorBillReportRow,
} from "../shared";

/**
 * One field per comparisonRows memo dependency. Member paths keep their shape, so the
 * builder reads exactly the values the memo tracks.
 */
export interface ComparisonRowsInput {
  /** comparisonCurrentProfitLoss?.netProfit, comparisonCurrentProfitLoss?.totalExpenses, comparisonCurrentProfitLoss?.totalRevenue */
  comparisonCurrentProfitLoss: {
    netProfit: number | undefined;
    totalExpenses: number | undefined;
    totalRevenue: number | undefined;
  };
  /** comparisonCurrentBalanceSheet?.totalAssets, comparisonCurrentBalanceSheet?.totalEquity, comparisonCurrentBalanceSheet?.totalLiabilities */
  comparisonCurrentBalanceSheet: {
    totalAssets: number | undefined;
    totalEquity: number | undefined;
    totalLiabilities: number | undefined;
  };
  /** comparisonCurrentCostCenterProfitability?.totals?.netIncome, comparisonCurrentCostCenterProfitability?.totals?.totalExpenses */
  comparisonCurrentCostCenterProfitability: {
    totals: {
      netIncome: number | undefined;
      totalExpenses: number | undefined;
    };
  };
  /** comparisonCurrentRange */
  comparisonCurrentRange: ComparisonRange;
  /** comparisonCurrentSalesProductService?.totals?.topProductServiceShare */
  comparisonCurrentSalesProductService: {
    totals: {
      topProductServiceShare: number | undefined;
    };
  };
  /** comparisonCurrentVat?.netVATPayable */
  comparisonCurrentVat: {
    netVATPayable: number | undefined;
  };
  /** comparisonPreviousCostCenterProfitability?.totals?.netIncome, comparisonPreviousCostCenterProfitability?.totals?.totalExpenses */
  comparisonPreviousCostCenterProfitability: {
    totals: {
      netIncome: number | undefined;
      totalExpenses: number | undefined;
    };
  };
  /** comparisonPreviousCorporateTaxEstimate?.taxPayable */
  comparisonPreviousCorporateTaxEstimate: {
    taxPayable: number | undefined;
  };
  /** comparisonPreviousProfitLoss?.netProfit, comparisonPreviousProfitLoss?.totalExpenses, comparisonPreviousProfitLoss?.totalRevenue */
  comparisonPreviousProfitLoss: {
    netProfit: number | undefined;
    totalExpenses: number | undefined;
    totalRevenue: number | undefined;
  };
  /** comparisonPreviousBalanceSheet?.totalAssets, comparisonPreviousBalanceSheet?.totalEquity, comparisonPreviousBalanceSheet?.totalLiabilities */
  comparisonPreviousBalanceSheet: {
    totalAssets: number | undefined;
    totalEquity: number | undefined;
    totalLiabilities: number | undefined;
  };
  /** comparisonPreviousRange */
  comparisonPreviousRange: ComparisonRange;
  /** comparisonPreviousSalesProductService?.totals?.topProductServiceShare */
  comparisonPreviousSalesProductService: {
    totals: {
      topProductServiceShare: number | undefined;
    };
  };
  /** comparisonPreviousVat?.netVATPayable */
  comparisonPreviousVat: {
    netVATPayable: number | undefined;
  };
  /** consolidatedStatementsReport.currentComparisonExpenses, consolidatedStatementsReport.currentComparisonNetProfit, consolidatedStatementsReport.currentComparisonRevenue, consolidatedStatementsReport.previousExpenses, consolidatedStatementsReport.previousNetProfit, consolidatedStatementsReport.previousRevenue, consolidatedStatementsReport.reviewCount */
  consolidatedStatementsReport: {
    currentComparisonExpenses: number;
    currentComparisonNetProfit: number;
    currentComparisonRevenue: number;
    previousExpenses: number;
    previousNetProfit: number;
    previousRevenue: number;
    reviewCount: number;
  };
  /** serverGroupConsolidation */
  serverGroupConsolidation: {
    groupId: string;
    groupName: string;
    currency: string;
    currentRevenue: number;
    previousRevenue: number;
    currentExpenses: number;
    previousExpenses: number;
    currentNetProfit: number;
    previousNetProfit: number;
    warningCount: number;
  } | null;
  /** activityLogs */
  activityLogs: ActivityLogReportRow[];
  /** bankTransactions */
  bankTransactions: BankTransactionReportRow[];
  /** cashFlowForecast?.currentBalance, cashFlowForecast?.projections */
  cashFlowForecast: {
    currentBalance: number | undefined;
    projections: CashFlowProjection[] | undefined;
  };
  /** cashFlowStatement */
  cashFlowStatement: CashFlowStatementRow[];
  /** corporateTaxEstimate?.taxPayable */
  corporateTaxEstimate: {
    taxPayable: number | undefined;
  };
  /** depreciationScheduleReport.readyToPostCount, depreciationScheduleReport.reviewCount, depreciationScheduleReport.reviewValueAed */
  depreciationScheduleReport: {
    readyToPostCount: number;
    reviewCount: number;
    reviewValueAed: number;
  };
  /** expenseClaims */
  expenseClaims: ExpenseClaimReportRow[];
  /** fixedAssetRegisterReport.activeRows, fixedAssetRegisterReport.reviewCount, fixedAssetRegisterReport.reviewValueAed */
  fixedAssetRegisterReport: {
    activeRows: FixedAssetValuationRow[];
    reviewCount: number;
    reviewValueAed: number;
  };
  /** fxGainsLosses?.totalUnrealizedGain, fxGainsLosses?.totalUnrealizedLoss */
  fxGainsLosses: {
    totalUnrealizedGain: number | undefined;
    totalUnrealizedLoss: number | undefined;
  };
  /** invoices */
  invoices: InvoiceReportRow[];
  /** inventoryMovements */
  inventoryMovements: InventoryMovementReportRow[];
  /** inventoryValuationReport.activeProductCount, inventoryValuationReport.reviewCount, inventoryValuationReport.reviewValueAed */
  inventoryValuationReport: {
    activeProductCount: number;
    reviewCount: number;
    reviewValueAed: number;
  };
  /** journalEntries */
  journalEntries: JournalEntryReportRow[];
  /** monthEndCloseStatus?.checklist */
  monthEndCloseStatus: {
    checklist: MonthEndChecklistItem[] | undefined;
  };
  /** payrollRuns */
  payrollRuns: PayrollRunReportRow[];
  /** receipts */
  receipts: ReceiptReportRow[];
  /** varianceReport?.varianceLines */
  varianceReport: {
    varianceLines: VarianceLine[] | undefined;
  };
  /** vendorBills */
  vendorBills: VendorBillReportRow[];
}
