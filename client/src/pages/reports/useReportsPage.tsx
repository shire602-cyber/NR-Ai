// Reports page state: every query, derived figure and handler the panels render (W5-A, R20-09).
// The page shell provides the result through ReportsPageContext; panels read only what they use.
import {
  AccountActivityRow,
  ActivityLogReportRow,
  AdvancedPeriodComparisonRow,
  AgingReportItem,
  AuditTrailSummaryRow,
  AutomationQueueItem,
  BalanceSheetReport,
  BalanceSummaryReport,
  BankTransactionReportRow,
  BillAgingReport,
  BudgetPlanReportRow,
  CashFlowForecastReport,
  CashFlowProjection,
  CashFlowStatementRow,
  ComparisonMetricRow,
  ComparisonRange,
  ConsolidatedCompanyStatementSource,
  CorporateTaxEstimateReport,
  CostCenterProfitabilityReport,
  CustomerRevenueRow,
  ExpenseClaimReportRow,
  ExpenseClaimStatusRow,
  ExpenseClaimSummaryReport,
  ExpenseSummaryRow,
  FixedAssetReportRow,
  FixedAssetSummaryReport,
  FixedAssetValuationRow,
  FxGainsLossesReport,
  InventoryMovementReportRow,
  InventoryMovementTypeRow,
  InventoryProductReportRow,
  InvoiceReportRow,
  InvoiceStatusSummaryRow,
  JournalEntryReportRow,
  JournalLineReportRow,
  LedgerLineRow,
  LedgerSourceRow,
  MonthEndCloseStatusReport,
  OverdueCustomerRow,
  OverdueResponse,
  PayrollRunReportRow,
  PayrollStatusReportRow,
  PersonaFilter,
  ProfitLossReport,
  ReceiptReportRow,
  ReportDeliveryAutomationPreferenceResponse,
  ReportDeliveryPlanPreview,
  ReportDeliveryPlanResponse,
  ReportDeliveryRunStatusFilter,
  ReportDeliveryRunSummary,
  ReportDeliverySchedulerScanSummary,
  ReportDeliverySettingsDraft,
  ReportViewerGroup,
  ReportViewerOption,
  ReportWorkflowFinderGapFilter,
  ReportWorkflowGapFilterState,
  ReportWorkspaceTab,
  SalesProductServiceReport,
  SaveReportDeliveryAutomationPreferenceInput,
  SaveReportDeliverySubscriptionSettingsInput,
  TrialBalanceReport,
  VATReturnReportRow,
  VATSummaryReport,
  VarianceReport,
  VendorBillReportRow,
  activityLogInDateRange,
  activityLogLabel,
  activityLogRiskLevel,
  amountInAed,
  averageAvailablePercent,
  averageDaysOverdue,
  buildComparisonRanges,
  buildConsolidatedStatementsReport,
  buildDepreciationScheduleReport,
  buildReportCoverageMap,
  comparisonBadgeVariant,
  comparisonParams,
  corporateTaxEstimateStatus,
  deliveryRunStatusVariant,
  dueWithinDaysAfterRangeEnd,
  expenseClaimAmount,
  expenseClaimInDateRange,
  fixedAssetAmount,
  formatComparisonExportValue,
  formatComparisonPercent,
  formatDeliveryRunTimestamp,
  inactiveInvoiceStatuses,
  inactiveVendorBillStatuses,
  inclusiveDayCount,
  inventoryAmount,
  inventoryMovementInDateRange,
  inventoryMovementValue,
  invoiceInDateRange,
  isOverBudgetLine,
  journalAccountName,
  journalEntryInDateRange,
  journalSourceLabel,
  ledgerDetailPageSize,
  makeComparisonMetric,
  matchesReportDeliveryRunStatusFilter,
  matchesReportPersona,
  nonPayableVendorBillStatuses,
  nonRevenueInvoiceStatuses,
  normalizeMonthlyBurn,
  payrollAmount,
  payrollRunInDateRange,
  personaFilterFromSearch,
  personaFilters,
  ratioPercent,
  receiptInDateRange,
  receiptSubtotalAed,
  receiptVatAed,
  reportDeliveryAutomationCommandLabels,
  reportIdFromSearch,
  reportStatusMeta,
  reportTabFromSearch,
  reportViewerCategoryForReport,
  reportViewerCategoryLabel,
  reportViewerCategoryRank,
  reportViewerPersonaForReport,
  reportWorkflowGapFilterFromSearch,
  reportWorkflowSearchFromSearch,
  reportWorkspaceIcons,
  reportWorkspaceTabFromLocation,
  reportsWorkspaceHref,
  runwayCoverageDays,
  startOfReportMonth,
  triggerSeverityMeta,
  uniqueSorted,
  valueInDateRange,
  vendorBillInDateRange,
  vendorBillOutstandingAed,
  vendorBillPaidAed,
  vendorBillTotalAed,
} from "./shared";
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
import type { BadgeProps } from "@/components/ui/badge";
import type { Company } from "@shared/schema";
import type { DateRange } from "@/components/DateRangeFilter";
import {
  type ExportData,
  exportToExcel,
  exportToGoogleSheets,
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
  type ReportCatalogDiscovery,
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
} from "@/lib/reportCatalogApi";
import {
  type ReportCatalogItem,
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
  type ReportTab,
  type ReportWorkflowGapFilter,
  buildReportAutomationHealthTrend,
  buildReportAutomationRunbookSteps,
  calculateReportAutomationHealth,
  calculateReportAutomationImpact,
  clearPreferredReportPersona,
  clearPreferredReportWorkflowGapFilter,
  clearPreferredReportWorkflowSearch,
  getPreferredReportDeliveryAutomationCommand,
  getPreferredReportPersona,
  getPreferredReportWorkflowSearch,
  getReportAutomationHealthHistory,
  parseReportDeliveryAutomationCommand,
  parseReportWorkflowGapFilter,
  readyReportCatalog,
  recordReportAutomationHealthSnapshots,
  reportAutomationImpactProfiles,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportHref,
  reportManagementBriefHref,
  reportManagementBriefProfiles,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonaWorkspaces,
  reportProductDepthAreaHref,
  reportProductDepthAreas,
  reportProductDepthSubgoalHref,
  reportQuickAccessProfiles,
  reportRoleWorkflowStepHref,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportWorkspaceHref,
  reportsHref,
  setPreferredReportDeliveryAutomationCommand,
  setPreferredReportPersona,
  setPreferredReportWorkflowGapFilter,
  setPreferredReportWorkflowSearch,
} from "@/lib/reportCatalog";
import type { ReportLaunchDeliveryPreview } from "@/components/reports/ReportLaunchPicker";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { prepareVat201ForExport } from "@/lib/vat201-export";
import { reportCategoryAr, reportNameAr, reportQuestionAr } from "@/lib/reportCatalogI18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";

export function useReportsPage() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId, companies: accessibleCompanies = [] } = useDefaultCompany();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [ledgerDetailPage, setLedgerDetailPage] = useState(1);
  const [reportAutomationHealthHistory, setReportAutomationHealthHistory] = useState(() =>
    getReportAutomationHealthHistory()
  );
  const [editingReportDeliverySubscriptionId, setEditingReportDeliverySubscriptionId] = useState<
    string | null
  >(null);
  const [reportDeliveryRunStatusFilter, setReportDeliveryRunStatusFilter] =
    useState<ReportDeliveryRunStatusFilter>("all");
  const [acknowledgedReportDeliveryHandoffGaps, setAcknowledgedReportDeliveryHandoffGaps] =
    useState<Record<string, true>>({});
  const [pinnedReportDeliveryAutomationCommands, setPinnedReportDeliveryAutomationCommands] =
    useState<Record<ReportPersona, ReportDeliveryAutomationCommand | null>>(() => ({
      owner: getPreferredReportDeliveryAutomationCommand("owner"),
      freelancer: getPreferredReportDeliveryAutomationCommand("freelancer"),
      accountant: getPreferredReportDeliveryAutomationCommand("accountant"),
    }));
  const [reportDeliverySettingsDraft, setReportDeliverySettingsDraft] =
    useState<ReportDeliverySettingsDraft>({
      cadence: "",
      channel: "",
      format: "",
      recipients: "",
      deliveryGuardrail: "",
    });

  const locationSearch = useMemo(() => (search ? `?${search}` : ""), [search]);

  const activeTab = useMemo(
    () =>
      reportTabFromSearch(
        locationSearch || (typeof window === "undefined" ? "" : window.location.search)
      ),
    [locationSearch]
  );
  const activeReportId = useMemo(
    () =>
      reportIdFromSearch(
        locationSearch || (typeof window === "undefined" ? "" : window.location.search)
      ),
    [locationSearch]
  );
  const [activeReportWorkspaceTab, setActiveReportWorkspaceTabState] = useState<ReportWorkspaceTab>(
    () =>
      reportWorkspaceTabFromLocation(
        typeof window === "undefined" ? "" : window.location.search,
        typeof window === "undefined" ? "" : window.location.hash
      )
  );

  const [preferredReportPersona, setPreferredReportPersonaState] = useState<ReportPersona | null>(
    () => getPreferredReportPersona()
  );

  const personaFilter = useMemo(() => {
    return personaFilterFromSearch(
      locationSearch || window.location.search,
      preferredReportPersona
    );
  }, [locationSearch, preferredReportPersona]);
  const [reportWorkflowSearch, setReportWorkflowSearch] = useState(() =>
    getPreferredReportWorkflowSearch(personaFilter)
  );
  const [reportWorkflowGapFilter, setReportWorkflowGapFilter] =
    useState<ReportWorkflowGapFilterState>(() =>
      reportWorkflowGapFilterFromSearch(locationSearch || window.location.search, personaFilter)
    );
  const reportCatalogDiscoveryPersona: ReportPersona | null =
    personaFilter === "all" ? null : personaFilter;
  const reportCatalogDiscoveryQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(reportCatalogDiscoveryPersona),
    queryFn: () => fetchReportCatalogDiscovery(reportCatalogDiscoveryPersona),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const syncedReportCatalogSummary = reportCatalogDiscoveryQuery.data?.summary;
  const syncedReportPersonaSummaries = reportCatalogDiscoveryQuery.data?.personaSummaries;
  const reportActionContextByPersonaReportId = useMemo(() => {
    return new Map(
      (reportCatalogDiscoveryQuery.data?.reportActionContexts ?? []).map((context) => [
        `${context.persona}:${context.reportId}`,
        context,
      ])
    );
  }, [reportCatalogDiscoveryQuery.data?.reportActionContexts]);

  const setActiveTab = useCallback(
    (tab: ReportTab, persona: PersonaFilter = personaFilter) => {
      setActiveReportWorkspaceTabState("reports");
      navigate(reportsWorkspaceHref({ tab, persona, workspace: "reports" }));
    },
    [navigate, personaFilter]
  );

  const setReportWorkspaceTab = (tab: ReportWorkspaceTab) => {
    setActiveReportWorkspaceTabState(tab);
    navigate(
      reportsWorkspaceHref({
        tab: tab === "reports" ? activeTab : undefined,
        persona: personaFilter,
        workspace: tab,
      })
    );
  };

  const setReportPersonaFilter = (persona: PersonaFilter) => {
    if (persona === "all") {
      clearPreferredReportPersona();
      setPreferredReportPersonaState(null);
    } else {
      setPreferredReportPersona(persona);
      setPreferredReportPersonaState(persona);
    }
    navigate(
      reportsWorkspaceHref({
        tab: activeReportWorkspaceTab === "reports" ? activeTab : undefined,
        persona,
        workspace: activeReportWorkspaceTab,
      })
    );
  };

  const effectiveReportPersona: ReportPersona =
    personaFilter === "all" ? (preferredReportPersona ?? "owner") : personaFilter;
  const reportViewerOptions = useMemo(() => {
    const isAr = locale === "ar";
    const catLabel = (category: string) =>
      isAr
        ? (reportCategoryAr[category] ?? reportViewerCategoryLabel(category))
        : reportViewerCategoryLabel(category);

    const statementCenterOption: ReportViewerOption = {
      id: "financial-statements-center",
      label: isAr ? (t as any).financialStatementsCenter : "Financial Statements Center",
      description: isAr
        ? (t as any).financialStatementsCenterDesc
        : "Open the clean statement workspace for P&L, Balance Sheet, and Cash Flow.",
      category: "Financial Statements",
      categoryLabel: catLabel("Financial Statements"),
      status: "live",
      order: -1,
      href: "/financial-statements",
    };

    const catalogOptions = readyReportCatalog.map((report, index): ReportViewerOption => {
      const persona = reportViewerPersonaForReport(report, effectiveReportPersona);
      const category = reportViewerCategoryForReport(report);
      const href =
        report.href ??
        (report.tab && persona
          ? reportsWorkspaceHref({
              tab: report.tab,
              reportId: report.id,
              persona,
              workspace: "reports",
            })
          : undefined);

      return {
        id: report.id,
        reportId: report.id,
        label: isAr ? (reportNameAr[report.id] ?? report.name) : report.name,
        description: isAr
          ? (reportQuestionAr[report.id] ?? report.decisionQuestion)
          : report.decisionQuestion,
        category,
        categoryLabel: catLabel(category),
        status: report.status,
        order: index,
        tab: report.tab,
        href,
        persona,
      };
    });

    return [statementCenterOption, ...catalogOptions].sort((a, b) => {
      const categoryDelta =
        reportViewerCategoryRank(a.category) - reportViewerCategoryRank(b.category);
      if (categoryDelta !== 0) return categoryDelta;
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
  }, [effectiveReportPersona, locale, t]);
  const reportViewerOptionById = useMemo(
    () => new Map(reportViewerOptions.map((option) => [option.id, option])),
    [reportViewerOptions]
  );
  const reportViewerGroups = useMemo<ReportViewerGroup[]>(() => {
    const groups = new Map<string, ReportViewerGroup>();

    reportViewerOptions.forEach((option) => {
      const group = groups.get(option.category) ?? {
        category: option.category,
        label: option.categoryLabel,
        rank: reportViewerCategoryRank(option.category),
        options: [],
      };
      group.options.push(option);
      groups.set(option.category, group);
    });

    return Array.from(groups.values()).sort(
      (a, b) => a.rank - b.rank || a.label.localeCompare(b.label)
    );
  }, [reportViewerOptions]);
  const activeReportViewerOption =
    (activeReportId ? reportViewerOptionById.get(activeReportId) : undefined) ??
    reportViewerOptions.find(
      (option) => option.tab === activeTab && option.persona === effectiveReportPersona
    ) ??
    reportViewerOptions.find((option) => option.tab === activeTab) ??
    reportViewerOptions[0];
  const selectedReportId = activeReportViewerOption?.reportId ?? null;
  const hasFocusedReportSelection = Boolean(activeReportId && selectedReportId);
  const reportViewerTitle = hasFocusedReportSelection
    ? (activeReportViewerOption?.label ?? "Reports")
    : ((t as any).reportCenter ?? "Report Center");
  const reportViewerDescription = hasFocusedReportSelection
    ? (activeReportViewerOption?.description ?? "Review this report for the selected period.")
    : ((t as any).chooseOneReport ??
      "Choose one report from a category. Reports open one at a time with the right period, export, and review context.");
  const reportViewerMenuLabel = hasFocusedReportSelection
    ? (activeReportViewerOption?.label ?? (t as any).chooseAReport ?? "Choose a report")
    : ((t as any).chooseAReport ?? "Choose a report");
  const reportViewerMenuDescription = hasFocusedReportSelection
    ? (activeReportViewerOption?.categoryLabel ??
      (t as any).groupedByCategory ??
      "Grouped by category")
    : ((t as any).groupedByCategory ?? "Grouped by category");

  const openReportViewerOption = useCallback(
    (optionId: string) => {
      const option = reportViewerOptionById.get(optionId);
      if (!option) return;

      setActiveReportWorkspaceTabState("reports");

      if (option.href) {
        navigate(option.href);
        return;
      }

      if (option.tab) {
        navigate(
          reportsWorkspaceHref({
            tab: option.tab,
            reportId: option.reportId,
            persona: option.persona ?? effectiveReportPersona,
            workspace: "reports",
          })
        );
      }
    },
    [effectiveReportPersona, navigate, reportViewerOptionById]
  );

  const showReportSection = useCallback(
    (...reportIds: string[]) =>
      !hasFocusedReportSelection ||
      (selectedReportId !== null && reportIds.includes(selectedReportId)),
    [hasFocusedReportSelection, selectedReportId]
  );
  const reportSectionClass = useCallback(
    (reportIds: string[], className?: string) =>
      cn(className, !showReportSection(...reportIds) && "hidden"),
    [showReportSection]
  );

  useEffect(() => {
    if (activeReportWorkspaceTab !== "reports" || reportViewerOptions.length === 0) return;
    if (
      activeReportId &&
      activeReportViewerOption?.tab &&
      activeReportViewerOption.tab !== activeTab
    ) {
      navigate(
        reportsWorkspaceHref({
          tab: activeReportViewerOption.tab,
          reportId: activeReportViewerOption.reportId,
          persona: activeReportViewerOption.persona ?? effectiveReportPersona,
          workspace: "reports",
        })
      );
      return;
    }

    if (reportViewerOptions.some((option) => option.tab === activeTab)) return;
  }, [
    activeReportId,
    activeReportViewerOption,
    activeReportWorkspaceTab,
    activeTab,
    effectiveReportPersona,
    navigate,
    reportViewerOptions,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncWorkspaceTabFromLocation = () => {
      setActiveReportWorkspaceTabState(
        reportWorkspaceTabFromLocation(
          locationSearch || window.location.search,
          window.location.hash
        )
      );
    };

    syncWorkspaceTabFromLocation();
    window.addEventListener("hashchange", syncWorkspaceTabFromLocation);

    return () => {
      window.removeEventListener("hashchange", syncWorkspaceTabFromLocation);
    };
  }, [locationSearch]);

  useEffect(() => {
    setLedgerDetailPage(1);
  }, [activeReportId, dateRange.from, dateRange.to, selectedCompanyId]);

  useEffect(() => {
    const currentSearch = locationSearch || window.location.search;
    const urlWorkflowSearch = reportWorkflowSearchFromSearch(currentSearch);
    if (urlWorkflowSearch !== null) {
      setReportWorkflowSearch(urlWorkflowSearch);
      setPreferredReportWorkflowSearch(urlWorkflowSearch, personaFilter);
      return;
    }

    setReportWorkflowSearch(getPreferredReportWorkflowSearch(personaFilter));
  }, [locationSearch, personaFilter]);

  useEffect(() => {
    const currentSearch = locationSearch || window.location.search;
    const nextFilter = reportWorkflowGapFilterFromSearch(currentSearch, personaFilter);
    const urlGapFilter = parseReportWorkflowGapFilter(
      new URLSearchParams(currentSearch).get("workflowGap")
    );
    if (urlGapFilter && nextFilter.persona) {
      setPreferredReportWorkflowGapFilter(nextFilter.persona, urlGapFilter);
    }

    setReportWorkflowGapFilter((current) => {
      if (current.type === nextFilter.type && current.persona === nextFilter.persona) {
        return current;
      }

      return nextFilter;
    });
  }, [locationSearch, personaFilter]);

  const personaFilterLabel =
    personaFilters.find((filter) => filter.id === personaFilter)?.label ?? "All";
  const personaScopeDescription =
    personaFilter === "all"
      ? "Showing all role signals."
      : `Focused for ${personaFilterLabel.toLowerCase()} workflows.`;
  const normalizedReportWorkflowSearch = reportWorkflowSearch.trim().toLowerCase();
  const matchesReportWorkflowSearch = useCallback(
    (values: Array<string | number | null | undefined>) => {
      if (!normalizedReportWorkflowSearch) return true;
      return values
        .filter((value): value is string | number => value !== null && value !== undefined)
        .map((value) => String(value))
        .join(" ")
        .toLowerCase()
        .includes(normalizedReportWorkflowSearch);
    },
    [normalizedReportWorkflowSearch]
  );
  const updateReportWorkflowSearch = useCallback(
    (value: string) => {
      setReportWorkflowSearch(value);
      setPreferredReportWorkflowSearch(value, personaFilter);
    },
    [personaFilter]
  );
  const applyReportWorkflowGapFilter = useCallback(
    (type: Exclude<ReportWorkflowFinderGapFilter, "all">, persona: ReportPersona) => {
      setReportWorkflowSearch("");
      if (reportWorkflowGapFilter.type === type && reportWorkflowGapFilter.persona === persona) {
        clearPreferredReportWorkflowGapFilter(persona);
        setReportWorkflowGapFilter({ type: "all", persona: null });
        return;
      }

      setPreferredReportWorkflowGapFilter(persona, type);
      setReportWorkflowGapFilter({ type, persona });
    },
    [reportWorkflowGapFilter.persona, reportWorkflowGapFilter.type]
  );
  const resetReportWorkflowContext = useCallback(() => {
    const personasToClear = new Set<ReportPersona>();
    if (personaFilter !== "all") personasToClear.add(personaFilter);
    if (reportWorkflowGapFilter.persona) {
      personasToClear.add(reportWorkflowGapFilter.persona);
    }

    personasToClear.forEach((persona) => {
      clearPreferredReportWorkflowGapFilter(persona);
      clearPreferredReportWorkflowSearch(persona);
    });
    clearPreferredReportWorkflowSearch("all");
    clearPreferredReportPersona();
    setPreferredReportPersonaState(null);
    setReportWorkflowSearch("");
    setReportWorkflowGapFilter({ type: "all", persona: null });
    navigate(
      reportsWorkspaceHref({
        tab: activeReportWorkspaceTab === "reports" ? activeTab : undefined,
        persona: "all",
        workspace: activeReportWorkspaceTab,
      })
    );
  }, [
    activeReportWorkspaceTab,
    activeTab,
    navigate,
    personaFilter,
    reportWorkflowGapFilter.persona,
  ]);
  const reportDeliveryLauncherPersona: ReportPersona =
    personaFilter === "all" ? (preferredReportPersona ?? "owner") : personaFilter;
  const pinnedReportDeliveryAutomationCommand =
    pinnedReportDeliveryAutomationCommands[reportDeliveryLauncherPersona];
  const saveReportDeliveryAutomationPreference = useMutation({
    mutationFn: ({ persona, command }: SaveReportDeliveryAutomationPreferenceInput) => {
      if (!selectedCompanyId) throw new Error("Select a company before saving automation.");
      return apiRequest(
        "PATCH",
        `/api/companies/${selectedCompanyId}/report-delivery/preferences/${persona}`,
        { preferredDeliveryAutomationCommand: command }
      );
    },
    onError: (error: any) => {
      toast({
        title: "Could not save automation command",
        description: error?.message || "Failed to save the pinned automation command",
        variant: "destructive",
      });
    },
  });
  const pinReportDeliveryAutomationCommand = useCallback(
    (command: ReportDeliveryAutomationCommand) => {
      const parsedCommand = parseReportDeliveryAutomationCommand(command);
      if (!parsedCommand) return;

      setPreferredReportDeliveryAutomationCommand(reportDeliveryLauncherPersona, parsedCommand);
      setPinnedReportDeliveryAutomationCommands((current) => ({
        ...current,
        [reportDeliveryLauncherPersona]: parsedCommand,
      }));
      if (selectedCompanyId) {
        saveReportDeliveryAutomationPreference.mutate({
          persona: reportDeliveryLauncherPersona,
          command: parsedCommand,
        });
      }
      toast({
        title: "Automation command pinned",
        description: `${reportDeliveryAutomationCommandLabels[parsedCommand]} is pinned for ${personaFilterLabel.toLowerCase()} workflows.`,
      });
    },
    [
      personaFilterLabel,
      reportDeliveryLauncherPersona,
      saveReportDeliveryAutomationPreference,
      selectedCompanyId,
      toast,
    ]
  );
  const reportStats = useMemo(() => {
    if (syncedReportCatalogSummary) {
      return {
        live: syncedReportCatalogSummary.liveReportCount,
        ready: syncedReportCatalogSummary.readyReportCount,
        planned: syncedReportCatalogSummary.plannedReportCount,
        total: syncedReportCatalogSummary.reportCount,
        packTemplates: syncedReportCatalogSummary.packTemplateCount,
        comparisonPresets: syncedReportCatalogSummary.comparisonPresetCount,
        reportSuites: syncedReportCatalogSummary.reportSuiteCount,
        deliverySubscriptions: syncedReportCatalogSummary.deliverySubscriptionCount,
        automationStarters: syncedReportCatalogSummary.automationStarterCount,
        quickAccessProfiles: syncedReportCatalogSummary.quickAccessProfileCount,
        savedViews: syncedReportCatalogSummary.savedViewCount,
        managementBriefs: syncedReportCatalogSummary.managementBriefCount,
        automationImpactProfiles: syncedReportCatalogSummary.automationImpactProfileCount,
        workflowSteps: syncedReportCatalogSummary.workflowStepCount,
        automationPlaybooks: syncedReportCatalogSummary.automationPlaybookCount,
      };
    }

    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) => report.status !== "planned").length;
    const planned = reportCatalog.length - ready;
    return {
      live,
      ready,
      planned,
      total: reportCatalog.length,
      packTemplates: reportPackTemplates.length,
      comparisonPresets: reportComparisonPresets.length,
      reportSuites: reportSuiteProfiles.length,
      deliverySubscriptions: reportDeliverySubscriptions.length,
      automationStarters: reportAutomationStarters.length,
      quickAccessProfiles: reportQuickAccessProfiles.length,
      savedViews: reportSavedViewProfiles.length,
      managementBriefs: reportManagementBriefProfiles.length,
      automationImpactProfiles: reportAutomationImpactProfiles.length,
      workflowSteps: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.workflowSteps.length,
        0
      ),
      automationPlaybooks: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.automations.length,
        0
      ),
    };
  }, [syncedReportCatalogSummary]);

  const workspaceSummaries = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const localReadyReports = reports.filter((report) => report.status !== "planned").length;
      const syncedSummary = syncedReportPersonaSummaries?.find(
        (summary) => summary.persona === workspace.persona
      );
      const catalogReportCount = syncedSummary?.reportCount ?? reports.length;
      const readyReports = syncedSummary?.readyReportCount ?? localReadyReports;
      const plannedReports = reports.filter((report) => report.status === "planned");
      const automationCount =
        syncedSummary?.automationPlaybookCount ?? workspace.automations.length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      const setupChecklist = workspace.setupChecklist.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));

        return {
          ...step,
          reports: linkedReports,
          href: reportSectionHref(workspace, step.section),
        };
      });
      const workflowSteps = workspace.workflowSteps.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const comparisonPreset = reportComparisonPresets.find(
          (preset) => preset.id === step.comparisonPresetId
        );
        const automationStarter = reportAutomationStarters.find(
          (starter) => starter.id === step.automationStarterId
        );
        const deliverySubscription = reportDeliverySubscriptions.find(
          (subscription) => subscription.id === step.deliverySubscriptionId
        );
        const decisionShortcut = reportDecisionShortcuts.find(
          (shortcut) => shortcut.id === step.decisionShortcutId
        );
        const savedView = reportSavedViewProfiles.find((view) => view.id === step.savedViewId);
        const reportSuite = reportSuiteProfiles.find((suite) => suite.id === step.reportSuiteId);

        return {
          ...step,
          reports: linkedReports,
          href: reportRoleWorkflowStepHref(workspace, step),
          sectionHref: reportSectionHref(workspace, step.section),
          comparisonPreset,
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportSectionHref(workspace, "recommendations"),
          automationStarter,
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportSectionHref(workspace, "automation-starters"),
          deliverySubscription,
          deliveryHref: deliverySubscription
            ? reportDeliverySubscriptionHref(deliverySubscription)
            : reportSectionHref(workspace, "delivery-subscriptions"),
          decisionShortcut,
          decisionHref: decisionShortcut
            ? reportDecisionShortcutHref(decisionShortcut)
            : reportSectionHref(workspace, "decision-shortcuts"),
          savedView,
          savedViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          defaultViewLabel: savedView?.title ?? "Role saved view",
          defaultViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          handoffRecipients: deliverySubscription?.recipients ?? workspace.packSchedule.recipients,
          handoffGuardrail:
            deliverySubscription?.deliveryGuardrail ?? workspace.packSchedule.automation,
          reportSuite,
          reportSuiteHref: reportSuite
            ? reportSuiteHref(reportSuite)
            : reportSectionHref(workspace, "report-suites"),
        };
      });
      return {
        ...workspace,
        icon: reportWorkspaceIcons[workspace.icon],
        reports,
        roleSetupHref: reportSectionHref(workspace, "role-setup"),
        roleWorkflowHref: reportSectionHref(workspace, "role-workflows"),
        managementBriefsHref: reportSectionHref(workspace, "management-briefs"),
        setupChecklist,
        setupStepCount: syncedSummary?.setupStepCount ?? setupChecklist.length,
        workflowSteps,
        workflowStepCount: syncedSummary?.workflowStepCount ?? workflowSteps.length,
        catalogReportCount,
        readyReports,
        plannedReports,
        automationCount,
        decisionShortcutCount:
          syncedSummary?.decisionShortcutCount ??
          reportDecisionShortcuts.filter((shortcut) => shortcut.persona === workspace.persona)
            .length,
        automationStarterCount:
          syncedSummary?.automationStarterCount ??
          reportAutomationStarters.filter((starter) => starter.persona === workspace.persona)
            .length,
        triggerRuleCount:
          syncedSummary?.triggerRuleCount ??
          reportAutomationTriggerRules.filter((rule) => rule.persona === workspace.persona).length,
        deliverySubscriptionCount:
          syncedSummary?.deliverySubscriptionCount ??
          reportDeliverySubscriptions.filter(
            (subscription) => subscription.persona === workspace.persona
          ).length,
        packTemplateCount:
          syncedSummary?.packTemplateCount ??
          reportPackTemplates.filter((template) => template.persona === workspace.persona).length,
        comparisonPresetCount:
          syncedSummary?.comparisonPresetCount ??
          reportComparisonPresets.filter((preset) => preset.persona === workspace.persona).length,
        reportSuiteCount:
          syncedSummary?.reportSuiteCount ??
          reportSuiteProfiles.filter((suite) => suite.persona === workspace.persona).length,
        managementBriefCount:
          syncedSummary?.managementBriefCount ??
          reportManagementBriefProfiles.filter((brief) => brief.persona === workspace.persona)
            .length,
        quickAccessProfileCount:
          syncedSummary?.quickAccessProfileCount ??
          reportQuickAccessProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        savedViewCount:
          syncedSummary?.savedViewCount ??
          reportSavedViewProfiles.filter((view) => view.persona === workspace.persona).length,
        automationImpactProfileCount:
          syncedSummary?.automationImpactProfileCount ??
          reportAutomationImpactProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        topReadyReport,
        readiness: catalogReportCount ? Math.round((readyReports / catalogReportCount) * 100) : 0,
      };
    });
  }, [syncedReportPersonaSummaries]);

  const visibleWorkspaceSummaries = useMemo(() => {
    return workspaceSummaries.filter((workspace) =>
      matchesReportPersona([workspace.persona], personaFilter)
    );
  }, [personaFilter, workspaceSummaries]);

  const reportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === profile.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === profile.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === profile.deliverySubscriptionId
      );
      if (!workspace || !comparisonPreset || !automationStarter || !deliverySubscription) {
        return [];
      }

      const reports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const reportEntries = reports.map((report) => {
        const context = reportActionContextByPersonaReportId.get(`${profile.persona}:${report.id}`);
        return {
          report,
          context,
          href:
            context?.reportHref ??
            reportPersonaHref(report, profile.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: profile.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: report.name,
            }),
          comparisonHref: context?.comparisonPresets[0]?.href,
          deliveryHref: context?.deliverySubscriptions[0]?.href,
        };
      });
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...profile,
          workspace,
          reports,
          primaryReports: reportEntries.slice(0, 6),
          additionalReports: reportEntries.slice(6),
          readyCount,
          href: reportSectionHref(workspace, "quick-access"),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessSummaries.filter(
      (profile) =>
        matchesReportPersona([profile.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          profile.title,
          profile.outcome,
          profile.commandKeywords,
          profile.reports.map((report) => report.name).join(" "),
          profile.comparisonPreset.title,
          profile.automationStarter.title,
          profile.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportQuickAccessSummaries]);

  const reportSavedViewSummaries = useMemo(() => {
    return reportSavedViewProfiles.flatMap((view) => {
      const workspace = workspaceSummaries.find((item) => item.persona === view.persona);
      const report = reportCatalog.find((item) => item.id === view.reportId);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === view.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === view.automationStarterId
      );
      if (!workspace || !report || !comparisonPreset || !automationStarter) return [];
      const context = reportActionContextByPersonaReportId.get(`${view.persona}:${report.id}`);

      return [
        {
          ...view,
          workspace,
          report,
          comparisonPreset,
          automationStarter,
          href: reportSavedViewHref(view),
          reportHref:
            context?.reportHref ??
            reportPersonaHref(report, view.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: view.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: view.title,
            }),
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationHref: reportAutomationStarterHref(automationStarter),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportSavedViewSummaries = useMemo(() => {
    return reportSavedViewSummaries.filter(
      (view) =>
        matchesReportPersona([view.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          view.title,
          view.description,
          view.dateRangePreset,
          view.comparisonPeriod,
          view.basis,
          view.currency,
          view.dimension,
          view.exportFormat,
          view.automationTrigger,
          view.commandKeywords,
          view.report.name,
          view.comparisonPreset.title,
          view.automationStarter.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSavedViewSummaries]);

  const reportSuiteSummaries = useMemo(() => {
    return reportSuiteProfiles.flatMap((suite) => {
      const workspace = workspaceSummaries.find((item) => item.persona === suite.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === suite.comparisonPresetId
      );
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === suite.packTemplateId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === suite.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === suite.deliverySubscriptionId
      );
      const triggerRules = suite.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === suite.decisionShortcutId
      );
      if (
        !workspace ||
        !comparisonPreset ||
        !packTemplate ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut
      ) {
        return [];
      }

      const reports = suite.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const savedViews = suite.savedViewIds
        .map((viewId) => reportSavedViewSummaries.find((view) => view.id === viewId))
        .filter((view): view is (typeof reportSavedViewSummaries)[number] => Boolean(view));

      return [
        {
          ...suite,
          workspace,
          reports,
          readyCount: reports.filter((report) => report.status !== "planned").length,
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          triggerRules,
          triggerRuleHref: triggerRules[0]
            ? reportAutomationTriggerRuleHref(triggerRules[0])
            : null,
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedViews,
          href: reportSuiteHref(suite),
          categories: uniqueSorted(reports.map((report) => report.category)),
        },
      ];
    });
  }, [reportSavedViewSummaries, workspaceSummaries]);

  const visibleReportSuiteSummaries = useMemo(() => {
    return reportSuiteSummaries.filter(
      (suite) =>
        matchesReportPersona([suite.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          suite.title,
          suite.outcome,
          suite.workflow,
          suite.primaryAction,
          suite.commandKeywords,
          suite.reports.map((report) => report.name).join(" "),
          suite.comparisonPreset.title,
          suite.packTemplate.title,
          suite.automationStarter.title,
          suite.deliverySubscription.title,
          suite.triggerRules.map((rule) => rule.title).join(" "),
          suite.decisionShortcut.question,
          suite.savedViews.map((view) => view.title).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSuiteSummaries]);

  const reportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefProfiles.flatMap((brief) => {
      const workspace = workspaceSummaries.find((item) => item.persona === brief.persona);
      const reportSuite = reportSuiteSummaries.find((suite) => suite.id === brief.reportSuiteId);
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === brief.packTemplateId
      );
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === brief.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === brief.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === brief.deliverySubscriptionId
      );
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === brief.decisionShortcutId
      );
      const savedView = reportSavedViewProfiles.find((view) => view.id === brief.savedViewId);

      if (
        !workspace ||
        !reportSuite ||
        !packTemplate ||
        !comparisonPreset ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut ||
        !savedView
      ) {
        return [];
      }

      const reports = brief.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...brief,
          workspace,
          reports,
          readyCount,
          reportSuite,
          suiteHref: reportSuiteHref(reportSuite),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedView,
          savedViewHref: reportSavedViewHref(savedView),
          href: reportManagementBriefHref(brief),
        },
      ];
    });
  }, [reportSuiteSummaries, workspaceSummaries]);

  const visibleReportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefSummaries.filter(
      (brief) =>
        matchesReportPersona([brief.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          brief.title,
          brief.audience,
          brief.outcome,
          brief.commandKeywords,
          brief.reports.map((report) => report.name).join(" "),
          brief.kpiMetricIds.join(" "),
          brief.narrativeSections.map((section) => section.title).join(" "),
          brief.narrativeSections.map((section) => section.prompt).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.label).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.dimension).join(" "),
          brief.batchAction?.label ?? "",
          brief.reportSuite.title,
          brief.packTemplate.title,
          brief.comparisonPreset.title,
          brief.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportManagementBriefSummaries]);

  const reportPackTemplateSummaries = useMemo(() => {
    return reportPackTemplates.flatMap((template) => {
      const workspace = workspaceSummaries.find((item) => item.persona === template.persona);
      if (!workspace) return [];

      const reports = template.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...template,
          workspace,
          reports,
          readyCount,
          href: reportPackTemplateHref(template),
          categories: uniqueSorted(reports.map((report) => report.category)),
          comparisonTypes: uniqueSorted(reports.map((report) => report.comparison)),
          automationHooks: uniqueSorted(reports.map((report) => report.automation)),
        },
      ];
    });
  }, [workspaceSummaries]);

  const visibleReportPackTemplates = useMemo(() => {
    return reportPackTemplateSummaries.filter(
      (template) =>
        matchesReportPersona([template.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          template.title,
          template.audience,
          template.outcome,
          template.cadence,
          template.delivery,
          template.comparisonFocus,
          template.automationTrigger,
          template.commandKeywords,
          template.reports.map((report) => report.name).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportPackTemplateSummaries]);

  const reportDecisionShortcutSummaries = useMemo(() => {
    return reportDecisionShortcuts.flatMap((shortcut) => {
      const workspace = workspaceSummaries.find((item) => item.persona === shortcut.persona);
      const primaryReport = reportCatalog.find((report) => report.id === shortcut.primaryReportId);
      if (!workspace || !primaryReport) return [];
      const context = reportActionContextByPersonaReportId.get(
        `${shortcut.persona}:${primaryReport.id}`
      );

      const reports = shortcut.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === shortcut.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === shortcut.automationStarterId
      );

      return [
        {
          ...shortcut,
          workspace,
          primaryReport,
          reports,
          comparisonPreset,
          automationStarter,
          href: reportDecisionShortcutHref(shortcut),
          primaryReportHref:
            context?.reportHref ??
            reportPersonaHref(primaryReport, shortcut.persona) ??
            reportDecisionShortcutHref(shortcut),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: shortcut.persona,
              tab: primaryReport.tab ?? workspace.primaryTab,
              search: shortcut.question,
            }),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportDecisionShortcutHref(shortcut),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportDecisionShortcutHref(shortcut),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportDecisionShortcuts = useMemo(() => {
    return reportDecisionShortcutSummaries.filter(
      (shortcut) =>
        matchesReportPersona([shortcut.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          shortcut.question,
          shortcut.answer,
          shortcut.commandKeywords,
          shortcut.primaryReport.name,
          shortcut.reports.map((report) => report.name).join(" "),
          shortcut.comparisonPreset?.title,
          shortcut.automationStarter?.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDecisionShortcutSummaries]);

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
  const comparisonCurrentLabel = `${format(comparisonRanges.current.from, "MMM dd, yyyy")} - ${format(
    comparisonRanges.current.to,
    "MMM dd, yyyy"
  )}`;
  const comparisonPreviousLabel = `${format(
    comparisonRanges.previous.from,
    "MMM dd, yyyy"
  )} - ${format(comparisonRanges.previous.to, "MMM dd, yyyy")}`;
  const comparisonCurrentRange = comparisonRanges.current;
  const comparisonPreviousRange = comparisonRanges.previous;
  const corporateTaxPeriodStart = format(comparisonCurrentRange.from, "yyyy-MM-dd");
  const corporateTaxPeriodEnd = format(comparisonCurrentRange.to, "yyyy-MM-dd");
  const corporateTaxParams = `?periodStart=${corporateTaxPeriodStart}&periodEnd=${corporateTaxPeriodEnd}`;
  const corporateTaxPreviousPeriodStart = format(comparisonPreviousRange.from, "yyyy-MM-dd");
  const corporateTaxPreviousPeriodEnd = format(comparisonPreviousRange.to, "yyyy-MM-dd");
  const corporateTaxPreviousParams = `?periodStart=${corporateTaxPreviousPeriodStart}&periodEnd=${corporateTaxPreviousPeriodEnd}`;
  const corporateTaxPeriodLabel = `${format(comparisonCurrentRange.from, "MMM dd, yyyy")} - ${format(
    comparisonCurrentRange.to,
    "MMM dd, yyyy"
  )}`;
  const monthEndPeriodAnchor = useMemo(() => dateRange.to ?? new Date(), [dateRange.to]);
  const monthEndPeriod = format(monthEndPeriodAnchor, "yyyy-MM");
  const monthEndPeriodLabel = format(monthEndPeriodAnchor, "MMMM yyyy");
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
        metric: "Revenue",
        amount: corporateTaxEstimate?.totalRevenue ?? 0,
        note: "Posted income accounts in the selected period.",
      },
      {
        metric: "Less: expenses",
        amount: -(corporateTaxEstimate?.totalExpenses ?? 0),
        note: "Posted expense accounts in the selected period.",
      },
      {
        metric: "Gross profit",
        amount: corporateTaxEstimate?.grossProfit ?? 0,
        note: "Revenue less expenses before tax-specific deductions.",
      },
      {
        metric: "Less: deductions",
        amount: -(corporateTaxEstimate?.totalDeductions ?? 0),
        note: "Adjustable in the Corporate Tax workspace.",
      },
      {
        metric: "Taxable income",
        amount: corporateTaxEstimate?.taxableIncome ?? 0,
        note: "Income before applying the zero-rate band.",
      },
      {
        metric: "Less: zero-rate band",
        amount: -(corporateTaxEstimate?.exemptionThreshold ?? 0),
        note: "Threshold returned by the Corporate Tax calculation endpoint.",
      },
      {
        metric: "Income above zero-rate band",
        amount: corporateTaxEstimate?.taxableAmount ?? 0,
        note: "Positive income above the zero-rate band before applying the returned rate.",
      },
      {
        metric: "Corporate tax payable",
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
      enabled: shouldLoadReportData("customer-balances", "vendor-balances"),
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

  const trialBalanceSummary = useMemo(() => {
    const rows = trialBalance?.rows ?? [];
    const activeAccounts = rows.filter((row) => Math.abs(row.balance) > 0.005).length;
    const foreignCurrencyAccounts = rows.filter((row) => row.hasForeignLines).length;
    const isBalanced = (trialBalance?.totals?.difference ?? 0) < 0.005;
    return { activeAccounts, foreignCurrencyAccounts, isBalanced };
  }, [trialBalance]);

  const reportInvoices = useMemo(() => {
    return invoices.filter((invoice) => invoiceInDateRange(invoice, dateRange));
  }, [dateRange, invoices]);

  const statusSummary = useMemo<InvoiceStatusSummaryRow[]>(() => {
    const summaries = new Map<string, InvoiceStatusSummaryRow>();
    for (const invoice of reportInvoices) {
      const status = invoice.status || "unknown";
      const summary = summaries.get(status) ?? { status, count: 0, amountAed: 0 };
      summary.count += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(status, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);

  const customerRevenue = useMemo<CustomerRevenueRow[]>(() => {
    const summaries = new Map<string, CustomerRevenueRow>();
    for (const invoice of reportInvoices) {
      if (nonRevenueInvoiceStatuses.has(invoice.status)) continue;
      const customerName = invoice.customerName || "Unknown Customer";
      const summary = summaries.get(customerName) ?? {
        customerName,
        invoiceCount: 0,
        amountAed: 0,
      };
      summary.invoiceCount += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(customerName, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);

  const overdueRows = useMemo(() => overdueReport?.rows ?? [], [overdueReport?.rows]);
  const productServiceSalesRows = useMemo(
    () => salesProductServiceReport?.rows ?? [],
    [salesProductServiceReport?.rows]
  );
  const topProductServiceSalesRow = productServiceSalesRows[0];
  const productServiceTopShare = salesProductServiceReport?.totals?.topProductServiceShare ?? 0;

  const overdueCustomerRows = useMemo<OverdueCustomerRow[]>(() => {
    const summaries = new Map<string, OverdueCustomerRow>();
    for (const row of overdueRows) {
      const customerName = row.invoice.customerName || "Unknown Customer";
      const currency = row.invoice.currency || "AED";
      const key = `${customerName}::${currency}`;
      const summary = summaries.get(key) ?? {
        customerName,
        currency,
        invoiceCount: 0,
        outstanding: 0,
        maxDaysOverdue: 0,
        recommendedLevel: 1,
      };
      summary.invoiceCount += 1;
      summary.outstanding += Number(row.outstanding) || 0;
      summary.maxDaysOverdue = Math.max(summary.maxDaysOverdue, row.daysOverdue);
      summary.recommendedLevel = Math.max(summary.recommendedLevel, row.recommendedLevel);
      summaries.set(key, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [overdueRows]);

  const invoiceStatusReport = useMemo(() => {
    const activeInvoices = reportInvoices.filter(
      (invoice) => !inactiveInvoiceStatuses.has(invoice.status)
    );
    const invoiceValueAed = activeInvoices.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    const unpaidCount = activeInvoices.filter((invoice) =>
      ["sent", "posted", "partial"].includes(invoice.status)
    ).length;
    const overdueCurrencies = new Set(overdueRows.map((row) => row.invoice.currency || "AED"));
    const overdueCurrency =
      overdueCurrencies.size === 1 ? Array.from(overdueCurrencies)[0] : undefined;
    return {
      invoiceCount: reportInvoices.length,
      activeInvoiceCount: activeInvoices.length,
      unpaidCount,
      invoiceValueAed,
      overdueRows,
      overdueCustomerRows,
      overdueCurrency,
      overdueOutstanding: overdueReport?.totalOutstanding ?? 0,
      statusSummary,
      customerRevenue,
      productServiceRows: productServiceSalesRows,
      productServiceTotals: salesProductServiceReport?.totals ?? {
        productServiceCount: 0,
        invoiceCount: 0,
        lineCount: 0,
        quantity: 0,
        amountAed: 0,
        vatAed: 0,
        topProductServiceShare: 0,
      },
      invoices: reportInvoices,
    };
  }, [
    customerRevenue,
    overdueCustomerRows,
    overdueReport?.totalOutstanding,
    overdueRows,
    productServiceSalesRows,
    reportInvoices,
    salesProductServiceReport?.totals,
    statusSummary,
  ]);

  const salesLoading = invoicesLoading || overdueLoading;

  const inventoryValuationReport = useMemo(() => {
    const movementCountByProduct = new Map<string, number>();
    for (const movement of inventoryMovements) {
      movementCountByProduct.set(
        movement.productId,
        (movementCountByProduct.get(movement.productId) ?? 0) + 1
      );
    }

    const rows = inventoryProducts
      .map((product) => {
        const currentStock = Number(product.currentStock ?? 0) || 0;
        const unitCost = inventoryAmount(product.costPrice);
        const unitPrice = inventoryAmount(product.unitPrice);
        const stockValueAed = currentStock * unitCost;
        const lowStockThreshold = product.lowStockThreshold;
        return {
          ...product,
          currentStock,
          lowStockThreshold,
          unitCost,
          unitPrice,
          grossMarginAed: unitPrice - unitCost,
          stockValueAed,
          movementCount: movementCountByProduct.get(product.id) ?? 0,
          isLowStock:
            lowStockThreshold !== null &&
            lowStockThreshold !== undefined &&
            currentStock <= lowStockThreshold,
          isNegativeStock: currentStock < 0,
          isMissingCost: currentStock !== 0 && unitCost <= 0,
        };
      })
      .sort((a, b) => b.stockValueAed - a.stockValueAed || a.name.localeCompare(b.name));

    const activeRows = rows.filter((row) => row.isActive);
    const lowStockCount = activeRows.filter((row) => row.isLowStock).length;
    const negativeStockCount = activeRows.filter((row) => row.isNegativeStock).length;
    const missingCostCount = activeRows.filter((row) => row.isMissingCost).length;
    const reviewRows = activeRows.filter(
      (row) => row.isLowStock || row.isNegativeStock || row.isMissingCost
    );

    return {
      rows,
      activeRows,
      reviewRows,
      productCount: rows.length,
      activeProductCount: activeRows.length,
      totalUnits: activeRows.reduce((sum, row) => sum + row.currentStock, 0),
      totalStockValueAed: activeRows.reduce((sum, row) => sum + row.stockValueAed, 0),
      reviewValueAed: reviewRows.reduce((sum, row) => sum + Math.abs(row.stockValueAed), 0),
      lowStockCount,
      negativeStockCount,
      missingCostCount,
      movementCount: inventoryMovements.length,
      reviewCount: reviewRows.length,
    };
  }, [inventoryMovements, inventoryProducts]);

  const reportInventoryMovements = useMemo(() => {
    return inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, dateRange)
    );
  }, [dateRange, inventoryMovements]);

  const inventoryMovementReport = useMemo(() => {
    const productById = new Map(inventoryProducts.map((product) => [product.id, product]));
    const typeRows = new Map<string, InventoryMovementTypeRow>();
    const rows = reportInventoryMovements
      .map((movement) => {
        const product = productById.get(movement.productId);
        const quantity = Number(movement.quantity ?? 0) || 0;
        const unitCost = inventoryAmount(movement.unitCost);
        const valueAed = Math.abs(quantity) * unitCost;
        const type = movement.type || "adjustment";
        const typeSummary = typeRows.get(type) ?? { type, count: 0, quantity: 0, valueAed: 0 };
        typeSummary.count += 1;
        typeSummary.quantity += Math.abs(quantity);
        typeSummary.valueAed += valueAed;
        typeRows.set(type, typeSummary);
        return {
          ...movement,
          type,
          quantity,
          unitCost,
          valueAed,
          productName: product?.name ?? "Unknown product",
          sku: product?.sku ?? "",
          unit: product?.unit ?? "",
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime || a.productName.localeCompare(b.productName);
      });
    const inboundTypes = new Set(["purchase", "return"]);
    const outboundTypes = new Set(["sale"]);
    const inboundUnits = rows
      .filter((row) => inboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const outboundUnits = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const adjustmentUnits = rows
      .filter((row) => row.type === "adjustment")
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const totalMovementValueAed = rows.reduce((sum, row) => sum + row.valueAed, 0);
    const outboundValueAed = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + row.valueAed, 0);

    return {
      rows,
      typeRows: Array.from(typeRows.values()).sort(
        (a, b) => b.valueAed - a.valueAed || a.type.localeCompare(b.type)
      ),
      movementCount: rows.length,
      inboundUnits,
      outboundUnits,
      adjustmentUnits,
      totalMovementValueAed,
      outboundValueAed,
      productCount: new Set(rows.map((row) => row.productId)).size,
      reorderSignalCount:
        inventoryValuationReport.lowStockCount + inventoryValuationReport.negativeStockCount,
    };
  }, [
    inventoryProducts,
    inventoryValuationReport.lowStockCount,
    inventoryValuationReport.negativeStockCount,
    reportInventoryMovements,
  ]);

  const fixedAssetRegisterReport = useMemo(() => {
    const rows: FixedAssetValuationRow[] = fixedAssets
      .map((asset) => ({
        ...asset,
        purchaseCost: fixedAssetAmount(asset.purchase_cost),
        salvageValue: fixedAssetAmount(asset.salvage_value),
        accumulatedDepreciation: fixedAssetAmount(asset.accumulated_depreciation),
        netBookValue: fixedAssetAmount(asset.net_book_value),
      }))
      .sort((a, b) => b.netBookValue - a.netBookValue || a.asset_name.localeCompare(b.asset_name));
    const activeRows = rows.filter((asset) => asset.status === "active");
    const capitalizationReviewRows = activeRows.filter((asset) => asset.needs_capitalization_je);
    const depreciationReviewRows = activeRows.filter(
      (asset) =>
        asset.category !== "Land" &&
        Number(asset.useful_life_years ?? 0) > 0 &&
        asset.netBookValue > asset.salvageValue + 0.005
    );
    const reviewRows = activeRows.filter(
      (asset) =>
        asset.needs_capitalization_je ||
        (asset.category !== "Land" &&
          Number(asset.useful_life_years ?? 0) > 0 &&
          asset.netBookValue > asset.salvageValue + 0.005)
    );

    return {
      rows,
      activeRows,
      reviewRows,
      byCategory: fixedAssetSummary?.byCategory ?? [],
      totalAssets: fixedAssetSummary?.totalAssets ?? activeRows.length,
      totalCost:
        fixedAssetSummary?.totalCost ??
        activeRows.reduce((sum, asset) => sum + asset.purchaseCost, 0),
      totalAccumulatedDepreciation:
        fixedAssetSummary?.totalAccumulatedDepreciation ??
        activeRows.reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0),
      totalNetBookValue:
        fixedAssetSummary?.totalNetBookValue ??
        activeRows.reduce((sum, asset) => sum + asset.netBookValue, 0),
      disposedAssetCount: rows.filter((asset) => asset.status !== "active").length,
      capitalizationReviewCount: capitalizationReviewRows.length,
      depreciationReviewCount: depreciationReviewRows.length,
      reviewValueAed: reviewRows.reduce((sum, asset) => sum + Math.max(0, asset.netBookValue), 0),
      reviewCount: reviewRows.length,
    };
  }, [fixedAssetSummary, fixedAssets]);

  const depreciationScheduleReport = useMemo(
    () =>
      buildDepreciationScheduleReport(fixedAssetRegisterReport.activeRows, depreciationPeriodDate),
    [depreciationPeriodDate, fixedAssetRegisterReport.activeRows]
  );

  const balanceReport = useMemo(() => {
    const customers = balanceSummaries?.customers ?? [];
    const vendors = balanceSummaries?.vendors ?? [];
    const customerOpenAed = customers.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const customerOverdueAed = customers.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    const vendorOpenAed = vendors.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const vendorOverdueAed = vendors.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    return {
      generatedAt: balanceSummaries?.generatedAt,
      customers,
      vendors,
      customerCount: customers.length,
      vendorCount: vendors.length,
      customerOpenAed,
      customerOverdueAed,
      vendorOpenAed,
      vendorOverdueAed,
      netBalanceAed: customerOpenAed - vendorOpenAed,
      overdueCustomerCount: customers.filter((row) => row.overdueBalanceAed > 0).length,
      overdueVendorCount: vendors.filter((row) => row.overdueBalanceAed > 0).length,
      inventory: {
        ...inventoryValuationReport,
        movementCount: inventoryMovementReport.movementCount,
        movementRows: inventoryMovementReport.rows,
        movementTypeRows: inventoryMovementReport.typeRows,
        productMovementCount: inventoryMovementReport.productCount,
        movementInboundUnits: inventoryMovementReport.inboundUnits,
        movementOutboundUnits: inventoryMovementReport.outboundUnits,
        movementAdjustmentUnits: inventoryMovementReport.adjustmentUnits,
        totalMovementValueAed: inventoryMovementReport.totalMovementValueAed,
        outboundMovementValueAed: inventoryMovementReport.outboundValueAed,
      },
      fixedAssets: {
        ...fixedAssetRegisterReport,
        depreciation: depreciationScheduleReport,
      },
    };
  }, [
    balanceSummaries,
    depreciationScheduleReport,
    fixedAssetRegisterReport,
    inventoryMovementReport,
    inventoryValuationReport,
  ]);

  const receivableAgingRows = useMemo(
    () =>
      agingReport
        .filter((row) => row.type === "receivable")
        .slice()
        .sort((a, b) => b.total - a.total),
    [agingReport]
  );

  const receivableAgingSummary = useMemo(
    () => ({
      current: receivableAgingRows.reduce((sum, row) => sum + row.current, 0),
      overdue: receivableAgingRows.reduce(
        (sum, row) => sum + row.days30 + row.days60 + row.days90 + row.over90,
        0
      ),
      over90: receivableAgingRows.reduce((sum, row) => sum + row.over90, 0),
      total: receivableAgingRows.reduce((sum, row) => sum + row.total, 0),
    }),
    [receivableAgingRows]
  );

  const payableAgingBuckets = useMemo(
    () => [
      {
        label: "Current",
        count: billAgingReport?.current?.count ?? 0,
        amount: billAgingReport?.current?.amount ?? 0,
      },
      {
        label: "1-30",
        count: billAgingReport?.days_1_30?.count ?? 0,
        amount: billAgingReport?.days_1_30?.amount ?? 0,
      },
      {
        label: "31-60",
        count: billAgingReport?.days_31_60?.count ?? 0,
        amount: billAgingReport?.days_31_60?.amount ?? 0,
      },
      {
        label: "61-90",
        count: billAgingReport?.days_61_90?.count ?? 0,
        amount: billAgingReport?.days_61_90?.amount ?? 0,
      },
      {
        label: "90+",
        count: billAgingReport?.days_90_plus?.count ?? 0,
        amount: billAgingReport?.days_90_plus?.amount ?? 0,
      },
    ],
    [billAgingReport]
  );

  const payableAgingSummary = useMemo(() => {
    const overdueBuckets = payableAgingBuckets.slice(1);
    return {
      current: payableAgingBuckets[0]?.amount ?? 0,
      overdue: overdueBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      over90: payableAgingBuckets[4]?.amount ?? 0,
      total: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      billCount: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
    };
  }, [payableAgingBuckets]);

  const agingExportSheets = useMemo(
    () => prepareAgingReportsForExport({ receivables: agingReport, payables: billAgingReport }),
    [agingReport, billAgingReport]
  );
  const receivableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/R Aging"),
    [agingExportSheets]
  );
  const payableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/P Aging"),
    [agingExportSheets]
  );

  const consolidatedStatementsReport = useMemo(
    () =>
      buildConsolidatedStatementsReport(
        consolidatedStatementSources,
        dateRange.from && dateRange.to
          ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
          : "All posted activity",
        "AED"
      ),
    [consolidatedStatementSources, dateRange.from, dateRange.to]
  );

  const reportReceipts = useMemo(() => {
    return receipts.filter((receipt) => receiptInDateRange(receipt, dateRange));
  }, [dateRange, receipts]);

  const receiptVendorById = useMemo(() => {
    return new Map(
      receipts.map((receipt) => [receipt.id, receipt.merchant || "Unknown receipt vendor"])
    );
  }, [receipts]);

  const vendorBillVendorById = useMemo(() => {
    return new Map(vendorBills.map((bill) => [bill.id, bill.vendor_name || "Unknown bill vendor"]));
  }, [vendorBills]);

  const reportExpenseJournalEntries = useMemo(() => {
    return journalEntries.filter(
      (entry) => entry.status === "posted" && journalEntryInDateRange(entry, dateRange)
    );
  }, [dateRange, journalEntries]);

  const expenseVendorLabel = useCallback(
    (entry: JournalEntryReportRow) => {
      const source = (entry.source || "").toLowerCase();
      if (source === "bill" && entry.sourceId) {
        return vendorBillVendorById.get(entry.sourceId) ?? "Unknown bill vendor";
      }
      if (source === "receipt" && entry.sourceId) {
        return receiptVendorById.get(entry.sourceId) ?? "Unknown receipt vendor";
      }
      return "Manual / no vendor";
    },
    [receiptVendorById, vendorBillVendorById]
  );

  const buildExpenseSummary = useCallback(
    (getLabel: (entry: JournalEntryReportRow, line: JournalLineReportRow) => string) => {
      const summaries = new Map<string, ExpenseSummaryRow & { entryIds: Set<string> }>();
      for (const entry of reportExpenseJournalEntries) {
        for (const line of entry.lines ?? []) {
          if (line.account?.type !== "expense") continue;
          const debitAed = Number(line.debit) || 0;
          const creditAed = Number(line.credit) || 0;
          if (Math.abs(debitAed) < 0.005 && Math.abs(creditAed) < 0.005) continue;
          const label = getLabel(entry, line);
          const summary = summaries.get(label) ?? {
            label,
            entryCount: 0,
            lineCount: 0,
            debitAed: 0,
            creditAed: 0,
            netExpenseAed: 0,
            entryIds: new Set<string>(),
          };
          summary.entryIds.add(entry.id);
          summary.lineCount += 1;
          summary.debitAed += debitAed;
          summary.creditAed += creditAed;
          summary.netExpenseAed += debitAed - creditAed;
          summaries.set(label, summary);
        }
      }
      return Array.from(summaries.values())
        .map(({ entryIds, ...summary }) => ({
          ...summary,
          entryCount: entryIds.size,
        }))
        .sort((a, b) => Math.abs(b.netExpenseAed) - Math.abs(a.netExpenseAed));
    },
    [reportExpenseJournalEntries]
  );

  const expenseByVendor = useMemo(
    () => buildExpenseSummary((entry) => expenseVendorLabel(entry)),
    [buildExpenseSummary, expenseVendorLabel]
  );

  const expenseByCategory = useMemo(
    () => buildExpenseSummary((_entry, line) => journalAccountName(line.account)),
    [buildExpenseSummary]
  );

  const reportExpenseClaims = useMemo(() => {
    return expenseClaims.filter((claim) => expenseClaimInDateRange(claim, dateRange));
  }, [dateRange, expenseClaims]);

  const expenseClaimReport = useMemo(() => {
    const statusRows = new Map<string, ExpenseClaimStatusRow>();
    for (const claim of reportExpenseClaims) {
      const status = claim.status || "draft";
      const summary = statusRows.get(status) ?? { status, count: 0, totalAmount: 0 };
      summary.count += 1;
      summary.totalAmount += expenseClaimAmount(claim);
      statusRows.set(status, summary);
    }
    const claimStatusRows = Array.from(statusRows.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount || a.status.localeCompare(b.status)
    );
    const submittedClaims = reportExpenseClaims.filter((claim) => claim.status === "submitted");
    const approvedClaims = reportExpenseClaims.filter((claim) => claim.status === "approved");
    const paidClaims = reportExpenseClaims.filter((claim) => claim.status === "paid");
    const totalAmount = reportExpenseClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const submittedAmount = submittedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const approvedAmount = approvedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const thisMonthTotal = Object.values(expenseClaimSummary?.thisMonth ?? {}).reduce(
      (sum, bucket) => sum + Number(bucket.total ?? 0),
      0
    );

    return {
      claims: reportExpenseClaims,
      statusRows: claimStatusRows,
      claimCount: reportExpenseClaims.length,
      totalAmount,
      submittedCount: submittedClaims.length,
      submittedAmount,
      approvedUnpaidCount: approvedClaims.length,
      approvedUnpaidAmount: approvedAmount,
      paidCount: paidClaims.length,
      thisMonthTotal,
      reviewCount: submittedClaims.length + approvedClaims.length,
      summary: expenseClaimSummary ?? { all: {}, thisMonth: {} },
    };
  }, [expenseClaimSummary, reportExpenseClaims]);

  const expenseReport = useMemo(() => {
    const capturedReceiptSubtotalAed = reportReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt),
      0
    );
    const capturedReceiptVatAed = reportReceipts.reduce(
      (sum, receipt) => sum + receiptVatAed(receipt),
      0
    );
    const unpostedReceipts = reportReceipts.filter((receipt) => !receipt.posted).length;
    const autoPostedReceipts = reportReceipts.filter((receipt) => receipt.autoPosted).length;
    const debitAed = expenseByCategory.reduce((sum, row) => sum + row.debitAed, 0);
    const creditAed = expenseByCategory.reduce((sum, row) => sum + row.creditAed, 0);
    const totalAed = expenseByCategory.reduce((sum, row) => sum + row.netExpenseAed, 0);
    const expenseEntryIds = new Set<string>();
    for (const entry of reportExpenseJournalEntries) {
      if ((entry.lines ?? []).some((line) => line.account?.type === "expense")) {
        expenseEntryIds.add(entry.id);
      }
    }
    const expenseLines = reportExpenseJournalEntries
      .flatMap((entry) =>
        (entry.lines ?? [])
          .filter((line) => line.account?.type === "expense")
          .map((line) => {
            const debitAed = Number(line.debit) || 0;
            const creditAed = Number(line.credit) || 0;
            return {
              id: line.id,
              date: entry.date,
              entryNumber: entry.entryNumber,
              vendor: expenseVendorLabel(entry),
              accountName: journalAccountName(line.account),
              accountCode: line.account?.code || "",
              source: journalSourceLabel(entry.source),
              memo: line.memo || entry.memo || "",
              debitAed,
              creditAed,
              netExpenseAed: debitAed - creditAed,
            };
          })
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      basis:
        "Posted journal lines where the linked chart-of-account type is expense. Input VAT and unposted receipts are shown separately as source-workflow context.",
      entryCount: expenseEntryIds.size,
      lineCount: expenseByCategory.reduce((sum, row) => sum + row.lineCount, 0),
      receiptCount: reportReceipts.length,
      subtotalAed: debitAed,
      vatAed: capturedReceiptVatAed,
      totalAed,
      debitAed,
      creditAed,
      receiptSpendAed: capturedReceiptSubtotalAed + capturedReceiptVatAed,
      unpostedReceipts,
      autoPostedReceipts,
      byVendor: expenseByVendor,
      byCategory: expenseByCategory,
      lines: expenseLines,
      receipts: reportReceipts,
      claims: expenseClaimReport,
    };
  }, [
    expenseByCategory,
    expenseByVendor,
    expenseVendorLabel,
    expenseClaimReport,
    reportExpenseJournalEntries,
    reportReceipts,
  ]);

  const expensesLoading =
    receiptsLoading || expenseClaimsLoading || expenseClaimSummaryLoading || journalLoading;

  const reportPayrollRuns = useMemo(() => {
    return payrollRuns.filter((run) => payrollRunInDateRange(run, dateRange));
  }, [dateRange, payrollRuns]);

  const payrollReport = useMemo(() => {
    const statusRows = new Map<string, PayrollStatusReportRow>();
    for (const run of reportPayrollRuns) {
      const status = run.status || "draft";
      const summary = statusRows.get(status) ?? {
        status,
        count: 0,
        employeeCount: 0,
        totalNet: 0,
      };
      summary.count += 1;
      summary.employeeCount += Number(run.employee_count ?? 0);
      summary.totalNet += payrollAmount(run.total_net);
      statusRows.set(status, summary);
    }

    const calculatedRuns = reportPayrollRuns.filter((run) => run.status === "calculated");
    const approvedRuns = reportPayrollRuns.filter((run) => run.status === "approved");
    const draftRuns = reportPayrollRuns.filter((run) => run.status === "draft");
    const sifEligibleRuns = reportPayrollRuns.filter(
      (run) => run.status === "calculated" || run.status === "approved"
    );
    const sifGeneratedRuns = reportPayrollRuns.filter((run) => Boolean(run.sif_file_content));
    const wpsMissingRuns = sifEligibleRuns.filter((run) => !run.sif_file_content);
    const latestRun = [...reportPayrollRuns].sort(
      (a, b) =>
        b.period_year - a.period_year ||
        b.period_month - a.period_month ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    return {
      runs: reportPayrollRuns,
      statusRows: Array.from(statusRows.values()).sort(
        (a, b) => b.totalNet - a.totalNet || a.status.localeCompare(b.status)
      ),
      runCount: reportPayrollRuns.length,
      employeeCount: reportPayrollRuns.reduce(
        (sum, run) => sum + Number(run.employee_count ?? 0),
        0
      ),
      totalBasic: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_basic), 0),
      totalAllowances: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_allowances),
        0
      ),
      totalDeductions: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_deductions),
        0
      ),
      totalNet: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_net), 0),
      approvedCount: approvedRuns.length,
      calculatedCount: calculatedRuns.length,
      draftCount: draftRuns.length,
      approvalQueueCount: calculatedRuns.length,
      sifGeneratedCount: sifGeneratedRuns.length,
      wpsReadyCount: approvedRuns.filter((run) => Boolean(run.sif_file_content)).length,
      wpsMissingCount: wpsMissingRuns.length,
      latestRun,
    };
  }, [reportPayrollRuns]);

  const payrollLoading = payrollRunsLoading;

  const comparisonRows = useMemo<ComparisonMetricRow[]>(() => {
    const currentInvoices = invoices.filter(
      (invoice) =>
        !inactiveInvoiceStatuses.has(invoice.status) &&
        invoiceInDateRange(invoice, comparisonCurrentRange)
    );
    const previousInvoices = invoices.filter(
      (invoice) =>
        !inactiveInvoiceStatuses.has(invoice.status) &&
        invoiceInDateRange(invoice, comparisonPreviousRange)
    );
    const currentVendorBillDocuments = vendorBills.filter(
      (bill) =>
        !nonPayableVendorBillStatuses.has(bill.status) &&
        vendorBillInDateRange(bill, comparisonCurrentRange)
    );
    const previousVendorBillDocuments = vendorBills.filter(
      (bill) =>
        !nonPayableVendorBillStatuses.has(bill.status) &&
        vendorBillInDateRange(bill, comparisonPreviousRange)
    );
    const currentVendorBills = currentVendorBillDocuments.filter(
      (bill) => !inactiveVendorBillStatuses.has(bill.status)
    );
    const previousVendorBills = previousVendorBillDocuments.filter(
      (bill) => !inactiveVendorBillStatuses.has(bill.status)
    );
    const currentReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonCurrentRange)
    );
    const previousReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonPreviousRange)
    );
    const currentBankTransactions = bankTransactions.filter((transaction) =>
      valueInDateRange(transaction.transactionDate, comparisonCurrentRange)
    );
    const previousBankTransactions = bankTransactions.filter((transaction) =>
      valueInDateRange(transaction.transactionDate, comparisonPreviousRange)
    );
    const currentExpenseClaims = expenseClaims.filter((claim) =>
      expenseClaimInDateRange(claim, comparisonCurrentRange)
    );
    const previousExpenseClaims = expenseClaims.filter((claim) =>
      expenseClaimInDateRange(claim, comparisonPreviousRange)
    );
    const currentPayrollRuns = payrollRuns.filter((run) =>
      payrollRunInDateRange(run, comparisonCurrentRange)
    );
    const previousPayrollRuns = payrollRuns.filter((run) =>
      payrollRunInDateRange(run, comparisonPreviousRange)
    );
    const currentInventoryMovements = inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, comparisonCurrentRange)
    );
    const previousInventoryMovements = inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, comparisonPreviousRange)
    );
    const currentActivityLogs = activityLogs.filter((log) =>
      activityLogInDateRange(log, comparisonCurrentRange)
    );
    const previousActivityLogs = activityLogs.filter((log) =>
      activityLogInDateRange(log, comparisonPreviousRange)
    );
    const currentDepreciationEstimate = buildDepreciationScheduleReport(
      fixedAssetRegisterReport.activeRows,
      comparisonCurrentRange.to
    ).periodDepreciationAed;
    const previousDepreciationEstimate = buildDepreciationScheduleReport(
      fixedAssetRegisterReport.activeRows,
      comparisonPreviousRange.to
    ).periodDepreciationAed;
    const currentInvoiceValue = currentInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousInvoiceValue = previousInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const revenueInvoiceRows = (rows: InvoiceReportRow[]) =>
      rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
    const currentRevenueInvoices = revenueInvoiceRows(currentInvoices);
    const previousRevenueInvoices = revenueInvoiceRows(previousInvoices);
    const currentRevenueInvoiceValue = currentRevenueInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousRevenueInvoiceValue = previousRevenueInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const openReceivableRows = (rows: InvoiceReportRow[]) =>
      rows.filter(
        (invoice) => !nonRevenueInvoiceStatuses.has(invoice.status) && invoice.status !== "paid"
      );
    const currentOpenReceivableInvoices = openReceivableRows(currentInvoices);
    const previousOpenReceivableInvoices = openReceivableRows(previousInvoices);
    const currentOpenReceivableValue = currentOpenReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousOpenReceivableValue = previousOpenReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentOpenInvoiceValueShare = ratioPercent(
      currentOpenReceivableValue,
      currentRevenueInvoiceValue
    );
    const previousOpenInvoiceValueShare = ratioPercent(
      previousOpenReceivableValue,
      previousRevenueInvoiceValue
    );
    const currentAverageOpenInvoiceValue =
      currentOpenReceivableInvoices.length > 0
        ? Math.round((currentOpenReceivableValue / currentOpenReceivableInvoices.length) * 100) /
          100
        : 0;
    const previousAverageOpenInvoiceValue =
      previousOpenReceivableInvoices.length > 0
        ? Math.round((previousOpenReceivableValue / previousOpenReceivableInvoices.length) * 100) /
          100
        : 0;
    const currentOpenInvoiceShare = ratioPercent(
      currentOpenReceivableInvoices.length,
      currentRevenueInvoices.length
    );
    const previousOpenInvoiceShare = ratioPercent(
      previousOpenReceivableInvoices.length,
      previousRevenueInvoices.length
    );
    const currentDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
      currentOpenReceivableInvoices,
      (invoice) => invoice.dueDate,
      comparisonCurrentRange
    );
    const previousDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
      previousOpenReceivableInvoices,
      (invoice) => invoice.dueDate,
      comparisonPreviousRange
    );
    const currentDueSoonReceivableValue = currentDueSoonReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousDueSoonReceivableValue = previousDueSoonReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentAverageDueSoonInvoiceValue =
      currentDueSoonReceivableInvoices.length > 0
        ? Math.round(
            (currentDueSoonReceivableValue / currentDueSoonReceivableInvoices.length) * 100
          ) / 100
        : 0;
    const previousAverageDueSoonInvoiceValue =
      previousDueSoonReceivableInvoices.length > 0
        ? Math.round(
            (previousDueSoonReceivableValue / previousDueSoonReceivableInvoices.length) * 100
          ) / 100
        : 0;
    const currentDueSoonInvoiceShare = ratioPercent(
      currentDueSoonReceivableInvoices.length,
      currentOpenReceivableInvoices.length
    );
    const previousDueSoonInvoiceShare = ratioPercent(
      previousDueSoonReceivableInvoices.length,
      previousOpenReceivableInvoices.length
    );
    const isDueByRangeEnd = (invoice: InvoiceReportRow, range: ComparisonRange) => {
      if (!invoice.dueDate) return false;
      const dueDate = new Date(invoice.dueDate);
      if (Number.isNaN(dueDate.getTime())) return false;
      const rangeEnd = new Date(range.to);
      rangeEnd.setHours(23, 59, 59, 999);
      return dueDate <= rangeEnd;
    };
    const overdueReceivableRows = (rows: InvoiceReportRow[], range: ComparisonRange) =>
      rows.filter(
        (invoice) =>
          !nonRevenueInvoiceStatuses.has(invoice.status) &&
          invoice.status !== "paid" &&
          isDueByRangeEnd(invoice, range)
      );
    const currentOverdueReceivables = overdueReceivableRows(
      currentInvoices,
      comparisonCurrentRange
    );
    const previousOverdueReceivables = overdueReceivableRows(
      previousInvoices,
      comparisonPreviousRange
    );
    const currentOverdueReceivableValue = currentOverdueReceivables.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousOverdueReceivableValue = previousOverdueReceivables.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentOverdueInvoiceCount = currentOverdueReceivables.length;
    const previousOverdueInvoiceCount = previousOverdueReceivables.length;
    const currentAverageOverdueInvoiceDays = averageDaysOverdue(
      currentOverdueReceivables,
      (invoice) => invoice.dueDate,
      comparisonCurrentRange
    );
    const previousAverageOverdueInvoiceDays = averageDaysOverdue(
      previousOverdueReceivables,
      (invoice) => invoice.dueDate,
      comparisonPreviousRange
    );
    const currentAverageOverdueInvoiceValue =
      currentOverdueInvoiceCount > 0
        ? Math.round((currentOverdueReceivableValue / currentOverdueInvoiceCount) * 100) / 100
        : 0;
    const previousAverageOverdueInvoiceValue =
      previousOverdueInvoiceCount > 0
        ? Math.round((previousOverdueReceivableValue / previousOverdueInvoiceCount) * 100) / 100
        : 0;
    const currentOverdueReceivableShare = ratioPercent(
      currentOverdueReceivableValue,
      currentOpenReceivableValue
    );
    const previousOverdueReceivableShare = ratioPercent(
      previousOverdueReceivableValue,
      previousOpenReceivableValue
    );
    const currentOverdueInvoiceShare = ratioPercent(
      currentOverdueInvoiceCount,
      currentOpenReceivableInvoices.length
    );
    const previousOverdueInvoiceShare = ratioPercent(
      previousOverdueInvoiceCount,
      previousOpenReceivableInvoices.length
    );
    const paidInvoiceShare = (rows: InvoiceReportRow[]) => {
      const revenueRows = revenueInvoiceRows(rows);
      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      if (total <= 0.005) return 0;

      const paidTotal = revenueRows
        .filter((invoice) => invoice.status === "paid")
        .reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      return Math.round((paidTotal / total) * 10000) / 100;
    };
    const currentPaidInvoiceShare = paidInvoiceShare(currentInvoices);
    const previousPaidInvoiceShare = paidInvoiceShare(previousInvoices);
    const averageInvoiceValue = (rows: InvoiceReportRow[]) => {
      const revenueRows = revenueInvoiceRows(rows);
      if (revenueRows.length === 0) return 0;

      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      return Math.round((total / revenueRows.length) * 100) / 100;
    };
    const currentAverageInvoiceValue = averageInvoiceValue(currentInvoices);
    const previousAverageInvoiceValue = averageInvoiceValue(previousInvoices);
    const currentOpenPayableValue = currentVendorBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousOpenPayableValue = previousVendorBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentOpenCashGap = currentOpenPayableValue - currentOpenReceivableValue;
    const previousOpenCashGap = previousOpenPayableValue - previousOpenReceivableValue;
    const currentOpenCashCoverage = ratioPercent(
      currentOpenReceivableValue,
      currentOpenPayableValue
    );
    const previousOpenCashCoverage = ratioPercent(
      previousOpenReceivableValue,
      previousOpenPayableValue
    );
    const currentOpenWorkloadGap = currentVendorBills.length - currentOpenReceivableInvoices.length;
    const previousOpenWorkloadGap =
      previousVendorBills.length - previousOpenReceivableInvoices.length;
    const currentAverageOpenBillValue =
      currentVendorBills.length > 0
        ? Math.round((currentOpenPayableValue / currentVendorBills.length) * 100) / 100
        : 0;
    const previousAverageOpenBillValue =
      previousVendorBills.length > 0
        ? Math.round((previousOpenPayableValue / previousVendorBills.length) * 100) / 100
        : 0;
    const currentOpenBillShare = ratioPercent(
      currentVendorBills.length,
      currentVendorBillDocuments.length
    );
    const previousOpenBillShare = ratioPercent(
      previousVendorBills.length,
      previousVendorBillDocuments.length
    );
    const currentDueSoonBills = dueWithinDaysAfterRangeEnd(
      currentVendorBills,
      (bill) => bill.due_date,
      comparisonCurrentRange
    );
    const previousDueSoonBills = dueWithinDaysAfterRangeEnd(
      previousVendorBills,
      (bill) => bill.due_date,
      comparisonPreviousRange
    );
    const currentDueSoonBillValue = currentDueSoonBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousDueSoonBillValue = previousDueSoonBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentAverageDueSoonBillValue =
      currentDueSoonBills.length > 0
        ? Math.round((currentDueSoonBillValue / currentDueSoonBills.length) * 100) / 100
        : 0;
    const previousAverageDueSoonBillValue =
      previousDueSoonBills.length > 0
        ? Math.round((previousDueSoonBillValue / previousDueSoonBills.length) * 100) / 100
        : 0;
    const currentDueSoonBillShare = ratioPercent(
      currentDueSoonBills.length,
      currentVendorBills.length
    );
    const previousDueSoonBillShare = ratioPercent(
      previousDueSoonBills.length,
      previousVendorBills.length
    );
    const currentDueSoonCashGap = currentDueSoonBillValue - currentDueSoonReceivableValue;
    const previousDueSoonCashGap = previousDueSoonBillValue - previousDueSoonReceivableValue;
    const currentDueSoonCashCoverage = ratioPercent(
      currentDueSoonReceivableValue,
      currentDueSoonBillValue
    );
    const previousDueSoonCashCoverage = ratioPercent(
      previousDueSoonReceivableValue,
      previousDueSoonBillValue
    );
    const currentDueSoonWorkloadGap =
      currentDueSoonBills.length - currentDueSoonReceivableInvoices.length;
    const previousDueSoonWorkloadGap =
      previousDueSoonBills.length - previousDueSoonReceivableInvoices.length;
    const isBillDueByRangeEnd = (bill: VendorBillReportRow, range: ComparisonRange) => {
      if (!bill.due_date) return false;
      const dueDate = new Date(bill.due_date);
      if (Number.isNaN(dueDate.getTime())) return false;
      const rangeEnd = new Date(range.to);
      rangeEnd.setHours(23, 59, 59, 999);
      return dueDate <= rangeEnd;
    };
    const overduePayableRows = (rows: VendorBillReportRow[], range: ComparisonRange) =>
      rows.filter((bill) => isBillDueByRangeEnd(bill, range));
    const currentOverduePayables = overduePayableRows(currentVendorBills, comparisonCurrentRange);
    const previousOverduePayables = overduePayableRows(
      previousVendorBills,
      comparisonPreviousRange
    );
    const currentOverduePayableValue = currentOverduePayables.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousOverduePayableValue = previousOverduePayables.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentOverdueCashGap = currentOverduePayableValue - currentOverdueReceivableValue;
    const previousOverdueCashGap = previousOverduePayableValue - previousOverdueReceivableValue;
    const currentOverdueCashCoverage = ratioPercent(
      currentOverdueReceivableValue,
      currentOverduePayableValue
    );
    const previousOverdueCashCoverage = ratioPercent(
      previousOverdueReceivableValue,
      previousOverduePayableValue
    );
    const currentOverdueBillCount = currentOverduePayables.length;
    const previousOverdueBillCount = previousOverduePayables.length;
    const currentOverdueWorkloadGap = currentOverdueBillCount - currentOverdueInvoiceCount;
    const previousOverdueWorkloadGap = previousOverdueBillCount - previousOverdueInvoiceCount;
    const currentAverageOverdueBillDays = averageDaysOverdue(
      currentOverduePayables,
      (bill) => bill.due_date,
      comparisonCurrentRange
    );
    const previousAverageOverdueBillDays = averageDaysOverdue(
      previousOverduePayables,
      (bill) => bill.due_date,
      comparisonPreviousRange
    );
    const currentAverageOverdueBillValue =
      currentOverdueBillCount > 0
        ? Math.round((currentOverduePayableValue / currentOverdueBillCount) * 100) / 100
        : 0;
    const previousAverageOverdueBillValue =
      previousOverdueBillCount > 0
        ? Math.round((previousOverduePayableValue / previousOverdueBillCount) * 100) / 100
        : 0;
    const currentOverdueBillShare = ratioPercent(
      currentOverdueBillCount,
      currentVendorBills.length
    );
    const previousOverdueBillShare = ratioPercent(
      previousOverdueBillCount,
      previousVendorBills.length
    );
    const currentOverduePayableShare = ratioPercent(
      currentOverduePayableValue,
      currentOpenPayableValue
    );
    const previousOverduePayableShare = ratioPercent(
      previousOverduePayableValue,
      previousOpenPayableValue
    );
    const currentWorkingCapitalProxy = currentOpenReceivableValue - currentOpenPayableValue;
    const previousWorkingCapitalProxy = previousOpenReceivableValue - previousOpenPayableValue;
    const currentVendorBillValue = currentVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillTotalAed(bill),
      0
    );
    const previousVendorBillValue = previousVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillTotalAed(bill),
      0
    );
    const currentAverageVendorBillValue =
      currentVendorBillDocuments.length > 0
        ? Math.round((currentVendorBillValue / currentVendorBillDocuments.length) * 100) / 100
        : 0;
    const previousAverageVendorBillValue =
      previousVendorBillDocuments.length > 0
        ? Math.round((previousVendorBillValue / previousVendorBillDocuments.length) * 100) / 100
        : 0;
    const currentPaidVendorBillValue = currentVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillPaidAed(bill),
      0
    );
    const previousPaidVendorBillValue = previousVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillPaidAed(bill),
      0
    );
    const currentPaidVendorBillShare = ratioPercent(
      currentPaidVendorBillValue,
      currentVendorBillValue
    );
    const previousPaidVendorBillShare = ratioPercent(
      previousPaidVendorBillValue,
      previousVendorBillValue
    );
    const currentOpenBillValueShare = ratioPercent(currentOpenPayableValue, currentVendorBillValue);
    const previousOpenBillValueShare = ratioPercent(
      previousOpenPayableValue,
      previousVendorBillValue
    );
    const topVendorShare = (rows: VendorBillReportRow[]) => {
      const total = rows.reduce((sum, bill) => sum + vendorBillTotalAed(bill), 0);
      if (total <= 0.005) return 0;

      const byVendor = new Map<string, number>();
      for (const bill of rows) {
        const vendorName = bill.vendor_name || "Unknown Vendor";
        byVendor.set(vendorName, (byVendor.get(vendorName) ?? 0) + vendorBillTotalAed(bill));
      }

      const topVendorSpend = Math.max(0, ...Array.from(byVendor.values()));
      return Math.round((topVendorSpend / total) * 10000) / 100;
    };
    const currentTopVendorShare = topVendorShare(currentVendorBillDocuments);
    const previousTopVendorShare = topVendorShare(previousVendorBillDocuments);
    const currentComparisonDays = inclusiveDayCount(
      comparisonCurrentRange.from,
      comparisonCurrentRange.to
    );
    const previousComparisonDays = inclusiveDayCount(
      comparisonPreviousRange.from,
      comparisonPreviousRange.to
    );
    const currentCollectionDays =
      currentInvoiceValue > 0.005
        ? Math.round(
            (currentOpenReceivableValue / currentInvoiceValue) * currentComparisonDays * 10
          ) / 10
        : 0;
    const previousCollectionDays =
      previousInvoiceValue > 0.005
        ? Math.round(
            (previousOpenReceivableValue / previousInvoiceValue) * previousComparisonDays * 10
          ) / 10
        : 0;
    const currentPayableDays =
      currentVendorBillValue > 0.005
        ? Math.round(
            (currentOpenPayableValue / currentVendorBillValue) * currentComparisonDays * 10
          ) / 10
        : 0;
    const previousPayableDays =
      previousVendorBillValue > 0.005
        ? Math.round(
            (previousOpenPayableValue / previousVendorBillValue) * previousComparisonDays * 10
          ) / 10
        : 0;
    const currentCashConversionGap =
      Math.round((currentCollectionDays - currentPayableDays) * 10) / 10;
    const previousCashConversionGap =
      Math.round((previousCollectionDays - previousPayableDays) * 10) / 10;
    const topCustomerShare = (rows: InvoiceReportRow[]) => {
      const revenueRows = rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      if (total <= 0.005) return 0;

      const byCustomer = new Map<string, number>();
      for (const invoice of revenueRows) {
        const customerName = invoice.customerName || "Unknown Customer";
        byCustomer.set(customerName, (byCustomer.get(customerName) ?? 0) + amountInAed(invoice));
      }

      const topCustomerRevenue = Math.max(0, ...Array.from(byCustomer.values()));
      return Math.round((topCustomerRevenue / total) * 10000) / 100;
    };
    const currentTopCustomerShare = topCustomerShare(currentInvoices);
    const previousTopCustomerShare = topCustomerShare(previousInvoices);
    const currentExpenseValue = currentReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const previousExpenseValue = previousReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const currentAverageReceiptValue =
      currentReceipts.length > 0
        ? Math.round((currentExpenseValue / currentReceipts.length) * 100) / 100
        : 0;
    const previousAverageReceiptValue =
      previousReceipts.length > 0
        ? Math.round((previousExpenseValue / previousReceipts.length) * 100) / 100
        : 0;
    const expenseClaimReviewRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "submitted" || claim.status === "approved");
    const submittedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "submitted");
    const approvedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "approved");
    const expenseClaimReviewValue = (rows: ExpenseClaimReportRow[]) =>
      expenseClaimReviewRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const submittedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
      submittedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const approvedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
      approvedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const currentExpenseClaimReviewValue = expenseClaimReviewValue(currentExpenseClaims);
    const previousExpenseClaimReviewValue = expenseClaimReviewValue(previousExpenseClaims);
    const currentSubmittedExpenseClaimValue = submittedExpenseClaimValue(currentExpenseClaims);
    const previousSubmittedExpenseClaimValue = submittedExpenseClaimValue(previousExpenseClaims);
    const currentApprovedExpenseClaimValue = approvedExpenseClaimValue(currentExpenseClaims);
    const previousApprovedExpenseClaimValue = approvedExpenseClaimValue(previousExpenseClaims);
    const currentExpenseClaimReviewCount = expenseClaimReviewRows(currentExpenseClaims).length;
    const previousExpenseClaimReviewCount = expenseClaimReviewRows(previousExpenseClaims).length;
    const currentSubmittedExpenseClaimCount =
      submittedExpenseClaimRows(currentExpenseClaims).length;
    const previousSubmittedExpenseClaimCount =
      submittedExpenseClaimRows(previousExpenseClaims).length;
    const currentApprovedExpenseClaimCount = approvedExpenseClaimRows(currentExpenseClaims).length;
    const previousApprovedExpenseClaimCount =
      approvedExpenseClaimRows(previousExpenseClaims).length;
    const receiptTotalAed = (receipt: ReceiptReportRow) =>
      receiptSubtotalAed(receipt) + receiptVatAed(receipt);
    const unpostedReceiptRows = (rows: ReceiptReportRow[]) =>
      rows.filter((receipt) => !receipt.posted);
    const unpostedReceiptValue = (rows: ReceiptReportRow[]) =>
      unpostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    const currentUnpostedReceiptValue = unpostedReceiptValue(currentReceipts);
    const previousUnpostedReceiptValue = unpostedReceiptValue(previousReceipts);
    const unpostedExpenseShare = (rows: ReceiptReportRow[]) => {
      const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
      if (total <= 0.005) return 0;

      const unpostedTotal = unpostedReceiptValue(rows);
      return Math.round((unpostedTotal / total) * 10000) / 100;
    };
    const currentUnpostedExpenseShare = unpostedExpenseShare(currentReceipts);
    const previousUnpostedExpenseShare = unpostedExpenseShare(previousReceipts);
    const currentUnpostedReceiptCount = unpostedReceiptRows(currentReceipts).length;
    const previousUnpostedReceiptCount = unpostedReceiptRows(previousReceipts).length;
    const autoPostedReceiptRows = (rows: ReceiptReportRow[]) =>
      rows.filter((receipt) => receipt.autoPosted);
    const autoPostedReceiptValue = (rows: ReceiptReportRow[]) =>
      autoPostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    const currentAutoPostedReceiptCount = autoPostedReceiptRows(currentReceipts).length;
    const previousAutoPostedReceiptCount = autoPostedReceiptRows(previousReceipts).length;
    const currentAutoPostedReceiptValue = autoPostedReceiptValue(currentReceipts);
    const previousAutoPostedReceiptValue = autoPostedReceiptValue(previousReceipts);
    const receiptAutomationCoverage = (rows: ReceiptReportRow[]) => {
      if (rows.length === 0) return 0;

      return Math.round((autoPostedReceiptRows(rows).length / rows.length) * 10000) / 100;
    };
    const currentReceiptAutomationCoverage = receiptAutomationCoverage(currentReceipts);
    const previousReceiptAutomationCoverage = receiptAutomationCoverage(previousReceipts);
    const receiptAutomationValueCoverage = (rows: ReceiptReportRow[]) => {
      const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
      if (total <= 0.005) return 0;

      return Math.round((autoPostedReceiptValue(rows) / total) * 10000) / 100;
    };
    const currentReceiptAutomationValueCoverage = receiptAutomationValueCoverage(currentReceipts);
    const previousReceiptAutomationValueCoverage = receiptAutomationValueCoverage(previousReceipts);
    const bankReconciliationCoverage = (rows: BankTransactionReportRow[]) => {
      if (rows.length === 0) return 0;

      const reconciledRows = rows.filter((transaction) => transaction.isReconciled).length;
      return Math.round((reconciledRows / rows.length) * 10000) / 100;
    };
    const currentBankReconciliationCoverage = bankReconciliationCoverage(currentBankTransactions);
    const previousBankReconciliationCoverage = bankReconciliationCoverage(previousBankTransactions);
    const bankTransactionReviewValue = (transaction: BankTransactionReportRow) =>
      Math.abs(Number(transaction.amount) || 0);
    const reconciledBankTransactionRows = (rows: BankTransactionReportRow[]) =>
      rows.filter((transaction) => transaction.isReconciled);
    const currentReconciledBankCount =
      reconciledBankTransactionRows(currentBankTransactions).length;
    const previousReconciledBankCount =
      reconciledBankTransactionRows(previousBankTransactions).length;
    const currentReconciledBankValue = reconciledBankTransactionRows(
      currentBankTransactions
    ).reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const previousReconciledBankValue = reconciledBankTransactionRows(
      previousBankTransactions
    ).reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const currentUnreconciledBankCount = currentBankTransactions.filter(
      (transaction) => !transaction.isReconciled
    ).length;
    const previousUnreconciledBankCount = previousBankTransactions.filter(
      (transaction) => !transaction.isReconciled
    ).length;
    const currentUnreconciledBankValue = currentBankTransactions
      .filter((transaction) => !transaction.isReconciled)
      .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const previousUnreconciledBankValue = previousBankTransactions
      .filter((transaction) => !transaction.isReconciled)
      .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const bankSuggestedMatchRows = (rows: BankTransactionReportRow[]) =>
      rows.filter(
        (transaction) => !transaction.isReconciled && transaction.matchStatus === "suggested"
      );
    const currentSuggestedBankMatchCount = bankSuggestedMatchRows(currentBankTransactions).length;
    const previousSuggestedBankMatchCount = bankSuggestedMatchRows(previousBankTransactions).length;
    const currentSuggestedBankMatchValue = bankSuggestedMatchRows(currentBankTransactions).reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
    const previousSuggestedBankMatchValue = bankSuggestedMatchRows(previousBankTransactions).reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
    const currentBankMatchSuggestionCoverage = ratioPercent(
      currentSuggestedBankMatchCount,
      currentUnreconciledBankCount
    );
    const previousBankMatchSuggestionCoverage = ratioPercent(
      previousSuggestedBankMatchCount,
      previousUnreconciledBankCount
    );
    const currentBankMatchSuggestionValueCoverage = ratioPercent(
      currentSuggestedBankMatchValue,
      currentUnreconciledBankValue
    );
    const previousBankMatchSuggestionValueCoverage = ratioPercent(
      previousSuggestedBankMatchValue,
      previousUnreconciledBankValue
    );
    const bankAssistedTransactionRows = (rows: BankTransactionReportRow[]) =>
      rows.filter(
        (transaction) =>
          transaction.isReconciled ||
          (!transaction.isReconciled && transaction.matchStatus === "suggested")
      );
    const bankAssistedTransactionValue = (rows: BankTransactionReportRow[]) =>
      bankAssistedTransactionRows(rows).reduce(
        (sum, transaction) => sum + bankTransactionReviewValue(transaction),
        0
      );
    const currentBankAssistedTransactionCount =
      bankAssistedTransactionRows(currentBankTransactions).length;
    const previousBankAssistedTransactionCount =
      bankAssistedTransactionRows(previousBankTransactions).length;
    const currentBankAssistedTransactionValue =
      bankAssistedTransactionValue(currentBankTransactions);
    const previousBankAssistedTransactionValue =
      bankAssistedTransactionValue(previousBankTransactions);
    const bankAssistedTransactionCoverage = (rows: BankTransactionReportRow[]) => {
      if (rows.length === 0) return null;

      return ratioPercent(bankAssistedTransactionRows(rows).length, rows.length);
    };
    const currentBankAssistedTransactionCoverage =
      bankAssistedTransactionCoverage(currentBankTransactions);
    const previousBankAssistedTransactionCoverage =
      bankAssistedTransactionCoverage(previousBankTransactions);
    const bankAssistedTransactionValueCoverage = (rows: BankTransactionReportRow[]) => {
      const total = rows.reduce(
        (sum, transaction) => sum + bankTransactionReviewValue(transaction),
        0
      );
      if (total <= 0.005) return null;

      return ratioPercent(bankAssistedTransactionValue(rows), total);
    };
    const currentBankAssistedTransactionValueCoverage =
      bankAssistedTransactionValueCoverage(currentBankTransactions);
    const previousBankAssistedTransactionValueCoverage =
      bankAssistedTransactionValueCoverage(previousBankTransactions);
    const currentAutomationWorkQueueCount =
      currentOverdueInvoiceCount +
      currentDueSoonReceivableInvoices.length +
      currentOverdueBillCount +
      currentDueSoonBills.length +
      currentUnpostedReceiptCount +
      currentExpenseClaimReviewCount +
      currentSuggestedBankMatchCount;
    const previousAutomationWorkQueueCount =
      previousOverdueInvoiceCount +
      previousDueSoonReceivableInvoices.length +
      previousOverdueBillCount +
      previousDueSoonBills.length +
      previousUnpostedReceiptCount +
      previousExpenseClaimReviewCount +
      previousSuggestedBankMatchCount;
    const currentAutomationWorkQueueValue =
      currentOverdueReceivableValue +
      currentDueSoonReceivableValue +
      currentOverduePayableValue +
      currentDueSoonBillValue +
      currentUnpostedReceiptValue +
      currentExpenseClaimReviewValue +
      currentSuggestedBankMatchValue;
    const previousAutomationWorkQueueValue =
      previousOverdueReceivableValue +
      previousDueSoonReceivableValue +
      previousOverduePayableValue +
      previousDueSoonBillValue +
      previousUnpostedReceiptValue +
      previousExpenseClaimReviewValue +
      previousSuggestedBankMatchValue;
    const currentPayrollValue = currentPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const previousPayrollValue = previousPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const payrollGrossValue = (rows: PayrollRunReportRow[]) =>
      rows.reduce(
        (sum, run) => sum + payrollAmount(run.total_basic) + payrollAmount(run.total_allowances),
        0
      );
    const payrollDeductionValue = (rows: PayrollRunReportRow[]) =>
      rows.reduce((sum, run) => sum + payrollAmount(run.total_deductions), 0);
    const currentPayrollGrossValue = payrollGrossValue(currentPayrollRuns);
    const previousPayrollGrossValue = payrollGrossValue(previousPayrollRuns);
    const currentPayrollDeductionValue = payrollDeductionValue(currentPayrollRuns);
    const previousPayrollDeductionValue = payrollDeductionValue(previousPayrollRuns);
    const currentPayrollDeductionShare = ratioPercent(
      currentPayrollDeductionValue,
      currentPayrollGrossValue
    );
    const previousPayrollDeductionShare = ratioPercent(
      previousPayrollDeductionValue,
      previousPayrollGrossValue
    );
    const currentAveragePayrollRunValue =
      currentPayrollRuns.length > 0
        ? Math.round((currentPayrollValue / currentPayrollRuns.length) * 100) / 100
        : 0;
    const previousAveragePayrollRunValue =
      previousPayrollRuns.length > 0
        ? Math.round((previousPayrollValue / previousPayrollRuns.length) * 100) / 100
        : 0;
    const currentPayrollCoveredEmployees = currentPayrollRuns.reduce(
      (sum, run) => sum + Number(run.employee_count ?? 0),
      0
    );
    const previousPayrollCoveredEmployees = previousPayrollRuns.reduce(
      (sum, run) => sum + Number(run.employee_count ?? 0),
      0
    );
    const currentPayrollCostPerCoveredEmployee =
      currentPayrollCoveredEmployees > 0
        ? Math.round((currentPayrollValue / currentPayrollCoveredEmployees) * 100) / 100
        : 0;
    const previousPayrollCostPerCoveredEmployee =
      previousPayrollCoveredEmployees > 0
        ? Math.round((previousPayrollValue / previousPayrollCoveredEmployees) * 100) / 100
        : 0;
    const payrollApprovalQueueRows = (rows: PayrollRunReportRow[]) =>
      rows.filter((run) => run.status === "calculated");
    const payrollApprovalQueueCount = (rows: PayrollRunReportRow[]) =>
      payrollApprovalQueueRows(rows).length;
    const payrollApprovalQueueValue = (rows: PayrollRunReportRow[]) =>
      payrollApprovalQueueRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
    const wpsMissingRunRows = (rows: PayrollRunReportRow[]) =>
      rows.filter(
        (run) => (run.status === "calculated" || run.status === "approved") && !run.sif_file_content
      );
    const wpsMissingRunCount = (rows: PayrollRunReportRow[]) => wpsMissingRunRows(rows).length;
    const wpsMissingRunValue = (rows: PayrollRunReportRow[]) =>
      wpsMissingRunRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
    const currentPayrollApprovalQueueCount = payrollApprovalQueueCount(currentPayrollRuns);
    const previousPayrollApprovalQueueCount = payrollApprovalQueueCount(previousPayrollRuns);
    const currentPayrollApprovalQueueValue = payrollApprovalQueueValue(currentPayrollRuns);
    const previousPayrollApprovalQueueValue = payrollApprovalQueueValue(previousPayrollRuns);
    const currentWpsMissingRunCount = wpsMissingRunCount(currentPayrollRuns);
    const previousWpsMissingRunCount = wpsMissingRunCount(previousPayrollRuns);
    const currentWpsMissingRunValue = wpsMissingRunValue(currentPayrollRuns);
    const previousWpsMissingRunValue = wpsMissingRunValue(previousPayrollRuns);
    const currentPayrollReadinessQueueCount =
      currentPayrollApprovalQueueCount + currentWpsMissingRunCount;
    const previousPayrollReadinessQueueCount =
      previousPayrollApprovalQueueCount + previousWpsMissingRunCount;
    const currentPayrollReadinessQueueValue =
      currentPayrollApprovalQueueValue + currentWpsMissingRunValue;
    const previousPayrollReadinessQueueValue =
      previousPayrollApprovalQueueValue + previousWpsMissingRunValue;
    const wpsReadyShare = (rows: PayrollRunReportRow[]) => {
      const eligibleRuns = rows.filter(
        (run) => run.status === "calculated" || run.status === "approved"
      );
      if (eligibleRuns.length === 0) return 0;

      const readyRuns = eligibleRuns.filter((run) => Boolean(run.sif_file_content)).length;
      return Math.round((readyRuns / eligibleRuns.length) * 10000) / 100;
    };
    const currentWpsReadyShare = wpsReadyShare(currentPayrollRuns);
    const previousWpsReadyShare = wpsReadyShare(previousPayrollRuns);
    const currentInventoryMovementValue = currentInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const previousInventoryMovementValue = previousInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const ledgerActivityBreakdownForRange = (range: ComparisonRange) => {
      const postedEntries = journalEntries.filter(
        (entry) => entry.status === "posted" && valueInDateRange(entry.date, range)
      );
      return postedEntries.reduce(
        (summary, entry) => {
          const entryActivity = (entry.lines ?? []).reduce(
            (lineSum, line) =>
              lineSum + Math.max(Number(line.debit) || 0, Number(line.credit) || 0),
            0
          );
          summary.totalActivity += entryActivity;
          if (!entry.source || entry.source === "manual") {
            summary.manualActivity += entryActivity;
          }
          return summary;
        },
        { totalActivity: 0, manualActivity: 0 }
      );
    };
    const currentLedgerActivityBreakdown = ledgerActivityBreakdownForRange(comparisonCurrentRange);
    const previousLedgerActivityBreakdown =
      ledgerActivityBreakdownForRange(comparisonPreviousRange);
    const currentLedgerActivity = currentLedgerActivityBreakdown.totalActivity;
    const previousLedgerActivity = previousLedgerActivityBreakdown.totalActivity;
    const currentManualLedgerShare = ratioPercent(
      currentLedgerActivityBreakdown.manualActivity,
      currentLedgerActivityBreakdown.totalActivity
    );
    const previousManualLedgerShare = ratioPercent(
      previousLedgerActivityBreakdown.manualActivity,
      previousLedgerActivityBreakdown.totalActivity
    );
    const currentManualLedgerActivity = currentLedgerActivityBreakdown.manualActivity;
    const previousManualLedgerActivity = previousLedgerActivityBreakdown.manualActivity;
    const automatedLedgerActivity = (summary: { totalActivity: number; manualActivity: number }) =>
      Math.max(0, summary.totalActivity - summary.manualActivity);
    const currentAutomatedLedgerActivity = automatedLedgerActivity(currentLedgerActivityBreakdown);
    const previousAutomatedLedgerActivity = automatedLedgerActivity(
      previousLedgerActivityBreakdown
    );
    const currentHighRiskActivityCount = currentActivityLogs.filter(
      (log) => activityLogRiskLevel(log) === "High"
    ).length;
    const previousHighRiskActivityCount = previousActivityLogs.filter(
      (log) => activityLogRiskLevel(log) === "High"
    ).length;
    const currentHighRiskActivityShare = ratioPercent(
      currentHighRiskActivityCount,
      currentActivityLogs.length
    );
    const previousHighRiskActivityShare = ratioPercent(
      previousHighRiskActivityCount,
      previousActivityLogs.length
    );
    const currentReviewActivityCount = currentActivityLogs.filter(
      (log) => activityLogRiskLevel(log) !== "Low"
    ).length;
    const previousReviewActivityCount = previousActivityLogs.filter(
      (log) => activityLogRiskLevel(log) !== "Low"
    ).length;
    const currentReviewActivityShare = ratioPercent(
      currentReviewActivityCount,
      currentActivityLogs.length
    );
    const previousReviewActivityShare = ratioPercent(
      previousReviewActivityCount,
      previousActivityLogs.length
    );
    const currentFxUnrealizedExposure =
      Math.abs(fxGainsLosses?.totalUnrealizedGain ?? 0) +
      Math.abs(fxGainsLosses?.totalUnrealizedLoss ?? 0);
    const currentLedgerAutomationCoverage =
      currentLedgerActivityBreakdown.totalActivity > 0.005 ? 100 - currentManualLedgerShare : null;
    const previousLedgerAutomationCoverage =
      previousLedgerActivityBreakdown.totalActivity > 0.005
        ? 100 - previousManualLedgerShare
        : null;
    const currentLedgerAutomationShare = currentLedgerAutomationCoverage ?? 0;
    const previousLedgerAutomationShare = previousLedgerAutomationCoverage ?? 0;
    const currentAutomationAdoptionIndex = averageAvailablePercent([
      currentReceipts.length > 0 ? currentReceiptAutomationCoverage : null,
      currentBankAssistedTransactionCoverage,
      currentLedgerAutomationCoverage,
    ]);
    const previousAutomationAdoptionIndex = averageAvailablePercent([
      previousReceipts.length > 0 ? previousReceiptAutomationCoverage : null,
      previousBankAssistedTransactionCoverage,
      previousLedgerAutomationCoverage,
    ]);
    const currentAutomationValueAdoptionIndex = averageAvailablePercent([
      currentExpenseValue > 0.005 ? currentReceiptAutomationValueCoverage : null,
      currentBankAssistedTransactionValueCoverage,
      currentLedgerAutomationCoverage,
    ]);
    const previousAutomationValueAdoptionIndex = averageAvailablePercent([
      previousExpenseValue > 0.005 ? previousReceiptAutomationValueCoverage : null,
      previousBankAssistedTransactionValueCoverage,
      previousLedgerAutomationCoverage,
    ]);
    const currentBurnRate = normalizeMonthlyBurn(
      comparisonCurrentProfitLoss?.totalRevenue ?? 0,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0,
      currentComparisonDays
    );
    const previousBurnRate = normalizeMonthlyBurn(
      comparisonPreviousProfitLoss?.totalRevenue ?? 0,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0,
      previousComparisonDays
    );
    const currentRunwayDays = runwayCoverageDays(
      cashFlowForecast?.currentBalance ?? 0,
      currentBurnRate
    );
    const previousRunwayDays = runwayCoverageDays(
      cashFlowForecast?.currentBalance ?? 0,
      previousBurnRate
    );
    const cashForecastProjections = cashFlowForecast?.projections ?? [];
    const lowestForecastBalance = cashForecastProjections.length
      ? Math.min(...cashForecastProjections.map((projection) => projection.projectedBalance))
      : (cashFlowForecast?.currentBalance ?? 0);
    const currentProjectedCashShortfall = Math.max(0, -lowestForecastBalance);
    const currentCashRiskWeekCount = cashForecastProjections.filter(
      (projection) => projection.projectedBalance < 0
    ).length;
    const currentNetMargin = ratioPercent(
      comparisonCurrentProfitLoss?.netProfit ?? 0,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousNetMargin = ratioPercent(
      comparisonPreviousProfitLoss?.netProfit ?? 0,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentExpenseRatio = ratioPercent(
      comparisonCurrentProfitLoss?.totalExpenses ?? 0,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousExpenseRatio = ratioPercent(
      comparisonPreviousProfitLoss?.totalExpenses ?? 0,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentRevenueExpenseCoverage = ratioPercent(
      comparisonCurrentProfitLoss?.totalRevenue ?? 0,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0
    );
    const previousRevenueExpenseCoverage = ratioPercent(
      comparisonPreviousProfitLoss?.totalRevenue ?? 0,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0
    );
    const currentConsolidatedMargin = ratioPercent(
      consolidatedStatementsReport.currentComparisonNetProfit,
      consolidatedStatementsReport.currentComparisonRevenue
    );
    const previousConsolidatedMargin = ratioPercent(
      consolidatedStatementsReport.previousNetProfit,
      consolidatedStatementsReport.previousRevenue
    );
    const currentBreakEvenGap = Math.max(
      0,
      (comparisonCurrentProfitLoss?.totalExpenses ?? 0) -
        (comparisonCurrentProfitLoss?.totalRevenue ?? 0)
    );
    const previousBreakEvenGap = Math.max(
      0,
      (comparisonPreviousProfitLoss?.totalExpenses ?? 0) -
        (comparisonPreviousProfitLoss?.totalRevenue ?? 0)
    );
    const currentPayrollExpenseShare = ratioPercent(
      currentPayrollValue,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0
    );
    const previousPayrollExpenseShare = ratioPercent(
      previousPayrollValue,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0
    );
    const operatingCashFlowForRow = (row: CashFlowStatementRow | undefined) =>
      (row?.operatingInflow ?? 0) - (row?.operatingOutflow ?? 0);
    const currentOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-1));
    const previousOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-2));
    const currentLiabilityAssetRatio = ratioPercent(
      comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
      comparisonCurrentBalanceSheet?.totalAssets ?? 0
    );
    const previousLiabilityAssetRatio = ratioPercent(
      comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
      comparisonPreviousBalanceSheet?.totalAssets ?? 0
    );
    const currentDebtEquityRatio = ratioPercent(
      comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
      comparisonCurrentBalanceSheet?.totalEquity ?? 0
    );
    const previousDebtEquityRatio = ratioPercent(
      comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
      comparisonPreviousBalanceSheet?.totalEquity ?? 0
    );
    const budgetComparisonLines = varianceReport?.varianceLines ?? [];
    const currentBudgetActualValue = budgetComparisonLines.reduce(
      (sum, line) => sum + line.totals.actual,
      0
    );
    const currentBudgetBaselineValue = budgetComparisonLines.reduce(
      (sum, line) => sum + line.totals.budget,
      0
    );
    const currentTotalTaxExposure =
      (comparisonCurrentVat?.netVATPayable ?? 0) + (corporateTaxEstimate?.taxPayable ?? 0);
    const previousTotalTaxExposure =
      (comparisonPreviousVat?.netVATPayable ?? 0) +
      (comparisonPreviousCorporateTaxEstimate?.taxPayable ?? 0);
    const currentTaxExposureRate = ratioPercent(
      currentTotalTaxExposure,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousTaxExposureRate = ratioPercent(
      previousTotalTaxExposure,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentAvailableTaxCash = Math.max(0, cashFlowForecast?.currentBalance ?? 0);
    const currentTaxReserveNeed = Math.max(0, currentTotalTaxExposure);
    const currentTaxReserveCoverage =
      currentTaxReserveNeed > 0.005
        ? ratioPercent(
            Math.min(currentAvailableTaxCash, currentTaxReserveNeed),
            currentTaxReserveNeed
          )
        : 100;
    const currentTaxFundingGap = Math.max(0, currentTaxReserveNeed - currentAvailableTaxCash);
    const currentTaxAdjustedRunwayDays = runwayCoverageDays(
      Math.max(0, currentAvailableTaxCash - currentTaxReserveNeed),
      currentBurnRate
    );
    const monthEndChecklistItems = monthEndCloseStatus?.checklist ?? [];
    const currentMonthEndOpenChecks = monthEndChecklistItems.filter(
      (item) => item.status !== "complete"
    ).length;
    const currentMonthEndReadiness = monthEndChecklistItems.length
      ? ratioPercent(
          monthEndChecklistItems.length - currentMonthEndOpenChecks,
          monthEndChecklistItems.length
        )
      : 100;

    return [
      makeComparisonMetric({
        id: "revenue",
        label: "Revenue",
        current: comparisonCurrentProfitLoss?.totalRevenue ?? 0,
        previous: comparisonPreviousProfitLoss?.totalRevenue ?? 0,
        currency: "AED",
        signal: "Growth",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "net-profit",
        label: "Net profit",
        current: comparisonCurrentProfitLoss?.netProfit ?? 0,
        previous: comparisonPreviousProfitLoss?.netProfit ?? 0,
        currency: "AED",
        signal: "Profitability",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "net-margin",
        label: "Net margin",
        current: currentNetMargin,
        previous: previousNetMargin,
        currency: "%",
        signal: "Profit efficiency",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "expense-ratio",
        label: "Expense ratio",
        current: currentExpenseRatio,
        previous: previousExpenseRatio,
        currency: "%",
        signal: "Cost efficiency",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "revenue-expense-coverage",
        label: "Revenue expense coverage",
        current: currentRevenueExpenseCoverage,
        previous: previousRevenueExpenseCoverage,
        currency: "%",
        signal: "Revenue covers expenses",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "break-even-gap",
        label: "Break-even gap",
        current: currentBreakEvenGap,
        previous: previousBreakEvenGap,
        currency: "AED",
        signal: "Break-even shortfall",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "invoice-value",
        label: "Invoice value",
        current: currentInvoiceValue,
        previous: previousInvoiceValue,
        currency: "AED",
        signal: "Sales activity",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "invoice-count",
        label: "Invoice count",
        current: currentInvoices.length,
        previous: previousInvoices.length,
        currency: "count",
        signal: "Invoice volume",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "paid-invoice-share",
        label: "Paid invoice share",
        current: currentPaidInvoiceShare,
        previous: previousPaidInvoiceShare,
        currency: "%",
        signal: "Collections effectiveness",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "average-invoice-value",
        label: "Average invoice value",
        current: currentAverageInvoiceValue,
        previous: previousAverageInvoiceValue,
        currency: "AED",
        signal: "Deal size",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "liability-asset-ratio",
        label: "Liabilities to assets",
        current: currentLiabilityAssetRatio,
        previous: previousLiabilityAssetRatio,
        currency: "%",
        signal: "Balance leverage",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "bs",
      }),
      makeComparisonMetric({
        id: "debt-to-equity-ratio",
        label: "Debt to equity",
        current: currentDebtEquityRatio,
        previous: previousDebtEquityRatio,
        currency: "%",
        signal: "Capital structure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "bs",
      }),
      makeComparisonMetric({
        id: "burn-rate",
        label: "Monthly burn rate",
        current: currentBurnRate,
        previous: previousBurnRate,
        currency: "AED",
        signal: "Cash pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cash-runway-days",
        label: "Cash runway coverage",
        current: currentRunwayDays,
        previous: previousRunwayDays,
        currency: "days",
        signal: "90-day runway",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "projected-cash-shortfall",
        label: "Projected cash shortfall",
        current: currentProjectedCashShortfall,
        previous: 0,
        currentLabel: "Forecast",
        previousLabel: "Zero shortfall",
        currency: "AED",
        signal: "Negative cash risk",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cash-risk-week-count",
        label: "Cash risk week count",
        current: currentCashRiskWeekCount,
        previous: 0,
        currentLabel: "Forecast",
        previousLabel: "Clear weeks",
        currency: "count",
        signal: "Forecast risk weeks",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "operating-cash-flow",
        label: "Operating cash flow",
        current: currentOperatingCashFlow,
        previous: previousOperatingCashFlow,
        currency: "AED",
        signal: "Cash movement",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "budget-actual-variance",
        label: "Budget actual variance",
        current: currentBudgetActualValue,
        previous: currentBudgetBaselineValue,
        currentLabel: "Actual",
        previousLabel: "Budget",
        currency: "AED",
        signal: "Budget vs actual",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-receivables",
        label: "Open receivables",
        current: currentOpenReceivableValue,
        previous: previousOpenReceivableValue,
        currency: "AED",
        signal: "Collections pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-count",
        label: "Open invoice count",
        current: currentOpenReceivableInvoices.length,
        previous: previousOpenReceivableInvoices.length,
        currency: "count",
        signal: "Collections workload",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-open-invoice-value",
        label: "Average open invoice value",
        current: currentAverageOpenInvoiceValue,
        previous: previousAverageOpenInvoiceValue,
        currency: "AED",
        signal: "Open invoice size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-value-share",
        label: "Open invoice value share",
        current: currentOpenInvoiceValueShare,
        previous: previousOpenInvoiceValueShare,
        currency: "%",
        signal: "Collections value mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-count",
        label: "Invoices due soon",
        current: currentDueSoonReceivableInvoices.length,
        previous: previousDueSoonReceivableInvoices.length,
        currency: "count",
        signal: "7-day collections queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-value",
        label: "Value due soon",
        current: currentDueSoonReceivableValue,
        previous: previousDueSoonReceivableValue,
        currency: "AED",
        signal: "7-day cash collection",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-due-soon-invoice-value",
        label: "Average due-soon invoice value",
        current: currentAverageDueSoonInvoiceValue,
        previous: previousAverageDueSoonInvoiceValue,
        currency: "AED",
        signal: "7-day invoice size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-share",
        label: "Due-soon invoice share",
        current: currentDueSoonInvoiceShare,
        previous: previousDueSoonInvoiceShare,
        currency: "%",
        signal: "7-day collections mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-share",
        label: "Open invoice share",
        current: currentOpenInvoiceShare,
        previous: previousOpenInvoiceShare,
        currency: "%",
        signal: "Collections workload mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-receivables",
        label: "Overdue receivables",
        current: currentOverdueReceivableValue,
        previous: previousOverdueReceivableValue,
        currency: "AED",
        signal: "A/R at risk",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-receivable-share",
        label: "Overdue receivable share",
        current: currentOverdueReceivableShare,
        previous: previousOverdueReceivableShare,
        currency: "%",
        signal: "A/R overdue mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-invoice-count",
        label: "Overdue invoice count",
        current: currentOverdueInvoiceCount,
        previous: previousOverdueInvoiceCount,
        currency: "count",
        signal: "Customer follow-ups",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-invoice-value",
        label: "Average overdue invoice value",
        current: currentAverageOverdueInvoiceValue,
        previous: previousAverageOverdueInvoiceValue,
        currency: "AED",
        signal: "Overdue invoice size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-invoice-days",
        label: "Average overdue invoice age",
        current: currentAverageOverdueInvoiceDays,
        previous: previousAverageOverdueInvoiceDays,
        currency: "days",
        signal: "Overdue aging",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-invoice-share",
        label: "Overdue invoice share",
        current: currentOverdueInvoiceShare,
        previous: previousOverdueInvoiceShare,
        currency: "%",
        signal: "Overdue workload mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "vendor-bill-value",
        label: "Vendor bill value",
        current: currentVendorBillValue,
        previous: previousVendorBillValue,
        currency: "AED",
        signal: "Supplier spend",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "vendor-bill-count",
        label: "Vendor bill count",
        current: currentVendorBillDocuments.length,
        previous: previousVendorBillDocuments.length,
        currency: "count",
        signal: "Supplier bill volume",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-bill-value",
        label: "Average bill value",
        current: currentAverageVendorBillValue,
        previous: previousAverageVendorBillValue,
        currency: "AED",
        signal: "Supplier bill size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "top-vendor-share",
        label: "Top vendor share",
        current: currentTopVendorShare,
        previous: previousTopVendorShare,
        currency: "%",
        signal: "Supplier concentration",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "paid-bill-share",
        label: "Paid bill share",
        current: currentPaidVendorBillShare,
        previous: previousPaidVendorBillShare,
        currency: "%",
        signal: "Supplier payment coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-payables",
        label: "Open payables",
        current: currentOpenPayableValue,
        previous: previousOpenPayableValue,
        currency: "AED",
        signal: "Bill-pay pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-bill-value-share",
        label: "Open bill value share",
        current: currentOpenBillValueShare,
        previous: previousOpenBillValueShare,
        currency: "%",
        signal: "Bill-pay value mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-cash-gap",
        label: "Open cash gap",
        current: currentOpenCashGap,
        previous: previousOpenCashGap,
        currency: "AED",
        signal: "Net unpaid pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-cash-coverage",
        label: "Open cash coverage",
        current: currentOpenCashCoverage,
        previous: previousOpenCashCoverage,
        currency: "%",
        signal: "Open bill coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-workload-gap",
        label: "Open workload gap",
        current: currentOpenWorkloadGap,
        previous: previousOpenWorkloadGap,
        currency: "count",
        signal: "Net unpaid workload",
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-bill-count",
        label: "Open bill count",
        current: currentVendorBills.length,
        previous: previousVendorBills.length,
        currency: "count",
        signal: "Bill-pay workload",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-open-bill-value",
        label: "Average open bill value",
        current: currentAverageOpenBillValue,
        previous: previousAverageOpenBillValue,
        currency: "AED",
        signal: "Open bill size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-count",
        label: "Bills due soon",
        current: currentDueSoonBills.length,
        previous: previousDueSoonBills.length,
        currency: "count",
        signal: "7-day bill-pay queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-value",
        label: "Value due soon",
        current: currentDueSoonBillValue,
        previous: previousDueSoonBillValue,
        currency: "AED",
        signal: "7-day cash need",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-due-soon-bill-value",
        label: "Average due-soon bill value",
        current: currentAverageDueSoonBillValue,
        previous: previousAverageDueSoonBillValue,
        currency: "AED",
        signal: "7-day bill size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-share",
        label: "Due-soon bill share",
        current: currentDueSoonBillShare,
        previous: previousDueSoonBillShare,
        currency: "%",
        signal: "7-day bill-pay mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-cash-gap",
        label: "Due-soon cash gap",
        current: currentDueSoonCashGap,
        previous: previousDueSoonCashGap,
        currency: "AED",
        signal: "7-day net cash need",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "due-soon-cash-coverage",
        label: "Due-soon cash coverage",
        current: currentDueSoonCashCoverage,
        previous: previousDueSoonCashCoverage,
        currency: "%",
        signal: "7-day bill coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "due-soon-workload-gap",
        label: "Due-soon workload gap",
        current: currentDueSoonWorkloadGap,
        previous: previousDueSoonWorkloadGap,
        currency: "count",
        signal: "7-day net workload",
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-bill-share",
        label: "Open bill share",
        current: currentOpenBillShare,
        previous: previousOpenBillShare,
        currency: "%",
        signal: "Bill-pay workload mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-payables",
        label: "Overdue payables",
        current: currentOverduePayableValue,
        previous: previousOverduePayableValue,
        currency: "AED",
        signal: "A/P at risk",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-cash-gap",
        label: "Overdue cash gap",
        current: currentOverdueCashGap,
        previous: previousOverdueCashGap,
        currency: "AED",
        signal: "Net overdue pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-cash-coverage",
        label: "Overdue cash coverage",
        current: currentOverdueCashCoverage,
        previous: previousOverdueCashCoverage,
        currency: "%",
        signal: "Overdue bill coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-workload-gap",
        label: "Overdue workload gap",
        current: currentOverdueWorkloadGap,
        previous: previousOverdueWorkloadGap,
        currency: "count",
        signal: "Net overdue workload",
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-payable-share",
        label: "Overdue payable share",
        current: currentOverduePayableShare,
        previous: previousOverduePayableShare,
        currency: "%",
        signal: "A/P overdue mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-bill-count",
        label: "Overdue bill count",
        current: currentOverdueBillCount,
        previous: previousOverdueBillCount,
        currency: "count",
        signal: "Vendor follow-ups",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-bill-value",
        label: "Average overdue bill value",
        current: currentAverageOverdueBillValue,
        previous: previousAverageOverdueBillValue,
        currency: "AED",
        signal: "Overdue bill size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-bill-days",
        label: "Average overdue bill age",
        current: currentAverageOverdueBillDays,
        previous: previousAverageOverdueBillDays,
        currency: "days",
        signal: "Overdue aging",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-bill-share",
        label: "Overdue bill share",
        current: currentOverdueBillShare,
        previous: previousOverdueBillShare,
        currency: "%",
        signal: "Overdue bill mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "working-capital-proxy",
        label: "Working capital proxy",
        current: currentWorkingCapitalProxy,
        previous: previousWorkingCapitalProxy,
        currency: "AED",
        signal: "A/R less A/P",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "collection-days",
        label: "Collection days",
        current: currentCollectionDays,
        previous: previousCollectionDays,
        currency: "days",
        signal: "DSO proxy",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "payable-days",
        label: "Payable days",
        current: currentPayableDays,
        previous: previousPayableDays,
        currency: "days",
        signal: "DPO proxy",
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "cash-conversion-gap",
        label: "Cash conversion gap",
        current: currentCashConversionGap,
        previous: previousCashConversionGap,
        currency: "days",
        signal: "DSO less DPO",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "top-customer-share",
        label: "Top customer share",
        current: currentTopCustomerShare,
        previous: previousTopCustomerShare,
        currency: "%",
        signal: "Client concentration",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "top-product-service-share",
        label: "Top product/service share",
        current: comparisonCurrentSalesProductService?.totals?.topProductServiceShare ?? 0,
        previous: comparisonPreviousSalesProductService?.totals?.topProductServiceShare ?? 0,
        currency: "%",
        signal: "Sales mix concentration",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "expense-spend",
        label: "Expense spend",
        current: currentExpenseValue,
        previous: previousExpenseValue,
        currency: "AED",
        signal: "Cost pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-count",
        label: "Receipt count",
        current: currentReceipts.length,
        previous: previousReceipts.length,
        currency: "count",
        signal: "Receipt workload",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "average-receipt-value",
        label: "Average receipt value",
        current: currentAverageReceiptValue,
        previous: previousAverageReceiptValue,
        currency: "AED",
        signal: "Receipt size",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "expense-claim-review-value",
        label: "Expense claim review value",
        current: currentExpenseClaimReviewValue,
        previous: previousExpenseClaimReviewValue,
        currency: "AED",
        signal: "Claims queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "expense-claim-review-count",
        label: "Expense claim review count",
        current: currentExpenseClaimReviewCount,
        previous: previousExpenseClaimReviewCount,
        currency: "count",
        signal: "Claims awaiting review",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "submitted-expense-claim-count",
        label: "Submitted expense claim count",
        current: currentSubmittedExpenseClaimCount,
        previous: previousSubmittedExpenseClaimCount,
        currency: "count",
        signal: "Claim approvals",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "submitted-expense-claim-value",
        label: "Submitted expense claim value",
        current: currentSubmittedExpenseClaimValue,
        previous: previousSubmittedExpenseClaimValue,
        currency: "AED",
        signal: "Claim approval value",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "approved-expense-claim-count",
        label: "Approved expense claim count",
        current: currentApprovedExpenseClaimCount,
        previous: previousApprovedExpenseClaimCount,
        currency: "count",
        signal: "Reimbursement follow-up",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "approved-expense-claim-value",
        label: "Approved expense claim value",
        current: currentApprovedExpenseClaimValue,
        previous: previousApprovedExpenseClaimValue,
        currency: "AED",
        signal: "Reimbursement value",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-expense-share",
        label: "Unposted expense share",
        current: currentUnpostedExpenseShare,
        previous: previousUnpostedExpenseShare,
        currency: "%",
        signal: "Bookkeeping backlog",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-receipt-count",
        label: "Unposted receipt count",
        current: currentUnpostedReceiptCount,
        previous: previousUnpostedReceiptCount,
        currency: "count",
        signal: "Posting queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-receipt-value",
        label: "Unposted receipt value",
        current: currentUnpostedReceiptValue,
        previous: previousUnpostedReceiptValue,
        currency: "AED",
        signal: "Posting value",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "auto-posted-receipt-count",
        label: "Auto-posted receipt count",
        current: currentAutoPostedReceiptCount,
        previous: previousAutoPostedReceiptCount,
        currency: "count",
        signal: "Receipts automated",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "auto-posted-receipt-value",
        label: "Auto-posted receipt value",
        current: currentAutoPostedReceiptValue,
        previous: previousAutoPostedReceiptValue,
        currency: "AED",
        signal: "Automated expense value",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-automation-coverage",
        label: "Receipt automation coverage",
        current: currentReceiptAutomationCoverage,
        previous: previousReceiptAutomationCoverage,
        currency: "%",
        signal: "Auto-post coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-automation-value-coverage",
        label: "Receipt automation value coverage",
        current: currentReceiptAutomationValueCoverage,
        previous: previousReceiptAutomationValueCoverage,
        currency: "%",
        signal: "Auto-posted value",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "bank-reconciliation-coverage",
        label: "Bank reconciliation coverage",
        current: currentBankReconciliationCoverage,
        previous: previousBankReconciliationCoverage,
        currency: "%",
        signal: "Bank automation coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "reconciled-bank-count",
        label: "Reconciled bank count",
        current: currentReconciledBankCount,
        previous: previousReconciledBankCount,
        currency: "count",
        signal: "Bank transactions cleared",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "reconciled-bank-value",
        label: "Reconciled bank value",
        current: currentReconciledBankValue,
        previous: previousReconciledBankValue,
        currency: "AED",
        signal: "Bank value cleared",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "unreconciled-bank-count",
        label: "Unreconciled bank count",
        current: currentUnreconciledBankCount,
        previous: previousUnreconciledBankCount,
        currency: "count",
        signal: "Bank review queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "unreconciled-bank-value",
        label: "Unreconciled bank value",
        current: currentUnreconciledBankValue,
        previous: previousUnreconciledBankValue,
        currency: "AED",
        signal: "Bank value at review",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-match-suggestion-coverage",
        label: "Bank match suggestion coverage",
        current: currentBankMatchSuggestionCoverage,
        previous: previousBankMatchSuggestionCoverage,
        currency: "%",
        signal: "Suggested match coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-match-suggestion-value-coverage",
        label: "Bank match suggestion value coverage",
        current: currentBankMatchSuggestionValueCoverage,
        previous: previousBankMatchSuggestionValueCoverage,
        currency: "%",
        signal: "Suggested match value",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "suggested-bank-match-count",
        label: "Suggested bank match count",
        current: currentSuggestedBankMatchCount,
        previous: previousSuggestedBankMatchCount,
        currency: "count",
        signal: "Review-ready matches",
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-count",
        label: "Bank-assisted transaction count",
        current: currentBankAssistedTransactionCount,
        previous: previousBankAssistedTransactionCount,
        currency: "count",
        signal: "Bank work assisted",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-value",
        label: "Bank-assisted transaction value",
        current: currentBankAssistedTransactionValue,
        previous: previousBankAssistedTransactionValue,
        currency: "AED",
        signal: "Assisted bank value",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-coverage",
        label: "Bank-assisted transaction coverage",
        current: currentBankAssistedTransactionCoverage ?? 0,
        previous: previousBankAssistedTransactionCoverage ?? 0,
        currency: "%",
        signal: "Bank work coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-value-coverage",
        label: "Bank-assisted transaction value coverage",
        current: currentBankAssistedTransactionValueCoverage ?? 0,
        previous: previousBankAssistedTransactionValueCoverage ?? 0,
        currency: "%",
        signal: "Assisted bank value coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "automation-work-queue-count",
        label: "Automation work queue count",
        current: currentAutomationWorkQueueCount,
        previous: previousAutomationWorkQueueCount,
        currency: "count",
        signal: "Action queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-work-queue-value",
        label: "Automation work queue value",
        current: currentAutomationWorkQueueValue,
        previous: previousAutomationWorkQueueValue,
        currency: "AED",
        signal: "Queue value",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "ledger-automation-share",
        label: "Ledger automation share",
        current: currentLedgerAutomationShare,
        previous: previousLedgerAutomationShare,
        currency: "%",
        signal: "Ledger automation coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "manual-ledger-activity",
        label: "Manual ledger activity",
        current: currentManualLedgerActivity,
        previous: previousManualLedgerActivity,
        currency: "AED",
        signal: "Manual ledger value",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automated-ledger-activity",
        label: "Automated ledger activity",
        current: currentAutomatedLedgerActivity,
        previous: previousAutomatedLedgerActivity,
        currency: "AED",
        signal: "Automated ledger value",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-adoption-index",
        label: "Automation adoption index",
        current: currentAutomationAdoptionIndex,
        previous: previousAutomationAdoptionIndex,
        currency: "%",
        signal: "Automation adoption",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-value-adoption-index",
        label: "Automation value adoption index",
        current: currentAutomationValueAdoptionIndex,
        previous: previousAutomationValueAdoptionIndex,
        currency: "%",
        signal: "Automation value adoption",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cost-center-net-income",
        label: "Cost center net income",
        current: comparisonCurrentCostCenterProfitability?.totals?.netIncome ?? 0,
        previous: comparisonPreviousCostCenterProfitability?.totals?.netIncome ?? 0,
        currency: "AED",
        signal: "Department profitability",
        favorable: "increase",
        personas: ["owner", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "cost-center-expenses",
        label: "Cost center expenses",
        current: comparisonCurrentCostCenterProfitability?.totals?.totalExpenses ?? 0,
        previous: comparisonPreviousCostCenterProfitability?.totals?.totalExpenses ?? 0,
        currency: "AED",
        signal: "Department cost pressure",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "vat-due",
        label: "Net VAT due",
        current: comparisonCurrentVat?.netVATPayable ?? 0,
        previous: comparisonPreviousVat?.netVATPayable ?? 0,
        currency: "AED",
        signal: "Tax cash flow",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "vat",
      }),
      makeComparisonMetric({
        id: "corporate-tax-payable",
        label: "Corporate tax payable",
        current: corporateTaxEstimate?.taxPayable ?? 0,
        previous: comparisonPreviousCorporateTaxEstimate?.taxPayable ?? 0,
        currency: "AED",
        signal: "Tax exposure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "total-tax-exposure",
        label: "Total tax exposure",
        current: currentTotalTaxExposure,
        previous: previousTotalTaxExposure,
        currency: "AED",
        signal: "VAT plus corporate tax",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-exposure-rate",
        label: "Tax exposure rate",
        current: currentTaxExposureRate,
        previous: previousTaxExposureRate,
        currency: "%",
        signal: "Tax load",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-reserve-coverage",
        label: "Tax reserve coverage",
        current: currentTaxReserveCoverage,
        previous: 100,
        currentLabel: "Current cash",
        previousLabel: "Fully funded",
        currency: "%",
        signal: "Tax cash coverage",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-funding-gap",
        label: "Tax funding gap",
        current: currentTaxFundingGap,
        previous: 0,
        currentLabel: "Current gap",
        previousLabel: "Zero gap",
        currency: "AED",
        signal: "Tax cash gap",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-adjusted-runway-days",
        label: "Tax-adjusted runway",
        current: currentTaxAdjustedRunwayDays,
        previous: currentRunwayDays,
        currentLabel: "After tax reserve",
        previousLabel: "Before tax reserve",
        currency: "days",
        signal: "Post-tax runway",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "payroll-cost",
        label: "Payroll cost",
        current: currentPayrollValue,
        previous: previousPayrollValue,
        currency: "AED",
        signal: "Payroll movement",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-run-count",
        label: "Payroll run count",
        current: currentPayrollRuns.length,
        previous: previousPayrollRuns.length,
        currency: "count",
        signal: "Payroll run volume",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-deduction-share",
        label: "Payroll deduction share",
        current: currentPayrollDeductionShare,
        previous: previousPayrollDeductionShare,
        currency: "%",
        signal: "Gross-to-net payroll",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "average-payroll-run-value",
        label: "Average payroll run value",
        current: currentAveragePayrollRunValue,
        previous: previousAveragePayrollRunValue,
        currency: "AED",
        signal: "Payroll run size",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-covered-employees",
        label: "Payroll covered employees",
        current: currentPayrollCoveredEmployees,
        previous: previousPayrollCoveredEmployees,
        currency: "count",
        signal: "Payroll headcount",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-cost-per-covered-employee",
        label: "Payroll cost per covered employee",
        current: currentPayrollCostPerCoveredEmployee,
        previous: previousPayrollCostPerCoveredEmployee,
        currency: "AED",
        signal: "Payroll unit cost",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-approval-queue-count",
        label: "Payroll approval queue",
        current: currentPayrollApprovalQueueCount,
        previous: previousPayrollApprovalQueueCount,
        currency: "count",
        signal: "Payroll approvals",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-approval-queue-value",
        label: "Payroll approval queue value",
        current: currentPayrollApprovalQueueValue,
        previous: previousPayrollApprovalQueueValue,
        currency: "AED",
        signal: "Payroll approval value",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-readiness-queue-count",
        label: "Payroll readiness queue",
        current: currentPayrollReadinessQueueCount,
        previous: previousPayrollReadinessQueueCount,
        currency: "count",
        signal: "Payroll approvals and WPS",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-readiness-queue-value",
        label: "Payroll readiness queue value",
        current: currentPayrollReadinessQueueValue,
        previous: previousPayrollReadinessQueueValue,
        currency: "AED",
        signal: "Payroll readiness value",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-missing-run-count",
        label: "WPS missing run count",
        current: currentWpsMissingRunCount,
        previous: previousWpsMissingRunCount,
        currency: "count",
        signal: "WPS file gap",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-missing-run-value",
        label: "WPS missing run value",
        current: currentWpsMissingRunValue,
        previous: previousWpsMissingRunValue,
        currency: "AED",
        signal: "WPS file value gap",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-expense-share",
        label: "Payroll expense share",
        current: currentPayrollExpenseShare,
        previous: previousPayrollExpenseShare,
        currency: "%",
        signal: "Payroll burden",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-ready-share",
        label: "WPS ready share",
        current: currentWpsReadyShare,
        previous: previousWpsReadyShare,
        currency: "%",
        signal: "Payroll file readiness",
        favorable: "increase",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "inventory-movement",
        label: "Inventory movement",
        current: currentInventoryMovementValue,
        previous: previousInventoryMovementValue,
        currency: "AED",
        signal: "Stock movement",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-items",
        label: "Inventory review items",
        current: inventoryValuationReport.reviewCount,
        previous: 0,
        currentLabel: "Review items",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Stock review queue",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-share",
        label: "Inventory review share",
        current: ratioPercent(
          inventoryValuationReport.reviewCount,
          inventoryValuationReport.activeProductCount
        ),
        previous: 0,
        currentLabel: "Review share",
        previousLabel: "Clear baseline",
        currency: "%",
        signal: "Stock review mix",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-value",
        label: "Inventory review value",
        current: inventoryValuationReport.reviewValueAed,
        previous: 0,
        currentLabel: "Review value",
        previousLabel: "Clear baseline",
        currency: "AED",
        signal: "Stock value at review",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-items",
        label: "Fixed asset review items",
        current: fixedAssetRegisterReport.reviewCount,
        previous: 0,
        currentLabel: "Review items",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Asset review queue",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-share",
        label: "Fixed asset review share",
        current: ratioPercent(
          fixedAssetRegisterReport.reviewCount,
          fixedAssetRegisterReport.activeRows.length
        ),
        previous: 0,
        currentLabel: "Review share",
        previousLabel: "Clear baseline",
        currency: "%",
        signal: "Asset review mix",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-value",
        label: "Fixed asset review value",
        current: fixedAssetRegisterReport.reviewValueAed,
        previous: 0,
        currentLabel: "Review value",
        previousLabel: "Clear baseline",
        currency: "AED",
        signal: "Asset value at review",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-review-items",
        label: "Depreciation review items",
        current: depreciationScheduleReport.reviewCount,
        previous: 0,
        currentLabel: "Review items",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Depreciation setup queue",
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-review-value",
        label: "Depreciation review value",
        current: depreciationScheduleReport.reviewValueAed,
        previous: 0,
        currentLabel: "Review value",
        previousLabel: "Clear baseline",
        currency: "AED",
        signal: "Depreciable value at review",
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-ready-items",
        label: "Depreciation ready items",
        current: depreciationScheduleReport.readyToPostCount,
        previous: 0,
        currentLabel: "Ready items",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Depreciation posting queue",
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-ready-share",
        label: "Depreciation ready share",
        current: ratioPercent(
          depreciationScheduleReport.readyToPostCount,
          depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount
        ),
        previous: 100,
        currentLabel: "Ready share",
        previousLabel: "Ready",
        currency: "%",
        signal: "Depreciation readiness",
        favorable: "increase",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-estimate",
        label: "Depreciation estimate",
        current: currentDepreciationEstimate,
        previous: previousDepreciationEstimate,
        currency: "AED",
        signal: "Depreciation schedule",
        favorable: "neutral",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "consolidated-revenue",
        label: "Roll-up revenue",
        current: consolidatedStatementsReport.currentComparisonRevenue,
        previous: consolidatedStatementsReport.previousRevenue,
        currency: "AED",
        signal: "Group revenue",
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-expenses",
        label: "Roll-up expenses",
        current: consolidatedStatementsReport.currentComparisonExpenses,
        previous: consolidatedStatementsReport.previousExpenses,
        currency: "AED",
        signal: "Group expenses",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-net-profit",
        label: "Roll-up net profit",
        current: consolidatedStatementsReport.currentComparisonNetProfit,
        previous: consolidatedStatementsReport.previousNetProfit,
        currency: "AED",
        signal: "Multi-entity roll-up",
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-margin",
        label: "Roll-up margin",
        current: currentConsolidatedMargin,
        previous: previousConsolidatedMargin,
        currency: "%",
        signal: "Group profitability",
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidation-review-items",
        label: "Consolidation review items",
        current: consolidatedStatementsReport.reviewCount,
        previous: 0,
        currentLabel: "Review items",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Consolidation review queue",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "month-end-open-checks",
        label: "Month-end open checks",
        current: currentMonthEndOpenChecks,
        previous: 0,
        currentLabel: "Open checks",
        previousLabel: "Clear baseline",
        currency: "count",
        signal: "Close checklist",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "month-end-readiness",
        label: "Month-end readiness",
        current: currentMonthEndReadiness,
        previous: 100,
        currentLabel: "Checklist",
        previousLabel: "Ready",
        currency: "%",
        signal: "Close readiness",
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-high-risk-event-count",
        label: "Audit high-risk events",
        current: currentHighRiskActivityCount,
        previous: previousHighRiskActivityCount,
        currency: "count",
        signal: "Risky audit activity",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-high-risk-event-share",
        label: "Audit high-risk event share",
        current: currentHighRiskActivityShare,
        previous: previousHighRiskActivityShare,
        currency: "%",
        signal: "Risky activity mix",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-review-event-count",
        label: "Audit review events",
        current: currentReviewActivityCount,
        previous: previousReviewActivityCount,
        currency: "count",
        signal: "Audit review workload",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-review-event-share",
        label: "Audit review event share",
        current: currentReviewActivityShare,
        previous: previousReviewActivityShare,
        currency: "%",
        signal: "Audit review mix",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "fx-unrealized-exposure",
        label: "FX unrealized exposure",
        current: currentFxUnrealizedExposure,
        previous: 0,
        currentLabel: "Exposure",
        previousLabel: "Clear baseline",
        currency: "AED",
        signal: "FX exposure at review",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "manual-ledger-share",
        label: "Manual ledger share",
        current: currentManualLedgerShare,
        previous: previousManualLedgerShare,
        currency: "%",
        signal: "Manual source coverage",
        favorable: "decrease",
        personas: ["accountant"],
        tab: "ledger",
      }),
      makeComparisonMetric({
        id: "ledger-activity",
        label: "Ledger activity",
        current: currentLedgerActivity,
        previous: previousLedgerActivity,
        currency: "AED",
        signal: "Close activity",
        favorable: "neutral",
        personas: ["accountant"],
        tab: "ledger",
      }),
    ];
  }, [
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
    inventoryValuationReport.reviewCount,
    inventoryValuationReport.reviewValueAed,
    journalEntries,
    monthEndCloseStatus?.checklist,
    payrollRuns,
    receipts,
    varianceReport?.varianceLines,
    vendorBills,
  ]);

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

  const automationQueue = useMemo<AutomationQueueItem[]>(() => {
    const vatNet = vatSummary?.netVATPayable ?? 0;
    const corporateTaxPayable = corporateTaxEstimate?.taxPayable ?? 0;
    const closeReviewCount = ledgerReport.reviewEntries + (trialBalanceSummary.isBalanced ? 0 : 1);
    const planningRiskCount =
      (planningReport.cashWarning === "On track" ? 0 : 1) + planningReport.overBudgetLines;

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
          inventoryValuationReport.reviewCount > 0 ? "Stock review items" : "Inventory valued",
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
          inventoryMovementReport.movementCount > 0 ? "Stock movement posted" : "No stock movement",
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
          fixedAssetRegisterReport.reviewCount > 0 ? "Asset review items" : "Asset register ready",
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
            ? "Depreciation setup review"
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
        signal: expenseClaimReport.reviewCount > 0 ? "Claim queue open" : "Expense claims clear",
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
            ? "Payroll action needed"
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
        signal: corporateTaxPayable > 0.005 ? "Tax payable" : "No current tax due",
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
            ? "Consolidation review"
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

  const reportDeliveryPlansQuery = useQuery<{
    subscriptions: ReportDeliveryPlanResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "subscriptions"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/subscriptions`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const reportDeliveryAutomationPreferencesQuery = useQuery<{
    preferences: ReportDeliveryAutomationPreferenceResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  useEffect(() => {
    const preferences = reportDeliveryAutomationPreferencesQuery.data?.preferences;
    if (!preferences?.length) return;

    setPinnedReportDeliveryAutomationCommands((current) => {
      const next = { ...current };
      for (const preference of preferences) {
        next[preference.persona] = parseReportDeliveryAutomationCommand(
          preference.preferredDeliveryAutomationCommand
        );
      }
      return next;
    });
  }, [reportDeliveryAutomationPreferencesQuery.data?.preferences]);

  const reportDeliveryRunsQuery = useQuery<{
    runs: ReportDeliveryRunSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const reportDeliverySchedulerHealthQuery = useQuery<{
    latestScan: ReportDeliverySchedulerScanSummary | null;
    recentScans: ReportDeliverySchedulerScanSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "scheduler-health"],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/report-delivery/scheduler-health?limit=5`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const latestReportDeliverySchedulerScan =
    reportDeliverySchedulerHealthQuery.data?.latestScan ?? null;
  const reportDeliverySchedulerHandoffSkipCount =
    latestReportDeliverySchedulerScan?.snapshot?.skippedHandoff ??
    latestReportDeliverySchedulerScan?.snapshot?.skippedSubscriptionIds?.handoff?.length ??
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews?.length ??
    0;
  const reportDeliverySchedulerGuardrailSkips = latestReportDeliverySchedulerScan
    ? latestReportDeliverySchedulerScan.skippedPaused +
      latestReportDeliverySchedulerScan.skippedSetup
    : 0;

  const reportDeliveryPlanById = useMemo(() => {
    return new Map(
      (reportDeliveryPlansQuery.data?.subscriptions ?? []).map((plan) => [plan.id, plan])
    );
  }, [reportDeliveryPlansQuery.data?.subscriptions]);

  const reportDeliveryRunsBySubscriptionId = useMemo(() => {
    const runsBySubscription = new Map<string, ReportDeliveryRunSummary[]>();
    for (const run of reportDeliveryRunsQuery.data?.runs ?? []) {
      const existing = runsBySubscription.get(run.subscriptionId) ?? [];
      existing.push(run);
      runsBySubscription.set(run.subscriptionId, existing);
    }
    return runsBySubscription;
  }, [reportDeliveryRunsQuery.data?.runs]);

  const reportDeliverySubscriptionSummaries = useMemo(() => {
    return reportDeliverySubscriptions.flatMap((subscription) => {
      const workspace = workspaceSummaries.find((item) => item.persona === subscription.persona);
      if (!workspace) return [];
      const deliveryPlan = reportDeliveryPlanById.get(subscription.id);
      const deliveryRuns = reportDeliveryRunsBySubscriptionId.get(subscription.id) ?? [];
      const reportSuites = reportSuiteSummaries.filter(
        (suite) => suite.deliverySubscriptionId === subscription.id
      );
      const plannedReportSuites =
        deliveryPlan?.reportSuites ??
        reportSuites.map((suite) => ({
          id: suite.id,
          title: suite.title,
          workflow: suite.workflow,
          href: suite.href,
        }));

      const reports = subscription.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;
      const packTemplate =
        reportPackTemplateSummaries.find(
          (template) => template.id === subscription.packTemplateId
        ) ?? null;
      const triggerRules = subscription.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRuleSummaries.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRuleSummaries)[number] =>
          Boolean(rule)
        );
      const automationStarter =
        reportAutomationStarterSummaries.find(
          (starter) => starter.id === subscription.automationStarterId
        ) ?? null;
      const decisionShortcut =
        reportDecisionShortcutSummaries.find(
          (shortcut) => shortcut.id === subscription.decisionShortcutId
        ) ?? null;
      const openWorkItemCount = triggerRules.reduce((sum, rule) => sum + rule.openWorkItemCount, 0);
      const amountAtRisk = triggerRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const enabled = deliveryPlan?.enabled ?? true;
      const status = !enabled
        ? "Paused"
        : openWorkItemCount > 0
          ? "Review before send"
          : (deliveryPlan?.status ?? "ready") === "setup"
            ? "Setup needed"
            : readyCount === reports.length
              ? "Ready to send"
              : "Setup needed";

      return [
        {
          ...subscription,
          enabled,
          workspace,
          reports,
          readyCount,
          packTemplate,
          triggerRules,
          automationStarter,
          decisionShortcut,
          reportSuites: plannedReportSuites,
          suiteCount: deliveryPlan?.suiteCount ?? plannedReportSuites.length,
          openWorkItemCount,
          amountAtRisk,
          cadence: deliveryPlan?.cadence ?? subscription.cadence,
          channel: deliveryPlan?.channel ?? subscription.channel,
          format: deliveryPlan?.format ?? subscription.format,
          recipients: deliveryPlan?.recipients ?? subscription.recipients,
          deliveryGuardrail: deliveryPlan?.deliveryGuardrail ?? subscription.deliveryGuardrail,
          nextRunLabel: deliveryPlan?.nextRunLabel ?? "",
          settingsSource: deliveryPlan?.settingsSource ?? "catalog",
          preview:
            deliveryPlan?.preview ??
            ({
              summary: `${subscription.format} to ${subscription.recipients} through ${subscription.channel}.`,
              readinessLabel: "Catalog preview",
              checklist: [
                {
                  label: "Reports",
                  status: readyCount === reports.length ? "ready" : "review",
                  detail: `${readyCount}/${reports.length} reports ready for this pack.`,
                },
                {
                  label: "Guardrail",
                  status: "ready",
                  detail: subscription.deliveryGuardrail,
                },
              ],
              reportNames: reports.map((report) => report.name),
              triggerRuleTitles: triggerRules.map((rule) => rule.title),
              suiteTitles: plannedReportSuites.map((suite) => suite.title),
            } satisfies ReportDeliveryPlanPreview),
          deliveryRuns,
          latestDeliveryRun: deliveryRuns[0] ?? null,
          href: reportDeliverySubscriptionHref(subscription),
          packTemplateHref: packTemplate?.href ?? reportDeliverySubscriptionHref(subscription),
          automationStarterHref:
            automationStarter?.href ?? reportDeliverySubscriptionHref(subscription),
          decisionShortcutHref:
            decisionShortcut?.href ?? reportDeliverySubscriptionHref(subscription),
          status,
          statusVariant:
            status === "Ready to send"
              ? ("success" as const)
              : status === "Review before send"
                ? ("warning" as const)
                : ("neutral" as const),
        },
      ];
    });
  }, [
    reportDeliveryPlanById,
    reportDeliveryRunsBySubscriptionId,
    reportAutomationStarterSummaries,
    reportAutomationTriggerRuleSummaries,
    reportDecisionShortcutSummaries,
    reportPackTemplateSummaries,
    reportSuiteSummaries,
    workspaceSummaries,
  ]);

  const reportDeliverySchedulerHandoffReviews = useMemo(() => {
    const reviews = latestReportDeliverySchedulerScan?.snapshot?.handoffReviews ?? [];
    return reviews
      .map((review) => {
        const subscription =
          reportDeliverySubscriptionSummaries.find((item) => item.id === review.subscriptionId) ??
          null;
        const workspace =
          subscription?.workspace ??
          workspaceSummaries.find((item) => item.persona === (subscription?.persona ?? "owner")) ??
          workspaceSummaries[0] ??
          null;
        if (!workspace) return null;
        const title = subscription?.title ?? review.subscriptionId;
        const href = reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: title,
          gap: review.gap,
        });

        return {
          ...review,
          title,
          href,
          subscriptionHref: subscription?.href ?? href,
          persona: workspace.persona,
          gapLabel: reportWorkflowGapFilterLabels[review.gap],
        };
      })
      .filter((review): review is NonNullable<typeof review> => Boolean(review))
      .filter(
        (review) =>
          matchesReportPersona([review.persona], personaFilter) &&
          matchesReportWorkflowSearch([
            review.title,
            review.gapLabel,
            review.detail,
            review.message,
            review.subscriptionId,
          ])
      );
  }, [
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews,
    matchesReportWorkflowSearch,
    personaFilter,
    reportDeliverySubscriptionSummaries,
    workspaceSummaries,
  ]);

  const visibleReportDeliverySubscriptions = useMemo(() => {
    return reportDeliverySubscriptionSummaries.filter(
      (subscription) =>
        matchesReportPersona([subscription.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          subscription.title,
          subscription.audience,
          subscription.cadence,
          subscription.channel,
          subscription.format,
          subscription.recipients,
          subscription.deliveryGuardrail,
          subscription.commandKeywords,
          subscription.reports.map((report) => report.name).join(" "),
          subscription.packTemplate?.title,
          subscription.automationStarter?.title,
          subscription.decisionShortcut?.question,
          subscription.reportSuites.map((suite) => `${suite.title} ${suite.workflow}`).join(" "),
          subscription.preview.suiteTitles.join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDeliverySubscriptionSummaries]);

  const activeReportWorkflowGapFilterLabel = useMemo(() => {
    if (reportWorkflowGapFilter.type === "all" || !reportWorkflowGapFilter.persona) return "";
    const workspace = reportPersonaWorkspaces.find(
      (item) => item.persona === reportWorkflowGapFilter.persona
    );
    return `${reportWorkflowGapFilterLabels[reportWorkflowGapFilter.type]} · ${
      workspace?.navLabel ?? reportWorkflowGapFilter.persona
    }`;
  }, [reportWorkflowGapFilter]);
  const reportWorkflowContextSearchLabel = reportWorkflowSearch.trim();
  const hasReportWorkflowContextFilters =
    personaFilter !== "all" ||
    Boolean(reportWorkflowContextSearchLabel) ||
    reportWorkflowGapFilter.type !== "all";
  const reportWorkflowContextSharePersona: PersonaFilter =
    reportWorkflowGapFilter.persona ?? personaFilter;
  const reportWorkflowContextShareHref = useMemo(
    () =>
      reportWorkflowContextHref({
        persona: reportWorkflowContextSharePersona,
        tab: activeTab,
        search: reportWorkflowContextSearchLabel,
        gap: reportWorkflowGapFilter.type === "all" ? null : reportWorkflowGapFilter.type,
      }),
    [
      activeTab,
      reportWorkflowContextSearchLabel,
      reportWorkflowContextSharePersona,
      reportWorkflowGapFilter.type,
    ]
  );

  const reportDeliveryRunStatusCounts = useMemo(() => {
    const counts: Record<ReportDeliveryRunStatusFilter, number> = {
      all: 0,
      queued: 0,
      sent: 0,
      failed: 0,
    };

    for (const subscription of visibleReportDeliverySubscriptions) {
      for (const run of subscription.deliveryRuns) {
        counts.all += 1;
        if (run.status === "queued" || run.status === "sent" || run.status === "failed") {
          counts[run.status] += 1;
        }
      }
    }

    return counts;
  }, [visibleReportDeliverySubscriptions]);

  const reportDeliveryRunTimelineRows = useMemo(() => {
    return visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns.map((run) => ({
          ...run,
          persona: subscription.persona,
          workspaceLabel: subscription.workspace.navLabel,
          subscriptionTitle: subscription.title,
          subscriptionHref: subscription.href,
        }))
      )
      .filter((run) =>
        matchesReportDeliveryRunStatusFilter(run.status, reportDeliveryRunStatusFilter)
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      )
      .slice(0, 6);
  }, [reportDeliveryRunStatusFilter, visibleReportDeliverySubscriptions]);

  const reportDeliveryRecoverySummary = useMemo(() => {
    const failedRuns = visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns
          .filter((run) => run.status === "failed")
          .map((run) => ({
            ...run,
            subscriptionTitle: subscription.title,
            subscriptionHref: subscription.href,
          }))
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      );
    const retryableSubscriptionCount = new Set(failedRuns.map((run) => run.subscriptionId)).size;
    const reviewSubscriptions = visibleReportDeliverySubscriptions.filter(
      (subscription) => subscription.status !== "Ready to send"
    );
    const latestFailedRun = failedRuns[0] ?? null;
    const firstReviewSubscription = reviewSubscriptions[0] ?? null;

    return {
      failedRunCount: failedRuns.length,
      retryableSubscriptionCount,
      reviewSubscriptionCount: reviewSubscriptions.length,
      nextAction: latestFailedRun
        ? {
            kind: "retry" as const,
            label: "Retry latest failed delivery",
            detail: `${latestFailedRun.subscriptionTitle} failed ${formatDeliveryRunTimestamp(latestFailedRun.createdAt)}. Retry after confirming recipients and guardrails are still valid.`,
            runId: latestFailedRun.id,
            badge: "Recovery",
            badgeVariant: "destructive" as const,
          }
        : firstReviewSubscription
          ? {
              kind: "open" as const,
              label: "Review delivery guardrails",
              detail: `${firstReviewSubscription.title} needs review before the next automated send.`,
              href: firstReviewSubscription.href,
              badge: "Review",
              badgeVariant: "warning" as const,
            }
          : {
              kind: "ready" as const,
              label: "Keep scheduled sends running",
              detail:
                visibleReportDeliverySubscriptions.length > 0
                  ? `${visibleReportDeliverySubscriptions.length} delivery subscriptions are ready for this view.`
                  : "No delivery subscriptions match this view yet.",
              badge: "Ready",
              badgeVariant: "success" as const,
            },
    };
  }, [visibleReportDeliverySubscriptions]);

  const reportDeliveryAutomationCommandTargets = useMemo(() => {
    const nextAction = reportDeliveryRecoverySummary.nextAction;
    const reviewSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.status !== "Ready to send"
      ) ?? null;
    const queueSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.enabled && subscription.status === "Ready to send"
      ) ??
      visibleReportDeliverySubscriptions.find((subscription) => subscription.enabled) ??
      null;
    const comparisonPreset =
      visibleReportComparisonPresets
        .slice()
        .sort(
          (first, second) =>
            second.warningCount - first.warningCount || first.title.localeCompare(second.title)
        )[0] ?? null;

    return {
      retryRunId: nextAction.kind === "retry" ? (nextAction.runId ?? null) : null,
      reviewSubscription,
      queueSubscription,
      comparisonPreset,
    };
  }, [
    reportDeliveryRecoverySummary.nextAction,
    visibleReportComparisonPresets,
    visibleReportDeliverySubscriptions,
  ]);

  const startEditingReportDeliverySubscription = useCallback(
    (subscription: (typeof reportDeliverySubscriptionSummaries)[number]) => {
      setEditingReportDeliverySubscriptionId(subscription.id);
      setReportDeliverySettingsDraft({
        cadence: subscription.cadence,
        channel: subscription.channel,
        format: subscription.format,
        recipients: subscription.recipients,
        deliveryGuardrail: subscription.deliveryGuardrail,
      });
    },
    []
  );

  const updateReportDeliverySettingsDraft = useCallback(
    (field: keyof ReportDeliverySettingsDraft, value: string) => {
      setReportDeliverySettingsDraft((current) => ({ ...current, [field]: value }));
    },
    []
  );

  const reportPackAutomationQueue = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const signals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = signals.filter((item) => item.count > 0);
      const openWorkItemCount = signals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = signals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        signals,
        openSignals,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        status: openSignals.length > 0 ? "Review before send" : "Ready to send",
      };
    });
  }, [automationQueue, workspaceSummaries]);

  const visibleReportPackAutomation = useMemo(() => {
    return reportPackAutomationQueue.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackAutomationQueue]);

  const reportPacksNeedingReview = visibleReportPackAutomation.filter(
    (item) => item.openSignalCount > 0
  ).length;

  const automationCoverageSummary = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const liveReports = workspace.reports.filter((report) => report.status === "live");
      const automatedSignals = Array.from(new Set(liveReports.map((report) => report.automation)));
      const comparisonTypes = new Set(liveReports.map((report) => report.comparison));
      const workflowReportCount = liveReports.filter((report) => reportHref(report)).length;
      const queueSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = queueSignals.filter((item) => item.count > 0);
      const openWorkItemCount = queueSignals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = queueSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        liveReportCount: liveReports.length,
        comparisonTypeCount: comparisonTypes.size,
        automatedSignalCount: automatedSignals.length,
        workflowReportCount,
        playbookCount: workspace.automations.length,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        topSignals: automatedSignals.slice(0, 4),
        status: openSignals.length > 0 ? "Needs review" : "Ready",
      };
    });
  }, [automationQueue, workspaceSummaries]);

  const visibleAutomationCoverage = useMemo(() => {
    return automationCoverageSummary.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [automationCoverageSummary, personaFilter]);

  const reportRoadmap = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const prioritizedPlannedReports = workspace.plannedReports
        .slice()
        .sort(
          (a, b) =>
            (b.roadmapPriority?.score ?? 0) - (a.roadmapPriority?.score ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const plannedAutomationHooks = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.automation))
      );
      const plannedCategories = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.category))
      );
      const plannedWorkflowDependencies = Array.from(
        new Set(
          prioritizedPlannedReports
            .map((report) => report.roadmapPrerequisites?.workflowDependency)
            .filter((dependency): dependency is string => Boolean(dependency))
        )
      );
      const nextReports = prioritizedPlannedReports.slice(0, 4);
      const topPriorityReport = nextReports[0] ?? null;
      const topPriorityImpact =
        topPriorityReport?.roadmapPriority?.impactByPersona[workspace.persona];

      return {
        workspace,
        plannedReports: prioritizedPlannedReports,
        nextReports,
        plannedAutomationHooks,
        plannedCategories,
        plannedWorkflowDependencies,
        topPriorityReport,
        topPriorityImpact,
        topPriorityScore: topPriorityReport?.roadmapPriority?.score ?? 0,
        liveReportCount: workspace.reports.length - workspace.plannedReports.length,
        plannedReportCount: workspace.plannedReports.length,
        prerequisiteCount: workspace.plannedReports.filter((report) => report.roadmapPrerequisites)
          .length,
        roadmapStatus: workspace.plannedReports.length > 0 ? "Roadmap gaps" : "Coverage complete",
        nextWorkflow:
          nextReports.length > 0
            ? (reportPersonaHref(nextReports[0], workspace.persona) ??
              reportWorkspaceHref(workspace))
            : reportWorkspaceHref(workspace),
      };
    });
  }, [workspaceSummaries]);

  const visibleReportRoadmap = useMemo(() => {
    return reportRoadmap.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportRoadmap]);

  const visiblePlannedReportCount = visibleReportRoadmap.reduce(
    (sum, item) => sum + item.plannedReportCount,
    0
  );

  const localReportProductDepthAreas = useMemo<ReportCatalogDiscovery["productDepthAreas"]>(() => {
    return reportProductDepthAreas.map((area) => ({
      ...area,
      href: reportProductDepthAreaHref(area),
      subgoals: area.subgoals.map((subgoal) => ({
        ...subgoal,
        href: reportProductDepthSubgoalHref(area, subgoal),
      })),
    }));
  }, []);

  const reportProductDepthCoverage: ReportCatalogDiscovery["productDepthAreas"] =
    reportCatalogDiscoveryQuery.data?.productDepthAreas ?? localReportProductDepthAreas;

  const visibleReportProductDepthAreas = useMemo<
    ReportCatalogDiscovery["productDepthAreas"]
  >(() => {
    return reportProductDepthCoverage
      .map((area) => ({
        ...area,
        subgoals: area.subgoals
          .filter((subgoal) => matchesReportPersona(subgoal.personas, personaFilter))
          .map((subgoal) => ({
            ...subgoal,
            sourceDrilldownTargets: subgoal.sourceDrilldownTargets?.filter((target) =>
              matchesReportPersona(target.personas, personaFilter)
            ),
          })),
      }))
      .filter((area) => area.subgoals.length > 0);
  }, [personaFilter, reportProductDepthCoverage]);

  const visibleReportProductDepthSubgoalCount = visibleReportProductDepthAreas.reduce(
    (sum, area) => sum + area.subgoals.length,
    0
  );

  const personaReportRecommendations = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const recommendations: Array<{
        id: string;
        title: string;
        detail: string;
        badge: string;
        badgeVariant: BadgeProps["variant"];
        amount?: number;
        tab?: ReportTab;
        href?: string;
      }> = [];

      const queueItems = automationQueue
        .filter((item) => matchesReportPersona(item.personas, workspace.persona))
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const amountDelta = (b.amount ?? 0) - (a.amount ?? 0);
          return Math.abs(amountDelta) > 0.005 ? amountDelta : b.count - a.count;
        });

      for (const item of queueItems.slice(0, 2)) {
        recommendations.push({
          id: `queue-${workspace.persona}-${item.id}`,
          title: item.title,
          detail: item.detail,
          badge: `${item.count} open`,
          badgeVariant: "warning",
          amount: item.amount,
          tab: item.tab,
          href: item.href,
        });
      }

      const comparisonItems = comparisonRows
        .filter((row) => matchesReportPersona(row.personas, workspace.persona))
        .filter((row) => Math.abs(row.delta) > 0.005)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      for (const row of comparisonItems) {
        if (recommendations.length >= 3) break;
        if (recommendations.some((item) => item.tab === row.tab && !item.href)) continue;

        recommendations.push({
          id: `comparison-${workspace.persona}-${row.id}`,
          title: row.label,
          detail: `${row.signal}: ${formatComparisonPercent(row.percentChange)} vs baseline`,
          badge: "Movement",
          badgeVariant: comparisonBadgeVariant(row),
          amount: row.delta,
          tab: row.tab,
        });
      }

      if (workspace.topReadyReport && recommendations.length < 3) {
        recommendations.push({
          id: `primary-${workspace.persona}-${workspace.topReadyReport.id}`,
          title: workspace.topReadyReport.name,
          detail: workspace.topReadyReport.automation,
          badge: reportStatusMeta[workspace.topReadyReport.status].label,
          badgeVariant: reportStatusMeta[workspace.topReadyReport.status].variant,
          tab: workspace.topReadyReport.tab,
          href: workspace.topReadyReport.href,
        });
      }

      return {
        workspace,
        recommendations: recommendations.slice(0, 3),
      };
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);

  const reportPackDeliveryReadiness = useMemo(() => {
    return reportPackAutomationQueue.map((pack) => {
      const workspace = pack.workspace;
      const packComparisonRows = comparisonRows.filter((row) =>
        matchesReportPersona(row.personas, workspace.persona)
      );
      const comparisonWarnings = packComparisonRows.filter(
        (row) => comparisonBadgeVariant(row) === "warning"
      ).length;
      const recommendationCount =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations.length ?? 0;
      const plannedReportCount = workspace.reports.length - workspace.readyReports;
      const checks = [
        {
          id: "ready-reports",
          label: "Report data refreshed",
          detail: `${workspace.readyReports} ready/API-backed reports for ${workspace.title}.`,
          status: workspace.readyReports > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "comparison-snapshot",
          label: "Comparison snapshot attached",
          detail: `${packComparisonRows.length} current-vs-prior signals in the pack.`,
          status: packComparisonRows.length > 0 ? "Ready" : "Review",
          workflow: reportsHref({ tab: workspace.primaryTab, persona: workspace.persona }),
        },
        {
          id: "recommended-actions",
          label: "Recommended actions ranked",
          detail: `${recommendationCount} next-best report actions included.`,
          status: recommendationCount > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "automation-review",
          label: "Automation exceptions reviewed",
          detail:
            pack.openWorkItemCount > 0
              ? `${pack.openWorkItemCount} open work items before delivery.`
              : "No open automation work items.",
          status: pack.openWorkItemCount > 0 ? "Review" : "Ready",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "delivery-cadence",
          label: "Delivery cadence configured",
          detail: workspace.packSchedule.cadence,
          status: workspace.packSchedule.cadence ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "recipients",
          label: "Recipients configured",
          detail: workspace.packSchedule.recipients,
          status: workspace.packSchedule.recipients ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
      ];
      const reviewCount = checks.filter((check) => check.status === "Review").length;
      const automationHealth = calculateReportAutomationHealth({
        readinessPercent: workspace.readiness,
        automationLaneCount: workspace.automationCount,
        comparisonMetricCount: packComparisonRows.length,
        comparisonWarningCount: comparisonWarnings,
        plannedReportCount,
        reviewSignalCount: reviewCount + comparisonWarnings + plannedReportCount,
      });

      return {
        workspace,
        checks,
        reviewCount,
        automationHealth,
        status: reviewCount > 0 ? "Review before send" : "Ready to send",
      };
    });
  }, [comparisonRows, personaReportRecommendations, reportPackAutomationQueue]);

  useEffect(() => {
    if (!reportPackDeliveryReadiness.length) return;

    const timer = window.setTimeout(() => {
      setReportAutomationHealthHistory(
        recordReportAutomationHealthSnapshots(
          reportPackDeliveryReadiness.map((item) => ({
            persona: item.workspace.persona,
            health: item.automationHealth,
          }))
        )
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [reportPackDeliveryReadiness]);

  const reportAutomationHealthTrends = useMemo(() => {
    return reportPackDeliveryReadiness.map((item) => ({
      workspace: item.workspace,
      trend: buildReportAutomationHealthTrend(
        reportAutomationHealthHistory,
        item.workspace.persona,
        item.automationHealth
      ),
    }));
  }, [reportAutomationHealthHistory, reportPackDeliveryReadiness]);

  const visibleReportPackReadiness = useMemo(() => {
    return reportPackDeliveryReadiness.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackDeliveryReadiness]);

  const visibleReportAutomationHealthTrends = useMemo(() => {
    return reportAutomationHealthTrends.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationHealthTrends]);

  const reportAutomationRules = useMemo(() => {
    return workspaceSummaries.flatMap((workspace) => {
      const workspaceSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );

      return workspace.automations.map((playbook) => {
        const linkedReports = playbook.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const liveReportCount = linkedReports.filter((report) => report.status === "live").length;
        const targetWorkflow = reportAutomationPlaybookHref(playbook, workspace.persona);
        const runbookSteps = buildReportAutomationRunbookSteps(workspace, playbook);
        const matchingSignals = workspaceSignals.filter((signal) => {
          if (playbook.href && signal.href === playbook.href) return true;
          if (playbook.tab && signal.tab === playbook.tab) return true;
          return linkedReports.some((report) => report.tab && report.tab === signal.tab);
        });
        const openSignals = matchingSignals.filter((signal) => signal.count > 0);
        const openWorkItemCount = matchingSignals.reduce((sum, signal) => sum + signal.count, 0);
        const amountAtRisk = matchingSignals.reduce((sum, signal) => sum + (signal.amount ?? 0), 0);
        const comparisonMetricCount = comparisonRows.filter(
          (row) =>
            matchesReportPersona(row.personas, workspace.persona) &&
            linkedReports.some((report) => report.tab === row.tab)
        ).length;
        const status =
          openWorkItemCount > 0
            ? "Review before auto-send"
            : liveReportCount === linkedReports.length
              ? "Ready to auto-send"
              : "Setup needed";

        return {
          id: `${workspace.persona}-${playbook.id}`,
          workspace,
          playbook,
          linkedReports,
          liveReportCount,
          reportCount: linkedReports.length,
          matchingSignals,
          openSignals,
          runbookSteps,
          openWorkItemCount,
          amountAtRisk,
          comparisonMetricCount,
          targetWorkflow,
          status,
          statusVariant:
            status === "Ready to auto-send"
              ? ("success" as const)
              : status === "Review before auto-send"
                ? ("warning" as const)
                : ("neutral" as const),
        };
      });
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);

  const visibleReportAutomationRules = useMemo(() => {
    return reportAutomationRules.filter((rule) =>
      matchesReportPersona([rule.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationRules]);

  const reportAutomationRuleReviewCount = visibleReportAutomationRules.filter(
    (rule) => rule.openWorkItemCount > 0 || rule.status === "Setup needed"
  ).length;

  const reportAutomationCommandCenter = useMemo(() => {
    const readyRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === "Ready to auto-send"
    ).length;
    const reviewRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.openWorkItemCount > 0
    ).length;
    const setupRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === "Setup needed"
    ).length;
    const openWorkItemCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.openWorkItemCount,
      0
    );
    const amountAtRisk = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.amountAtRisk,
      0
    );
    const comparisonMetricCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.comparisonMetricCount,
      0
    );
    const reportBundleCount = new Set(
      visibleReportAutomationRules.flatMap((rule) => rule.linkedReports.map((report) => report.id))
    ).size;
    const autoSendCoveragePercent =
      visibleReportAutomationRules.length > 0
        ? Math.round((readyRuleCount / visibleReportAutomationRules.length) * 100)
        : 0;
    const readyPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount === 0
    ).length;
    const reviewPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount > 0
    ).length;
    const topReviewRules = visibleReportAutomationRules
      .filter((rule) => rule.openWorkItemCount > 0 || rule.status === "Setup needed")
      .sort(
        (a, b) =>
          b.openWorkItemCount - a.openWorkItemCount ||
          b.amountAtRisk - a.amountAtRisk ||
          a.playbook.title.localeCompare(b.playbook.title)
      )
      .slice(0, 4);

    return {
      ruleCount: visibleReportAutomationRules.length,
      readyRuleCount,
      reviewRuleCount,
      setupRuleCount,
      openWorkItemCount,
      amountAtRisk,
      comparisonMetricCount,
      reportBundleCount,
      autoSendCoveragePercent,
      readyPackCount,
      reviewPackCount,
      topReviewRules,
    };
  }, [visibleReportAutomationRules, visibleReportPackReadiness]);

  const reportAutomationOperationSummaries = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const packReadiness = reportPackDeliveryReadiness.find(
        (item) => item.workspace.persona === workspace.persona
      );
      const deliverySubscriptions = reportDeliverySubscriptionSummaries.filter(
        (subscription) => subscription.persona === workspace.persona
      );
      const automationRules = reportAutomationRules.filter(
        (rule) => rule.workspace.persona === workspace.persona
      );
      const recommendations =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations ?? [];
      const failedRunCount = deliverySubscriptions.reduce(
        (sum, subscription) =>
          sum + subscription.deliveryRuns.filter((run) => run.status === "failed").length,
        0
      );
      const pausedDeliveryCount = deliverySubscriptions.filter(
        (subscription) => !subscription.enabled
      ).length;
      const setupDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Setup needed"
      ).length;
      const readyDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Ready to send"
      ).length;
      const reviewDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Review before send"
      ).length;
      const readyRuleCount = automationRules.filter(
        (rule) => rule.status === "Ready to auto-send"
      ).length;
      const openWorkItemCount = automationRules.reduce(
        (sum, rule) => sum + rule.openWorkItemCount,
        0
      );
      const amountAtRisk = automationRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const comparisonWarnings = comparisonRows.filter(
        (row) =>
          matchesReportPersona(row.personas, workspace.persona) &&
          comparisonBadgeVariant(row) === "warning"
      ).length;
      const reportCount = workspace.reports.length;
      const reportGapCount = Math.max(0, reportCount - workspace.readyReports);
      const deliveryIssueCount =
        failedRunCount + pausedDeliveryCount + setupDeliveryCount + reviewDeliveryCount;
      const automationScore = packReadiness?.automationHealth.score ?? workspace.readiness;
      const automationHealthVariant =
        packReadiness?.automationHealth.variant ??
        (workspace.readiness >= 85 ? "success" : workspace.readiness >= 60 ? "warning" : "danger");

      const nextAction =
        failedRunCount > 0
          ? {
              label: "Recover failed delivery",
              detail: `${failedRunCount} failed report delivery run${
                failedRunCount === 1 ? "" : "s"
              } can be retried after guardrails are fixed.`,
              href: reportSectionHref(workspace, "delivery-subscriptions"),
              badge: "Recovery",
              badgeVariant: "danger" as const,
            }
          : deliveryIssueCount > 0
            ? {
                label: "Review delivery setup",
                detail: `${deliveryIssueCount} delivery subscription${
                  deliveryIssueCount === 1 ? "" : "s"
                } need setup, guardrail review, or enablement before auto-send.`,
                href: reportSectionHref(workspace, "delivery-subscriptions"),
                badge: "Delivery",
                badgeVariant: "warning" as const,
              }
            : openWorkItemCount > 0
              ? {
                  label: "Clear automation queue",
                  detail: `${openWorkItemCount} open work item${
                    openWorkItemCount === 1 ? "" : "s"
                  } should be resolved before scheduled packs are sent.`,
                  href: reportSectionHref(workspace, "automation-command-center"),
                  badge: "Work queue",
                  badgeVariant: "warning" as const,
                }
              : comparisonWarnings > 0
                ? {
                    label: "Review comparison movement",
                    detail: `${comparisonWarnings} comparison signal${
                      comparisonWarnings === 1 ? "" : "s"
                    } need a note before the next pack delivery.`,
                    href: reportSectionHref(workspace, "recommendations"),
                    badge: "Movement",
                    badgeVariant: "warning" as const,
                  }
                : {
                    label: "Keep automation running",
                    detail: `${readyRuleCount}/${automationRules.length} auto-send rules and ${readyDeliveryCount}/${deliverySubscriptions.length} deliveries are ready.`,
                    href: reportSectionHref(workspace, "automation-command-center"),
                    badge: "Ready",
                    badgeVariant: "success" as const,
                  };

      const status =
        failedRunCount > 0
          ? "Delivery recovery"
          : deliveryIssueCount > 0 || openWorkItemCount > 0 || comparisonWarnings > 0
            ? "Needs review"
            : "Ready to automate";

      return {
        workspace,
        reportCount,
        readyReportCount: workspace.readyReports,
        automationScore,
        automationHealthVariant,
        automationRuleCount: automationRules.length,
        readyRuleCount,
        automationRuleGapCount: Math.max(0, automationRules.length - readyRuleCount),
        deliverySubscriptionCount: deliverySubscriptions.length,
        readyDeliveryCount,
        deliveryGapCount: Math.max(0, deliverySubscriptions.length - readyDeliveryCount),
        reportGapCount,
        failedRunCount,
        openWorkItemCount,
        amountAtRisk,
        comparisonWarnings,
        recommendationCount: recommendations.length,
        nextAction,
        status,
        statusVariant:
          status === "Ready to automate"
            ? ("success" as const)
            : status === "Delivery recovery"
              ? ("destructive" as const)
              : ("warning" as const),
      };
    });
  }, [
    comparisonRows,
    personaReportRecommendations,
    reportAutomationRules,
    reportDeliverySubscriptionSummaries,
    reportPackDeliveryReadiness,
    workspaceSummaries,
  ]);

  const visibleReportAutomationOperations = useMemo(() => {
    return reportAutomationOperationSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationOperationSummaries]);
  const reportAutomationOperationsNeedingReview = visibleReportAutomationOperations.filter(
    (item) => item.status !== "Ready to automate"
  ).length;
  const reportHomeQuickReports = useMemo(() => {
    const seenReportIds = new Set<string>();

    return visibleReportQuickAccessSummaries
      .flatMap((profile) =>
        profile.primaryReports.flatMap((entry) => {
          const key = `${profile.persona}:${entry.report.id}`;
          if (seenReportIds.has(key)) return [];
          seenReportIds.add(key);
          return [{ ...entry, profile }];
        })
      )
      .slice(0, 6);
  }, [visibleReportQuickAccessSummaries]);
  const reportHomeSuites = visibleReportSuiteSummaries.slice(0, personaFilter === "all" ? 3 : 2);
  const reportHomeSavedViews = visibleReportSavedViewSummaries.slice(0, 3);
  const reportHomeAutomationOperation = visibleReportAutomationOperations[0] ?? null;

  const reportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      if (!workspace) return [];

      const operation = reportAutomationOperationSummaries.find(
        (item) => item.workspace.persona === profile.persona
      );
      const profileReports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const starters = profile.automationStarterIds
        .map((starterId) => reportAutomationStarters.find((starter) => starter.id === starterId))
        .filter((starter): starter is (typeof reportAutomationStarters)[number] =>
          Boolean(starter)
        );
      const triggerRules = profile.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const estimate = calculateReportAutomationImpact(profile, {
        readyRuleCount: operation?.readyRuleCount ?? 0,
        readyDeliveryCount: operation?.readyDeliveryCount ?? 0,
        readyReportCount:
          operation?.readyReportCount ??
          profileReports.filter((report) => report.status !== "planned").length,
        openWorkItemCount: operation?.openWorkItemCount ?? 0,
        recommendationCount: operation?.recommendationCount ?? 0,
        amountAtRisk: operation?.amountAtRisk ?? 0,
      });

      return [
        {
          profile,
          workspace,
          estimate,
          reports: profileReports,
          starters,
          triggerRules,
          href: reportSectionHref(workspace, "automation-impact"),
          commandCenterHref: reportSectionHref(workspace, "automation-command-center"),
          starterHref: starters[0]
            ? reportAutomationStarterHref(starters[0])
            : reportWorkspaceHref(workspace),
        },
      ];
    });
  }, [reportAutomationOperationSummaries, workspaceSummaries]);
  const visibleReportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationImpactSummaries]);
  const reportAutomationImpactTotals = useMemo(() => {
    return visibleReportAutomationImpactSummaries.reduce(
      (totals, item) => ({
        estimatedMonthlyHoursSaved:
          totals.estimatedMonthlyHoursSaved + item.estimate.estimatedMonthlyHoursSaved,
        estimatedAutomatedItemCount:
          totals.estimatedAutomatedItemCount + item.estimate.estimatedAutomatedItemCount,
        reviewItemCount: totals.reviewItemCount + item.estimate.reviewItemCount,
        amountAtRisk: totals.amountAtRisk + item.estimate.amountAtRisk,
      }),
      {
        estimatedMonthlyHoursSaved: 0,
        estimatedAutomatedItemCount: 0,
        reviewItemCount: 0,
        amountAtRisk: 0,
      }
    );
  }, [visibleReportAutomationImpactSummaries]);
  const reportAccountantHandoffSummaries = useMemo(() => {
    return visibleReportAutomationOperations.map((item) => {
      const workspace = item.workspace;
      const priorityGap: ReportWorkflowGapFilter | null =
        item.failedRunCount > 0 || item.deliveryGapCount > 0
          ? "delivery-gaps"
          : item.automationRuleGapCount > 0 || item.openWorkItemCount > 0
            ? "rule-gaps"
            : item.reportGapCount > 0
              ? "report-gaps"
              : null;

      return {
        ...item,
        shareHref: reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: reportWorkflowContextSearchLabel,
          gap: priorityGap,
        }),
        gapHref: priorityGap
          ? reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
              gap: priorityGap,
            })
          : reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
            }),
        priorityGap,
        priorityGapLabel: priorityGap ? reportWorkflowGapFilterLabels[priorityGap] : "No open gap",
      };
    });
  }, [reportWorkflowContextSearchLabel, visibleReportAutomationOperations]);
  const reportDeliveryHandoffPreviewByPersona = useMemo(() => {
    return reportAccountantHandoffSummaries.reduce<
      Partial<Record<ReportPersona, NonNullable<ReportDeliveryPlanPreview["handoffRows"]>>>
    >((previews, item) => {
      previews[item.workspace.persona] = [
        {
          label: "Shared context",
          value: item.status,
          status: item.status === "Ready to automate" ? "ready" : "review",
          detail: `${item.readyReportCount}/${item.reportCount} reports, ${item.readyRuleCount}/${item.automationRuleCount} rules, ${item.readyDeliveryCount}/${item.deliverySubscriptionCount} deliveries ready.`,
          href: item.shareHref,
        },
        {
          label: "Priority gap",
          value: item.priorityGapLabel,
          status: item.priorityGap ? "review" : "ready",
          detail: `${item.reportGapCount} report gaps, ${item.automationRuleGapCount} rule gaps, ${item.deliveryGapCount} delivery gaps.`,
          href: item.gapHref,
        },
        {
          label: "Next action",
          value: item.nextAction.label,
          status: item.nextAction.badgeVariant === "success" ? "ready" : "review",
          detail: item.nextAction.detail,
          href: item.nextAction.href,
        },
      ];
      return previews;
    }, {});
  }, [reportAccountantHandoffSummaries]);
  const reportDeliverySubscriptionHasReviewHandoff = useCallback(
    (subscriptionId: string) => {
      const subscription = reportDeliverySubscriptionSummaries.find(
        (item) => item.id === subscriptionId
      );
      if (!subscription) return false;
      const handoffRows =
        reportDeliveryHandoffPreviewByPersona[subscription.persona] ??
        subscription.preview.handoffRows ??
        [];
      return handoffRows.some((row) => row.status === "review");
    },
    [reportDeliveryHandoffPreviewByPersona, reportDeliverySubscriptionSummaries]
  );
  const isReportDeliveryHandoffAcknowledged = useCallback(
    (subscriptionId: string) => Boolean(acknowledgedReportDeliveryHandoffGaps[subscriptionId]),
    [acknowledgedReportDeliveryHandoffGaps]
  );
  const reportDeliveryLauncherPreviewById = useMemo(() => {
    return reportDeliverySubscriptionSummaries.reduce<Record<string, ReportLaunchDeliveryPreview>>(
      (previews, subscription) => {
        const latestRun = subscription.latestDeliveryRun;
        const handoffRows = reportDeliveryHandoffPreviewByPersona[subscription.persona];
        const requiresHandoffAcknowledgement =
          handoffRows?.some((row) => row.status === "review") ?? false;
        previews[subscription.id] = {
          status: subscription.status,
          statusVariant: subscription.statusVariant,
          enabled: subscription.enabled,
          nextRunLabel: subscription.nextRunLabel,
          channel: subscription.channel,
          format: subscription.format,
          recipients: subscription.recipients,
          deliveryGuardrail: subscription.deliveryGuardrail,
          summary: subscription.preview.summary,
          suiteTitles:
            subscription.preview.suiteTitles.length > 0
              ? subscription.preview.suiteTitles
              : subscription.reportSuites.map((suite) => suite.title),
          handoffRows,
          handoffRequiresAcknowledgement: requiresHandoffAcknowledgement,
          handoffAcknowledged: Boolean(acknowledgedReportDeliveryHandoffGaps[subscription.id]),
          latestRunStatus: latestRun?.status,
          latestRunStatusVariant: latestRun
            ? deliveryRunStatusVariant(latestRun.status)
            : undefined,
          latestRunId: latestRun?.id,
          latestRunLabel: latestRun ? formatDeliveryRunTimestamp(latestRun.createdAt) : undefined,
          latestRunDetail: latestRun
            ? `Scheduled ${formatDeliveryRunTimestamp(latestRun.scheduledFor)} - ${latestRun.readyReportCount}/${latestRun.reportCount} reports - ${latestRun.channel}`
            : undefined,
          latestRunError:
            latestRun?.status === "failed"
              ? (latestRun.errorMessage ?? "Retry after fixing delivery settings or guardrails.")
              : null,
          queueDisabled: !subscription.enabled,
        };
        return previews;
      },
      {}
    );
  }, [
    acknowledgedReportDeliveryHandoffGaps,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliverySubscriptionSummaries,
  ]);
  const reportAutomationOperationsLoading =
    automationLoading ||
    comparisonLoading ||
    reportDeliveryPlansQuery.isLoading ||
    reportDeliveryRunsQuery.isLoading;

  const reportPackReadinessNeedingReview = visibleReportPackReadiness.filter(
    (item) => item.reviewCount > 0
  ).length;
  const reportPackReviewCount = Math.max(
    reportPacksNeedingReview,
    reportPackReadinessNeedingReview
  );

  const saveReportDeliverySubscriptionSettings = useMutation({
    mutationFn: ({ subscriptionId, ...settings }: SaveReportDeliverySubscriptionSettingsInput) => {
      if (!selectedCompanyId) throw new Error("Select a company before updating delivery.");
      return apiRequest(
        "PATCH",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/settings`,
        settings
      );
    },
    onSuccess: (result: any, variables) => {
      reportDeliveryPlansQuery.refetch();
      if (variables.subscriptionId === editingReportDeliverySubscriptionId) {
        setEditingReportDeliverySubscriptionId(null);
      }
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const onlyToggledEnabled =
        variables.enabled !== undefined &&
        variables.cadence === undefined &&
        variables.channel === undefined &&
        variables.format === undefined &&
        variables.recipients === undefined &&
        variables.deliveryGuardrail === undefined;
      toast({
        title: onlyToggledEnabled
          ? result?.subscription?.enabled
            ? "Report delivery enabled"
            : "Report delivery paused"
          : "Report delivery settings saved",
        description: `${subscriptionTitle} now uses company delivery settings.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update report delivery",
        description: error?.message || "Failed to update report delivery settings",
        variant: "destructive",
      });
    },
  });

  const queueReportDeliverySubscription = useMutation({
    mutationFn: ({
      subscriptionId,
      acknowledgeHandoffGaps,
    }: {
      subscriptionId: string;
      acknowledgeHandoffGaps?: boolean;
    }) => {
      if (!selectedCompanyId) throw new Error("Select a company before queuing delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/queue`,
        acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true } : undefined
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: "Report delivery queued",
        description: nextRunLabel
          ? `${subscriptionTitle} queued for ${nextRunLabel}.`
          : `${subscriptionTitle} queued as an in-app reminder.`,
      });
    },
    onError: (error: any) => {
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      toast({
        title: "Could not queue report delivery",
        description: error?.message || "Failed to queue report delivery",
        variant: "destructive",
      });
    },
  });
  const queueReportDeliverySubscriptionWithHandoffGuard = useCallback(
    (subscriptionId: string) => {
      if (
        reportDeliverySubscriptionHasReviewHandoff(subscriptionId) &&
        !isReportDeliveryHandoffAcknowledged(subscriptionId)
      ) {
        const subscription = reportDeliverySubscriptionSummaries.find(
          (item) => item.id === subscriptionId
        );
        setAcknowledgedReportDeliveryHandoffGaps((current) => ({
          ...current,
          [subscriptionId]: true,
        }));
        toast({
          title: "Handoff gaps acknowledged",
          description: `${
            subscription?.title ?? "This report delivery"
          } has review gaps in the accountant handoff. Click queue again to send with those gaps acknowledged.`,
        });
        return;
      }

      queueReportDeliverySubscription.mutate({
        subscriptionId,
        acknowledgeHandoffGaps: isReportDeliveryHandoffAcknowledged(subscriptionId),
      });
    },
    [
      isReportDeliveryHandoffAcknowledged,
      queueReportDeliverySubscription,
      reportDeliverySubscriptionHasReviewHandoff,
      reportDeliverySubscriptionSummaries,
      toast,
    ]
  );
  const commandQueueSubscriptionRequiresHandoffAcknowledgement = Boolean(
    reportDeliveryAutomationCommandTargets.queueSubscription &&
    reportDeliverySubscriptionHasReviewHandoff(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    ) &&
    !isReportDeliveryHandoffAcknowledged(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    )
  );

  const retryReportDeliveryRun = useMutation({
    mutationFn: (runId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before retrying delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      toast({
        title: "Report delivery retry queued",
        description: `${subscriptionTitle} was requeued after recovery.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not retry report delivery",
        description: error?.message || "Failed to retry report delivery",
        variant: "destructive",
      });
    },
  });

  const exportDateRangeSuffix =
    dateRange.from && dateRange.to
      ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
      : "";

  const buildWorkspaceReportPack = (
    workspace: (typeof workspaceSummaries)[number]
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
      (rule) => rule.status === "Setup needed"
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
        delivery: workbookReportIds.has(report.id) ? "Included in workbook" : "Open workflow",
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
          value: packOperations?.status ?? "Not available",
          workflow: operationsWorkflow,
        },
        {
          field: "Next action",
          value: packOperations?.nextAction.label ?? "Not available",
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Next action detail",
          value: packOperations?.nextAction.detail ?? "Not available",
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Automation health",
          value: packOperations
            ? `${packOperations.automationScore}/100`
            : packReadiness
              ? `${packReadiness.automationHealth.score}/100`
              : "Not available",
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
                  (subscription) => subscription.status === "Ready to send"
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
          status: packOperations?.status ?? "Not available",
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
                  (subscription) => subscription.status === "Ready to send"
                ).length
              }/${packDeliverySubscriptions.length}`,
          amountAtRisk: `AED ${(packOperations?.amountAtRisk ?? packRuleAmountAtRisk).toFixed(2)}`,
          sharedContext: packSharedContextHref,
          gapWorkflow: packGapHref,
          nextAction: packOperations?.nextAction.label ?? "Not available",
          nextActionDetail: packOperations?.nextAction.detail ?? "Not available",
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
          value: openPackSignals.length > 0 ? "Review before send" : "Ready to send",
        },
        {
          metric: "Operations status",
          value: packOperations?.status ?? "Not available",
        },
        {
          metric: "Operations next action",
          value: packOperations?.nextAction.label ?? "Not available",
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
        { metric: "Roadmap status", value: packRoadmap?.roadmapStatus ?? "Not available" },
        {
          metric: "Top roadmap priority",
          value: packRoadmap?.topPriorityReport
            ? `${packRoadmap.topPriorityReport.name} (${packRoadmap.topPriorityScore})`
            : "Not available",
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
            : "Not available",
        },
        {
          metric: "Automation health review signals",
          value: packReadiness?.automationHealth.reviewSignals ?? 0,
        },
        {
          metric: "Automation health trend",
          value: packHealthTrend
            ? `${packHealthTrend.label} (${packHealthTrend.detail})`
            : "Not available",
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
          value: packReadiness?.status ?? "Not available",
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
        status: item.count > 0 ? "Review before send" : "Clear",
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

  const handleExportWorkspacePack = async (workspace: (typeof workspaceSummaries)[number]) => {
    setIsExporting(true);
    try {
      await exportToExcel(
        buildWorkspaceReportPack(workspace),
        `${workspace.persona}_report_pack${exportDateRangeSuffix}`
      );
      toast({
        title: "Report pack exported",
        description: `${workspace.title} exported to Excel.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error?.message || "Failed to export report pack",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWorkspacePackToSheets = async (
    workspace: (typeof workspaceSummaries)[number]
  ) => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeTitle =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
        : "";

    const result = await exportToGoogleSheets(
      buildWorkspaceReportPack(workspace),
      `${workspace.title}${dateRangeTitle}`,
      selectedCompanyId
    );

    setIsExporting(false);

    if (result?.success) {
      toast({
        title: "Report pack exported",
        description: `${workspace.title} exported to Google Sheets. Opening...`,
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: result?.error || "Failed to export report pack to Google Sheets",
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
      toast({ title: "Export successful", description: "Profit & Loss exported to Excel" });
    } else if (activeTab === "bs" && balanceSheet) {
      exportToExcel([prepareBalanceSheetForExport(balanceSheet)], `balance_sheet${dateRangeStr}`);
      toast({ title: "Export successful", description: "Balance Sheet exported to Excel" });
    } else if (activeTab === "vat" && vatSummary) {
      exportToExcel([prepareVATSummaryForExport(vatSummary)], `vat_summary${dateRangeStr}`);
      toast({ title: "Export successful", description: "VAT Summary exported to Excel" });
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      exportToExcel(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `corporate_tax_estimate${dateRangeStr}`
      );
      toast({
        title: "Export successful",
        description: "Corporate Tax Estimate exported to Excel",
      });
    } else if (activeTab === "trial" && trialBalance) {
      exportToExcel([prepareTrialBalanceForExport(trialBalance)], `trial_balance${dateRangeStr}`);
      toast({ title: "Export successful", description: "Trial Balance exported to Excel" });
    } else if (activeTab === "sales") {
      if (selectedReportId === "ar-aging") {
        exportToExcel(receivableAgingExportSheets, `ar_aging${dateRangeStr}`);
        toast({ title: "Export successful", description: "A/R Aging exported to Excel" });
      } else {
        exportToExcel(
          prepareInvoiceStatusForExport(invoiceStatusReport),
          `invoice_status${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Invoice Status exported to Excel" });
      }
    } else if (activeTab === "balances") {
      if (selectedReportId === "ap-aging") {
        exportToExcel(payableAgingExportSheets, `ap_aging${dateRangeStr}`);
        toast({ title: "Export successful", description: "A/P Aging exported to Excel" });
      } else {
        exportToExcel(
          prepareBalanceSummaryReportsForExport(balanceReport),
          `balance_reports${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Balance reports exported to Excel" });
      }
    } else if (activeTab === "expenses") {
      exportToExcel(
        prepareExpenseReportsForExport(expenseReport),
        `expense_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Expense reports exported to Excel" });
    } else if (activeTab === "payroll") {
      exportToExcel(
        preparePayrollReportsForExport(payrollReport),
        `payroll_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Payroll reports exported to Excel" });
    } else if (activeTab === "ledger") {
      exportToExcel(prepareLedgerReportsForExport(ledgerReport), `general_ledger${dateRangeStr}`);
      toast({ title: "Export successful", description: "General Ledger exported to Excel" });
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
        title: "Export successful",
        description: "Close reports exported to Excel",
      });
    } else if (activeTab === "planning") {
      exportToExcel(
        preparePlanningReportsForExport(planningReport),
        `planning_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Planning reports exported to Excel" });
    }
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
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
        `${selectedReportId === "ar-aging" ? "A/R Aging" : "Invoice Status"}${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "balances") {
      result = await exportToGoogleSheets(
        selectedReportId === "ap-aging"
          ? payableAgingExportSheets
          : prepareBalanceSummaryReportsForExport(balanceReport),
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
        title: "Export successful",
        description: "Report exported to Google Sheets. Opening...",
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: result?.error || "Failed to export to Google Sheets",
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
    accountActivity,
    activeReportViewerOption,
    activeReportWorkflowGapFilterLabel,
    activeReportWorkspaceTab,
    activeTab,
    agingReportLoading,
    applyReportWorkflowGapFilter,
    auditTrailLoading,
    auditTrailPeriodLabel,
    auditTrailReport,
    automationLoading,
    automationQueueCount,
    backToReportsHref,
    balanceReport,
    balanceSheet,
    balancesLoading,
    billAgingLoading,
    bsLoading,
    commandQueueSubscriptionRequiresHandoffAcknowledgement,
    comparisonCurrentLabel,
    comparisonLoading,
    comparisonPreviousLabel,
    comparisonRanges,
    consolidatedStatementsLoading,
    consolidatedStatementsReport,
    corporateTaxBridgeRows,
    corporateTaxEstimate,
    corporateTaxLoading,
    corporateTaxPeriodLabel,
    corporateTaxStatus,
    customerRevenue,
    dateRange,
    depreciationPeriodDate,
    depreciationScheduleReport,
    editingReportDeliverySubscriptionId,
    effectiveReportPersona,
    expenseClaimReport,
    expenseReport,
    expensesLoading,
    fixedAssetRegisterReport,
    handleExportExcel,
    handleExportGoogleSheets,
    handleExportWorkspacePack,
    handleExportWorkspacePackToSheets,
    hasFocusedReportSelection,
    hasReportWorkflowContextFilters,
    inventoryMovementReport,
    inventoryValuationReport,
    invoiceStatusReport,
    isExporting,
    isReportDeliveryHandoffAcknowledged,
    latestReportDeliverySchedulerScan,
    ledgerDetailCurrentPage,
    ledgerDetailPageCount,
    ledgerDetailPageLines,
    ledgerDetailStartIndex,
    ledgerLines,
    ledgerLoading,
    ledgerReport,
    ledgerSourceRows,
    locale,
    monthEndChecklist,
    monthEndCloseLoading,
    monthEndCloseStatus,
    monthEndCompletedChecks,
    monthEndPeriod,
    monthEndPeriodLabel,
    monthEndReadinessPercent,
    monthEndReviewChecks,
    navigate,
    openReportViewerOption,
    overdueCustomerRows,
    payableAgingBuckets,
    payableAgingSummary,
    payrollLoading,
    payrollReport,
    personaFilter,
    personaFilterLabel,
    personaScopeDescription,
    pinReportDeliveryAutomationCommand,
    pinnedReportDeliveryAutomationCommand,
    plLoading,
    planningLoading,
    planningReport,
    productServiceSalesRows,
    productServiceTopShare,
    profitLoss,
    queueReportDeliverySubscription,
    queueReportDeliverySubscriptionWithHandoffGuard,
    receivableAgingRows,
    receivableAgingSummary,
    reportAccountantHandoffSummaries,
    reportAutomationCommandCenter,
    reportAutomationImpactTotals,
    reportAutomationOperationsLoading,
    reportAutomationOperationsNeedingReview,
    reportAutomationRuleReviewCount,
    reportDeliveryAutomationCommandTargets,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliveryLauncherPersona,
    reportDeliveryLauncherPreviewById,
    reportDeliveryRecoverySummary,
    reportDeliveryRunStatusCounts,
    reportDeliveryRunStatusFilter,
    reportDeliveryRunTimelineRows,
    reportDeliverySchedulerGuardrailSkips,
    reportDeliverySchedulerHandoffReviews,
    reportDeliverySchedulerHandoffSkipCount,
    reportDeliverySettingsDraft,
    reportDeliverySubscriptionHasReviewHandoff,
    reportDeliverySubscriptionSummaries,
    reportHomeAutomationOperation,
    reportHomeQuickReports,
    reportHomeSavedViews,
    reportHomeSuites,
    reportInvoices,
    reportPackReviewCount,
    reportSectionClass,
    reportStats,
    reportViewerDescription,
    reportViewerGroups,
    reportViewerMenuDescription,
    reportViewerMenuLabel,
    reportViewerTitle,
    reportWorkflowContextSearchLabel,
    reportWorkflowContextShareHref,
    reportWorkflowGapFilter,
    reportWorkflowSearch,
    reportWorkspacePanelClass,
    resetReportWorkflowContext,
    retryReportDeliveryRun,
    salesLoading,
    salesProductServiceLoading,
    saveReportDeliverySubscriptionSettings,
    selectedCompanyId,
    setActiveTab,
    setDateRange,
    setEditingReportDeliverySubscriptionId,
    setLedgerDetailPage,
    setReportDeliveryRunStatusFilter,
    setReportPersonaFilter,
    setReportWorkspaceTab,
    startEditingReportDeliverySubscription,
    statusSummary,
    t,
    trialBalance,
    trialBalanceLoading,
    trialBalanceSummary,
    updateReportDeliverySettingsDraft,
    updateReportWorkflowSearch,
    vatLoading,
    vatSummary,
    visibleAutomationCoverage,
    visibleAutomationQueue,
    visibleComparisonRows,
    visiblePlannedReportCount,
    visibleReportAutomationHealthTrends,
    visibleReportAutomationImpactSummaries,
    visibleReportAutomationOperations,
    visibleReportAutomationRules,
    visibleReportAutomationStarters,
    visibleReportAutomationTriggerRules,
    visibleReportComparisonPresets,
    visibleReportDecisionShortcuts,
    visibleReportDeliverySubscriptions,
    visibleReportManagementBriefSummaries,
    visibleReportPackAutomation,
    visibleReportPackReadiness,
    visibleReportPackTemplates,
    visibleReportProductDepthAreas,
    visibleReportProductDepthSubgoalCount,
    visibleReportRoadmap,
    visibleReportSuiteSummaries,
    visibleWorkspaceSummaries,
  };
}
