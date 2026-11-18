import { T } from "@/components/layout/T";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
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
import { formatDate as formatDisplayDate } from "@/lib/format-date";
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
import { Money } from "@/components/ui/money";
import { AlertTriangle, CheckCircle2, Clock, FileText, Send, Loader2, XCircle } from "lucide-react";

// ─── Types matching the server's VAT autopilot service ───────────────────────

type VatPeriodStatus = "draft" | "ready" | "submitted" | "accepted";

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
  lifecycle?: ReturnLifecycle | null;
}

/** E3 (J3-r3): the period's return on the Returns tab (server: vat-autopilot ReturnLifecycle). */
interface ReturnLifecycle {
  returnId: string;
  stage: "draft" | "ready" | "filed" | "paid";
  filed: boolean;
  paymentDate: string | null;
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
  lifecycle?: ReturnLifecycle | null;
}

/** Status label: a filed return reads Filed / Paid (the Returns tab's words), else the stage. */
function statusKeyFor(status: VatPeriodStatus, lifecycle?: ReturnLifecycle | null): string {
  if (lifecycle?.filed) {
    return lifecycle.stage === "paid"
      ? "compliance.autopilotStagePaid"
      : "compliance.autopilotStageFiled";
  }
  return STATUS_KEY[status];
}

interface CalculationResult {
  companyId: string;
  periodId: string | null;
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
  };

const LEVEL_BADGE: Record<DeadlineStatus["level"], { labelKey: string; className: string }> = {
  ok: {
    labelKey: "compliance.autopilotLevelOk",
    className: "bg-success-subtle text-success-subtle-foreground",
  },
  warning: {
    labelKey: "compliance.autopilotLevelWarning",
    className: "bg-warning-subtle text-warning-subtle-foreground",
  },
  critical: {
    labelKey: "compliance.autopilotLevelCritical",
    className: "bg-warning-subtle text-warning-subtle-foreground",
  },
  overdue: {
    labelKey: "compliance.autopilotLevelOverdue",
    className: "bg-danger-subtle text-danger-subtle-foreground",
  },
};

const ADJUSTMENT_BOXES = [
  "box1aAbuDhabiAmount",
  "box1aAbuDhabiVat",
  "box1bDubaiAmount",
  "box1bDubaiVat",
  "box1cSharjahAmount",
  "box1cSharjahVat",
  "box1dAjmanAmount",
  "box1dAjmanVat",
  "box1eUmmAlQuwainAmount",
  "box1eUmmAlQuwainVat",
  "box1fRasAlKhaimahAmount",
  "box1fRasAlKhaimahVat",
  "box1gFujairahAmount",
  "box1gFujairahVat",
  "box3ReverseChargeAmount",
  "box3ReverseChargeVat",
  "box4ZeroRatedAmount",
  "box5ExemptAmount",
  "box9ExpensesAmount",
  "box9ExpensesVat",
  "box10ReverseChargeAmount",
  "box10ReverseChargeVat",
] as const;

const STATUS_KEY: Record<VatPeriodStatus, string> = {
  draft: "compliance.autopilotStatusDraft",
  ready: "compliance.autopilotStatusReady",
  submitted: "compliance.autopilotStatusSubmitted",
  accepted: "compliance.autopilotStatusAccepted",
};

const FREQUENCY_KEY: Record<VatPeriodSummary["frequency"], string> = {
  monthly: "compliance.autopilotFreqMonthly",
  quarterly: "compliance.autopilotFreqQuarterly",
};

/** Fill `{name}` slots with React nodes (e.g. <Money>) so word order follows the catalog. */
function fillNodes(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
}

function formatDate(iso: string, locale: string): string {
  // Period boundaries are UTC instants (e.g. 30 Jun 23:59:59.999Z). Format the
  // UTC calendar date — local-time formatting in UAE (UTC+4) would roll the
  // period end over to "01 Jul".
  return formatDisplayDate(iso.slice(0, 10), locale);
}

function periodKey(period: Pick<VatPeriodSummary, "periodStart" | "periodEnd">): string {
  return `${period.periodStart}::${period.periodEnd}`;
}

function periodLabel(
  period: Pick<VatPeriodSummary, "periodStart" | "periodEnd" | "frequency">,
  locale: string,
  t: Record<string, string>
) {
  return `${formatDate(period.periodStart, locale)} - ${formatDate(period.periodEnd, locale)} (${t[FREQUENCY_KEY[period.frequency]] ?? period.frequency})`;
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

/**
 * Spec 3.12 (WP-D): VAT autopilot is no longer a page. Its periods, calculation, adjustments and
 * status steps are the "Periods" tab of /vat-filing; /vat-autopilot stays as a redirect.
 */
export default function VATAutopilot() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/vat-filing?tab=periods", { replace: true });
  }, [navigate]);
  return <Skeleton className="h-96 w-full" />;
}

export function VatPeriodsPanel() {
  const { t, locale } = useTranslation();
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const { toast } = useToast();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentBox, setAdjustmentBox] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [pickedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);

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

  const periods = useMemo(() => periodsQuery.data || [], [periodsQuery.data]);
  // A pick that is no longer among the loaded periods reads as "no selection".
  const selectedPeriodKey =
    pickedPeriodKey &&
    periodsQuery.data &&
    !periodsQuery.data.some((p) => periodKey(p) === pickedPeriodKey)
      ? null
      : pickedPeriodKey;
  const selectedPeriod = useMemo(
    () => periods.find((p) => periodKey(p) === selectedPeriodKey) || null,
    [periods, selectedPeriodKey]
  );

  const calcMutation = useMutation<CalculationResult, Error, VatPeriodSummary>({
    mutationFn: (period) => {
      if (!companyId) throw new Error(t["compliance.autopilotChooseCompanyFirst"]);
      return apiRequest("GET", calculationPath(companyId, period));
    },
    onSuccess: (calc) => {
      setSelectedPeriodKey(
        periodKey({ periodStart: calc.period.start, periodEnd: calc.period.end })
      );
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/due-dates", companyId] });
      toast({
        title: t["compliance.autopilotRecalculated"],
        description: formatMessage(t["compliance.autopilotRecalculatedBody"], {
          period: `${formatDate(calc.period.start, locale)} - ${formatDate(calc.period.end, locale)}`,
        }),
      });
    },
    onError: (err: any) => {
      toast({
        title: t["compliance.autopilotCalcFailed"],
        description: err?.message || t["compliance.autopilotCalcFailedBody"],
        variant: "destructive",
      });
    },
  });

  const lastCalc = calcMutation.data;
  const lastCalcPeriodKey = lastCalc
    ? periodKey({ periodStart: lastCalc.period.start, periodEnd: lastCalc.period.end })
    : null;
  const visibleCalc = lastCalc && selectedPeriodKey === lastCalcPeriodKey ? lastCalc : null;
  const currentPeriodId = visibleCalc?.periodId ?? selectedPeriod?.id ?? null;
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
      toast({
        title: t["compliance.autopilotAdjustmentSaved"],
        description: t["compliance.autopilotAdjustmentSavedBody"],
      });
      setAdjustmentOpen(false);
      setAdjustmentReason("");
      setAdjustmentAmount("0");
      setAdjustmentBox("");
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
    },
    onError: (err: any) => {
      toast({
        title: t["compliance.autopilotAdjustmentFailed"],
        description: err?.message,
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      periodId,
      status,
      overrideReason,
    }: {
      periodId: string;
      status: VatPeriodStatus;
      overrideReason?: string;
    }) =>
      apiRequest("PATCH", `/api/vat/autopilot/periods/${periodId}/status`, {
        status,
        companyId,
        ...(overrideReason ? { overrideReason } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/periods", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot/due-dates", companyId] });
      toast({ title: t["compliance.autopilotStatusUpdated"] });
    },
    onError: (err: Error, vars) => {
      // W4-E (R12-03): an unexplained VAT-to-GL difference needs an audited override reason.
      if (
        vars.status === "ready" &&
        !vars.overrideReason &&
        /VAT control accounts/.test(err?.message || "")
      ) {
        const reason = window.prompt(t["compliance.autopilotReconPrompt"]);
        if (reason && reason.trim()) {
          statusMutation.mutate({ ...vars, overrideReason: reason.trim() });
          return;
        }
      }
      toast({
        title: t["compliance.autopilotStatusFailed"],
        description: err?.message,
        variant: "destructive",
      });
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
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            <T k="pageLabels.setUpACompanyBeforeUsing" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Periods table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <T k="pageLabels.periods" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.lastSeveralVatFilingWindowsFor" />
          </CardDescription>
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
                <p className="font-medium">
                  <T k="pageLabels.couldNotLoadVatPeriods" />
                </p>
                <p className="text-xs">
                  {(periodsQuery.error as Error)?.message || t["compliance.autopilotTryAgain"]}
                </p>
              </div>
            </div>
          ) : (periodsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="periods-empty">
              <T k="compliance.autopilotNoPeriods" />
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="hr.period" />
                  </TableHead>
                  <TableHead>{t["compliance.autopilotColDue"]}</TableHead>
                  <TableHead>
                    <T k="banking.common.status" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="pageLabels.outputVat" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="pageLabels.inputVat" />
                  </TableHead>
                  <TableHead data-numeric>{t["compliance.autopilotColNet"]}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t["compliance.periodsAction"]}</span>
                  </TableHead>
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
                        <div className="font-medium">
                          {formatDate(p.periodStart, locale)} – {formatDate(p.periodEnd, locale)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t[FREQUENCY_KEY[p.frequency]]}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {formatDate(p.dueDate, locale)}
                          {p.lifecycle?.filed ? null : (
                            <Badge className={LEVEL_BADGE[p.deadline.level].className}>
                              {t[LEVEL_BADGE[p.deadline.level].labelKey]}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANT[p.status]}
                          data-testid={`status-vat-period-${p.periodStart.slice(0, 10)}`}
                        >
                          {t[statusKeyFor(p.status, p.lifecycle)]}
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={p.outputVat} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={p.inputVat} />
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={p.netVatPayable} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => {
                            setSelectedPeriodKey(key);
                            calcMutation.mutate(p);
                          }}
                          disabled={calcMutation.isPending}
                          aria-pressed={isSelected}
                          data-testid={`button-select-vat-period-${p.periodStart.slice(0, 10)}`}
                        >
                          {calcMutation.isPending && isSelected ? (
                            <Loader2 className="h-4 w-4 me-2 animate-spin" />
                          ) : null}
                          {p.status === "draft"
                            ? t["compliance.periodsPrepare"]
                            : t["compliance.periodsReview"]}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation alert */}
      {visibleCalc?.reconciliation.hasDiscrepancy && (
        <Card className="border-warning/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">
                <T k="pageLabels.ledgerReconciliationMismatch" />
              </p>
              <p className="text-muted-foreground">
                {fillNodes(t["compliance.autopilotReconBody"], {
                  output: <Money amount={visibleCalc.reconciliation.outputVatDelta} />,
                  input: <Money amount={visibleCalc.reconciliation.inputVatDelta} />,
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
            {fillNodes(t["compliance.autopilotStaleCalc"], {
              action: (
                <span className="font-medium text-foreground">
                  <T k="pageLabels.calculateSelectedPeriod" />
                </span>
              ),
              period: periodLabel(selectedPeriod, locale, t),
            })}
          </CardContent>
        </Card>
      )}

      {visibleCalc && (
        <Card>
          <CardHeader>
            <CardTitle>
              {formatMessage(t["compliance.autopilotCalcPeriod"], {
                start: formatDate(visibleCalc.period.start, locale),
                end: formatDate(visibleCalc.period.end, locale),
              })}
            </CardTitle>
            <CardDescription>
              {formatMessage(t["compliance.autopilotCalcSummary"], {
                date: formatDate(visibleCalc.period.dueDate, locale),
                invoices: visibleCalc.invoicesProcessed,
                receipts: visibleCalc.receiptsProcessed,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">
                  <T k="compliance.autopilotOutputHeading" />
                </h3>
                <BoxRow
                  label={t["compliance.autopilotStandardRated"]}
                  amount={visibleCalc.boxes.standardRatedSales}
                  vat={visibleCalc.boxes.standardRatedVat}
                />
                <BoxRow
                  label={t["compliance.autopilotZeroRated"]}
                  amount={visibleCalc.boxes.zeroRatedSales}
                  vat={0}
                />
                <BoxRow
                  label={t["compliance.autopilotExempt"]}
                  amount={visibleCalc.boxes.exemptSales}
                  vat={0}
                />
                <BoxRow
                  label={t["compliance.autopilotReverseOutput"]}
                  amount={visibleCalc.boxes.reverseChargeAmount}
                  vat={visibleCalc.boxes.reverseChargeVat}
                />
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>
                    <T k="compliance.autopilotBox12" />
                  </span>
                  <span>
                    <Money amount={visibleCalc.boxes.totalOutputVat} />
                  </span>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-4">
                <h3 className="font-medium">
                  <T k="compliance.autopilotInputHeading" />
                </h3>
                <BoxRow
                  label={t["compliance.autopilotStandardExpenses"]}
                  amount={visibleCalc.boxes.totalExpenses}
                  vat={visibleCalc.boxes.inputVatRecoverable}
                />
                <BoxRow
                  label={t["compliance.autopilotReverseInput"]}
                  amount={visibleCalc.boxes.reverseChargeAmount}
                  vat={visibleCalc.boxes.reverseChargeVatRecoverable}
                />
                {visibleCalc.boxes.inputVatIrrecoverable > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {fillNodes(t["compliance.autopilotPartialExemption"], {
                      amount: <Money amount={visibleCalc.boxes.inputVatIrrecoverable} />,
                    })}
                  </p>
                )}
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>
                    <T k="compliance.autopilotBox13" />
                  </span>
                  <span>
                    <Money amount={visibleCalc.boxes.totalInputVat} />
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-md bg-muted p-4 flex items-center justify-between">
              <span className="font-medium">
                <T k="compliance.autopilotBox14" />
              </span>
              <span className="text-lg font-semibold">
                <Money amount={visibleCalc.boxes.netVatPayable} />
              </span>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setAdjustmentOpen(true)}
                disabled={!currentPeriodId}
              >
                <T k="pageLabels.addManualAdjustment" />
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
                  <T k="pageLabels.markReady" />
                </Button>
              )}
              {/* E1 (J3-r2): the Periods tab is read-only for filing. Submitting and filing happen on
                  the Returns tab (one state machine), so this links there instead of marking a
                  period submitted in one click. */}
              {currentPeriodId &&
                (currentPeriodStatus === "ready" || currentPeriodStatus === "submitted") && (
                  <Button asChild variant="secondary" data-testid="link-open-vat-return">
                    <Link href="/vat-filing?tab=returns">
                      <Send className="h-4 w-4 me-2" />
                      {t["compliance.periodsOpenReturn"]}
                    </Link>
                  </Button>
                )}
              {currentPeriodId && currentPeriodStatus === "accepted" && (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 me-1" />
                  <T k="pageLabels.acceptedByFta" />
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active-company deadlines */}
      <Card>
        <CardHeader>
          <CardTitle>{t["compliance.autopilotDeadlinesTitle"]}</CardTitle>
          <CardDescription>{t["compliance.autopilotDeadlinesHint"]}</CardDescription>
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
                <p className="font-medium">
                  <T k="pageLabels.couldNotLoadUpcomingDeadlines" />
                </p>
                <p className="text-xs">
                  {(dueDatesQuery.error as Error)?.message || t["compliance.autopilotTryAgain"]}
                </p>
              </div>
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="due-dates-empty">
              <T k="pageLabels.noUpcomingVatDeadlines" />
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="banking.statement.periodEnd" />
                  </TableHead>
                  <TableHead>{t["compliance.autopilotColDue"]}</TableHead>
                  <TableHead>
                    <T k="banking.common.status" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((d) => (
                  <TableRow key={`${d.companyId}-${d.periodEnd}`} data-testid="row-due-date">
                    <TableCell>{formatDate(d.periodEnd, locale)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {formatDate(d.dueDate, locale)}
                        {d.lifecycle?.filed ? null : (
                          <Badge className={LEVEL_BADGE[d.level].className}>
                            <Clock className="h-3 w-3 me-1" />
                            {d.daysUntilDue >= 0
                              ? formatMessage(t["compliance.autopilotDaysLeft"], {
                                  n: d.daysUntilDue,
                                })
                              : formatMessage(t["compliance.autopilotDaysLate"], {
                                  n: Math.abs(d.daysUntilDue),
                                })}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[d.status]}>
                        {t[statusKeyFor(d.status, d.lifecycle)]}
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
            <DialogTitle>
              <T k="pageLabels.manualAdjustment" />
            </DialogTitle>
            <DialogDescription>
              <T k="compliance.autopilotAdjustHint" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>
                <T k="compliance.autopilotBoxLabel" />
              </Label>
              <Select value={adjustmentBox} onValueChange={setAdjustmentBox}>
                <SelectTrigger data-testid="select-adjustment-box">
                  <SelectValue placeholder={t["compliance.autopilotSelectBox"]} />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_BOXES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t[`compliance.autopilotBoxOpt.${value}`]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>
                <T k="compliance.autopilotAdjustmentLabel" />
              </Label>
              <Input
                type="number"
                step="0.01"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(e.target.value)}
                data-testid="input-adjustment-amount"
              />
              {adjustmentAmount.trim() !== "" && !adjustmentAmountValid && (
                <p className="text-xs text-destructive mt-1">
                  <T k="compliance.autopilotAmountInvalid" />
                </p>
              )}
            </div>
            <div>
              <Label>
                <T k="banking.line.excludeReason" />
              </Label>
              <Textarea
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder={t["compliance.autopilotReasonPlaceholder"]}
                data-testid="input-adjustment-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustmentOpen(false)}>
              <T k="pages.cancel" />
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
              <T k="pageLabels.saveAdjustment" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoxRow({ label, amount, vat }: { label: string; amount: number; vat: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>
        <Money amount={amount} />
        {vat > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · <Money amount={vat} /> <T k="compliance.autopilotVatSuffix" />
          </span>
        )}
      </span>
    </div>
  );
}
