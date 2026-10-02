import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CALENDAR_DATE_SHORT_FORMAT,
  formatCurrency,
  formatDate as formatLocaleDate,
} from "@/lib/format";
import { statusLabel } from "@/lib/enum-labels";
import { useI18n } from "@/lib/i18n";
import { FiledElsewhereDialog } from "@/components/vat/FiledElsewhereDialog";
import { VatEmirateBreakdown } from "@/components/vat/VatEmirateBreakdown";
import { PageHeader } from "@/components/ui/page-header";
import DraftPreviewBanner from "@/components/vat/DraftPreviewBanner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Send,
  Loader2,
  XCircle,
} from "lucide-react";
import { messages as pageMessages } from "./VATAutopilot.i18n";

// ─── Types matching the server's VAT autopilot service ───────────────────────

type VatPeriodStatus = "draft" | "ready" | "submitted" | "accepted" | "filed_elsewhere";

interface DeadlineStatus {
  daysUntilDue: number;
  level: "ok" | "warning" | "critical" | "overdue";
  isOverdue: boolean;
}

interface VatPeriodSummary {
  id: string | null;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  frequency: "monthly" | "quarterly";
  status: VatPeriodStatus;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  calculatedAt: string | null;
  deadline: DeadlineStatus;
  /** Open period: a live draft preview that is never saved or filed. */
  isDraftPreview?: boolean;
}

interface DueDateView {
  companyId: string;
  companyName: string;
  trnVatNumber: string | null;
  periodEnd: string;
  dueDate: string;
  status: VatPeriodStatus;
  daysUntilDue: number;
  level: "ok" | "warning" | "critical" | "overdue";
}

interface CalculationResult {
  companyId: string;
  periodId: string | null;
  /** true when the period has not ended; the period cannot be submitted yet */
  isDraftPreview?: boolean;
  previewAsOf?: string | null;
  period: { start: string; end: string; dueDate: string; frequency: "monthly" | "quarterly" };
  boxes: {
    standardRatedSales: number;
    standardRatedVat: number;
    zeroRatedSales: number;
    exemptSales: number;
    reverseChargeAmount: number;
    reverseChargeVat: number;
    totalOutputVat: number;
    totalExpenses: number;
    inputVatGross: number;
    inputVatRecoverable: number;
    inputVatIrrecoverable: number;
    reverseChargeVatRecoverable: number;
    totalInputVat: number;
    netVatPayable: number;
  };
  reconciliation: {
    outputVatLedger: number;
    outputVatCalculated: number;
    outputVatDelta: number;
    inputVatLedger: number;
    inputVatCalculated: number;
    inputVatDelta: number;
    hasDiscrepancy: boolean;
  };
  invoicesProcessed: number;
  receiptsProcessed: number;
  partialExemption: { exemptSupplyRatio: number; recoverableRatio: number };
  vat201: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<VatPeriodStatus, "default" | "secondary" | "destructive" | "outline"> =
  {
    draft: "outline",
    ready: "default",
    submitted: "secondary",
    accepted: "secondary",
    filed_elsewhere: "secondary",
  };

const LEVEL_BADGE: Record<DeadlineStatus["level"], { label: string; className: string }> = {
  ok: {
    get label() {
      return pageMessages.t("onTrack");
    },
    className: "bg-success-subtle text-success-subtle-foreground",
  },
  warning: {
    get label() {
      return pageMessages.t("dueSoon");
    },
    className: "bg-warning-subtle text-warning-subtle-foreground",
  },
  critical: {
    get label() {
      return pageMessages.t("critical");
    },
    className: "bg-warning-subtle text-warning-subtle-foreground",
  },
  overdue: {
    get label() {
      return pageMessages.t("overdue");
    },
    className: "bg-danger-subtle text-danger-subtle-foreground",
  },
};

function formatDate(iso: string): string {
  // Period boundaries are UTC instants (e.g. 30 Jun 23:59:59.999Z). Format the UTC calendar date: local-time
  // formatting in UAE (UTC+4) would roll the period end over to "01 Jul". Month names follow the reader's language.
  return formatLocaleDate(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
    useI18n.getState().locale,
    CALENDAR_DATE_SHORT_FORMAT
  );
}

function periodKey(period: Pick<VatPeriodSummary, "periodStart" | "periodEnd">): string {
  return `${period.periodStart}::${period.periodEnd}`;
}

function periodLabel(period: Pick<VatPeriodSummary, "periodStart" | "periodEnd" | "frequency">) {
  return `${formatDate(period.periodStart)} - ${formatDate(period.periodEnd)} (${statusLabel(period.frequency, useI18n.getState().locale)})`;
}

function calculationPath(companyId: string, period: VatPeriodSummary): string {
  const params = new URLSearchParams({
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    frequency: period.frequency,
  });
  return `/api/vat/autopilot/calculate/${companyId}?${params.toString()}`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VATAutopilot() {
  const tr = pageMessages.useT();
  const locale = useI18n((state) => state.locale);

  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const { toast } = useToast();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentBox, setAdjustmentBox] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);

  const periodsQuery = useQuery<VatPeriodSummary[]>({
    queryKey: ["/api/vat/autopilot/periods", companyId],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/vat/autopilot/periods/${companyId}`),
  });

  const dueDatesQuery = useQuery<DueDateView[]>({
    queryKey: ["/api/vat/autopilot/due-dates", companyId],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/vat/autopilot/due-dates?companyId=${companyId}`),
  });

  const periods = periodsQuery.data || [];
  const selectedPeriod = useMemo(
    () => periods.find((p) => periodKey(p) === selectedPeriodKey) || null,
    [periods, selectedPeriodKey]
  );

  useEffect(() => {
    if (!periodsQuery.data) return;
    if (!selectedPeriodKey) return;
    if (!periodsQuery.data.some((p) => periodKey(p) === selectedPeriodKey)) {
      setSelectedPeriodKey(null);
    }
  }, [periodsQuery.data, selectedPeriodKey]);

  const calcMutation = useMutation<CalculationResult, Error, VatPeriodSummary>({
    mutationFn: (period) => {
      if (!companyId) throw new Error("Choose a company before calculating VAT.");
      return apiRequest("GET", calculationPath(companyId, period));
    },
    onSuccess: (calc) => {
      setSelectedPeriodKey(
        periodKey({ periodStart: calc.period.start, periodEnd: calc.period.end })
      );
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/due-dates", companyId] });
      toast({
        title: tr("vatReturnRecalculated"),
        description: tr("allBoxesUpdatedFor", {
          formatDate: formatDate(calc.period.start),
          formatDate2: formatDate(calc.period.end),
        }),
      });
    },
    onError: (err: any) => {
      toast({
        title: tr("calculationFailed"),
        description: err?.message || tr("couldNotAutoCalculateVatReturn"),
        variant: "destructive",
      });
    },
  });

  const lastCalc = calcMutation.data;
  const lastCalcPeriodKey = lastCalc
    ? periodKey({ periodStart: lastCalc.period.start, periodEnd: lastCalc.period.end })
    : null;
  const visibleCalc = lastCalc && selectedPeriodKey === lastCalcPeriodKey ? lastCalc : null;
  // An open period is compute-only: it has no saved row, so no status or
  // adjustment actions apply until the period has ended and is recalculated.
  const isPreviewPeriod = visibleCalc
    ? !!visibleCalc.isDraftPreview
    : !!selectedPeriod?.isDraftPreview;
  const currentPeriodId = isPreviewPeriod
    ? null
    : (visibleCalc?.periodId ?? selectedPeriod?.id ?? null);
  const currentPeriodStatus: VatPeriodStatus | null = useMemo(() => {
    if (!periodsQuery.data) return null;
    if (currentPeriodId) {
      const byId = periodsQuery.data.find((p) => p.id === currentPeriodId);
      if (byId) return byId.status;
    }
    if (visibleCalc) {
      const byPeriod = periodsQuery.data.find(
        (p) => p.periodStart === visibleCalc.period.start && p.periodEnd === visibleCalc.period.end
      );
      if (byPeriod) return byPeriod.status;
    }
    return selectedPeriod?.status ?? null;
  }, [periodsQuery.data, currentPeriodId, selectedPeriod, visibleCalc]);

  const parsedAdjustmentAmount = Number(adjustmentAmount);
  const adjustmentAmountValid =
    adjustmentAmount.trim() !== "" &&
    Number.isFinite(parsedAdjustmentAmount) &&
    parsedAdjustmentAmount !== 0;

  const adjustmentMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/vat/autopilot/adjustments", {
        companyId,
        periodId: currentPeriodId,
        box: adjustmentBox,
        amount: parsedAdjustmentAmount,
        reason: adjustmentReason,
      }),
    onSuccess: () => {
      toast({ title: tr("adjustmentSaved"), description: tr("itWillAppearInTheAudit") });
      setAdjustmentOpen(false);
      setAdjustmentReason("");
      setAdjustmentAmount("0");
      setAdjustmentBox("");
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
    },
    onError: (err: any) => {
      toast({
        title: tr("couldNotSaveAdjustment"),
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ periodId, status }: { periodId: string; status: VatPeriodStatus }) =>
      apiRequest("PATCH", `/api/vat/autopilot/periods/${periodId}/status`, { status, companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/due-dates", companyId] });
      toast({ title: tr("statusUpdated") });
    },
    onError: (err: any) => {
      toast({ title: tr("statusUpdateFailed"), description: err?.message, variant: "destructive" });
    },
  });

  const upcoming = useMemo(() => {
    return (dueDatesQuery.data || []).filter((d) => d.companyId === companyId).slice(0, 5);
  }, [dueDatesQuery.data, companyId]);

  if (companyLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{tr("vatAutopilot")}</h1>
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            {tr("setUpACompanyBeforeUsing")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow={tr("compliance")}
        title={tr("vatAutopilot")}
        description={tr("autoCalculateTheUaeFtaVat")}
        backHref="/vat-filing"
        backLabel={tr("backToVatFiling")}
        actions={
          <Button
            onClick={() => selectedPeriod && calcMutation.mutate(selectedPeriod)}
            disabled={calcMutation.isPending || !selectedPeriod}
            data-testid="button-calculate-now"
          >
            {calcMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 me-2" />
            )}
            {selectedPeriod ? tr("calculateSelectedPeriod") : tr("choosePeriodFirst")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{tr("filingPeriod")}</CardTitle>
          <CardDescription>{tr("chooseTheVatReturnPeriodFirst")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2 md:min-w-[360px]">
            <Label htmlFor="vat-filing-period">{tr("periodToFile")}</Label>
            <Select
              value={selectedPeriodKey ?? ""}
              onValueChange={setSelectedPeriodKey}
              disabled={periodsQuery.isLoading || periods.length === 0 || calcMutation.isPending}
            >
              <SelectTrigger id="vat-filing-period" data-testid="select-vat-filing-period">
                <SelectValue placeholder={tr("selectAVatFilingPeriod")} />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={periodKey(period)} value={periodKey(period)}>
                    {periodLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPeriod ? (
            <div
              className="flex flex-wrap items-center gap-3 text-sm"
              data-testid="selected-vat-filing-period"
            >
              <span className="text-muted-foreground">
                {tr("due", { formatDate: formatDate(selectedPeriod.dueDate) })}
              </span>
              <Badge className={LEVEL_BADGE[selectedPeriod.deadline.level].className}>
                {LEVEL_BADGE[selectedPeriod.deadline.level].label}
              </Badge>
              <Badge variant={STATUS_VARIANT[selectedPeriod.status]}>
                {statusLabel(selectedPeriod.status, locale)}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="selected-vat-period-empty">
              {tr("noFilingPeriodSelected")}
            </p>
          )}
        </CardContent>
      </Card>

      {visibleCalc?.isDraftPreview && <DraftPreviewBanner previewAsOf={visibleCalc.previewAsOf} />}

      {/* Reconciliation alert */}
      {visibleCalc?.reconciliation.hasDiscrepancy && (
        <Card className="border-warning/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">{tr("ledgerReconciliationMismatch")}</p>
              <p className="text-muted-foreground">
                {tr("calculatedOutputVatDiffersFromThe", {
                  formatCurrency: formatCurrency(visibleCalc.reconciliation.outputVatDelta),
                  formatCurrency2: formatCurrency(visibleCalc.reconciliation.inputVatDelta),
                })}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-calculated 201 form preview */}
      {lastCalc && selectedPeriod && !visibleCalc && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {tr("theLastCalculationWasForA")}
            <span className="font-medium text-foreground">
              {tr("calculateSelectedPeriod")}
            </span>{" "}
            {tr("toUpdateVat201For", { periodLabel: periodLabel(selectedPeriod) })}
          </CardContent>
        </Card>
      )}

      {visibleCalc && (
        <Card>
          <CardHeader>
            <CardTitle>
              {tr("calculatedFilingPeriod", {
                formatDate: formatDate(visibleCalc.period.start),
                formatDate2: formatDate(visibleCalc.period.end),
              })}
            </CardTitle>
            <CardDescription>
              {tr("dueInvoicesReceipts", {
                formatDate: formatDate(visibleCalc.period.dueDate),
                invoicesProcessed: visibleCalc.invoicesProcessed,
                receiptsProcessed: visibleCalc.receiptsProcessed,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">{tr("outputVatSales")}</h3>
                <BoxRow
                  label={tr("standardRatedSupplies")}
                  amount={visibleCalc.boxes.standardRatedSales}
                  vat={visibleCalc.boxes.standardRatedVat}
                />
                <BoxRow
                  label={tr("zeroRatedSupplies")}
                  amount={visibleCalc.boxes.zeroRatedSales}
                  vat={0}
                />
                <BoxRow
                  label={tr("exemptSupplies")}
                  amount={visibleCalc.boxes.exemptSales}
                  vat={0}
                />
                <BoxRow
                  label={tr("reverseChargeOutput")}
                  amount={visibleCalc.boxes.reverseChargeAmount}
                  vat={visibleCalc.boxes.reverseChargeVat}
                />
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>{tr("box12TotalOutputVat")}</span>
                  <span>{formatCurrency(visibleCalc.boxes.totalOutputVat)}</span>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">{tr("inputVatPurchases")}</h3>
                <BoxRow
                  label={tr("standardExpenses")}
                  amount={visibleCalc.boxes.totalExpenses}
                  vat={visibleCalc.boxes.inputVatRecoverable}
                />
                <BoxRow
                  label={tr("reverseChargeInput")}
                  amount={visibleCalc.boxes.reverseChargeAmount}
                  vat={visibleCalc.boxes.reverseChargeVatRecoverable}
                />
                {visibleCalc.boxes.inputVatIrrecoverable > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {tr("partialExemptionReducedInputVatBy", {
                      formatCurrency: formatCurrency(visibleCalc.boxes.inputVatIrrecoverable),
                    })}
                  </p>
                )}
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>{tr("box13TotalInputVat")}</span>
                  <span>{formatCurrency(visibleCalc.boxes.totalInputVat)}</span>
                </div>
              </div>
            </div>

            <VatEmirateBreakdown boxes={visibleCalc.vat201} testId="autopilot-emirate-breakdown" />

            <div className="rounded-md bg-muted p-4 flex items-center justify-between">
              <span className="font-medium">{tr("box14NetVatPayable")}</span>
              <span className="text-lg font-semibold">
                {formatCurrency(visibleCalc.boxes.netVatPayable)}
              </span>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setAdjustmentOpen(true)}
                disabled={!currentPeriodId}
              >
                {tr("addManualAdjustment")}
              </Button>
              {currentPeriodId && currentPeriodStatus === "draft" && (
                <Button
                  variant="default"
                  onClick={() =>
                    statusMutation.mutate({ periodId: currentPeriodId, status: "ready" })
                  }
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-ready"
                >
                  <CheckCircle2 className="h-4 w-4 me-2" />
                  {tr("markReady")}
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === "ready" && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    statusMutation.mutate({ periodId: currentPeriodId, status: "submitted" })
                  }
                  disabled={statusMutation.isPending || !!visibleCalc?.isDraftPreview}
                  data-testid="button-mark-submitted"
                >
                  <Send className="h-4 w-4 me-2" />
                  {tr("markSubmitted")}
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === "submitted" && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    statusMutation.mutate({ periodId: currentPeriodId, status: "accepted" })
                  }
                  disabled={statusMutation.isPending}
                  data-testid="button-mark-accepted"
                >
                  <CheckCircle2 className="h-4 w-4 me-2" />
                  {tr("markAcceptedByFta")}
                </Button>
              )}
              {currentPeriodId && currentPeriodStatus === "accepted" && (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 me-1" />
                  {tr("acceptedByFta")}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Periods table */}
      <Card>
        <CardHeader>
          <CardTitle>{tr("periods")}</CardTitle>
          <CardDescription>{tr("lastSeveralVatFilingWindowsFor")}</CardDescription>
        </CardHeader>
        <CardContent>
          {periodsQuery.isLoading ? (
            <Skeleton className="h-32" data-testid="periods-loading" />
          ) : periodsQuery.isError ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="periods-error"
            >
              <XCircle className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-medium">{tr("couldNotLoadVatPeriods")}</p>
                <p className="text-xs">
                  {(periodsQuery.error as Error)?.message || tr("pleaseTryAgainOrContactSupport")}
                </p>
              </div>
            </div>
          ) : (periodsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="periods-empty">
              {tr("noVatPeriodsYetClickCalculate")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("filing")}</TableHead>
                  <TableHead>{tr("period")}</TableHead>
                  <TableHead>{tr("due2")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead className="text-end">{tr("outputVat")}</TableHead>
                  <TableHead className="text-end">{tr("inputVat")}</TableHead>
                  <TableHead className="text-end">{tr("net")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const key = periodKey(p);
                  const isSelected = key === selectedPeriodKey;
                  return (
                    <TableRow
                      key={`${p.periodStart}-${p.periodEnd}`}
                      data-testid="row-period"
                      className={isSelected ? "bg-muted/50" : undefined}
                    >
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => setSelectedPeriodKey(key)}
                          disabled={calcMutation.isPending}
                          data-testid={`button-select-vat-period-${p.periodStart.slice(0, 10)}`}
                        >
                          {isSelected ? tr("selected") : tr("select")}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {statusLabel(p.frequency, locale)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {formatDate(p.dueDate)}
                          <Badge className={LEVEL_BADGE[p.deadline.level].className}>
                            {LEVEL_BADGE[p.deadline.level].label}
                          </Badge>
                        </div>
                        {p.deadline.isOverdue &&
                        p.status !== "submitted" &&
                        p.status !== "accepted" &&
                        p.status !== "filed_elsewhere" ? (
                          <div className="mt-2">
                            <FiledElsewhereDialog
                              companyId={companyId}
                              periodStart={p.periodStart}
                              periodEnd={p.periodEnd}
                              testIdSuffix={`autopilot-${p.periodStart.slice(0, 10)}`}
                            />
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status]}>
                          {statusLabel(p.status, locale)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">{formatCurrency(p.outputVat)}</TableCell>
                      <TableCell className="text-end">{formatCurrency(p.inputVat)}</TableCell>
                      <TableCell className="text-end font-medium">
                        {formatCurrency(p.netVatPayable)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Active-company deadlines */}
      <Card>
        <CardHeader>
          <CardTitle>{tr("thisCompanySVatDeadlines")}</CardTitle>
          <CardDescription>{tr("vat201DueDatesForThe")}</CardDescription>
        </CardHeader>
        <CardContent>
          {dueDatesQuery.isLoading ? (
            <Skeleton className="h-32" data-testid="due-dates-loading" />
          ) : dueDatesQuery.isError ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="due-dates-error"
            >
              <XCircle className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-medium">{tr("couldNotLoadUpcomingDeadlines")}</p>
                <p className="text-xs">
                  {(dueDatesQuery.error as Error)?.message || tr("pleaseTryAgainOrContactSupport")}
                </p>
              </div>
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="due-dates-empty">
              {tr("noUpcomingVatDeadlines")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("periodEnd")}</TableHead>
                  <TableHead>{tr("due2")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((d) => (
                  <TableRow key={`${d.companyId}-${d.periodEnd}`} data-testid="row-due-date">
                    <TableCell>{formatDate(d.periodEnd)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDate(d.dueDate)}
                        <Badge className={LEVEL_BADGE[d.level].className}>
                          <Clock className="h-3 w-3 me-1" />
                          {d.daysUntilDue >= 0
                            ? `${d.daysUntilDue}d`
                            : tr("dLate", { abs: Math.abs(d.daysUntilDue) })}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[d.status]}>
                        {statusLabel(d.status, locale)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Adjustment dialog */}
      <Dialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("manualAdjustment")}</DialogTitle>
            <DialogDescription>{tr("adjustmentsAreAppendedToTheAudit")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{tr("box")}</Label>
              <Select value={adjustmentBox} onValueChange={setAdjustmentBox}>
                <SelectTrigger data-testid="select-adjustment-box">
                  <SelectValue placeholder={tr("selectABox")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="box1aAbuDhabiAmount">
                    {tr("box1aAbuDhabiStandardSupplies")}
                  </SelectItem>
                  <SelectItem value="box1aAbuDhabiVat">
                    {tr("box1aAbuDhabiStandardSupplies2")}
                  </SelectItem>
                  <SelectItem value="box1bDubaiAmount">
                    {tr("box1bDubaiStandardSuppliesAmount")}
                  </SelectItem>
                  <SelectItem value="box1bDubaiVat">
                    {tr("box1bDubaiStandardSuppliesVat")}
                  </SelectItem>
                  <SelectItem value="box1cSharjahAmount">
                    {tr("box1cSharjahStandardSuppliesAmount")}
                  </SelectItem>
                  <SelectItem value="box1cSharjahVat">
                    {tr("box1cSharjahStandardSuppliesVat")}
                  </SelectItem>
                  <SelectItem value="box1dAjmanAmount">
                    {tr("box1dAjmanStandardSuppliesAmount")}
                  </SelectItem>
                  <SelectItem value="box1dAjmanVat">
                    {tr("box1dAjmanStandardSuppliesVat")}
                  </SelectItem>
                  <SelectItem value="box1eUmmAlQuwainAmount">
                    {tr("box1eUmmAlQuwainStandard")}
                  </SelectItem>
                  <SelectItem value="box1eUmmAlQuwainVat">
                    {tr("box1eUmmAlQuwainStandard2")}
                  </SelectItem>
                  <SelectItem value="box1fRasAlKhaimahAmount">
                    {tr("box1fRasAlKhaimahStandard")}
                  </SelectItem>
                  <SelectItem value="box1fRasAlKhaimahVat">
                    {tr("box1fRasAlKhaimahStandard2")}
                  </SelectItem>
                  <SelectItem value="box1gFujairahAmount">
                    {tr("box1gFujairahStandardSuppliesAmount")}
                  </SelectItem>
                  <SelectItem value="box1gFujairahVat">
                    {tr("box1gFujairahStandardSuppliesVat")}
                  </SelectItem>
                  <SelectItem value="box3ReverseChargeAmount">
                    {tr("box3ReverseChargeSuppliesAmount")}
                  </SelectItem>
                  <SelectItem value="box3ReverseChargeVat">
                    {tr("box3ReverseChargeSuppliesVat")}
                  </SelectItem>
                  <SelectItem value="box4ZeroRatedAmount">{tr("box4ZeroRatedSupplies")}</SelectItem>
                  <SelectItem value="box5ExemptAmount">{tr("box5ExemptSupplies")}</SelectItem>
                  <SelectItem value="box9ExpensesAmount">
                    {tr("box9StandardExpensesAmount")}
                  </SelectItem>
                  <SelectItem value="box9ExpensesVat">
                    {tr("box9StandardExpensesInputVat")}
                  </SelectItem>
                  <SelectItem value="box10ReverseChargeAmount">
                    {tr("box10ReverseChargeExpensesAmount")}
                  </SelectItem>
                  <SelectItem value="box10ReverseChargeVat">
                    {tr("box10ReverseChargeInputVat")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{tr("adjustmentAed")}</Label>
              <Input
                type="number"
                step="0.01"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(e.target.value)}
                data-testid="input-adjustment-amount"
              />
              {adjustmentAmount.trim() !== "" && !adjustmentAmountValid && (
                <p className="text-xs text-destructive mt-1">{tr("amountMustBeANonZero")}</p>
              )}
            </div>
            <div>
              <Label>{tr("reason")}</Label>
              <Textarea
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder={tr("eGVatCorrectionForInvoice")}
                data-testid="input-adjustment-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => adjustmentMutation.mutate()}
              disabled={
                !adjustmentBox ||
                !adjustmentReason.trim() ||
                !adjustmentAmountValid ||
                adjustmentMutation.isPending
              }
              data-testid="button-save-adjustment"
            >
              {adjustmentMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              <FileText className="h-4 w-4 me-2" />
              {tr("saveAdjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoxRow({ label, amount, vat }: { label: string; amount: number; vat: number }) {
  const tr = pageMessages.useT();

  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {formatCurrency(amount)}
        {vat > 0 && (
          <span className="text-muted-foreground">
            {" "}
            {tr("vat", { formatCurrency: formatCurrency(vat) })}
          </span>
        )}
      </span>
    </div>
  );
}
