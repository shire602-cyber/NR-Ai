// Reports > header (always shown).
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { BooksStatusStrip } from "@/components/reports/BooksStatusStrip";
import { ReportWorkspaceTab, personaFilters, reportWorkspaceTabs } from "../shared";
import { SiGooglesheets } from "react-icons/si";
import { formatMessage, useI18n } from "@/lib/i18n";
import { pdfLanguageOptions, statementDownloadPath } from "../model/statementDownloads";
import { T } from "@/components/layout/T";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { evidenceSectionHref } from "@/lib/evidenceLinks";
import { useReportsPageContext } from "../context";
import ReportsModeTabs from "./ReportsModeTabs";
import { apiUrl } from "@/lib/api";
import { format } from "date-fns";

/** Catalog reports the server renders as a PDF (server/services/report-render STATEMENT_KINDS). */
const SERVER_PDF_REPORTS = new Set([
  "profit-loss",
  "balance-sheet",
  "trial-balance",
  "cash-flow",
  "general-ledger",
  "ar-aging",
  "ap-aging",
]);

export default function ReportsHeader() {
  const {
    activeReportViewerOption,
    activeReportWorkflowGapFilterLabel,
    activeReportWorkspaceTab,
    backToReportsHref,
    dateRange,
    handleExportExcel,
    handleExportGoogleSheets,
    hasFocusedReportSelection,
    hasReportWorkflowContextFilters,
    isExporting,
    openReportViewerOption,
    personaFilter,
    personaFilterLabel,
    personaScopeDescription,
    reportViewerDescription,
    reportViewerGroups,
    reportViewerMenuDescription,
    reportViewerMenuLabel,
    reportViewerTitle,
    reportWorkflowContextSearchLabel,
    reportWorkflowContextShareHref,
    resetReportWorkflowContext,
    selectedCompanyId,
    setDateRange,
    setReportPersonaFilter,
    setReportWorkspaceTab,
    t,
  } = useReportsPageContext();
  const locale = useI18n((s) => s.locale);
  const focusedReportId = hasFocusedReportSelection ? activeReportViewerOption?.reportId : null;
  const pdfKind =
    focusedReportId && SERVER_PDF_REPORTS.has(focusedReportId) ? focusedReportId : null;
  const pdfParams = new URLSearchParams();
  if (dateRange.from) pdfParams.set("from", format(dateRange.from, "yyyy-MM-dd"));
  if (dateRange.to) pdfParams.set("to", format(dateRange.to, "yyyy-MM-dd"));
  const pdfRange = pdfParams.toString() ? `&${pdfParams.toString()}` : "";
  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title={t["analytics.modeReports"]}
        description={
          (t as any).financialReportsSubtitle ??
          "Financial statements, tax reports and comparisons from your books"
        }
        // Spec 3.11: one primary (Export); audit evidence sits in the overflow menu.
        primaryAction={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={isExporting} data-testid="button-export">
                <Download className="w-4 h-4 me-2" />
                {isExporting ? t["reportCenter.exportingEllipsis"] : t.export}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* X5 (J1): server-rendered PDF (en/ar) for the focused statement, aging or GL. */}
              {pdfKind &&
                selectedCompanyId &&
                pdfLanguageOptions(locale).map((option, index) => (
                  <DropdownMenuItem
                    key={option.lang}
                    asChild
                    data-testid={index === 0 ? "menu-export-pdf" : `menu-export-pdf-${option.lang}`}
                  >
                    <a
                      href={apiUrl(
                        statementDownloadPath(
                          `/api/companies/${selectedCompanyId}/reports/statements/${pdfKind}`,
                          "pdf",
                          option.lang,
                          pdfRange
                        )
                      )}
                      download
                    >
                      <FileText className="w-4 h-4 me-2" />
                      {t[option.labelKey]}
                    </a>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                <FileSpreadsheet className="w-4 h-4 me-2" />
                <T k="reportCenter.exportToExcel" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportGoogleSheets} data-testid="menu-export-sheets">
                <SiGooglesheets className="w-4 h-4 me-2" aria-hidden />
                <T k="reportCenter.exportToGoogleSheets" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        overflowLabel={t["reportCenter.moreActions"]}
        overflowTestId="button-reports-more"
        overflow={
          <DropdownMenuItem asChild data-testid="button-report-proof-trail">
            <Link href={evidenceSectionHref("proof-drilldown")}>
              <FileText className="w-4 h-4 me-2" />
              {(t as any).viewProof}
            </Link>
          </DropdownMenuItem>
        }
      />
      {activeReportWorkspaceTab === "reports" && !hasFocusedReportSelection ? (
        <ReportsModeTabs mode="reports" />
      ) : null}
      {/* R3 (CTO 23): books-balanced / period-lock status on the report screen. */}
      <BooksStatusStrip companyId={selectedCompanyId} />
      {activeReportWorkspaceTab === "reports" ? (
        <section
          className="space-y-4"
          aria-labelledby={hasFocusedReportSelection ? "report-viewer-title" : undefined}
          aria-label={hasFocusedReportSelection ? undefined : (t as any).period}
        >
          {/* Spec 3.11: the catalogue below is the picker; the title and the report menu only
              appear once a report is open. */}
          {hasFocusedReportSelection ? (
            <div className="flex flex-col gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                  {hasFocusedReportSelection ? (
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      data-testid="button-back-to-report-center"
                    >
                      <Link href={backToReportsHref}>
                        <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                        <T k="reportCenter.backToReports" />
                      </Link>
                    </Button>
                  ) : null}
                  {hasFocusedReportSelection && activeReportViewerOption?.categoryLabel ? (
                    <span>{activeReportViewerOption.categoryLabel}</span>
                  ) : null}
                </div>
                <div>
                  <h2 id="report-viewer-title" className="text-h2 font-semibold text-foreground">
                    {reportViewerTitle}
                  </h2>
                  <p className="mt-1 max-w-3xl text-small text-muted-foreground">
                    {reportViewerDescription}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div
            className={
              hasFocusedReportSelection
                ? "grid items-start gap-3 lg:grid-cols-[minmax(16rem,24rem)_minmax(20rem,1fr)]"
                : "grid items-start gap-3 lg:max-w-xl"
            }
          >
            {hasFocusedReportSelection ? (
              <div className="space-y-1.5">
                {/* R3 (CTO 21): the section title already says "Report Center"; the field is the report. */}
                <Label>
                  <T k="reportCenter.reportFieldLabel" />
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto min-h-11 w-full justify-between gap-3 bg-card px-3 py-1.5 text-start"
                      data-testid="button-report-viewer-menu"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {reportViewerMenuLabel}
                        </span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {reportViewerMenuDescription}
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-72"
                    data-testid="menu-report-viewer"
                  >
                    <DropdownMenuLabel>{(t as any).reportCenter}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {reportViewerGroups.map((group) => (
                      <DropdownMenuSub key={group.category}>
                        <DropdownMenuSubTrigger>
                          <span className="min-w-0 flex-1 truncate">{group.label}</span>
                          <span className="me-2 text-xs font-normal text-muted-foreground">
                            {group.options.length}
                          </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto">
                          {group.options.map((option) => (
                            <DropdownMenuItem
                              key={option.id}
                              disabled={!option.href && !option.tab}
                              onSelect={() => openReportViewerOption(option.id)}
                              className="items-start py-2"
                              data-testid={`menu-report-viewer-${option.id}`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{option.label}</span>
                                <span className="block line-clamp-2 text-xs leading-snug text-muted-foreground">
                                  {option.description}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>{(t as any).period ?? "Period"}</Label>
              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            </div>
          </div>
        </section>
      ) : null}
      {activeReportWorkspaceTab !== "reports" ? (
        <>
          <section className="space-y-3" aria-labelledby="role-focus-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="role-focus-title" className="text-h2 font-semibold text-foreground">
                  <T k="reportCenter.roleFocus" />
                </h2>
                <p className="mt-0.5 text-small text-muted-foreground">{personaScopeDescription}</p>
              </div>
              <Badge
                variant={personaFilter === "all" ? "outline" : "info"}
                className="hidden sm:inline-flex"
              >
                {personaFilterLabel}
              </Badge>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t["reportCenter.roleFocusAria"]}
            >
              {personaFilters.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={personaFilter === filter.id ? "default" : "outline"}
                  onClick={() => setReportPersonaFilter(filter.id)}
                  data-testid={`button-role-focus-${filter.id}`}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div
              className="rounded-md border border-border/70 bg-muted/20 p-3"
              data-testid="reports-workflow-context-summary"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-caption font-semibold text-muted-foreground">
                    <T k="reportCenter.savedReportingContext" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="info" data-testid="reports-workflow-context-role">
                      {formatMessage(t["reportCenter.contextRole"], { value: personaFilterLabel })}
                    </Badge>
                    {reportWorkflowContextSearchLabel ? (
                      <Badge variant="outline" data-testid="reports-workflow-context-search">
                        <span className="max-w-[14rem] truncate">
                          {formatMessage(t["reportCenter.contextSearch"], {
                            value: reportWorkflowContextSearchLabel,
                          })}
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <T k="reportCenter.noSavedSearch" />
                      </Badge>
                    )}
                    {activeReportWorkflowGapFilterLabel ? (
                      <Badge variant="outline" data-testid="reports-workflow-context-gap">
                        <span className="max-w-[14rem] truncate">
                          {formatMessage(t["reportCenter.contextGap"], {
                            value: activeReportWorkflowGapFilterLabel,
                          })}
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <T k="reportCenter.noGapFilter" />
                      </Badge>
                    )}
                  </div>
                </div>
                {hasReportWorkflowContextFilters ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={reportWorkflowContextShareHref}
                        data-testid="button-open-report-workflow-context-link"
                      >
                        <T k="reportCenter.openShareLink" />
                        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={resetReportWorkflowContext}
                      data-testid="button-reset-report-workflow-context"
                    >
                      <X className="h-3.5 w-3.5" />
                      <T k="reportCenter.resetContext" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
            <Tabs
              value={activeReportWorkspaceTab}
              onValueChange={(value) => setReportWorkspaceTab(value as ReportWorkspaceTab)}
            >
              <TabsList>
                {reportWorkspaceTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    title={tab.description}
                    data-testid={`reports-workspace-tab-${tab.id}`}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </>
      ) : null}
    </>
  );
}
