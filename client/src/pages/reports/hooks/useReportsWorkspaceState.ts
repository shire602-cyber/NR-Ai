// Reports workspace state: URL tab/persona/workspace, catalog discovery API, report viewer options, workflow search and pinned delivery commands.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import type { DateRange } from "@/components/DateRangeFilter";
import {
  PersonaFilter,
  ReportDeliveryRunStatusFilter,
  ReportDeliverySettingsDraft,
  ReportViewerGroup,
  ReportViewerOption,
  ReportWorkflowFinderGapFilter,
  ReportWorkflowGapFilterState,
  ReportWorkspaceTab,
  SaveReportDeliveryAutomationPreferenceInput,
  personaFilterFromSearch,
  personaFilters,
  reportDeliveryAutomationCommandLabels,
  reportIdFromSearch,
  reportTabFromSearch,
  reportViewerCategoryForReport,
  reportViewerCategoryLabel,
  reportViewerCategoryRank,
  reportViewerPersonaForReport,
  reportWorkflowGapFilterFromSearch,
  reportWorkflowSearchFromSearch,
  reportWorkspaceTabFromLocation,
  reportsWorkspaceHref,
} from "../shared";
import {
  type ReportCatalogDiscovery,
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
} from "@/lib/reportCatalogApi";
import {
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
  type ReportTab,
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
  setPreferredReportDeliveryAutomationCommand,
  setPreferredReportPersona,
  setPreferredReportWorkflowGapFilter,
  setPreferredReportWorkflowSearch,
} from "@/lib/reportCatalog";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { reportCategoryAr, reportNameAr, reportQuestionAr } from "@/lib/reportCatalogI18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";

export function useReportsWorkspaceState() {
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
  // Back to the first ledger page whenever the report, range or company changes.
  const ledgerDetailPageScope = [
    activeReportId,
    dateRange.from,
    dateRange.to,
    selectedCompanyId,
  ] as const;
  const [seenLedgerDetailPageScope, setSeenLedgerDetailPageScope] = useState(ledgerDetailPageScope);
  if (ledgerDetailPageScope.some((dep, i) => !Object.is(dep, seenLedgerDetailPageScope[i]))) {
    setSeenLedgerDetailPageScope(ledgerDetailPageScope);
    setLedgerDetailPage(1);
  }
  useEffect(() => {
    const currentSearch = locationSearch || window.location.search;
    const urlWorkflowSearch = reportWorkflowSearchFromSearch(currentSearch);
    if (urlWorkflowSearch !== null) {
      // Syncs from the URL and persists to localStorage (external systems).
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

    // Syncs from the URL (external system); keeps the same object when unchanged.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return {
    t,
    locale,
    toast,
    selectedCompanyId,
    accessibleCompanies,
    navigate,
    dateRange,
    setDateRange,
    isExporting,
    setIsExporting,
    ledgerDetailPage,
    setLedgerDetailPage,
    reportAutomationHealthHistory,
    setReportAutomationHealthHistory,
    editingReportDeliverySubscriptionId,
    setEditingReportDeliverySubscriptionId,
    reportDeliveryRunStatusFilter,
    setReportDeliveryRunStatusFilter,
    acknowledgedReportDeliveryHandoffGaps,
    setAcknowledgedReportDeliveryHandoffGaps,
    setPinnedReportDeliveryAutomationCommands,
    reportDeliverySettingsDraft,
    setReportDeliverySettingsDraft,
    activeTab,
    activeReportWorkspaceTab,
    personaFilter,
    reportWorkflowSearch,
    reportWorkflowGapFilter,
    reportCatalogDiscoveryQuery,
    syncedReportCatalogSummary,
    syncedReportPersonaSummaries,
    reportActionContextByPersonaReportId,
    setActiveTab,
    setReportWorkspaceTab,
    setReportPersonaFilter,
    effectiveReportPersona,
    reportViewerGroups,
    activeReportViewerOption,
    selectedReportId,
    hasFocusedReportSelection,
    reportViewerTitle,
    reportViewerDescription,
    reportViewerMenuLabel,
    reportViewerMenuDescription,
    openReportViewerOption,
    reportSectionClass,
    personaFilterLabel,
    personaScopeDescription,
    matchesReportWorkflowSearch,
    updateReportWorkflowSearch,
    applyReportWorkflowGapFilter,
    resetReportWorkflowContext,
    reportDeliveryLauncherPersona,
    pinnedReportDeliveryAutomationCommand,
    pinReportDeliveryAutomationCommand,
  };
}

export type ReportsWorkspaceStateState = ReturnType<typeof useReportsWorkspaceState>;
