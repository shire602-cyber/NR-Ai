import { closeChecklistStatus } from "@/pages/month-end/closeStatus";
import { YearEndFailure } from "@/pages/month-end/YearEndFailure";
import { errorHeading } from "@/lib/error-heading";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import {
  formatDate as formatDisplayDate,
  formatEmbeddedDates,
  formatMonthYear,
  parseCalendarDate,
} from "@/lib/format-date";
import { localizeServerText, type CopyDescriptor } from "@shared/server-copy";
import { lazy, Suspense, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle2,
  Circle,
  Lock,
  Unlock,
  Sparkles,
  FileText,
  RefreshCw,
  Clock,
  AlertTriangle,
  ArrowRight,
  BookOpen,
} from "lucide-react";

// A rejected chunk import resolves to the failure slot, so the rest of the page stays usable.
const YearEndCloseCard = lazy(() =>
  import("@/pages/month-end/YearEndCloseCard").catch(() => ({ default: YearEndFailure }))
);

// ---- Types ----

interface ChecklistItem {
  id: number;
  key?: string;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
  /** Stable keys + params for title/description/details (shared/server-copy.ts). */
  copy?: {
    title: CopyDescriptor | null;
    description: CopyDescriptor | null;
    details: CopyDescriptor | null;
  };
  requiresSignOff?: boolean;
  actionHref?: string;
  actionEndpoint?: string;
  signOff?: {
    stepKey: string;
    signedOffBy: string;
    signedOffByEmail: string | null;
    signedOffAt: string;
    note: string | null;
  } | null;
  effectiveStatus?: "complete" | "incomplete";
}

interface ReopenRequest {
  id: string;
  periodEnd: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

const stepDone = (item: ChecklistItem) => (item.effectiveStatus ?? item.status) === "complete";

interface ChecklistResponse {
  period: string;
  periodStart: string;
  periodEnd: string;
  checklist: ChecklistItem[];
}

interface ValidationResponse {
  period: string;
  ready: boolean;
  summary: string;
  checklist: ChecklistItem[];
}

interface ClosingEntry {
  id: string | null;
  entryNumber: string | null;
  posted?: boolean;
  netIncome?: number;
  date: string;
  memo: string;
  copy?: { memo: CopyDescriptor | null; message: CopyDescriptor | null };
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  totalDebits: number;
  totalCredits: number;
}

interface CloseRecord {
  id: string;
  companyId: string;
  periodEnd: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
  closingEntryId: string | null;
  createdAt: string;
  closedByEmail?: string | null;
  lockType?: "soft" | "hard";
  lockScope?: "month" | "through";
  lockReason?: string | null;
  checklistOverride?: boolean;
  unlockReason?: string | null;
}

interface CloseSettingsResponse {
  postYearEndClosingEntry: boolean;
  requireChecklistToLock: boolean;
  lockThroughDate: string | null;
  permissions: { canLock: boolean; canUnlock: boolean; canReopenHardClose: boolean };
}

interface LockPeriodSubmission {
  companyId: string;
  periodEnd: string;
  lockType: "soft" | "hard";
  overrideChecklist: boolean;
  reason: string;
}

// ---- Fix routes for incomplete items ----
const fixRoutes: Record<number, string> = {
  1: "/bank-reconciliation",
  2: "/invoices",
  3: "/receipts",
  4: "/anomaly-detection",
  5: "/ai-features",
  6: "/fixed-assets",
  7: "/vat-filing",
};

// ---- Component ----

/** Keeps Try again mounted while a retry runs or waits offline, so focus is not dropped. */
function CloseRetryNotice({
  testId,
  scope,
  stale,
  query,
}: {
  testId: string;
  scope: "checklist" | "history";
  /** Cached rows are still shown above or below the notice. */
  stale?: boolean;
  query: { isFetching: boolean; isPaused: boolean; refetch: () => unknown };
}) {
  const { t } = useTranslation();
  const checklist = scope === "checklist";
  const busy = query.isFetching || query.isPaused;
  const message = stale
    ? checklist
      ? t["monthEnd.checklistRefreshFailed"]
      : t["monthEnd.historyRefreshFailed"]
    : checklist
      ? t["monthEnd.checklistLoadFailed"]
      : t["monthEnd.historyLoadFailed"];
  const waiting = checklist
    ? t["monthEnd.checklistWaitingForConnection"]
    : t["monthEnd.historyWaitingForConnection"];
  const retrying = checklist ? t["monthEnd.retryingChecklist"] : t["monthEnd.retryingHistory"];
  return (
    <div
      className={`space-y-3 text-center ${stale ? "py-3" : checklist ? "py-4" : "py-6"}`}
      data-testid={testId}
    >
      <p className="text-sm text-destructive" role="alert">
        {message}
      </p>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={busy}
        onClick={() => {
          if (!busy) query.refetch();
        }}
      >
        {t["monthEnd.retry"]}
      </Button>
      <p className={query.isPaused ? "text-sm text-muted-foreground" : "sr-only"} role="status">
        {query.isPaused ? waiting : query.isFetching ? retrying : ""}
      </p>
    </div>
  );
}

/** A fetch paused offline: nothing has failed, but nothing on screen is verified either. */
function WaitingNotice({ testId, message }: { testId: string; message: string }) {
  return (
    <p
      className="text-muted-foreground text-sm text-center py-6"
      role="status"
      data-testid={testId}
    >
      {message}
    </p>
  );
}

export default function MonthEndClose() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, company, isLoading: isLoadingCompany } = useDefaultCompany();
  const fyStartMonth = (company as { fiscalYearStartMonth?: number | null } | null | undefined)
    ?.fiscalYearStartMonth;

  // Default to previous month
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [selectedYear, setSelectedYear] = useState(String(prevMonth.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(prevMonth.getMonth() + 1));

  const period = useMemo(
    () => `${selectedYear}-${selectedMonth.padStart(2, "0")}`,
    [selectedYear, selectedMonth]
  );

  const periodDates = useMemo(() => {
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const periodEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { periodStart, periodEnd };
  }, [selectedYear, selectedMonth]);

  // ---- Queries ----

  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    isError: isChecklistError,
    isFetching: isFetchingChecklist,
    isPaused: isChecklistPaused,
    isPending: isChecklistPending,
    isFetched: isChecklistFetched,
    refetch: refetchChecklist,
  } = useQuery<ChecklistResponse>({
    queryKey: [`/api/companies/${companyId}/month-end/checklist?period=${period}`],
    enabled: !!companyId,
  });
  const checklistQuery = {
    isFetching: isFetchingChecklist,
    isPaused: isChecklistPaused,
    refetch: refetchChecklist,
  };
  const checklistRetryBusy = isFetchingChecklist || isChecklistPaused;
  // An uncached retry clears the error and sets isLoading, which would swap Try again for skeletons.
  const showChecklistRetry =
    checklistData === undefined &&
    (isChecklistError || (isChecklistPending && isChecklistFetched && checklistRetryBusy));

  const checklistStatus = closeChecklistStatus({
    isLoading: isLoadingChecklist && !showChecklistRetry,
    isError: isChecklistError,
    isPaused: isChecklistPaused,
    items: checklistData?.checklist.map((i) => ({ done: stepDone(i) })),
  });
  // Cached items stay on screen after a failed refresh, but no longer count as verified.
  const checklistStale = isChecklistError && checklistData !== undefined;
  // Stale or paused items can't justify an override: the lock dialog treats them as unknown.
  const checklistKnownIncomplete =
    checklistStatus.state === "incomplete" && !checklistStale && !isChecklistPaused;
  const checklistUnknown = isChecklistPaused || ["error", "empty"].includes(checklistStatus.state);
  const checklistAllClear =
    checklistStatus.state === "complete" && !checklistStale && !isChecklistPaused;
  // A failed refresh reports its own paused retry, so only one notice shows.
  const checklistWaiting = isChecklistPaused && !isChecklistError && (
    <WaitingNotice testId="checklist-waiting" message={t["monthEnd.checklistWaitingToLoad"]} />
  );

  const {
    data: historyData,
    isLoading: isLoadingHistory,
    isError: isHistoryError,
    isFetched: isHistoryFetched,
    isFetching: isFetchingHistory,
    isPaused: isHistoryPaused,
    isPending: isHistoryPending,
    refetch: refetchHistory,
  } = useQuery<CloseRecord[]>({
    queryKey: [`/api/companies/${companyId}/month-end/history`],
    enabled: !!companyId,
  });
  const historyQuery = {
    isFetching: isFetchingHistory,
    isPaused: isHistoryPaused,
    refetch: refetchHistory,
  };
  const historyRetryBusy = isFetchingHistory || isHistoryPaused;
  const historyHasRows = (historyData?.length ?? 0) > 0;
  // No cached rows: keep the retry panel through a paused or in-flight retry.
  const historyUncachedProblem =
    !historyHasRows &&
    (isHistoryError || (isHistoryPending && isHistoryFetched && historyRetryBusy));
  // A paused fetch has not failed and isLoading stays false, with or without cached rows.
  const historyWaiting = isHistoryPaused && !isHistoryError && (
    <WaitingNotice testId="history-waiting" message={t["monthEnd.historyWaitingToLoad"]} />
  );

  const { data: closeSettings } = useQuery<CloseSettingsResponse>({
    queryKey: [`/api/companies/${companyId}/month-end/settings`],
    enabled: !!companyId,
  });

  // W4-A (R08-23): per-step sign-off and the reopen workflow.
  const { data: reopenRequests } = useQuery<ReopenRequest[]>({
    queryKey: [`/api/companies/${companyId}/month-end/reopen-requests`],
    enabled: !!companyId,
  });
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const signOffMutation = useMutation({
    mutationFn: async ({ stepKey, withdraw }: { stepKey: string; withdraw?: boolean }) =>
      withdraw
        ? apiRequest(
            "DELETE",
            `/api/companies/${companyId}/month-end/steps/${stepKey}/sign-off?period=${period}`
          )
        : apiRequest("POST", `/api/companies/${companyId}/month-end/steps/${stepKey}/sign-off`, {
            period,
          }),
    onSuccess: () => {
      refetchChecklist();
    },
    onError: (error: Error) => {
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });
  const reopenRequestMutation = useMutation({
    mutationFn: async ({ periodEnd, reason }: { periodEnd: string; reason: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/month-end/reopen-requests`, {
        periodEnd,
        reason,
      }),
    onSuccess: () => {
      toast({ title: t["compliance.closeReopenRequested"] });
      setReopenTarget(null);
      setReopenReason("");
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/reopen-requests`],
      });
    },
    onError: (error: Error) => {
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });
  const reopenDecisionMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/month-end/reopen-requests/${id}/${decision}`,
        {}
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/reopen-requests`],
      });
      invalidateClose();
    },
    onError: (error: Error) => {
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });

  // Lock form state (R08-05 / R02-19): lock type, checklist override + reason.
  const [lockType, setLockType] = useState<"soft" | "hard">("soft");
  const lockScope = `${companyId}:${period}`;
  const [lockOverrideScope, setLockOverrideScope] = useState<string | null>(null);
  if (lockOverrideScope !== null && lockOverrideScope !== lockScope) {
    setLockOverrideScope(null);
  }
  const lockChecklistOverride = checklistKnownIncomplete && lockOverrideScope === lockScope;
  const [lockReason, setLockReason] = useState("");
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [unlockReason, setUnlockReason] = useState("");

  const invalidateClose = (targetCompanyId = companyId) => {
    for (const key of ["history", "settings"]) {
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${targetCompanyId}/month-end/${key}`],
      });
    }
  };

  // ---- Mutations ----

  const validationMutation = useMutation<ValidationResponse>({
    mutationFn: async () => {
      return apiRequest(
        "GET",
        `/api/companies/${companyId}/month-end/ai-validation?period=${period}`
      );
    },
    onError: (error: Error) => {
      toast({
        title: t["monthEnd.validationError"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const closingEntriesMutation = useMutation<ClosingEntry>({
    mutationFn: async () => {
      return apiRequest("POST", `/api/companies/${companyId}/month-end/generate-closing-entries`, {
        periodStart: periodDates.periodStart,
        periodEnd: periodDates.periodEnd,
      });
    },
    onSuccess: (data) => {
      toast({
        title: t["monthEnd.computedCloseTitle"],
        description: formatMessage(t["monthEnd.computedCloseToast"], {
          lines: data.lines.length,
          net: (data.netIncome ?? 0).toLocaleString(locale === "ar" ? "ar-AE" : "en-AE", {
            minimumFractionDigits: 2,
          }),
        }),
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/checklist`],
      });
      refetchChecklist();
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const lockPeriodMutation = useMutation<CloseRecord, Error, LockPeriodSubmission>({
    mutationFn: async ({ companyId, periodEnd, lockType, overrideChecklist, reason }) => {
      return apiRequest("POST", `/api/companies/${companyId}/month-end/lock-period`, {
        periodEnd,
        lockType,
        ...(overrideChecklist ? { overrideChecklist: true } : {}),
        ...(reason ? { reason } : {}),
      });
    },
    onSuccess: (_, { companyId, periodEnd }) => {
      toast({
        title: t["monthEnd.periodLocked"],
        description: formatMessage(t["monthEnd.periodLockedToast"], {
          date: periodEnd,
        }),
      });
      setLockReason("");
      invalidateClose(companyId);
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const unlockMutation = useMutation<CloseRecord, Error, { periodEnd: string; reason: string }>({
    mutationFn: async ({ periodEnd, reason }) =>
      apiRequest("POST", `/api/companies/${companyId}/period-lock/unlock`, { periodEnd, reason }),
    onSuccess: () => {
      toast({ title: t["monthEnd.unlocked"] });
      setUnlockTarget(null);
      setUnlockReason("");
      invalidateClose();
    },
    onError: (error: Error) => {
      toast({ title: errorHeading(error), description: error?.message, variant: "destructive" });
    },
  });

  const lockReasonValid = !lockChecklistOverride || lockReason.trim().length >= 3;

  // ---- Helpers ----

  const monthFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    month: "long",
  });
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthFormatter.format(new Date(2026, i, 1)),
  }));

  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  function validationSummary(data: ValidationResponse): string {
    const list = data.checklist ?? [];
    const total = list.length;
    const open = list.filter((item) => item.status === "incomplete");
    if (data.ready || open.length === 0) {
      return formatMessage(t["monthEnd.summaryReady"], { total });
    }
    const issues = open.map((item) => {
      const title = localizeServerText(item.title, t, item.copy?.title);
      // F3: server details carry ISO dates ("the VAT period ends 2026-12-31").
      const detail = item.details
        ? formatEmbeddedDates(localizeServerText(item.details, t, item.copy?.details), locale)
        : "";
      return `- ${title}${detail ? ` (${detail})` : ""}`;
    });
    return [
      formatMessage(t["monthEnd.summaryNotReady"], { done: total - open.length, total }),
      ...issues,
    ].join("\n");
  }

  function formatPeriodLabel(p: string): string {
    const [y, m] = p.split("-").map(Number);
    return formatMonthYear(new Date(y, m - 1, 1), locale);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  // Lock-through semantics: a lock covers every date on or before its period end.
  const lockThroughDate = closeSettings?.lockThroughDate ?? null;
  const isCurrentPeriodLocked =
    (lockThroughDate !== null && periodDates.periodEnd <= lockThroughDate) ||
    historyData?.some(
      (record) =>
        record.status === "locked" &&
        String(record.periodEnd).startsWith(`${selectedYear}-${selectedMonth.padStart(2, "0")}`)
    ) ||
    false;

  const completedCount = checklistStatus.done;
  const totalCount = checklistStatus.total;

  // ---- Loading state ----

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              <T k="pageLabels.pleaseCreateACompanyFirstTo" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={t["monthEnd.eyebrowAccounting"]}
        title={<T k="pageLabels.monthEndClose" />}
        description={<T k="pageLabels.reviewValidateAndLockYourMonthly" />}
        actions={
          isCurrentPeriodLocked ? (
            <>
              {isCurrentPeriodLocked && (
                <Badge variant="neutral" className="gap-1.5 px-2.5 py-1">
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  {lockThroughDate
                    ? formatMessage(t["monthEnd.lockedThrough"], {
                        date: formatDisplayDate(lockThroughDate, locale),
                      })
                    : t["monthEnd.periodLocked"]}
                </Badge>
              )}
            </>
          ) : undefined
        }
      />

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium">{t["monthEnd.periodLabel"]}</span>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[160px]" aria-label={t["hr.month"]}>
                <SelectValue placeholder={t["hr.month"]} />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[120px]" aria-label={t["hr.year"]}>
                <SelectValue placeholder={t["hr.year"]} />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchChecklist()}
              disabled={isLoadingChecklist || checklistStatus.state === "waiting"}
            >
              <RefreshCw className={`h-4 w-4 me-2 ${isLoadingChecklist ? "animate-spin" : ""}`} />
              <T k="pages.refresh" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                <T k="pageLabels.closeChecklist" />
              </CardTitle>
              <CardDescription>
                {checklistStatus.state === "loading" || checklistUnknown
                  ? formatPeriodLabel(period)
                  : formatMessage(t["monthEnd.itemsCompleteFor"], {
                      done: completedCount,
                      total: totalCount,
                      period: formatPeriodLabel(period),
                    })}
              </CardDescription>
            </div>
            {checklistStatus.state !== "loading" && (
              <Badge variant={checklistAllClear ? "default" : "secondary"}>
                {checklistAllClear
                  ? t["pages.allClear"]
                  : checklistUnknown || checklistStatus.state === "complete"
                    ? t["monthEnd.checklistUnavailable"]
                    : formatMessage(t["monthEnd.remainingCount"], {
                        count: checklistStatus.remaining,
                      })}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showChecklistRetry ? (
            <CloseRetryNotice testId="checklist-error" scope="checklist" query={checklistQuery} />
          ) : isLoadingChecklist ? (
            <div className="space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : checklistStatus.state === "waiting" ? (
            checklistWaiting
          ) : checklistStatus.state === "error" ? (
            <CloseRetryNotice testId="checklist-error" scope="checklist" query={checklistQuery} />
          ) : checklistData ? (
            <div className="space-y-2">
              {checklistWaiting}
              {checklistStale && (
                <CloseRetryNotice
                  testId="checklist-refresh-error"
                  scope="checklist"
                  stale={checklistData.checklist.length > 0}
                  query={checklistQuery}
                />
              )}
              {checklistStatus.state === "empty" && !checklistStale && !isChecklistPaused && (
                <p
                  className="text-muted-foreground text-sm text-center py-6"
                  data-testid="checklist-empty"
                >
                  {t["monthEnd.checklistEmpty"]}
                </p>
              )}
              {checklistData.checklist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-3">
                    {stepDone(item) ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    ) : (
                      // Spec 3.10: not yet done is neutral; red is reserved for failed checks.
                      <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {localizeServerText(item.title, t, item.copy?.title)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatEmbeddedDates(
                          item.details
                            ? localizeServerText(item.details, t, item.copy?.details)
                            : localizeServerText(item.description, t, item.copy?.description),
                          locale
                        )}
                      </p>
                      {item.signOff && (
                        <p className="text-xs text-success" data-testid={`signoff-${item.key}`}>
                          {formatMessage(t["compliance.closeSignedOffBy"], {
                            user: item.signOff.signedOffByEmail ?? item.signOff.signedOffBy,
                            time: formatDate(item.signOff.signedOffAt),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {item.key && closeSettings?.permissions.canLock && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          signOffMutation.mutate({
                            stepKey: item.key!,
                            withdraw: Boolean(item.signOff),
                          })
                        }
                        disabled={signOffMutation.isPending}
                        data-testid={`button-signoff-${item.key}`}
                      >
                        {item.signOff
                          ? t["compliance.closeWithdrawSignOff"]
                          : t["compliance.closeSignOff"]}
                      </Button>
                    )}
                    {item.status === "incomplete" && (item.actionHref ?? fixRoutes[item.id]) && (
                      <a href={item.actionHref ?? fixRoutes[item.id]}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          <T k="monthEnd.fix" />{" "}
                          <ArrowRight className="h-3 w-3 ms-1 rtl:rotate-180" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              <T k="pageLabels.selectAPeriodToLoadThe" />
            </p>
          )}
        </CardContent>
      </Card>

      {/* AI Validation Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-warning" />
              <CardTitle className="text-lg">
                <T k="pageLabels.aiValidation" />
              </CardTitle>
            </div>
            <Button
              onClick={() => validationMutation.mutate()}
              disabled={validationMutation.isPending}
              variant="outline"
            >
              {validationMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 me-2" />
              )}
              {t["monthEnd.runValidation"]}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {validationMutation.data ? (
            <div
              className={`p-4 rounded-lg border ${
                validationMutation.data.ready
                  ? "border-border bg-card"
                  : "border-warning/40 bg-warning-subtle/40"
              }`}
            >
              <div className="flex items-start gap-3">
                {validationMutation.data.ready ? (
                  <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <p className="font-medium text-sm">
                    {validationMutation.data.ready
                      ? t["monthEnd.readyToClose"]
                      : t["monthEnd.notReady"]}
                  </p>
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans">
                    {validationSummary(validationMutation.data)}
                  </pre>
                </div>
              </div>
            </div>
          ) : validationMutation.isPending ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">
                <T k="pageLabels.runningAiValidation" />
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              {t["monthEnd.runValidationHint"]}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Generate Closing Entries */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={closingEntriesMutation.isPending} className="bg-info hover:bg-info">
              {closingEntriesMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 me-2" />
              )}
              <T k="monthEnd.computeClose" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T k="monthEnd.computeCloseTitle" />
              </AlertDialogTitle>
              <AlertDialogDescription>
                {formatMessage(t["monthEnd.computeCloseBody"], {
                  period: formatPeriodLabel(period),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <T k="pages.cancel" />
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => closingEntriesMutation.mutate()}>
                <T k="monthEnd.computeCloseAction" />
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Lock Period */}
        <AlertDialog onOpenChange={(open) => !open && setLockOverrideScope(null)}>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              disabled={
                lockPeriodMutation.isPending ||
                isCurrentPeriodLocked ||
                closeSettings?.permissions.canLock === false
              }
            >
              {lockPeriodMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 me-2" />
              )}
              <T k="pages.lockPeriod" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T k="pages.lockPeriod" />
              </AlertDialogTitle>
              <AlertDialogDescription>
                {formatMessage(t["monthEnd.lockBody"], { date: periodDates.periodEnd })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="lock-type">
                  <T k="monthEnd.lockType" />
                </Label>
                <Select value={lockType} onValueChange={(v) => setLockType(v as "soft" | "hard")}>
                  <SelectTrigger id="lock-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soft">{t["monthEnd.softLock"]}</SelectItem>
                    <SelectItem value="hard">{t["monthEnd.hardLock"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(checklistKnownIncomplete || checklistUnknown || checklistStale) && (
                <p className="text-sm text-warning flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {checklistKnownIncomplete
                    ? t["monthEnd.checklistIncomplete"]
                    : t["monthEnd.lockChecklistUnavailable"]}
                </p>
              )}
              {checklistKnownIncomplete && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={lockChecklistOverride}
                    onChange={(e) => setLockOverrideScope(e.target.checked ? lockScope : null)}
                    data-testid="checkbox-override-checklist"
                  />
                  <T k="monthEnd.overrideChecklist" />
                </label>
              )}
              <div className="space-y-1">
                <Label htmlFor="lock-reason">
                  <T k="monthEnd.reason" />
                </Label>
                <Input
                  id="lock-reason"
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  placeholder={t["monthEnd.reasonPlaceholder"]}
                />
                {!lockReasonValid && (
                  <p className="text-xs text-destructive">
                    <T k="monthEnd.reasonRequired" />
                  </p>
                )}
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <T k="pages.cancel" />
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  lockPeriodMutation.mutate({
                    companyId,
                    periodEnd: periodDates.periodEnd,
                    lockType,
                    overrideChecklist: lockChecklistOverride,
                    reason: lockReason.trim(),
                  })
                }
                disabled={!lockReasonValid}
                className="bg-destructive hover:bg-destructive"
              >
                <T k="pages.lockPeriod" />
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Closing Entry Result */}
      {closingEntriesMutation.data && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-info" />
              <CardTitle className="text-lg">
                <T k="monthEnd.computedCloseTitle" />
              </CardTitle>
            </div>
            <CardDescription>
              {localizeServerText(
                closingEntriesMutation.data.memo,
                t,
                closingEntriesMutation.data.copy?.memo
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.account" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="monthEnd.debitAed" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="monthEnd.creditAed" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closingEntriesMutation.data.lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <span className="tabular-nums text-xs me-2">{line.accountCode}</span>
                      {line.accountName}
                    </TableCell>
                    <TableCell data-numeric>
                      {line.debit > 0
                        ? line.debit.toLocaleString("en-AE", { minimumFractionDigits: 2 })
                        : ""}
                    </TableCell>
                    <TableCell data-numeric>
                      {line.credit > 0
                        ? line.credit.toLocaleString("en-AE", { minimumFractionDigits: 2 })
                        : ""}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell>
                    <T k="pages.total2" />
                  </TableCell>
                  <TableCell data-numeric>
                    {closingEntriesMutation.data.totalDebits.toLocaleString("en-AE", {
                      minimumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell data-numeric>
                    {closingEntriesMutation.data.totalCredits.toLocaleString("en-AE", {
                      minimumFractionDigits: 2,
                    })}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* History Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              <T k="pageLabels.closeHistory" />
            </CardTitle>
          </div>
          <CardDescription>
            <T k="pageLabels.pastMonthEndClosingsForThis" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* A retry without cached history stays pending while it fetches or waits offline. */}
          {historyUncachedProblem ? (
            <CloseRetryNotice testId="history-error" scope="history" query={historyQuery} />
          ) : isLoadingHistory ||
            (historyData === undefined && !isHistoryFetched && !isHistoryPaused) ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : historyData && historyData.length > 0 ? (
            <div className="space-y-3">
              {historyWaiting}
              {isHistoryError && (
                <CloseRetryNotice
                  testId="history-refresh-error"
                  scope="history"
                  stale
                  query={historyQuery}
                />
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.period" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.closedBy" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.closedAt" />
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyData.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        {(() => {
                          try {
                            const d = parseCalendarDate(record.periodEnd);
                            return formatMonthYear(d, locale);
                          } catch {
                            return record.periodEnd;
                          }
                        })()}
                      </TableCell>
                      <TableCell>
                        {record.status === "locked" ? (
                          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                            <Lock className="h-3 w-3" />
                            <T k="pageLabels.locked" />
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Unlock className="h-3 w-3" />
                            <T k="monthEnd.statusOpen" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.closedByEmail || record.closedBy || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(record.closedAt)}
                      </TableCell>
                      <TableCell>
                        {record.status === "locked" && closeSettings?.permissions.canLock && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="me-2"
                            onClick={() => setReopenTarget(String(record.periodEnd).slice(0, 10))}
                            data-testid={`button-reopen-${String(record.periodEnd).slice(0, 10)}`}
                          >
                            <T k="compliance.closeRequestReopen" />
                          </Button>
                        )}
                        {record.status === "locked" && closeSettings?.permissions.canUnlock && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setUnlockTarget(String(record.periodEnd).slice(0, 10))}
                            data-testid={`button-unlock-${String(record.periodEnd).slice(0, 10)}`}
                          >
                            <Unlock className="h-3 w-3 me-1" />
                            <T k="monthEnd.unlock" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : historyWaiting ? (
            historyWaiting
          ) : (
            <p
              className="text-muted-foreground text-sm text-center py-8"
              data-testid="history-empty"
            >
              <T k="pageLabels.noPeriodClosingsRecordedYet" />
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reopen workflow (W4-A, R08-23) */}
      {(reopenTarget || (reopenRequests ?? []).some((r) => r.status === "pending")) && (
        <Card data-testid="reopen-requests">
          <CardHeader>
            <CardTitle className="text-lg">
              <T k="compliance.closeReopenTitle" />
            </CardTitle>
            <CardDescription>
              <T k="compliance.closeReopenDescription" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {reopenTarget && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1 flex-1 min-w-[240px]">
                  <Label htmlFor="reopen-reason">
                    {formatMessage(t["compliance.closeReopenReasonLabel"], { date: reopenTarget })}
                  </Label>
                  <Input
                    id="reopen-reason"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={reopenReason.trim().length < 3 || reopenRequestMutation.isPending}
                  onClick={() =>
                    reopenRequestMutation.mutate({
                      periodEnd: reopenTarget,
                      reason: reopenReason.trim(),
                    })
                  }
                >
                  <T k="compliance.closeSubmitReopen" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReopenTarget(null)}>
                  <T k="pages.cancel" />
                </Button>
              </div>
            )}
            {(reopenRequests ?? [])
              .filter((r) => r.status === "pending")
              .map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span>
                    {String(r.periodEnd).slice(0, 10)} · {r.reason}
                  </span>
                  {closeSettings?.permissions.canUnlock && (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          reopenDecisionMutation.mutate({ id: r.id, decision: "approve" })
                        }
                        disabled={reopenDecisionMutation.isPending}
                      >
                        <T k="compliance.closeApproveReopen" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reopenDecisionMutation.mutate({ id: r.id, decision: "reject" })
                        }
                        disabled={reopenDecisionMutation.isPending}
                      >
                        <T k="compliance.closeRejectReopen" />
                      </Button>
                    </span>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Year-end close (R11-14) */}
      {closeSettings?.permissions.canLock && (
        <Suspense fallback={<Skeleton className="h-64 w-full" aria-busy="true" />}>
          <YearEndCloseCard
            companyId={companyId}
            fyStartMonth={fyStartMonth}
            postYearEndClosingEntry={closeSettings.postYearEndClosingEntry}
          />
        </Suspense>
      )}

      {/* Unlock with reason (R02-11) */}
      <AlertDialog
        open={unlockTarget !== null}
        onOpenChange={(open) => !open && setUnlockTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="monthEnd.unlockTitle" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {formatMessage(t["monthEnd.unlockBody"], { date: unlockTarget ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="unlock-reason">
              <T k="monthEnd.reason" />
            </Label>
            <Input
              id="unlock-reason"
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              placeholder={t["monthEnd.reasonPlaceholder"]}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={unlockReason.trim().length < 3 || unlockMutation.isPending}
              onClick={() =>
                unlockTarget &&
                unlockMutation.mutate({ periodEnd: unlockTarget, reason: unlockReason.trim() })
              }
            >
              <T k="monthEnd.unlock" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
