import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Loader2, Send, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Money } from "@/components/ui/money";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { accountDisplayName } from "@/lib/account-name";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
  type PaymentAccountLike,
} from "@/lib/payment-accounts";
import { dayAfter, vatFilingStage, vatNextAction } from "@/lib/vat-filing-stage";

/**
 * E2 (J3-r2): the filing steps after "ready", on the Returns side. Record the filing made on
 * EmaraTax (reference + date) → record the payment to (or refund from) the FTA through the
 * settlement seam (POST /api/vat-returns/:id/settlement, Box 14, a cash/bank account) → reverse
 * it if it was wrong. Muhasib transmits nothing to the FTA; these are the user's records.
 */
export interface VatFilingActionsProps {
  companyId: string;
  vatReturn: {
    id: string;
    status: string;
    periodEnd: string;
    box14PayableTax: number | string | null;
    paymentStatus?: string | null;
    paymentDate?: string | null;
    ftaReferenceNumber?: string | null;
  };
  /** "hero" shows full-size buttons, "row" compact ones. */
  size?: "default" | "sm";
}

type Dlg = "filing" | "settle" | "reverse" | null;

export default function VatFilingActions({
  companyId,
  vatReturn,
  size = "default",
}: VatFilingActionsProps) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { gate } = useCompanyPermission();
  const [open, setOpen] = useState<Dlg>(null);
  const today = format(new Date(), "yyyy-MM-dd");
  const periodEnd = String(vatReturn.periodEnd).slice(0, 10);
  const earliest = dayAfter(periodEnd);
  const net = Number(vatReturn.box14PayableTax ?? 0) || 0;
  const stage = vatFilingStage(vatReturn);
  const next = vatNextAction(vatReturn);
  const isRefund = net < 0;

  const [reference, setReference] = useState(vatReturn.ftaReferenceNumber ?? "");
  const [filedOn, setFiledOn] = useState(today >= earliest ? today : "");
  const [reconciliationError, setReconciliationError] = useState<{
    message: string;
    input?: number;
    output?: number;
  } | null>(null);
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [payDate, setPayDate] = useState(today >= earliest ? today : "");
  const [payAccount, setPayAccount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [revDate, setRevDate] = useState(today);
  const [revReason, setRevReason] = useState("");

  const { data: accounts = [] } = useQuery<(PaymentAccountLike & { code?: string })[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: open === "settle",
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: open === "settle",
  });
  const paymentAccounts = postablePaymentAccounts(accounts);
  const chosenAccount = payAccount || defaultPaymentAccountId(accounts, bankAccounts);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
    queryClient.invalidateQueries({ queryKey: ["/api/vat-returns", vatReturn.id] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey.some(
          (k) =>
            typeof k === "string" &&
            (k.includes("compliance") || k.includes("journal") || k.includes("vat"))
        ),
    });
  };
  const fail = (title: string) => (err: Error) =>
    toast({ variant: "destructive", title, description: err?.message });
  const setFilingOpen = (isOpen: boolean) => {
    setReconciliationError(null);
    setReconciliationReason("");
    setOpen(isOpen ? "filing" : null);
  };

  const filing = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vat-returns/${vatReturn.id}/submit`, {
        ftaReferenceNumber: reference.trim(),
        filedOn,
        ...(reconciliationError
          ? { reconciliationOverrideReason: reconciliationReason.trim() }
          : {}),
      }),
    onSuccess: () => {
      toast({
        title: t["compliance.vatFlow.filedDone"],
        description: t["compliance.vatFlow.noTransmit"],
      });
      setFilingOpen(false);
      refresh();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.body?.code === "VAT_RECONCILIATION_DIFFERENCE") {
        if (open === "filing") {
          const details = error.body.details as Record<string, unknown> | undefined;
          setReconciliationError({
            message: error.message,
            input:
              typeof details?.unexplainedInputVat === "number"
                ? details.unexplainedInputVat
                : undefined,
            output:
              typeof details?.unexplainedOutputVat === "number"
                ? details.unexplainedOutputVat
                : undefined,
          });
          setReconciliationReason("");
        }
        return;
      }
      fail(t["compliance.vatFlow.filingFailed"])(error);
    },
  });

  const settle = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vat-returns/${vatReturn.id}/settlement`, {
        date: payDate,
        paymentAccountId: chosenAccount,
        ...(payRef.trim() ? { reference: payRef.trim() } : {}),
      }),
    onSuccess: () => {
      toast({
        title: isRefund ? t["compliance.vatFlow.refundDone"] : t["compliance.vatFlow.paymentDone"],
      });
      setOpen(null);
      refresh();
    },
    onError: fail(
      isRefund ? t["compliance.vatFlow.refundFailed"] : t["compliance.vatFlow.paymentFailed"]
    ),
  });

  const reverse = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vat-returns/${vatReturn.id}/settlement/reverse`, {
        date: revDate,
        reason: revReason.trim(),
      }),
    onSuccess: () => {
      toast({ title: t["compliance.vatFlow.reverseDone"] });
      setOpen(null);
      setRevReason("");
      refresh();
    },
    onError: fail(t["compliance.vatFlow.reverseFailed"]),
  });

  const settled = stage === "paid" || stage === "refunded";
  const gated = gate("tax.submit");

  return (
    <>
      {next === "recordFiling" && (
        <Button
          size={size}
          onClick={() => setFilingOpen(true)}
          data-testid={`button-record-filing-${vatReturn.id}`}
          {...gated}
        >
          <Send className="me-2 h-4 w-4" aria-hidden />
          {t["compliance.vatFlow.recordFiling"]}
        </Button>
      )}
      {(next === "recordPayment" || next === "recordRefund") && (
        <Button
          size={size}
          onClick={() => setOpen("settle")}
          data-testid={`button-record-settlement-${vatReturn.id}`}
          {...gated}
        >
          <Banknote className="me-2 h-4 w-4" aria-hidden />
          {next === "recordRefund"
            ? t["compliance.vatFlow.recordRefund"]
            : t["compliance.vatFlow.recordPayment"]}
        </Button>
      )}
      {settled && (
        <>
          <span
            className="inline-flex items-center gap-1 text-small text-success"
            data-testid={`text-vat-settled-${vatReturn.id}`}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {formatMessage(
              stage === "refunded"
                ? t["compliance.vatFlow.refundedOn"]
                : t["compliance.vatFlow.paidOn"],
              { date: vatReturn.paymentDate ? formatDate(vatReturn.paymentDate, locale) : "" }
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen("reverse")}
            data-testid={`button-reverse-settlement-${vatReturn.id}`}
            {...gated}
          >
            <Undo2 className="me-2 h-4 w-4" aria-hidden />
            {t["compliance.vatFlow.reverse"]}
          </Button>
        </>
      )}

      <Dialog open={open === "filing"} onOpenChange={setFilingOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t["compliance.vatFlow.recordFilingTitle"]}</DialogTitle>
            <DialogDescription>{t["compliance.vatFlow.recordFilingHelp"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`fta-ref-${vatReturn.id}`}>
                {t["compliance.vatFlow.emaraTaxReference"]}
              </Label>
              <Input
                id={`fta-ref-${vatReturn.id}`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
                data-testid="input-fta-reference"
              />
            </div>
            <div className="space-y-2">
              <Label>{t["compliance.vatFlow.filedOn"]}</Label>
              <DatePicker
                value={filedOn}
                onChange={setFiledOn}
                min={earliest}
                max={today}
                aria-label={t["compliance.vatFlow.filedOn"]}
                data-testid="input-filed-on"
              />
              <p className="text-xs text-muted-foreground">{t["compliance.vatFlow.filedOnHelp"]}</p>
            </div>
            {reconciliationError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {reconciliationError.message}
                </p>
                {reconciliationError.input !== undefined &&
                  reconciliationError.output !== undefined && (
                    <dl className="grid grid-cols-[1fr_auto] gap-1 text-sm">
                      <dt>{t["compliance.vatFilingOutputVat"]}</dt>
                      <dd>
                        <Money amount={reconciliationError.output} showCurrency={false} />
                      </dd>
                      <dt>{t["compliance.vatFilingInputVat"]}</dt>
                      <dd>
                        <Money amount={reconciliationError.input} showCurrency={false} />
                      </dd>
                    </dl>
                  )}
                <Label htmlFor={`filing-override-${vatReturn.id}`}>
                  {t["compliance.vatFlow.reconciliationOverrideReason"]}
                </Label>
                <Textarea
                  id={`filing-override-${vatReturn.id}`}
                  data-testid="input-vat-filing-override"
                  value={reconciliationReason}
                  onChange={(event) => setReconciliationReason(event.target.value)}
                  maxLength={2000}
                  required
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilingOpen(false)}>
              {t["compliance.vatFlow.cancel"]}
            </Button>
            <Button
              onClick={() => filing.mutate()}
              disabled={
                !reference.trim() ||
                !filedOn ||
                filing.isPending ||
                (!!reconciliationError && !reconciliationReason.trim())
              }
              data-testid="button-confirm-filing"
            >
              {filing.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t["compliance.vatFlow.confirmFiling"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "settle"} onOpenChange={(o) => setOpen(o ? "settle" : null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {isRefund
                ? t["compliance.vatFlow.recordRefundTitle"]
                : t["compliance.vatFlow.recordPaymentTitle"]}
            </DialogTitle>
            <DialogDescription>
              {isRefund
                ? t["compliance.vatFlow.recordRefundHelp"]
                : t["compliance.vatFlow.recordPaymentHelp"]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between rounded-md bg-muted/50 p-3">
              <span className="text-small text-muted-foreground">
                {isRefund ? t["compliance.vatFlow.box14Refund"] : t["compliance.vatFlow.box14"]}
              </span>
              <span className="font-semibold tabular-nums" data-testid="text-settlement-amount">
                <Money amount={Math.abs(net)} />
              </span>
            </div>
            <div className="space-y-2">
              <Label>
                {isRefund
                  ? t["compliance.vatFlow.refundDate"]
                  : t["compliance.vatFlow.paymentDate"]}
              </Label>
              <DatePicker
                value={payDate}
                onChange={setPayDate}
                min={earliest}
                max={today}
                aria-label={
                  isRefund
                    ? t["compliance.vatFlow.refundDate"]
                    : t["compliance.vatFlow.paymentDate"]
                }
                data-testid="input-settlement-date"
              />
            </div>
            <div className="space-y-2">
              <Label>{t["compliance.vatFlow.bankAccount"]}</Label>
              <Select value={chosenAccount} onValueChange={setPayAccount}>
                <SelectTrigger
                  aria-label={t["compliance.vatFlow.bankAccount"]}
                  data-testid="select-settlement-account"
                >
                  <SelectValue placeholder={t["compliance.vatFlow.chooseAccount"]} />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="me-2 tabular-nums text-muted-foreground">{a.code}</span>
                      {accountDisplayName(a, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`pay-ref-${vatReturn.id}`}>
                {t["compliance.vatFlow.paymentReference"]}
              </Label>
              <Input
                id={`pay-ref-${vatReturn.id}`}
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t["compliance.vatFlow.cancel"]}
            </Button>
            <Button
              onClick={() => settle.mutate()}
              disabled={!payDate || !chosenAccount || settle.isPending}
              data-testid="button-confirm-settlement"
            >
              {settle.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {isRefund
                ? t["compliance.vatFlow.recordRefund"]
                : t["compliance.vatFlow.recordPayment"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "reverse"} onOpenChange={(o) => setOpen(o ? "reverse" : null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t["compliance.vatFlow.reverseTitle"]}</DialogTitle>
            <DialogDescription>{t["compliance.vatFlow.reverseHelp"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t["compliance.vatFlow.reverseDate"]}</Label>
              <DatePicker
                value={revDate}
                onChange={setRevDate}
                max={today}
                aria-label={t["compliance.vatFlow.reverseDate"]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`rev-reason-${vatReturn.id}`}>
                {t["compliance.vatFlow.reverseReason"]}
              </Label>
              <Textarea
                id={`rev-reason-${vatReturn.id}`}
                value={revReason}
                onChange={(e) => setRevReason(e.target.value)}
                className="min-h-16"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t["compliance.vatFlow.cancel"]}
            </Button>
            <Button
              variant="destructive"
              onClick={() => reverse.mutate()}
              disabled={!revDate || revReason.trim().length < 3 || reverse.isPending}
              data-testid="button-confirm-reverse-settlement"
            >
              {reverse.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t["compliance.vatFlow.reverse"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
