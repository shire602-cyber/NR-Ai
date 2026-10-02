import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AlertTriangle, CalendarClock, ChevronRight, Lock, Search } from "lucide-react";
import type { ReportResult } from "@shared/report-result";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsolidationCompanyPicker } from "@/components/reports/ConsolidationCompanyPicker";
import {
  MAX_CONSOLIDATED_COMPANIES,
  hasMixedCurrencies,
  selectedCompanyIds,
} from "@/components/reports/ConsolidationCompanyPicker.logic";
import { ReportExportMenu } from "@/components/reports/ReportExportMenu";
import { ReportParamsBar, paramsAreValid } from "@/components/reports/ReportParamsBar";
import { ReportScheduleDialog } from "@/components/reports/ReportScheduleDialog";
import { ReportTable } from "@/components/reports/ReportTable";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useReportScheduleAccess } from "@/hooks/useReportScheduleAccess";
import { useTranslation } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { ApiError } from "@/lib/queryClient";
import { reportCatalog, type ReportCatalogItem } from "@/lib/reportCatalog";
import { reportCategoryAr, reportNameAr, reportQuestionAr } from "@/lib/reportCatalogI18n";
import { CATEGORY_ORDER } from "@/lib/report-categories";
import { reportUiRule } from "@/lib/report-ui-rules";
import {
  REPORT_SCHEDULES_HREF,
  REPORT_VIEWER_INDEX,
  buildRunQuery,
  buildShareQuery,
  fetchReportPage,
  reportViewerHref,
  stateFromSearch,
  type ReportViewState,
} from "@/lib/reportRunApi";
import { messages as pageMessages } from "./ReportRun.i18n";

const PAGE_SIZE = 250;
const CONSOLIDATED = "consolidated-statements";
const liveReports = reportCatalog.filter(
  (r) => r.status === "live" && r.params && r.params.length > 0
);
const findLive = (id: string | undefined) => liveReports.find((r) => r.id === id);

type Tr = ReturnType<typeof pageMessages.useT>;

function reportName(entry: ReportCatalogItem, locale: string): string {
  return locale === "ar" ? (reportNameAr[entry.id] ?? entry.name) : entry.name;
}
function reportQuestion(entry: ReportCatalogItem, locale: string): string {
  return locale === "ar"
    ? (reportQuestionAr[entry.id] ?? entry.decisionQuestion)
    : entry.decisionQuestion;
}

/** Plain-language text for the error codes the run route answers. */
function errorText(tr: Tr, error: unknown, locale: string): string {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case "ROLE_FORBIDDEN":
      return tr("errorForbidden");
    case "REPORT_NOT_AVAILABLE":
      return tr("errorNotAvailable");
    case "INVALID_RANGE":
      return tr("errorRange");
    case "RANGE_TOO_LONG":
      return tr("errorRangeTooLong");
    case "AS_OF_IN_FUTURE":
      return tr("errorAsOfFuture");
    case "REPORT_TOO_LARGE":
      return tr("errorTooLarge");
    case "MIXED_BASE_CURRENCY":
      return tr("errorMixedCurrency");
    case "TOO_MANY_COMPANIES":
      return tr("errorTooManyCompanies");
    case "UNMATCHED_INTERCOMPANY": {
      const difference = Number(
        (error as ApiError).details &&
          ((error as ApiError).details as { difference?: unknown }).difference
      );
      return Number.isFinite(difference) && difference > 0
        ? `${tr("errorUnmatched")} ${tr("errorUnmatchedDifference", { amount: formatNumber(difference, locale) })}`
        : tr("errorUnmatched");
    }
    case "UNKNOWN_PARAM":
      return tr("errorUnknownParam", { message: (error as Error).message });
    case "COMPARISON_NOT_SUPPORTED":
      return tr("errorComparison");
    default:
      return (error as Error)?.message ?? "";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Index of every live report
// ---------------------------------------------------------------------------------------------------------------

function ReportIndex() {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const [term, setTerm] = useState("");

  const groups = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const matches = liveReports.filter((r) => {
      if (!needle) return true;
      const haystack =
        `${r.name} ${reportNameAr[r.id] ?? ""} ${r.decisionQuestion} ${r.commandKeywords} ${r.category}`.toLowerCase();
      return haystack.includes(needle);
    });
    const byCategory = new Map<string, ReportCatalogItem[]>();
    for (const r of matches) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    const rank = (category: string) => {
      const i = CATEGORY_ORDER.indexOf(category);
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    return [...byCategory.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [term]);
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="space-y-6" data-testid="report-index">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("indexTitle")}
        description={tr("indexDescription")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" data-testid="link-report-schedules">
          <Link href={REPORT_SCHEDULES_HREF}>
            <CalendarClock className="me-2 h-4 w-4" />
            {tr("schedules")}
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={tr("searchPlaceholder")}
            aria-label={tr("searchLabel")}
            className="ps-10"
            data-testid="input-report-search"
          />
        </div>
        <span className="text-sm text-muted-foreground" data-testid="report-index-count">
          {tr("reportCount", { count: shown })}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("noMatches")}</p>
      ) : null}

      {groups.map(([category, list]) => (
        <section key={category} aria-labelledby={`cat-${category}`} className="space-y-3">
          <h2 id={`cat-${category}`} className="text-lg font-semibold">
            {locale === "ar" ? (reportCategoryAr[category] ?? category) : category}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((r) => (
              <Card key={r.id} className="transition-colors hover:border-primary/50">
                <CardContent className="p-4">
                  <Link
                    href={reportViewerHref(r.id)}
                    className="group flex items-start justify-between gap-3"
                    data-testid={`link-report-${r.id}`}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block font-medium group-hover:underline">
                        {reportName(r, locale)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {reportQuestion(r, locale)}
                      </span>
                      {reportUiRule(r.id).sensitive ? (
                        <Badge variant="outline" className="mt-1 gap-1">
                          <Lock className="h-3 w-3" aria-hidden />
                          {tr("limitedReport")}
                        </Badge>
                      ) : null}
                    </span>
                    <ChevronRight
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
                      aria-hidden
                    />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// One report
// ---------------------------------------------------------------------------------------------------------------

/** The days a result covers, in words. Consolidation takes both a range and an as-of day; only the one in use is shown. */
function periodSummary(
  tr: Tr,
  result: ReportResult,
  use: { range: boolean; asOf: boolean }
): string[] {
  const lines: string[] = [];
  const { from, to, asOf, compare } = result.params;
  if (use.range && from && to) lines.push(tr("periodLine", { from, to }));
  if (use.asOf && asOf && !(use.range && from && to)) lines.push(tr("asOfLine", { asOf }));
  if (compare && compare.mode !== "none" && compare.mode !== "budget") {
    const window =
      compare.from && compare.to
        ? tr("periodLine", { from: compare.from, to: compare.to })
        : compare.asOf
          ? tr("asOfLine", { asOf: compare.asOf })
          : "";
    if (window) lines.push(tr("comparedWith", { window }));
  }
  return lines;
}

function dubaiTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t)
    ? ""
    : new Date(t + 4 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

function ReportViewer({ entry }: { entry: ReportCatalogItem }) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const lang = locale === "ar" ? "ar" : "en";
  const { company, companyId, companies } = useDefaultCompany();
  const { canManage } = useReportScheduleAccess(companyId);
  const kinds = entry.params ?? [];
  const reportId = entry.id;
  const fiscalStartMonth = company?.fiscalYearStartMonth ?? 1;
  const isConsolidation = reportId === CONSOLIDATED;
  const [state, setState] = useState<ReportViewState>(() =>
    stateFromSearch(reportId, kinds, typeof window === "undefined" ? "" : window.location.search, {
      fiscalStartMonth,
    })
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const statement = state.filters.statement === "bs" ? "bs" : "pl";
  const showRange = !isConsolidation || statement === "pl";
  const showAsOf = !isConsolidation || statement === "bs";
  const baseValid = paramsAreValid(reportId, kinds, state, showRange, showAsOf);
  const picked = isConsolidation ? selectedCompanyIds(state, companyId) : [];
  const consolidationOk =
    !isConsolidation ||
    (picked.length > 0 &&
      picked.length <= MAX_CONSOLIDATED_COMPANIES &&
      !hasMixedCurrencies(companies ?? [], picked));
  const valid = baseValid && consolidationOk;

  // The consolidation query carries the picked ids (the current company by default).
  const runState = useMemo<ReportViewState>(
    () =>
      isConsolidation
        ? { ...state, filters: { ...state.filters, companyIds: picked.join(",") } }
        : state,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, isConsolidation, picked.join(",")]
  );

  // Keep the choices in the address bar so a reload or a shared link shows the same report.
  const shareQuery = buildShareQuery(reportId, kinds, state);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${shareQuery ? `?${shareQuery}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(window.history.state, "", next);
  }, [shareQuery]);

  const query = buildRunQuery(reportId, kinds, runState, { lang, limit: PAGE_SIZE });
  const result = useInfiniteQuery({
    queryKey: ["report-run", companyId, reportId, query],
    enabled: Boolean(companyId) && valid,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchReportPage(
        companyId as string,
        reportId,
        buildRunQuery(reportId, kinds, runState, { lang, limit: PAGE_SIZE, offset: pageParam })
      ),
    getNextPageParam: (last) =>
      last.page && last.page.offset + last.page.limit < last.page.total
        ? last.page.offset + last.page.limit
        : undefined,
    staleTime: 30_000,
  });

  const first = result.data?.pages[0];
  const rows = useMemo(() => result.data?.pages.flatMap((p) => p.rows) ?? [], [result.data]);

  // Drill links that name an account by its code need the account's id.
  const accounts = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: Boolean(companyId) && entry.drillTarget === "account",
    staleTime: 5 * 60_000,
  });
  const accountIdByCode = useMemo(
    () =>
      new Map<string, string>(
        (Array.isArray(accounts.data) ? accounts.data : [])
          .filter((a) => a?.code && a?.id)
          .map((a) => [String(a.code), String(a.id)])
      ),
    [accounts.data]
  );

  const name = first?.title
    ? lang === "ar"
      ? first.title.ar || first.title.en
      : first.title.en
    : reportName(entry, locale);
  const description = reportQuestion(entry, locale);
  const relatedHref = entry.href && !entry.href.startsWith("/reports/run") ? entry.href : null;

  return (
    <div className="space-y-6" data-testid={`report-viewer-${reportId}`}>
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={name}
        description={description}
        backHref={REPORT_VIEWER_INDEX}
        backLabel={tr("backToReports")}
      />
      <div className="flex flex-wrap items-center gap-2" data-testid="report-actions">
        {relatedHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={relatedHref}>{tr("relatedPage")}</Link>
          </Button>
        ) : null}
        {canManage ? (
          <Button
            variant="outline"
            onClick={() => setScheduleOpen(true)}
            disabled={!companyId}
            data-testid="button-schedule-report"
          >
            <CalendarClock className="me-2 h-4 w-4" />
            {tr("scheduleReport")}
          </Button>
        ) : null}
        <ReportExportMenu
          companyId={companyId}
          reportId={reportId}
          reportName={name}
          kinds={kinds}
          state={runState}
          disabled={!valid}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <ReportParamsBar
            reportId={reportId}
            kinds={kinds}
            state={state}
            onChange={setState}
            companyId={companyId}
            fiscalStartMonth={fiscalStartMonth}
            showRange={showRange}
            showAsOf={showAsOf}
          />
          {isConsolidation ? (
            <ConsolidationCompanyPicker
              companies={companies ?? []}
              currentCompanyId={companyId}
              state={runState}
              onChange={setState}
            />
          ) : null}
        </CardContent>
      </Card>

      {!companyId ? <p className="text-sm text-muted-foreground">{tr("pickCompany")}</p> : null}
      {companyId && !valid ? (
        <p className="text-sm text-muted-foreground">{tr("paramsInvalid")}</p>
      ) : null}

      {result.isError ? (
        <Alert variant="destructive" data-testid="report-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{tr("errorTitle")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{errorText(tr, result.error, locale)}</p>
            {result.error instanceof ApiError && result.error.status < 500 ? null : (
              <Button size="sm" variant="outline" onClick={() => void result.refetch()}>
                {tr("retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {result.isLoading && valid ? (
        <div
          className="space-y-2"
          role="status"
          aria-label={tr("loading")}
          data-testid="report-loading"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {first ? (
        <section className="space-y-3" aria-live="polite">
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
            data-testid="report-meta"
          >
            {periodSummary(tr, first, { range: showRange, asOf: showAsOf }).map((line) => (
              <span key={line} dir="auto">
                {line}
              </span>
            ))}
            <span dir="auto">{tr("generated", { time: dubaiTime(first.generatedAt) })}</span>
            {result.isFetching && !result.isFetchingNextPage ? (
              <span>{tr("refreshing")}</span>
            ) : null}
          </div>

          {first.warnings?.length ? (
            <Alert data-testid="report-warnings">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{tr("warningsTitle")}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc ps-5">
                  {first.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <ReportTable
            columns={first.columns}
            rows={rows}
            totals={first.totals}
            total={first.page?.total}
            drillContext={{ accountIdByCode }}
            hasMore={result.hasNextPage}
            isLoadingMore={result.isFetchingNextPage}
            onLoadMore={() => void result.fetchNextPage()}
          />
        </section>
      ) : null}

      <ReportScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        companyId={companyId}
        reportId={reportId}
        reportName={name}
        kinds={kinds}
        initialState={runState}
      />
    </div>
  );
}

export default function ReportRun() {
  const tr = pageMessages.useT();
  const params = useParams<{ reportId?: string }>();
  const { companyId } = useDefaultCompany();
  if (!params.reportId) return <ReportIndex />;
  const entry = findLive(params.reportId);
  if (!entry) {
    return (
      <div className="space-y-4" data-testid="report-not-found">
        <PageHeader
          eyebrow={tr("eyebrow")}
          title={tr("notFoundTitle")}
          description={tr("notFoundBody")}
          backHref={REPORT_VIEWER_INDEX}
          backLabel={tr("backToReports")}
        />
      </div>
    );
  }
  // A new company or a new report starts from fresh choices.
  return <ReportViewer key={`${companyId}:${entry.id}`} entry={entry} />;
}
