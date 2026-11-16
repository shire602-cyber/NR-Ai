// Period comparisons, comparison presets, general ledger, audit trail, month-end close and planning reports.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import {
  AccountActivityRow,
  AuditTrailSummaryRow,
  CashFlowProjection,
  ComparisonMetricRow,
  LedgerLineRow,
  LedgerSourceRow,
  activityLogInDateRange,
  activityLogLabel,
  activityLogRiskLevel,
  comparisonBadgeVariant,
  isOverBudgetLine,
  journalAccountName,
  journalEntryInDateRange,
  journalSourceLabel,
  ledgerDetailPageSize,
  matchesReportPersona,
} from "../shared";
import {
  type ReportCatalogItem,
  reportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
} from "@/lib/reportCatalog";
import { buildComparisonRows } from "../comparisons/buildComparisonRows";
import { format } from "date-fns";
import { useMemo } from "react";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsDerivedReportsState } from "./useReportsDerivedReports";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";
import type { ReportsWorkspaceSummariesState } from "./useReportsWorkspaceSummaries";

type UseReportsComparisonsAndCloseDeps = Pick<
  ReportsDataQueriesState &
    ReportsDerivedReportsState &
    ReportsWorkspaceStateState &
    ReportsWorkspaceSummariesState,
  | "activityLogs"
  | "activityLogsLoading"
  | "advancedPeriodComparisonLoading"
  | "agingReportLoading"
  | "balancesLoading"
  | "bankTransactions"
  | "bankTransactionsLoading"
  | "billAgingLoading"
  | "budgetPlans"
  | "budgetPlansLoading"
  | "cashFlowForecast"
  | "cashFlowForecastLoading"
  | "cashFlowStatement"
  | "cashFlowStatementLoading"
  | "comparisonCurrentBalanceSheet"
  | "comparisonCurrentBalanceSheetLoading"
  | "comparisonCurrentCostCenterLoading"
  | "comparisonCurrentCostCenterProfitability"
  | "comparisonCurrentPlLoading"
  | "comparisonCurrentProfitLoss"
  | "comparisonCurrentRange"
  | "comparisonCurrentSalesProductService"
  | "comparisonCurrentSalesProductServiceLoading"
  | "comparisonCurrentVat"
  | "comparisonCurrentVatLoading"
  | "comparisonPreviousBalanceSheet"
  | "comparisonPreviousBalanceSheetLoading"
  | "comparisonPreviousCorporateTaxEstimate"
  | "comparisonPreviousCorporateTaxLoading"
  | "comparisonPreviousCostCenterLoading"
  | "comparisonPreviousCostCenterProfitability"
  | "comparisonPreviousPlLoading"
  | "comparisonPreviousProfitLoss"
  | "comparisonPreviousRange"
  | "comparisonPreviousSalesProductService"
  | "comparisonPreviousSalesProductServiceLoading"
  | "comparisonPreviousVat"
  | "comparisonPreviousVatLoading"
  | "consolidatedStatementsLoading"
  | "consolidatedStatementsReport"
  | "corporateTaxEstimate"
  | "corporateTaxLoading"
  | "costCenterProfitabilityLoading"
  | "dateRange"
  | "depreciationScheduleReport"
  | "expenseClaims"
  | "expenseClaimsLoading"
  | "expensesLoading"
  | "fixedAssetRegisterReport"
  | "fxGainsLosses"
  | "fxGainsLossesLoading"
  | "inventoryMovements"
  | "inventoryValuationReport"
  | "invoices"
  | "invoicesLoading"
  | "journalEntries"
  | "journalLoading"
  | "ledgerDetailPage"
  | "matchesReportWorkflowSearch"
  | "monthEndCloseLoading"
  | "monthEndCloseStatus"
  | "monthEndPeriod"
  | "payrollLoading"
  | "payrollRuns"
  | "personaFilter"
  | "receipts"
  | "receiptsLoading"
  | "serverGroupConsolidation"
  | "trialBalanceLoading"
  | "varianceLoading"
  | "varianceReport"
  | "vatLoading"
  | "vatReturnsLoading"
  | "vendorBills"
  | "vendorBillsLoading"
  | "workspaceSummaries"
>;

export function useReportsComparisonsAndClose({
  activityLogs,
  activityLogsLoading,
  advancedPeriodComparisonLoading,
  agingReportLoading,
  balancesLoading,
  bankTransactions,
  bankTransactionsLoading,
  billAgingLoading,
  budgetPlans,
  budgetPlansLoading,
  cashFlowForecast,
  cashFlowForecastLoading,
  cashFlowStatement,
  cashFlowStatementLoading,
  comparisonCurrentBalanceSheet,
  comparisonCurrentBalanceSheetLoading,
  comparisonCurrentCostCenterLoading,
  comparisonCurrentCostCenterProfitability,
  comparisonCurrentPlLoading,
  comparisonCurrentProfitLoss,
  comparisonCurrentRange,
  comparisonCurrentSalesProductService,
  comparisonCurrentSalesProductServiceLoading,
  comparisonCurrentVat,
  comparisonCurrentVatLoading,
  comparisonPreviousBalanceSheet,
  comparisonPreviousBalanceSheetLoading,
  comparisonPreviousCorporateTaxEstimate,
  comparisonPreviousCorporateTaxLoading,
  comparisonPreviousCostCenterLoading,
  comparisonPreviousCostCenterProfitability,
  comparisonPreviousPlLoading,
  comparisonPreviousProfitLoss,
  comparisonPreviousRange,
  comparisonPreviousSalesProductService,
  comparisonPreviousSalesProductServiceLoading,
  comparisonPreviousVat,
  comparisonPreviousVatLoading,
  consolidatedStatementsLoading,
  consolidatedStatementsReport,
  corporateTaxEstimate,
  corporateTaxLoading,
  costCenterProfitabilityLoading,
  dateRange,
  depreciationScheduleReport,
  expenseClaims,
  expenseClaimsLoading,
  expensesLoading,
  fixedAssetRegisterReport,
  fxGainsLosses,
  fxGainsLossesLoading,
  inventoryMovements,
  inventoryValuationReport,
  invoices,
  invoicesLoading,
  journalEntries,
  journalLoading,
  ledgerDetailPage,
  matchesReportWorkflowSearch,
  monthEndCloseLoading,
  monthEndCloseStatus,
  monthEndPeriod,
  payrollLoading,
  payrollRuns,
  personaFilter,
  receipts,
  receiptsLoading,
  serverGroupConsolidation,
  trialBalanceLoading,
  varianceLoading,
  varianceReport,
  vatLoading,
  vatReturnsLoading,
  vendorBills,
  vendorBillsLoading,
  workspaceSummaries,
}: UseReportsComparisonsAndCloseDeps) {
  const comparisonRows = useMemo<ComparisonMetricRow[]>(
    () =>
      buildComparisonRows({
        comparisonCurrentProfitLoss: {
          netProfit: comparisonCurrentProfitLoss?.netProfit,
          totalExpenses: comparisonCurrentProfitLoss?.totalExpenses,
          totalRevenue: comparisonCurrentProfitLoss?.totalRevenue,
        },
        comparisonCurrentBalanceSheet: {
          totalAssets: comparisonCurrentBalanceSheet?.totalAssets,
          totalEquity: comparisonCurrentBalanceSheet?.totalEquity,
          totalLiabilities: comparisonCurrentBalanceSheet?.totalLiabilities,
        },
        comparisonCurrentCostCenterProfitability: {
          totals: {
            netIncome: comparisonCurrentCostCenterProfitability?.totals?.netIncome,
            totalExpenses: comparisonCurrentCostCenterProfitability?.totals?.totalExpenses,
          },
        },
        comparisonCurrentRange,
        comparisonCurrentSalesProductService: {
          totals: {
            topProductServiceShare:
              comparisonCurrentSalesProductService?.totals?.topProductServiceShare,
          },
        },
        comparisonCurrentVat: { netVATPayable: comparisonCurrentVat?.netVATPayable },
        comparisonPreviousCostCenterProfitability: {
          totals: {
            netIncome: comparisonPreviousCostCenterProfitability?.totals?.netIncome,
            totalExpenses: comparisonPreviousCostCenterProfitability?.totals?.totalExpenses,
          },
        },
        comparisonPreviousCorporateTaxEstimate: {
          taxPayable: comparisonPreviousCorporateTaxEstimate?.taxPayable,
        },
        comparisonPreviousProfitLoss: {
          netProfit: comparisonPreviousProfitLoss?.netProfit,
          totalExpenses: comparisonPreviousProfitLoss?.totalExpenses,
          totalRevenue: comparisonPreviousProfitLoss?.totalRevenue,
        },
        comparisonPreviousBalanceSheet: {
          totalAssets: comparisonPreviousBalanceSheet?.totalAssets,
          totalEquity: comparisonPreviousBalanceSheet?.totalEquity,
          totalLiabilities: comparisonPreviousBalanceSheet?.totalLiabilities,
        },
        comparisonPreviousRange,
        comparisonPreviousSalesProductService: {
          totals: {
            topProductServiceShare:
              comparisonPreviousSalesProductService?.totals?.topProductServiceShare,
          },
        },
        comparisonPreviousVat: { netVATPayable: comparisonPreviousVat?.netVATPayable },
        consolidatedStatementsReport: {
          currentComparisonExpenses: consolidatedStatementsReport.currentComparisonExpenses,
          currentComparisonNetProfit: consolidatedStatementsReport.currentComparisonNetProfit,
          currentComparisonRevenue: consolidatedStatementsReport.currentComparisonRevenue,
          previousExpenses: consolidatedStatementsReport.previousExpenses,
          previousNetProfit: consolidatedStatementsReport.previousNetProfit,
          previousRevenue: consolidatedStatementsReport.previousRevenue,
          reviewCount: consolidatedStatementsReport.reviewCount,
        },
        serverGroupConsolidation,
        activityLogs,
        bankTransactions,
        cashFlowForecast: {
          currentBalance: cashFlowForecast?.currentBalance,
          projections: cashFlowForecast?.projections,
        },
        cashFlowStatement,
        corporateTaxEstimate: { taxPayable: corporateTaxEstimate?.taxPayable },
        depreciationScheduleReport: {
          readyToPostCount: depreciationScheduleReport.readyToPostCount,
          reviewCount: depreciationScheduleReport.reviewCount,
          reviewValueAed: depreciationScheduleReport.reviewValueAed,
        },
        expenseClaims,
        fixedAssetRegisterReport: {
          activeRows: fixedAssetRegisterReport.activeRows,
          reviewCount: fixedAssetRegisterReport.reviewCount,
          reviewValueAed: fixedAssetRegisterReport.reviewValueAed,
        },
        fxGainsLosses: {
          totalUnrealizedGain: fxGainsLosses?.totalUnrealizedGain,
          totalUnrealizedLoss: fxGainsLosses?.totalUnrealizedLoss,
        },
        invoices,
        inventoryMovements,
        inventoryValuationReport: {
          activeProductCount: inventoryValuationReport.activeProductCount,
          reviewCount: inventoryValuationReport.reviewCount,
          reviewValueAed: inventoryValuationReport.reviewValueAed,
        },
        journalEntries,
        monthEndCloseStatus: { checklist: monthEndCloseStatus?.checklist },
        payrollRuns,
        receipts,
        varianceReport: { varianceLines: varianceReport?.varianceLines },
        vendorBills,
      }),
    [
      comparisonCurrentProfitLoss?.netProfit,
      comparisonCurrentProfitLoss?.totalExpenses,
      comparisonCurrentProfitLoss?.totalRevenue,
      comparisonCurrentBalanceSheet?.totalAssets,
      comparisonCurrentBalanceSheet?.totalEquity,
      comparisonCurrentBalanceSheet?.totalLiabilities,
      comparisonCurrentCostCenterProfitability?.totals?.netIncome,
      comparisonCurrentCostCenterProfitability?.totals?.totalExpenses,
      comparisonCurrentRange,
      comparisonCurrentSalesProductService?.totals?.topProductServiceShare,
      comparisonCurrentVat?.netVATPayable,
      comparisonPreviousCostCenterProfitability?.totals?.netIncome,
      comparisonPreviousCostCenterProfitability?.totals?.totalExpenses,
      comparisonPreviousCorporateTaxEstimate?.taxPayable,
      comparisonPreviousProfitLoss?.netProfit,
      comparisonPreviousProfitLoss?.totalExpenses,
      comparisonPreviousProfitLoss?.totalRevenue,
      comparisonPreviousBalanceSheet?.totalAssets,
      comparisonPreviousBalanceSheet?.totalEquity,
      comparisonPreviousBalanceSheet?.totalLiabilities,
      comparisonPreviousRange,
      comparisonPreviousSalesProductService?.totals?.topProductServiceShare,
      comparisonPreviousVat?.netVATPayable,
      consolidatedStatementsReport.currentComparisonExpenses,
      consolidatedStatementsReport.currentComparisonNetProfit,
      consolidatedStatementsReport.currentComparisonRevenue,
      consolidatedStatementsReport.previousExpenses,
      consolidatedStatementsReport.previousNetProfit,
      consolidatedStatementsReport.previousRevenue,
      consolidatedStatementsReport.reviewCount,
      serverGroupConsolidation,
      activityLogs,
      bankTransactions,
      cashFlowForecast?.currentBalance,
      cashFlowForecast?.projections,
      cashFlowStatement,
      corporateTaxEstimate?.taxPayable,
      depreciationScheduleReport.readyToPostCount,
      depreciationScheduleReport.reviewCount,
      depreciationScheduleReport.reviewValueAed,
      expenseClaims,
      fixedAssetRegisterReport.activeRows,
      fixedAssetRegisterReport.reviewCount,
      fixedAssetRegisterReport.reviewValueAed,
      fxGainsLosses?.totalUnrealizedGain,
      fxGainsLosses?.totalUnrealizedLoss,
      invoices,
      inventoryMovements,
      inventoryValuationReport.activeProductCount,
      inventoryValuationReport.reviewCount,
      inventoryValuationReport.reviewValueAed,
      journalEntries,
      monthEndCloseStatus?.checklist,
      payrollRuns,
      receipts,
      varianceReport?.varianceLines,
      vendorBills,
    ]
  );
  const visibleComparisonRows = useMemo(() => {
    return comparisonRows.filter(
      (row) =>
        matchesReportPersona(row.personas, personaFilter) &&
        matchesReportWorkflowSearch([
          row.label,
          row.signal,
          row.currency,
          row.personas.join(" "),
          row.tab,
        ])
    );
  }, [comparisonRows, matchesReportWorkflowSearch, personaFilter]);
  const reportComparisonPresetSummaries = useMemo(() => {
    return reportComparisonPresets.flatMap((preset) => {
      const workspace = workspaceSummaries.find((item) => item.persona === preset.persona);
      if (!workspace) return [];

      const reports = preset.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const metrics = preset.metricIds
        .map((metricId) => comparisonRows.find((row) => row.id === metricId))
        .filter((row): row is ComparisonMetricRow => Boolean(row));
      const warningCount = metrics.filter(
        (row) => comparisonBadgeVariant(row) === "warning"
      ).length;

      return [
        {
          ...preset,
          workspace,
          reports,
          metrics,
          warningCount,
          href: reportComparisonPresetHref(preset),
        },
      ];
    });
  }, [comparisonRows, workspaceSummaries]);
  const visibleReportComparisonPresets = useMemo(() => {
    return reportComparisonPresetSummaries.filter(
      (preset) =>
        matchesReportPersona([preset.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          preset.title,
          preset.question,
          preset.baseline,
          preset.automationTrigger,
          preset.commandKeywords,
          preset.reports.map((report) => report.name).join(" "),
          preset.metrics.map((metric) => metric.label).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportComparisonPresetSummaries]);
  const comparisonLoading =
    comparisonCurrentPlLoading ||
    comparisonPreviousPlLoading ||
    comparisonCurrentBalanceSheetLoading ||
    comparisonPreviousBalanceSheetLoading ||
    comparisonCurrentSalesProductServiceLoading ||
    comparisonPreviousSalesProductServiceLoading ||
    comparisonCurrentVatLoading ||
    comparisonPreviousVatLoading ||
    comparisonCurrentCostCenterLoading ||
    comparisonPreviousCostCenterLoading ||
    corporateTaxLoading ||
    comparisonPreviousCorporateTaxLoading ||
    consolidatedStatementsLoading ||
    cashFlowForecastLoading ||
    varianceLoading ||
    expenseClaimsLoading ||
    invoicesLoading ||
    journalLoading ||
    monthEndCloseLoading ||
    receiptsLoading ||
    bankTransactionsLoading ||
    vendorBillsLoading;
  const reportJournalEntries = useMemo(() => {
    return journalEntries.filter(
      (entry) => entry.status === "posted" && journalEntryInDateRange(entry, dateRange)
    );
  }, [dateRange, journalEntries]);
  const ledgerLines = useMemo<LedgerLineRow[]>(() => {
    return reportJournalEntries
      .flatMap((entry) =>
        (entry.lines ?? []).map((line) => ({
          id: line.id,
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          date: entry.date,
          memo: line.memo || entry.memo || "",
          source: journalSourceLabel(entry.source),
          accountId: line.accountId,
          accountCode: line.account?.code || "",
          accountName: journalAccountName(line.account),
          accountType: line.account?.type || "unknown",
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          hasForeignCurrency: Boolean(line.foreignCurrency),
        }))
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [reportJournalEntries]);
  const accountActivity = useMemo<AccountActivityRow[]>(() => {
    const summaries = new Map<string, AccountActivityRow>();
    for (const line of ledgerLines) {
      const summary = summaries.get(line.accountId) ?? {
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType,
        lineCount: 0,
        debit: 0,
        credit: 0,
        netActivity: 0,
        lastActivity: line.date,
      };
      summary.lineCount += 1;
      summary.debit += line.debit;
      summary.credit += line.credit;
      summary.netActivity = summary.debit - summary.credit;
      if (new Date(line.date) > new Date(summary.lastActivity)) {
        summary.lastActivity = line.date;
      }
      summaries.set(line.accountId, summary);
    }
    return Array.from(summaries.values()).sort(
      (a, b) => Math.abs(b.netActivity) - Math.abs(a.netActivity)
    );
  }, [ledgerLines]);
  const ledgerSourceRows = useMemo<LedgerSourceRow[]>(() => {
    const sourceEntries = new Map<string, Set<string>>();
    const summaries = new Map<string, LedgerSourceRow>();
    for (const line of ledgerLines) {
      const source = line.source;
      const entryIds = sourceEntries.get(source) ?? new Set<string>();
      entryIds.add(line.entryId);
      sourceEntries.set(source, entryIds);

      const summary = summaries.get(source) ?? {
        source,
        entryCount: 0,
        lineCount: 0,
        amountAed: 0,
        needsReview: source === "Manual / no source" || source === "manual",
      };
      summary.lineCount += 1;
      summary.amountAed += Math.max(line.debit, line.credit);
      summaries.set(source, summary);
    }
    for (const [source, summary] of summaries) {
      summary.entryCount = sourceEntries.get(source)?.size ?? 0;
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [ledgerLines]);
  const ledgerReport = useMemo(() => {
    const totalDebit = ledgerLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = ledgerLines.reduce((sum, line) => sum + line.credit, 0);
    const reviewEntries = reportJournalEntries.filter(
      (entry) => !entry.source || entry.source === "manual"
    ).length;
    return {
      entryCount: reportJournalEntries.length,
      lineCount: ledgerLines.length,
      accountCount: accountActivity.length,
      totalDebit,
      totalCredit,
      difference: Math.abs(totalDebit - totalCredit),
      reviewEntries,
      foreignCurrencyLines: ledgerLines.filter((line) => line.hasForeignCurrency).length,
      lines: ledgerLines,
      accountActivity,
      sourceRows: ledgerSourceRows,
    };
  }, [accountActivity, ledgerLines, ledgerSourceRows, reportJournalEntries]);
  const ledgerLoading = journalLoading;
  const ledgerDetailPageCount = Math.max(1, Math.ceil(ledgerLines.length / ledgerDetailPageSize));
  const ledgerDetailCurrentPage = Math.min(ledgerDetailPage, ledgerDetailPageCount);
  const ledgerDetailStartIndex = (ledgerDetailCurrentPage - 1) * ledgerDetailPageSize;
  const ledgerDetailPageLines = ledgerLines.slice(
    ledgerDetailStartIndex,
    ledgerDetailStartIndex + ledgerDetailPageSize
  );
  const reportActivityLogs = useMemo(() => {
    return activityLogs.filter((log) => activityLogInDateRange(log, dateRange));
  }, [activityLogs, dateRange]);
  const auditTrailReport = useMemo(() => {
    const actionRows = new Map<string, AuditTrailSummaryRow>();
    const entityRows = new Map<string, AuditTrailSummaryRow>();
    const rows = reportActivityLogs
      .map((log) => ({
        ...log,
        actionLabel: activityLogLabel(log.action),
        entityLabel: activityLogLabel(log.entityType),
        riskLevel: activityLogRiskLevel(log),
      }))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    for (const row of rows) {
      const actionKey = row.action || "unknown";
      const actionSummary = actionRows.get(actionKey) ?? {
        key: actionKey,
        label: row.actionLabel,
        count: 0,
        latestAt: null,
      };
      actionSummary.count += 1;
      if (
        row.createdAt &&
        (!actionSummary.latestAt || new Date(row.createdAt) > new Date(actionSummary.latestAt))
      ) {
        actionSummary.latestAt = row.createdAt;
      }
      actionRows.set(actionKey, actionSummary);

      const entityKey = row.entityType || "unknown";
      const entitySummary = entityRows.get(entityKey) ?? {
        key: entityKey,
        label: row.entityLabel,
        count: 0,
        latestAt: null,
      };
      entitySummary.count += 1;
      if (
        row.createdAt &&
        (!entitySummary.latestAt || new Date(row.createdAt) > new Date(entitySummary.latestAt))
      ) {
        entitySummary.latestAt = row.createdAt;
      }
      entityRows.set(entityKey, entitySummary);
    }

    const postingActionCount = rows.filter((row) =>
      /(approve|post|journal|close|reconcile)/.test(row.action.toLowerCase())
    ).length;

    return {
      rows,
      actionRows: Array.from(actionRows.values()).sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label)
      ),
      entityRows: Array.from(entityRows.values()).sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label)
      ),
      logCount: rows.length,
      highRiskCount: rows.filter((row) => row.riskLevel === "High").length,
      mediumRiskCount: rows.filter((row) => row.riskLevel === "Medium").length,
      postingActionCount,
      userCount: new Set(rows.map((row) => row.userId).filter(Boolean)).size,
      latestLog: rows[0] ?? null,
    };
  }, [reportActivityLogs]);
  const auditTrailPeriodLabel =
    dateRange.from && dateRange.to
      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
      : "Latest 200 activity events";
  const auditTrailLoading = activityLogsLoading;
  const monthEndChecklist = useMemo(
    () => monthEndCloseStatus?.checklist ?? [],
    [monthEndCloseStatus?.checklist]
  );
  const monthEndCompletedChecks = monthEndChecklist.filter(
    (item) => item.status === "complete"
  ).length;
  const monthEndReviewChecks = Math.max(0, monthEndChecklist.length - monthEndCompletedChecks);
  const monthEndReadinessPercent = monthEndChecklist.length
    ? Math.round((monthEndCompletedChecks / monthEndChecklist.length) * 100)
    : 0;
  const monthEndCloseExportReport = useMemo(
    () => ({
      ...(monthEndCloseStatus ?? {
        period: monthEndPeriod,
        periodStart: "",
        periodEnd: "",
        checklist: [],
      }),
      completedChecks: monthEndCompletedChecks,
      reviewChecks: monthEndReviewChecks,
      readinessPercent: monthEndReadinessPercent,
    }),
    [
      monthEndCloseStatus,
      monthEndCompletedChecks,
      monthEndPeriod,
      monthEndReadinessPercent,
      monthEndReviewChecks,
    ]
  );
  const planningReport = useMemo(() => {
    const varianceLines = varianceReport?.varianceLines ?? [];
    const budgetTotal = varianceLines.reduce((sum, line) => sum + line.totals.budget, 0);
    const actualTotal = varianceLines.reduce((sum, line) => sum + line.totals.actual, 0);
    const variance = budgetTotal - actualTotal;
    const variancePercent = budgetTotal !== 0 ? (variance / budgetTotal) * 100 : 0;
    // W3-E: variance is "positive = favourable" by account type, so a negative income
    // variance is under target, not over budget. Over budget = spend above its budget.
    const overBudgetLines = varianceLines.filter(isOverBudgetLine).length;
    const largestVarianceLines = [...varianceLines].sort(
      (a, b) => Math.abs(b.totals.variance) - Math.abs(a.totals.variance)
    );

    const projections = cashFlowForecast?.projections ?? [];
    const projectedInflows = projections.reduce((sum, row) => sum + row.expectedInflows, 0);
    const projectedOutflows = projections.reduce((sum, row) => sum + row.expectedOutflows, 0);
    const endingProjection = projections[projections.length - 1];
    const lowestProjection = projections.reduce<CashFlowProjection | undefined>((lowest, row) => {
      if (!lowest || row.projectedBalance < lowest.projectedBalance) return row;
      return lowest;
    }, undefined);
    const projectedEndingBalance =
      endingProjection?.projectedBalance ?? cashFlowForecast?.currentBalance ?? 0;
    const currentBalance = cashFlowForecast?.currentBalance ?? 0;
    const cashMovement = projectedEndingBalance - currentBalance;
    const cashWarning =
      lowestProjection && lowestProjection.projectedBalance < 0
        ? "Negative cash risk"
        : lowestProjection && lowestProjection.projectedBalance < 10000
          ? "Low cash warning"
          : "On track";

    return {
      budget: varianceReport?.budget ?? null,
      budgetPlans,
      varianceLines,
      budgetTotal,
      actualTotal,
      variance,
      variancePercent,
      overBudgetLines,
      largestVarianceLines,
      forecast: cashFlowForecast ?? null,
      projections,
      projectedInflows,
      projectedOutflows,
      projectedEndingBalance,
      currentBalance,
      cashMovement,
      cashWarning,
      lowestProjection,
      insights: cashFlowForecast?.insights ?? [],
    };
  }, [budgetPlans, cashFlowForecast, varianceReport]);
  const planningLoading = budgetPlansLoading || varianceLoading || cashFlowForecastLoading;
  const advancedReportsLoading =
    cashFlowStatementLoading ||
    agingReportLoading ||
    billAgingLoading ||
    advancedPeriodComparisonLoading ||
    fxGainsLossesLoading ||
    vatReturnsLoading ||
    costCenterProfitabilityLoading;
  const automationLoading =
    balancesLoading ||
    expensesLoading ||
    vatLoading ||
    corporateTaxLoading ||
    trialBalanceLoading ||
    ledgerLoading ||
    monthEndCloseLoading ||
    auditTrailLoading ||
    consolidatedStatementsLoading ||
    payrollLoading ||
    planningLoading ||
    advancedReportsLoading;

  return {
    comparisonRows,
    visibleComparisonRows,
    reportComparisonPresetSummaries,
    visibleReportComparisonPresets,
    comparisonLoading,
    ledgerLines,
    accountActivity,
    ledgerSourceRows,
    ledgerReport,
    ledgerLoading,
    ledgerDetailPageCount,
    ledgerDetailCurrentPage,
    ledgerDetailStartIndex,
    ledgerDetailPageLines,
    auditTrailReport,
    auditTrailPeriodLabel,
    auditTrailLoading,
    monthEndChecklist,
    monthEndCompletedChecks,
    monthEndReviewChecks,
    monthEndReadinessPercent,
    monthEndCloseExportReport,
    planningReport,
    planningLoading,
    automationLoading,
  };
}

export type ReportsComparisonsAndCloseState = ReturnType<typeof useReportsComparisonsAndClose>;
