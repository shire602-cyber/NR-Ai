// Report periods and every report data query (statements, tax, comparisons, consolidation, documents, payroll, assets, inventory).
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import {
  ActivityLogReportRow,
  AdvancedPeriodComparisonRow,
  AgingReportItem,
  BalanceSheetReport,
  BalanceSummaryReport,
  BankTransactionReportRow,
  BillAgingReport,
  BudgetPlanReportRow,
  CashFlowForecastReport,
  CashFlowStatementRow,
  ConsolidatedCompanyStatementSource,
  CorporateTaxEstimateReport,
  CostCenterProfitabilityReport,
  ExpenseClaimReportRow,
  ExpenseClaimSummaryReport,
  FixedAssetReportRow,
  FixedAssetSummaryReport,
  FxGainsLossesReport,
  InventoryMovementReportRow,
  InventoryProductReportRow,
  InvoiceReportRow,
  JournalEntryReportRow,
  MonthEndCloseStatusReport,
  OverdueResponse,
  PayrollRunReportRow,
  ProfitLossReport,
  ReceiptReportRow,
  SalesProductServiceReport,
  TrialBalanceReport,
  VATReturnReportRow,
  VATSummaryReport,
  VarianceReport,
  VendorBillReportRow,
  BALANCE_STRIP_REPORT_IDS,
  buildComparisonRanges,
  comparisonParams,
  corporateTaxEstimateStatus,
  reportDateRange,
  reportMonthYear,
  reportText,
  startOfReportMonth,
} from "../shared";
import type { Company } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  serverConsolidationCurrency,
  useFirstCompanyGroup,
  useServerConsolidatedStatements,
} from "../groupConsolidationQueries";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";

type UseReportsDataQueriesDeps = Pick<
  ReportsWorkspaceStateState,
  | "accessibleCompanies"
  | "activeReportWorkspaceTab"
  | "dateRange"
  | "hasFocusedReportSelection"
  | "selectedCompanyId"
  | "selectedReportId"
>;

export function useReportsDataQueries({
  accessibleCompanies,
  activeReportWorkspaceTab,
  dateRange,
  hasFocusedReportSelection,
  selectedCompanyId,
  selectedReportId,
}: UseReportsDataQueriesDeps) {
  const dateParams =
    dateRange.from && dateRange.to
      ? `?startDate=${format(dateRange.from, "yyyy-MM-dd")}&endDate=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const salesProductServiceParams = dateParams;
  const trialBalanceParams =
    dateRange.from && dateRange.to
      ? `?from=${format(dateRange.from, "yyyy-MM-dd")}&to=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const comparisonRanges = useMemo(() => buildComparisonRanges(dateRange), [dateRange]);
  const comparisonCurrentParams = comparisonParams(comparisonRanges.current);
  const comparisonPreviousParams = comparisonParams(comparisonRanges.previous);
  const comparisonCurrentLabel = reportDateRange(
    comparisonRanges.current.from,
    comparisonRanges.current.to
  );
  const comparisonPreviousLabel = reportDateRange(
    comparisonRanges.previous.from,
    comparisonRanges.previous.to
  );
  const comparisonCurrentRange = comparisonRanges.current;
  const comparisonPreviousRange = comparisonRanges.previous;
  const corporateTaxPeriodStart = format(comparisonCurrentRange.from, "yyyy-MM-dd");
  const corporateTaxPeriodEnd = format(comparisonCurrentRange.to, "yyyy-MM-dd");
  const corporateTaxParams = `?periodStart=${corporateTaxPeriodStart}&periodEnd=${corporateTaxPeriodEnd}`;
  const corporateTaxPreviousPeriodStart = format(comparisonPreviousRange.from, "yyyy-MM-dd");
  const corporateTaxPreviousPeriodEnd = format(comparisonPreviousRange.to, "yyyy-MM-dd");
  const corporateTaxPreviousParams = `?periodStart=${corporateTaxPreviousPeriodStart}&periodEnd=${corporateTaxPreviousPeriodEnd}`;
  const corporateTaxPeriodLabel = reportDateRange(
    comparisonCurrentRange.from,
    comparisonCurrentRange.to
  );
  const monthEndPeriodAnchor = useMemo(() => dateRange.to ?? new Date(), [dateRange.to]);
  const monthEndPeriod = format(monthEndPeriodAnchor, "yyyy-MM");
  const monthEndPeriodLabel = reportMonthYear(monthEndPeriodAnchor);
  const depreciationPeriodDate = useMemo(
    () => startOfReportMonth(monthEndPeriodAnchor),
    [monthEndPeriodAnchor]
  );
  const accessibleReportCompanies = useMemo(() => {
    const seen = new Set<string>();
    return accessibleCompanies.filter((company): company is Company => {
      if (!company?.id || seen.has(company.id)) return false;
      seen.add(company.id);
      return true;
    });
  }, [accessibleCompanies]);
  const selectedCompany = useMemo(
    () => accessibleReportCompanies.find((company) => company.id === selectedCompanyId) ?? null,
    [accessibleReportCompanies, selectedCompanyId]
  );
  const consolidatedCompanyIds = useMemo(
    () => accessibleReportCompanies.map((company) => company.id).sort(),
    [accessibleReportCompanies]
  );
  const advancedReportPeriod = "quarter";
  const reportQueryOptions = {
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  } as const;
  const shouldLoadReportData = (...reportIds: string[]) =>
    Boolean(selectedCompanyId) &&
    (activeReportWorkspaceTab !== "reports" ||
      (hasFocusedReportSelection &&
        selectedReportId !== null &&
        reportIds.includes(selectedReportId)));
  const shouldLoadWorkflowData =
    Boolean(selectedCompanyId) && activeReportWorkspaceTab !== "reports";
  const shouldLoadReportDeliveryData =
    Boolean(selectedCompanyId) &&
    ["home", "automation", "delivery", "suites"].includes(activeReportWorkspaceTab);
  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("profit-loss"),
  });
  const { data: costCenterProfitability, isLoading: costCenterProfitabilityLoading } =
    useQuery<CostCenterProfitabilityReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cost-centers", "profitability", dateParams],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/cost-centers/profitability${dateParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("cost-center-profitability"),
    });
  const { data: balanceSheet, isLoading: bsLoading } = useQuery<BalanceSheetReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-sheet", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("balance-sheet"),
  });
  const { data: vatSummary, isLoading: vatLoading } = useQuery<VATSummaryReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vat-summary", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("vat-summary"),
  });
  const { data: cashFlowStatement = [], isLoading: cashFlowStatementLoading } = useQuery<
    CashFlowStatementRow[]
  >({
    queryKey: ["/api/reports", selectedCompanyId, "cash-flow", advancedReportPeriod],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: agingReport = [], isLoading: agingReportLoading } = useQuery<AgingReportItem[]>({
    queryKey: ["/api/reports", selectedCompanyId, "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging"),
  });
  const { data: billAgingReport, isLoading: billAgingLoading } = useQuery<BillAgingReport>({
    queryKey: ["/api/companies", selectedCompanyId, "bills", "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ap-aging"),
  });
  const { data: vendorBills = [], isLoading: vendorBillsLoading } = useQuery<VendorBillReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "bills"],
      ...reportQueryOptions,
      enabled: shouldLoadReportData(
        "ap-aging",
        "vendor-balances",
        "expenses-vendor",
        "expenses-category"
      ),
    }
  );
  const { data: advancedPeriodComparison = [], isLoading: advancedPeriodComparisonLoading } =
    useQuery<AdvancedPeriodComparisonRow[]>({
      queryKey: ["/api/reports", selectedCompanyId, "comparison", advancedReportPeriod],
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: fxGainsLosses, isLoading: fxGainsLossesLoading } = useQuery<FxGainsLossesReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "fx-gains-losses"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: vatReturns = [], isLoading: vatReturnsLoading } = useQuery<VATReturnReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "vat-returns"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: corporateTaxEstimate, isLoading: corporateTaxLoading } =
    useQuery<CorporateTaxEstimateReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "corporate-tax",
        "calculate",
        corporateTaxPeriodStart,
        corporateTaxPeriodEnd,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/corporate-tax/calculate${corporateTaxParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("corporate-tax-estimate"),
    });
  const corporateTaxStatus = useMemo(
    () => corporateTaxEstimateStatus(corporateTaxEstimate),
    [corporateTaxEstimate]
  );
  const {
    data: comparisonPreviousCorporateTaxEstimate,
    isLoading: comparisonPreviousCorporateTaxLoading,
  } = useQuery<CorporateTaxEstimateReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "corporate-tax",
      "comparison",
      "previous",
      corporateTaxPreviousPeriodStart,
      corporateTaxPreviousPeriodEnd,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/corporate-tax/calculate${corporateTaxPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const corporateTaxBridgeRows = useMemo(
    () => [
      {
        metric: reportText("ctRevenue", "Revenue"),
        amount: corporateTaxEstimate?.totalRevenue ?? 0,
        note: reportText("ctRevenueNote", "Posted income accounts in the selected period."),
      },
      {
        metric: reportText("ctExpenses", "Less: expenses"),
        amount: -(corporateTaxEstimate?.totalExpenses ?? 0),
        note: reportText("ctExpensesNote", "Posted expense accounts in the selected period."),
      },
      {
        metric: reportText("ctGross", "Gross profit"),
        amount: corporateTaxEstimate?.grossProfit ?? 0,
        note: reportText("ctGrossNote", "Revenue less expenses before tax-specific deductions."),
      },
      {
        metric: reportText("ctDeductions", "Less: deductions"),
        amount: -(corporateTaxEstimate?.totalDeductions ?? 0),
        note: reportText("ctDeductionsNote", "Adjustable in the Corporate Tax workspace."),
      },
      {
        metric: reportText("ctTaxable", "Taxable income"),
        amount: corporateTaxEstimate?.taxableIncome ?? 0,
        note: reportText("ctTaxableNote", "Income before applying the zero-rate band."),
      },
      {
        metric: reportText("ctBand", "Less: zero-rate band"),
        amount: -(corporateTaxEstimate?.exemptionThreshold ?? 0),
        note: reportText(
          "ctBandNote",
          "Threshold returned by the Corporate Tax calculation endpoint."
        ),
      },
      {
        metric: reportText("ctAbove", "Income above zero-rate band"),
        amount: corporateTaxEstimate?.taxableAmount ?? 0,
        note: reportText(
          "ctAboveNote",
          "Positive income above the zero-rate band before applying the returned rate."
        ),
      },
      {
        metric: reportText("ctPayable", "Corporate tax payable"),
        amount: corporateTaxEstimate?.taxPayable ?? 0,
        note: corporateTaxStatus.detail,
      },
    ],
    [corporateTaxEstimate, corporateTaxStatus.detail]
  );
  const { data: comparisonCurrentProfitLoss, isLoading: comparisonCurrentPlLoading } =
    useQuery<ProfitLossReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "pl",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/pl${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: comparisonPreviousProfitLoss, isLoading: comparisonPreviousPlLoading } =
    useQuery<ProfitLossReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "pl",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/pl${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: comparisonCurrentBalanceSheet, isLoading: comparisonCurrentBalanceSheetLoading } =
    useQuery<BalanceSheetReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "balance-sheet",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/balance-sheet${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: comparisonPreviousBalanceSheet, isLoading: comparisonPreviousBalanceSheetLoading } =
    useQuery<BalanceSheetReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "balance-sheet",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/balance-sheet${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const {
    data: comparisonCurrentSalesProductService,
    isLoading: comparisonCurrentSalesProductServiceLoading,
  } = useQuery<SalesProductServiceReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "reports",
      "comparison",
      "sales-product-service",
      comparisonCurrentParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/sales-product-service${comparisonCurrentParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const {
    data: comparisonPreviousSalesProductService,
    isLoading: comparisonPreviousSalesProductServiceLoading,
  } = useQuery<SalesProductServiceReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "reports",
      "comparison",
      "sales-product-service",
      comparisonPreviousParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/sales-product-service${comparisonPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const {
    data: comparisonCurrentCostCenterProfitability,
    isLoading: comparisonCurrentCostCenterLoading,
  } = useQuery<CostCenterProfitabilityReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "cost-centers",
      "comparison",
      "profitability",
      comparisonCurrentParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/cost-centers/profitability${comparisonCurrentParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const {
    data: comparisonPreviousCostCenterProfitability,
    isLoading: comparisonPreviousCostCenterLoading,
  } = useQuery<CostCenterProfitabilityReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "cost-centers",
      "comparison",
      "profitability",
      comparisonPreviousParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/cost-centers/profitability${comparisonPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: comparisonCurrentVat, isLoading: comparisonCurrentVatLoading } =
    useQuery<VATSummaryReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "vat-summary",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/vat-summary${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: comparisonPreviousVat, isLoading: comparisonPreviousVatLoading } =
    useQuery<VATSummaryReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "vat-summary",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/vat-summary${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: consolidatedStatementSources = [], isLoading: consolidatedStatementsLoading } =
    useQuery<ConsolidatedCompanyStatementSource[]>({
      queryKey: [
        "/api/companies",
        "reports",
        "consolidated-statements",
        consolidatedCompanyIds,
        dateParams,
        comparisonCurrentParams,
        comparisonPreviousParams,
      ],
      queryFn: () =>
        Promise.all(
          accessibleReportCompanies.map(async (company) => {
            const base = {
              companyId: company.id,
              companyName: company.name || company.legalName || "Unnamed company",
              companyType: company.companyType || "company",
              baseCurrency: company.baseCurrency || "AED",
            };

            try {
              const [
                companyProfitLoss,
                companyBalanceSheet,
                companyComparisonCurrentProfitLoss,
                companyComparisonPreviousProfitLoss,
              ] = await Promise.all([
                apiRequest("GET", `/api/companies/${company.id}/reports/pl${dateParams}`),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/balance-sheet${dateParams}`
                ),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/pl${comparisonCurrentParams}`
                ),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/pl${comparisonPreviousParams}`
                ),
              ]);

              return {
                ...base,
                profitLoss: companyProfitLoss,
                balanceSheet: companyBalanceSheet,
                comparisonCurrentProfitLoss: companyComparisonCurrentProfitLoss,
                comparisonPreviousProfitLoss: companyComparisonPreviousProfitLoss,
                error: null,
              };
            } catch (error: any) {
              return {
                ...base,
                profitLoss: null,
                balanceSheet: null,
                comparisonCurrentProfitLoss: null,
                comparisonPreviousProfitLoss: null,
                error: error?.message || "Financial reports could not be loaded.",
              };
            }
          })
        ),
      ...reportQueryOptions,
      enabled:
        accessibleReportCompanies.length > 0 &&
        (shouldLoadWorkflowData || shouldLoadReportData("consolidated-statements")),
    });
  // W5-C/W5-A: when a company group exists, consolidated-* metrics come from the server's
  // management consolidation (eliminations, NCI, FX translation) instead of the client roll-up.
  const shouldLoadGroupConsolidation =
    shouldLoadWorkflowData || shouldLoadReportData("consolidated-statements");
  const { group: consolidationGroup } = useFirstCompanyGroup(shouldLoadGroupConsolidation);
  const serverConsolidationCurrent = useServerConsolidatedStatements(
    consolidationGroup?.id,
    format(comparisonRanges.current.from, "yyyy-MM-dd"),
    format(comparisonRanges.current.to, "yyyy-MM-dd"),
    shouldLoadGroupConsolidation
  );
  const serverConsolidationPrevious = useServerConsolidatedStatements(
    consolidationGroup?.id,
    format(comparisonRanges.previous.from, "yyyy-MM-dd"),
    format(comparisonRanges.previous.to, "yyyy-MM-dd"),
    shouldLoadGroupConsolidation
  );
  const serverGroupConsolidation = useMemo(() => {
    const current = serverConsolidationCurrent.data?.consolidated?.profitAndLoss;
    const previous = serverConsolidationPrevious.data?.consolidated?.profitAndLoss;
    if (!consolidationGroup || !current || !previous) return null;
    const income = (pl: typeof current) => pl.revenue ?? pl.totalIncome ?? 0;
    return {
      groupId: consolidationGroup.id,
      groupName: consolidationGroup.name,
      currency: serverConsolidationCurrency(serverConsolidationCurrent.data),
      currentRevenue: income(current),
      previousRevenue: income(previous),
      currentExpenses: current.totalExpenses ?? 0,
      previousExpenses: previous.totalExpenses ?? 0,
      currentNetProfit: current.netProfit ?? 0,
      previousNetProfit: previous.netProfit ?? 0,
      warningCount: (serverConsolidationCurrent.data?.warnings ?? []).length,
    };
  }, [consolidationGroup, serverConsolidationCurrent.data, serverConsolidationPrevious.data]);
  const { data: trialBalance, isLoading: trialBalanceLoading } = useQuery<TrialBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "trial-balance", trialBalanceParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/trial-balance${trialBalanceParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("trial-balance"),
  });
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<InvoiceReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    // R20-05: the list endpoint paginates by default; report aggregates need all rows.
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/invoices?all=true`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData(
      "ar-aging",
      "customer-balances",
      "invoice-status",
      "revenue-customer",
      "sales-product-service"
    ),
  });
  const { data: salesProductServiceReport, isLoading: salesProductServiceLoading } =
    useQuery<SalesProductServiceReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "sales-product-service",
        salesProductServiceParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/sales-product-service${salesProductServiceParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("sales-product-service"),
    });
  const { data: overdueReport, isLoading: overdueLoading } = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", selectedCompanyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${selectedCompanyId}`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging", "invoice-status"),
  });
  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<ReceiptReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "receipts"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expenses-vendor", "expenses-category"),
  });
  const { data: bankTransactions = [], isLoading: bankTransactionsLoading } = useQuery<
    BankTransactionReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "bank-statements", "transactions"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: expenseClaims = [], isLoading: expenseClaimsLoading } = useQuery<
    ExpenseClaimReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "expense-claims"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expense-claims"),
  });
  const { data: expenseClaimSummary, isLoading: expenseClaimSummaryLoading } =
    useQuery<ExpenseClaimSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "expense-claims", "summary"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("expense-claims"),
    });
  const { data: payrollRuns = [], isLoading: payrollRunsLoading } = useQuery<PayrollRunReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "payroll-runs"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/payroll-runs`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("payroll-summary", "wps-sif-summary"),
    }
  );
  const { data: journalEntries = [], isLoading: journalLoading } = useQuery<
    JournalEntryReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData(
      "general-ledger",
      "account-transactions",
      "expenses-vendor",
      "expenses-category",
      "month-end-close-status",
      "audit-trail"
    ),
  });
  const { data: monthEndCloseStatus, isLoading: monthEndCloseLoading } =
    useQuery<MonthEndCloseStatusReport>({
      queryKey: ["/api/companies", selectedCompanyId, "month-end", "checklist", monthEndPeriod],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/month-end/checklist?period=${monthEndPeriod}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("month-end-close-status"),
    });
  const { data: activityLogs = [], isLoading: activityLogsLoading } = useQuery<
    ActivityLogReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "activity-logs"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/activity-logs?limit=200`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("audit-trail"),
  });
  const { data: budgetPlans = [], isLoading: budgetPlansLoading } = useQuery<BudgetPlanReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "budget-plans"],
      ...reportQueryOptions,
      enabled: shouldLoadReportData("budget-actual", "cash-flow-forecast"),
    }
  );
  const selectedBudgetPlan = useMemo(() => {
    return budgetPlans.find((budget) => budget.status === "approved") ?? budgetPlans[0];
  }, [budgetPlans]);
  const { data: varianceReport, isLoading: varianceLoading } = useQuery<VarianceReport>({
    queryKey: ["/api/budget-plans", selectedBudgetPlan?.id, "variance"],
    queryFn: () => apiRequest("GET", `/api/budget-plans/${selectedBudgetPlan?.id}/variance`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("budget-actual") && !!selectedBudgetPlan?.id,
  });
  const { data: cashFlowForecast, isLoading: cashFlowForecastLoading } =
    useQuery<CashFlowForecastReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cashflow", "forecast", 90],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/cashflow/forecast?days=90`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("cash-flow-forecast"),
    });
  const { data: balanceSummaries, isLoading: balanceSummariesLoading } =
    useQuery<BalanceSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-summaries"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/balance-summaries`),
      ...reportQueryOptions,
      // E3 (J1-r3): every report that shows the balances KPI strip loads its figures.
      enabled: shouldLoadReportData(...BALANCE_STRIP_REPORT_IDS),
    });
  const { data: fixedAssets = [], isLoading: fixedAssetsLoading } = useQuery<FixedAssetReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    }
  );
  const { data: fixedAssetSummary, isLoading: fixedAssetSummaryLoading } =
    useQuery<FixedAssetSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets", "summary"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    });
  const { data: inventoryProducts = [], isLoading: inventoryProductsLoading } = useQuery<
    InventoryProductReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/products`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("inventory-valuation", "inventory-movement"),
  });
  const { data: inventoryMovements = [], isLoading: inventoryMovementsLoading } = useQuery<
    InventoryMovementReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "inventory-movements"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/inventory-movements`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("inventory-movement"),
  });
  const balancesLoading =
    balanceSummariesLoading ||
    fixedAssetsLoading ||
    fixedAssetSummaryLoading ||
    inventoryProductsLoading ||
    inventoryMovementsLoading;

  return {
    comparisonRanges,
    comparisonCurrentLabel,
    comparisonPreviousLabel,
    comparisonCurrentRange,
    comparisonPreviousRange,
    corporateTaxPeriodLabel,
    monthEndPeriod,
    monthEndPeriodLabel,
    depreciationPeriodDate,
    selectedCompany,
    reportQueryOptions,
    shouldLoadReportDeliveryData,
    profitLoss,
    plLoading,
    costCenterProfitability,
    costCenterProfitabilityLoading,
    balanceSheet,
    bsLoading,
    vatSummary,
    vatLoading,
    cashFlowStatement,
    cashFlowStatementLoading,
    agingReport,
    agingReportLoading,
    billAgingReport,
    billAgingLoading,
    vendorBills,
    vendorBillsLoading,
    advancedPeriodComparison,
    advancedPeriodComparisonLoading,
    fxGainsLosses,
    fxGainsLossesLoading,
    vatReturns,
    vatReturnsLoading,
    corporateTaxEstimate,
    corporateTaxLoading,
    corporateTaxStatus,
    comparisonPreviousCorporateTaxEstimate,
    comparisonPreviousCorporateTaxLoading,
    corporateTaxBridgeRows,
    comparisonCurrentProfitLoss,
    comparisonCurrentPlLoading,
    comparisonPreviousProfitLoss,
    comparisonPreviousPlLoading,
    comparisonCurrentBalanceSheet,
    comparisonCurrentBalanceSheetLoading,
    comparisonPreviousBalanceSheet,
    comparisonPreviousBalanceSheetLoading,
    comparisonCurrentSalesProductService,
    comparisonCurrentSalesProductServiceLoading,
    comparisonPreviousSalesProductService,
    comparisonPreviousSalesProductServiceLoading,
    comparisonCurrentCostCenterProfitability,
    comparisonCurrentCostCenterLoading,
    comparisonPreviousCostCenterProfitability,
    comparisonPreviousCostCenterLoading,
    comparisonCurrentVat,
    comparisonCurrentVatLoading,
    comparisonPreviousVat,
    comparisonPreviousVatLoading,
    consolidatedStatementSources,
    consolidatedStatementsLoading,
    serverGroupConsolidation,
    trialBalance,
    trialBalanceLoading,
    invoices,
    invoicesLoading,
    salesProductServiceReport,
    salesProductServiceLoading,
    overdueReport,
    overdueLoading,
    receipts,
    receiptsLoading,
    bankTransactions,
    bankTransactionsLoading,
    expenseClaims,
    expenseClaimsLoading,
    expenseClaimSummary,
    expenseClaimSummaryLoading,
    payrollRuns,
    payrollRunsLoading,
    journalEntries,
    journalLoading,
    monthEndCloseStatus,
    monthEndCloseLoading,
    activityLogs,
    activityLogsLoading,
    budgetPlans,
    budgetPlansLoading,
    varianceReport,
    varianceLoading,
    cashFlowForecast,
    cashFlowForecastLoading,
    balanceSummaries,
    fixedAssets,
    fixedAssetSummary,
    inventoryProducts,
    inventoryMovements,
    balancesLoading,
  };
}

export type ReportsDataQueriesState = ReturnType<typeof useReportsDataQueries>;
