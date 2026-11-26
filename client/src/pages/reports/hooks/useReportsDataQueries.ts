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
  const {
    data: profitLoss,
    isLoading: plLoading,
    fetchStatus: plFetchStatus,
    error: plError,
    refetch: plRefetch,
  } = useQuery<ProfitLossReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("profit-loss"),
  });
  const { data: costCenterProfitability, isLoading: costCenterProfitabilityLoading, isError: costCenterProfitabilityIsError, refetch: costCenterProfitabilityRefetch } =
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
  const {
    data: balanceSheet,
    isLoading: bsLoading,
    fetchStatus: bsFetchStatus,
    error: bsError,
    refetch: bsRefetch,
  } = useQuery<BalanceSheetReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-sheet", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("balance-sheet"),
  });
  const {
    data: vatSummary,
    isLoading: vatLoading,
    fetchStatus: vatFetchStatus,
    error: vatError,
    refetch: vatRefetch,
  } = useQuery<VATSummaryReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vat-summary", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("vat-summary"),
  });
  const { data: cashFlowStatement = [], isLoading: cashFlowStatementLoading, isError: cashFlowStatementIsError, refetch: cashFlowStatementRefetch } = useQuery<
    CashFlowStatementRow[]
  >({
    queryKey: ["/api/reports", selectedCompanyId, "cash-flow", advancedReportPeriod],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: agingReport = [], isLoading: agingReportLoading, isError: agingReportIsError, refetch: agingReportRefetch } = useQuery<AgingReportItem[]>({
    queryKey: ["/api/reports", selectedCompanyId, "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging"),
  });
  const { data: billAgingReport, isLoading: billAgingLoading, isError: billAgingIsError, refetch: billAgingRefetch } = useQuery<BillAgingReport>({
    queryKey: ["/api/companies", selectedCompanyId, "bills", "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ap-aging"),
  });
  const { data: vendorBills = [], isLoading: vendorBillsLoading, isError: vendorBillsIsError, refetch: vendorBillsRefetch } = useQuery<VendorBillReportRow[]>(
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
  const { data: advancedPeriodComparison = [], isLoading: advancedPeriodComparisonLoading, isError: advancedPeriodComparisonIsError, refetch: advancedPeriodComparisonRefetch } =
    useQuery<AdvancedPeriodComparisonRow[]>({
      queryKey: ["/api/reports", selectedCompanyId, "comparison", advancedReportPeriod],
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });
  const { data: fxGainsLosses, isLoading: fxGainsLossesLoading, isError: fxGainsLossesIsError, refetch: fxGainsLossesRefetch } = useQuery<FxGainsLossesReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "fx-gains-losses"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: vatReturns = [], isLoading: vatReturnsLoading, isError: vatReturnsIsError, refetch: vatReturnsRefetch } = useQuery<VATReturnReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "vat-returns"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: corporateTaxEstimate, isLoading: corporateTaxLoading, isError: corporateTaxIsError, refetch: corporateTaxRefetch } =
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
    isError: comparisonPreviousCorporateTaxIsError,
    refetch: comparisonPreviousCorporateTaxRefetch,
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
  const { data: comparisonCurrentProfitLoss, isLoading: comparisonCurrentPlLoading, isError: comparisonCurrentPlIsError, refetch: comparisonCurrentPlRefetch } =
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
  const { data: comparisonPreviousProfitLoss, isLoading: comparisonPreviousPlLoading, isError: comparisonPreviousPlIsError, refetch: comparisonPreviousPlRefetch } =
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
  const { data: comparisonCurrentBalanceSheet, isLoading: comparisonCurrentBalanceSheetLoading, isError: comparisonCurrentBalanceSheetIsError, refetch: comparisonCurrentBalanceSheetRefetch } =
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
  const { data: comparisonPreviousBalanceSheet, isLoading: comparisonPreviousBalanceSheetLoading, isError: comparisonPreviousBalanceSheetIsError, refetch: comparisonPreviousBalanceSheetRefetch } =
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
    isError: comparisonCurrentSpsIsError,
    refetch: comparisonCurrentSpsRefetch,
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
    isError: comparisonPreviousSpsIsError,
    refetch: comparisonPreviousSpsRefetch,
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
    isError: comparisonCurrentCcIsError,
    refetch: comparisonCurrentCcRefetch,
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
    isError: comparisonPreviousCcIsError,
    refetch: comparisonPreviousCcRefetch,
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
  const { data: comparisonCurrentVat, isLoading: comparisonCurrentVatLoading, isError: comparisonCurrentVatIsError, refetch: comparisonCurrentVatRefetch } =
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
  const { data: comparisonPreviousVat, isLoading: comparisonPreviousVatLoading, isError: comparisonPreviousVatIsError, refetch: comparisonPreviousVatRefetch } =
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
  const {
    data: trialBalance,
    isLoading: trialBalanceLoading,
    fetchStatus: tbFetchStatus,
    error: tbError,
    refetch: tbRefetch,
  } = useQuery<TrialBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "trial-balance", trialBalanceParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/trial-balance${trialBalanceParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("trial-balance"),
  });
  const { data: invoices = [], isLoading: invoicesLoading, isError: invoicesIsError, refetch: invoicesRefetch } = useQuery<InvoiceReportRow[]>({
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
  const { data: salesProductServiceReport, isLoading: salesProductServiceLoading, isError: salesProductServiceIsError, refetch: salesProductServiceRefetch } =
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
  const { data: overdueReport, isLoading: overdueLoading, isError: overdueIsError, refetch: overdueRefetch } = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", selectedCompanyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${selectedCompanyId}`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging", "invoice-status"),
  });
  const { data: receipts = [], isLoading: receiptsLoading, isError: receiptsIsError, refetch: receiptsRefetch } = useQuery<ReceiptReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "receipts"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expenses-vendor", "expenses-category"),
  });
  const { data: bankTransactions = [], isLoading: bankTransactionsLoading, isError: bankTransactionsIsError, refetch: bankTransactionsRefetch } = useQuery<
    BankTransactionReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "bank-statements", "transactions"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });
  const { data: expenseClaims = [], isLoading: expenseClaimsLoading, isError: expenseClaimsIsError, refetch: expenseClaimsRefetch } = useQuery<
    ExpenseClaimReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "expense-claims"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expense-claims"),
  });
  const { data: expenseClaimSummary, isLoading: expenseClaimSummaryLoading, isError: expenseClaimSummaryIsError, refetch: expenseClaimSummaryRefetch } =
    useQuery<ExpenseClaimSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "expense-claims", "summary"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("expense-claims"),
    });
  const { data: payrollRuns = [], isLoading: payrollRunsLoading, isError: payrollRunsIsError, refetch: payrollRunsRefetch } = useQuery<PayrollRunReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "payroll-runs"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/payroll-runs`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("payroll-summary", "wps-sif-summary"),
    }
  );
  const { data: journalEntries = [], isLoading: journalLoading, isError: journalEntriesIsError, refetch: journalEntriesRefetch } = useQuery<
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
  const { data: monthEndCloseStatus, isLoading: monthEndCloseLoading, isError: monthEndCloseIsError, refetch: monthEndCloseRefetch } =
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
  const { data: activityLogs = [], isLoading: activityLogsLoading, isError: activityLogsIsError, refetch: activityLogsRefetch } = useQuery<
    ActivityLogReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "activity-logs"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/activity-logs?limit=200`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("audit-trail"),
  });
  const { data: budgetPlans = [], isLoading: budgetPlansLoading, isError: budgetPlansIsError, refetch: budgetPlansRefetch } = useQuery<BudgetPlanReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "budget-plans"],
      ...reportQueryOptions,
      enabled: shouldLoadReportData("budget-actual", "cash-flow-forecast"),
    }
  );
  const selectedBudgetPlan = useMemo(() => {
    return budgetPlans.find((budget) => budget.status === "approved") ?? budgetPlans[0];
  }, [budgetPlans]);
  const { data: varianceReport, isLoading: varianceLoading, isError: varianceIsError, refetch: varianceRefetch } = useQuery<VarianceReport>({
    queryKey: ["/api/budget-plans", selectedBudgetPlan?.id, "variance"],
    queryFn: () => apiRequest("GET", `/api/budget-plans/${selectedBudgetPlan?.id}/variance`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("budget-actual") && !!selectedBudgetPlan?.id,
  });
  const { data: cashFlowForecast, isLoading: cashFlowForecastLoading, isError: cashFlowForecastIsError, refetch: cashFlowForecastRefetch } =
    useQuery<CashFlowForecastReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cashflow", "forecast", 90],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/cashflow/forecast?days=90`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("cash-flow-forecast"),
    });
  const { data: balanceSummaries, isLoading: balanceSummariesLoading, isError: balanceSummariesIsError, refetch: balanceSummariesRefetch } =
    useQuery<BalanceSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-summaries"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/balance-summaries`),
      ...reportQueryOptions,
      // E3 (J1-r3): every report that shows the balances KPI strip loads its figures.
      enabled: shouldLoadReportData(...BALANCE_STRIP_REPORT_IDS),
    });
  const { data: fixedAssets = [], isLoading: fixedAssetsLoading, isError: fixedAssetsIsError, refetch: fixedAssetsRefetch } = useQuery<FixedAssetReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    }
  );
  const { data: fixedAssetSummary, isLoading: fixedAssetSummaryLoading, isError: fixedAssetSummaryIsError, refetch: fixedAssetSummaryRefetch } =
    useQuery<FixedAssetSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets", "summary"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    });
  const { data: inventoryProducts = [], isLoading: inventoryProductsLoading, isError: inventoryProductsIsError, refetch: inventoryProductsRefetch } = useQuery<
    InventoryProductReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/products`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("inventory-valuation", "inventory-movement"),
  });
  const { data: inventoryMovements = [], isLoading: inventoryMovementsLoading, isError: inventoryMovementsIsError, refetch: inventoryMovementsRefetch } = useQuery<
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
    plFetchStatus,
    bsFetchStatus,
    vatFetchStatus,
    /** A failed statement fetch is shown as an error, never as an all-zero statement. */
    reportLoadErrors: {
      pl: plError ? { error: plError, retry: () => void plRefetch() } : null,
      bs: bsError ? { error: bsError, retry: () => void bsRefetch() } : null,
      vat: vatError ? { error: vatError, retry: () => void vatRefetch() } : null,
      tb: tbError ? { error: tbError, retry: () => void tbRefetch() } : null,
    },
    /** A failed secondary read is shown as an error notice, never silently as an empty list. */
    secondaryLoadErrors: {
      cashFlowStatement: cashFlowStatementIsError ? { retry: () => void cashFlowStatementRefetch() } : null,
      agingReport: agingReportIsError ? { retry: () => void agingReportRefetch() } : null,
      vendorBills: vendorBillsIsError ? { retry: () => void vendorBillsRefetch() } : null,
      advancedPeriodComparison: advancedPeriodComparisonIsError ? { retry: () => void advancedPeriodComparisonRefetch() } : null,
      vatReturns: vatReturnsIsError ? { retry: () => void vatReturnsRefetch() } : null,
      invoices: invoicesIsError ? { retry: () => void invoicesRefetch() } : null,
      receipts: receiptsIsError ? { retry: () => void receiptsRefetch() } : null,
      bankTransactions: bankTransactionsIsError ? { retry: () => void bankTransactionsRefetch() } : null,
      expenseClaims: expenseClaimsIsError ? { retry: () => void expenseClaimsRefetch() } : null,
      payrollRuns: payrollRunsIsError ? { retry: () => void payrollRunsRefetch() } : null,
      journalEntries: journalEntriesIsError ? { retry: () => void journalEntriesRefetch() } : null,
      activityLogs: activityLogsIsError ? { retry: () => void activityLogsRefetch() } : null,
      budgetPlans: budgetPlansIsError ? { retry: () => void budgetPlansRefetch() } : null,
      fixedAssets: fixedAssetsIsError ? { retry: () => void fixedAssetsRefetch() } : null,
      inventoryProducts: inventoryProductsIsError ? { retry: () => void inventoryProductsRefetch() } : null,
      inventoryMovements: inventoryMovementsIsError ? { retry: () => void inventoryMovementsRefetch() } : null,
      costCenterProfitability: costCenterProfitabilityIsError ? { retry: () => void costCenterProfitabilityRefetch() } : null,
      billAgingReport: billAgingIsError ? { retry: () => void billAgingRefetch() } : null,
      fxGainsLosses: fxGainsLossesIsError ? { retry: () => void fxGainsLossesRefetch() } : null,
      corporateTaxEstimate: corporateTaxIsError ? { retry: () => void corporateTaxRefetch() } : null,
      salesProductServiceReport: salesProductServiceIsError ? { retry: () => void salesProductServiceRefetch() } : null,
      overdueReport: overdueIsError ? { retry: () => void overdueRefetch() } : null,
      expenseClaimSummary: expenseClaimSummaryIsError ? { retry: () => void expenseClaimSummaryRefetch() } : null,
      monthEndCloseStatus: monthEndCloseIsError ? { retry: () => void monthEndCloseRefetch() } : null,
      varianceReport: varianceIsError ? { retry: () => void varianceRefetch() } : null,
      cashFlowForecast: cashFlowForecastIsError ? { retry: () => void cashFlowForecastRefetch() } : null,
      balanceSummaries: balanceSummariesIsError ? { retry: () => void balanceSummariesRefetch() } : null,
      fixedAssetSummary: fixedAssetSummaryIsError ? { retry: () => void fixedAssetSummaryRefetch() } : null,
      comparisonProfitLoss: (comparisonCurrentPlIsError || comparisonPreviousPlIsError) ? { retry: () => { if (comparisonCurrentPlIsError) void comparisonCurrentPlRefetch(); if (comparisonPreviousPlIsError) void comparisonPreviousPlRefetch(); } } : null,
      comparisonBalanceSheet: (comparisonCurrentBalanceSheetIsError || comparisonPreviousBalanceSheetIsError) ? { retry: () => { if (comparisonCurrentBalanceSheetIsError) void comparisonCurrentBalanceSheetRefetch(); if (comparisonPreviousBalanceSheetIsError) void comparisonPreviousBalanceSheetRefetch(); } } : null,
      comparisonVat: (comparisonCurrentVatIsError || comparisonPreviousVatIsError) ? { retry: () => { if (comparisonCurrentVatIsError) void comparisonCurrentVatRefetch(); if (comparisonPreviousVatIsError) void comparisonPreviousVatRefetch(); } } : null,
      comparisonSalesProductService: (comparisonCurrentSpsIsError || comparisonPreviousSpsIsError) ? { retry: () => { if (comparisonCurrentSpsIsError) void comparisonCurrentSpsRefetch(); if (comparisonPreviousSpsIsError) void comparisonPreviousSpsRefetch(); } } : null,
      comparisonCostCenter: (comparisonCurrentCcIsError || comparisonPreviousCcIsError) ? { retry: () => { if (comparisonCurrentCcIsError) void comparisonCurrentCcRefetch(); if (comparisonPreviousCcIsError) void comparisonPreviousCcRefetch(); } } : null,
      comparisonCorporateTax: comparisonPreviousCorporateTaxIsError ? { retry: () => void comparisonPreviousCorporateTaxRefetch() } : null,
    },
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
    tbFetchStatus,
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
