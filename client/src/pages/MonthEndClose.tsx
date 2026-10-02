import { useState, useMemo } from "react";
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
import { useTranslation } from "@/lib/i18n";
import YearEndCloseSection from "@/components/compliance/YearEndCloseSection";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import {
  CalendarCheck,
  CheckCircle2,
  XCircle,
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
import { ChecklistItemText } from "@/components/month-end/ChecklistItemText";
import { RevalueActions } from "@/components/month-end/RevaluationChecklistRow";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useReportScheduleAccess } from "@/hooks/useReportScheduleAccess";
import {
  UNLOCK_AUDIT_HREF,
  canUnlockPeriod,
  lockAllowed,
  lockBody,
  unlockBody,
  unlockReasonOk,
  vatItemOpen,
} from "@/lib/period-lock";
import { messages as pageMessages } from "./MonthEndClose.i18n";

// ---- Types ----

interface ChecklistItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
}

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

/** A month-end close posts nothing (posted: false); it reports what the period earned so the screen can show it. */
interface ClosingEntry {
  posted: false;
  code: string;
  message: string;
  messageAr: string;
  periodStart: string;
  periodEnd: string;
  /** Income less expenses over the period only. Nothing was moved. */
  netProfit: number;
  lines: [];
  entryNumber: null;
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
  8: "/exchange-rates",
};

// ---- Component ----

export default function MonthEndClose() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { myRole, user: signedInUser } = useReportScheduleAccess(companyId);
  const canUnlock = canUnlockPeriod(signedInUser, myRole);
  const [overrideVat, setOverrideVat] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

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
    refetch: refetchChecklist,
  } = useQuery<ChecklistResponse>({
    queryKey: [`/api/companies/${companyId}/month-end/checklist?period=${period}`],
    enabled: !!companyId,
  });

  const { data: historyData, isLoading: isLoadingHistory } = useQuery<CloseRecord[]>({
    queryKey: [`/api/companies/${companyId}/month-end/history`],
    enabled: !!companyId,
  });

  // The VAT return item decides whether locking needs an explicit override.
  // The server has the last word: if it refuses a lock with VAT_RETURN_OPEN the next try shows the warning and override.
  const [serverSaysVatOpen, setServerSaysVatOpen] = useState(false);
  const vatOpen = vatItemOpen(checklistData?.checklist) || serverSaysVatOpen;

  // ---- Mutations ----

  const validationMutation = useMutation<ValidationResponse>({
    mutationFn: async () => {
      return apiRequest(
        "GET",
        `/api/companies/${companyId}/month-end/ai-validation?period=${period}`
      );
    },
    onError: (error: Error) => {
      toast({ title: tr("validationError"), description: error?.message, variant: "destructive" });
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
        title: tr("nothingPosted"),
        description: tr("periodProfitIs", {
          profit: formatCurrency(data.netProfit, "AED", locale),
        }),
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/checklist`],
      });
      refetchChecklist();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const lockPeriodMutation = useMutation<CloseRecord>({
    mutationFn: async () => {
      return apiRequest(
        "POST",
        `/api/companies/${companyId}/month-end/lock-period`,
        lockBody(periodDates.periodEnd, vatOpen, overrideVat, overrideReason)
      );
    },
    onSuccess: () => {
      toast({
        title: tr("periodLocked"),
        description: tr("periodHasBeenLocked", { formatPeriodLabel: formatPeriodLabel(period) }),
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/history`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/checklist`],
      });
      setOverrideVat(false);
      setOverrideReason("");
      setServerSaysVatOpen(false);
    },
    onError: (error: Error) => {
      if ((error as { code?: string }).code === "VAT_RETURN_OPEN") setServerSaysVatOpen(true);
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  // Reopen one locked month. Owner only, with a written reason; the server writes the audit entry.
  const unlockPeriodMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        "/api/period-lock/unlock",
        unlockBody(companyId as string, period, unlockReason)
      ),
    onSuccess: () => {
      toast({
        title: tr("periodUnlocked"),
        description: tr("periodUnlockedDescription", {
          formatPeriodLabel: formatPeriodLabel(period),
        }),
      });
      setUnlockOpen(false);
      setUnlockReason("");
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/history`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/month-end/checklist`],
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("unlockFailed"), description: error?.message, variant: "destructive" });
    },
  });

  // ---- Helpers ----

  const months = [
    { value: "1", label: tr("january") },
    { value: "2", label: tr("february") },
    { value: "3", label: tr("march") },
    { value: "4", label: tr("april") },
    { value: "5", label: tr("may") },
    { value: "6", label: tr("june") },
    { value: "7", label: tr("july") },
    { value: "8", label: tr("august") },
    { value: "9", label: tr("september") },
    { value: "10", label: tr("october") },
    { value: "11", label: tr("november") },
    { value: "12", label: tr("december") },
  ];

  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  function formatPeriodLabel(p: string): string {
    const [y, m] = p.split("-").map(Number);
    const monthName = months.find((mo) => Number(mo.value) === m)?.label || "";
    return `${monthName} ${y}`;
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
        // i18n-ignore: IANA time-zone identifier, not copy
        timeZone: "Asia/Dubai",
        timeZoneName: "short",
      });
    } catch {
      return dateStr;
    }
  }

  const isCurrentPeriodLocked =
    historyData?.some(
      (record) =>
        record.status === "locked" &&
        new Date(record.periodEnd)
          .toISOString()
          .startsWith(`${selectedYear}-${selectedMonth.padStart(2, "0")}`)
    ) || false;

  const completedCount =
    checklistData?.checklist.filter((i) => i.status === "complete").length || 0;
  const totalCount = checklistData?.checklist.length || 7;

  // ---- Loading state ----

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
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
            <p className="text-muted-foreground text-center">{tr("pleaseCreateACompanyFirstTo")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-info-subtle rounded-lg">
            <CalendarCheck className="h-6 w-6 text-info" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tr("monthEndClose")}</h1>
            <p className="text-muted-foreground text-sm">
              {tr("reviewValidateAndLockYourMonthly")}
            </p>
          </div>
        </div>

        {isCurrentPeriodLocked && (
          <Badge variant="destructive" className="flex items-center gap-1 text-sm px-3 py-1">
            <Lock className="h-4 w-4" />
            {tr("periodLocked")}
          </Badge>
        )}
      </div>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium">{tr("period")}</span>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={tr("month")} />
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
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder={tr("year")} />
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
              disabled={isLoadingChecklist}
            >
              <RefreshCw className={`h-4 w-4 me-2 ${isLoadingChecklist ? "animate-spin" : ""}`} />
              {tr("refresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{tr("closeChecklist")}</CardTitle>
              <CardDescription>
                {tr("itemsCompleteFor", {
                  completedCount,
                  totalCount,
                  formatPeriodLabel: formatPeriodLabel(period),
                })}
              </CardDescription>
            </div>
            <Badge variant={completedCount === totalCount ? "default" : "secondary"}>
              {completedCount === totalCount
                ? tr("allClear")
                : tr("remaining", { value: totalCount - completedCount })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingChecklist ? (
            <div className="space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : checklistData ? (
            <div className="space-y-2">
              {checklistData.checklist.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    item.status === "complete"
                      ? "bg-success-subtle border-success/30"
                      : "bg-danger-subtle border-destructive/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {item.status === "complete" ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <ChecklistItemText item={item} />
                  </div>
                  {item.status === "incomplete" && item.id === 8 && companyId && (
                    <RevalueActions companyId={companyId} periodEnd={periodDates.periodEnd} />
                  )}
                  {item.status === "incomplete" && fixRoutes[item.id] && (
                    <a href={fixRoutes[item.id]}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        {tr("fix")} <ArrowRight className="h-3 w-3 ms-1" />
                      </Button>
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              {tr("selectAPeriodToLoadThe")}
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
              <CardTitle className="text-lg">{tr("aiValidation")}</CardTitle>
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
              {tr("runValidation")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {validationMutation.data ? (
            <div
              className={`p-4 rounded-lg border ${
                validationMutation.data.ready
                  ? "bg-success-subtle border-success/30"
                  : "bg-warning-subtle border-warning/30"
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
                    {validationMutation.data.ready ? tr("readyToClose") : tr("notReady")}
                  </p>
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans">
                    {validationMutation.data.summary}
                  </pre>
                </div>
              </div>
            </div>
          ) : validationMutation.isPending ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">{tr("runningAiValidation")}</span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              {tr("clickRunValidationToGetAn")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Generate Closing Entries */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={closingEntriesMutation.isPending || isCurrentPeriodLocked}
              className="bg-info hover:bg-info"
            >
              {closingEntriesMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 me-2" />
              )}
              {tr("reviewClosingSummary")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("reviewClosingSummary")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr("closingSummaryExplained", {
                  formatPeriodLabel: formatPeriodLabel(period),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => closingEntriesMutation.mutate()}>
                {tr("showSummary")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Lock Period */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              disabled={lockPeriodMutation.isPending || isCurrentPeriodLocked}
            >
              {lockPeriodMutation.isPending ? (
                <RefreshCw className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 me-2" />
              )}
              {tr("lockPeriod")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("lockPeriod")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr("lockingWillPreventAnyModificationsTo", {
                  formatPeriodLabel: formatPeriodLabel(period),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {vatOpen ? (
              <div
                className="space-y-3 rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm"
                role="alert"
                data-testid="lock-vat-warning"
              >
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  {tr("lockVatWarning")}
                </p>
                <p className="text-muted-foreground">{tr("lockVatWarningDetail")}</p>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="lock-override-vat"
                    checked={overrideVat}
                    onCheckedChange={(v) => setOverrideVat(v === true)}
                    data-testid="checkbox-lock-override-vat"
                  />
                  <Label htmlFor="lock-override-vat" className="cursor-pointer font-normal">
                    {tr("lockVatOverrideLabel")}
                  </Label>
                </div>
                {overrideVat ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="lock-override-reason">{tr("lockOverrideReasonLabel")}</Label>
                    <Textarea
                      id="lock-override-reason"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder={tr("lockOverrideReasonPlaceholder")}
                      rows={2}
                      maxLength={500}
                      data-testid="input-lock-override-reason"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setOverrideVat(false);
                  setOverrideReason("");
                }}
              >
                {tr("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => lockPeriodMutation.mutate()}
                disabled={!lockAllowed(vatOpen, overrideVat, overrideReason)}
                className="bg-destructive hover:bg-destructive"
                data-testid="button-confirm-lock"
              >
                {tr("lockPeriod")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Unlock Period: one month, owner only, with a reason */}
        {isCurrentPeriodLocked ? (
          canUnlock ? (
            <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" data-testid="button-unlock-period">
                  <Unlock className="h-4 w-4 me-2" />
                  {tr("unlockPeriod")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {tr("unlockPeriodTitle", { formatPeriodLabel: formatPeriodLabel(period) })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{tr("unlockPeriodExplained")}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="unlock-reason">{tr("unlockReasonLabel")}</Label>
                  <Textarea
                    id="unlock-reason"
                    value={unlockReason}
                    onChange={(e) => setUnlockReason(e.target.value)}
                    placeholder={tr("unlockReasonPlaceholder")}
                    rows={3}
                    maxLength={500}
                    aria-invalid={unlockReason.trim() !== "" && !unlockReasonOk(unlockReason)}
                    data-testid="input-unlock-reason"
                  />
                  {!unlockReasonOk(unlockReason) ? (
                    <p className="text-xs text-muted-foreground">{tr("unlockReasonRule")}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {tr("unlockAuditNote")}{" "}
                    <Link href={UNLOCK_AUDIT_HREF} className="underline">
                      {tr("unlockAuditLink")}
                    </Link>
                  </p>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      if (unlockReasonOk(unlockReason)) unlockPeriodMutation.mutate();
                    }}
                    disabled={!unlockReasonOk(unlockReason) || unlockPeriodMutation.isPending}
                    data-testid="button-confirm-unlock"
                  >
                    {unlockPeriodMutation.isPending ? tr("unlocking") : tr("unlockPeriod")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="unlock-owner-only">
              {tr("unlockOwnerOnly")}
            </p>
          )
        ) : null}
      </div>

      {/* Closing summary: nothing is posted by a month-end close */}
      {closingEntriesMutation.data && (
        <Card data-testid="month-end-closing-summary">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-info" />
              <CardTitle className="text-lg">{tr("closingSummaryTitle")}</CardTitle>
            </div>
            <CardDescription>{tr("nothingWasPosted")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {tr("profitForPeriod", { formatPeriodLabel: formatPeriodLabel(period) })}
              </div>
              <div
                dir="ltr"
                className={`text-2xl font-bold tabular-nums ${closingEntriesMutation.data.netProfit < 0 ? "text-destructive" : "text-success"}`}
                data-testid="month-end-period-profit"
              >
                {formatCurrency(closingEntriesMutation.data.netProfit, "AED", locale)}
              </div>
            </div>
            <p className="text-sm text-muted-foreground" data-testid="month-end-closing-message">
              {locale === "ar"
                ? closingEntriesMutation.data.messageAr
                : closingEntriesMutation.data.message}
            </p>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* History Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">{tr("closeHistory")}</CardTitle>
          </div>
          <CardDescription>{tr("pastMonthEndClosingsForThis")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : historyData && historyData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("period2")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead>{tr("closedBy")}</TableHead>
                  <TableHead>{tr("closedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      {(() => {
                        try {
                          const d = new Date(record.periodEnd);
                          return d.toLocaleDateString(
                            locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE",
                            { year: "numeric", month: "long", timeZone: "UTC" }
                          );
                        } catch {
                          return record.periodEnd;
                        }
                      })()}
                    </TableCell>
                    <TableCell>
                      {record.status === "locked" ? (
                        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                          <Lock className="h-3 w-3" />
                          {tr("locked")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                          <Unlock className="h-3 w-3" />
                          {tr("open")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {record.closedByEmail || record.closedBy || "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(record.closedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">
              {tr("noPeriodClosingsRecordedYet")}
            </p>
          )}
        </CardContent>
      </Card>

      <YearEndCloseSection companyId={companyId} />
    </div>
  );
}
