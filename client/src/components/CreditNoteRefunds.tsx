import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { messages as pageMessages } from "./CreditNoteRefunds.i18n";

export interface RefundableCreditNote {
  id: string;
  number: string;
  customerName: string;
  currency: string;
}

interface Refund {
  id: string;
  amount: number | string;
  currency: string;
  refundDate: string;
  reference: string | null;
  voidedAt: string | null;
}

interface RefundSummary {
  creditNoteTotal: number;
  refunded: number;
  refundable: number;
  currency: string;
}

interface RefundsResponse {
  refunds: Refund[];
  summary: RefundSummary;
}

interface Props {
  companyId: string;
  creditNote: RefundableCreditNote | null;
  onOpenChange: (open: boolean) => void;
}

const isCashOrBankAccount = (acc: any): boolean => {
  if (acc.type !== "asset" || acc.isActive === false) return false;
  const name = String(acc.nameEn || "").toLowerCase();
  const nameAr = String(acc.nameAr || "");
  return (
    name.includes("bank") ||
    name.includes("cash") ||
    name.includes("cheque") ||
    nameAr.includes("بنك") ||
    nameAr.includes("نقد") ||
    nameAr.includes("شيك")
  );
};

export function CreditNoteRefunds({ companyId, creditNote, onOpenChange }: Props) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const todayYmd = format(new Date(), "yyyy-MM-dd");

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd);
  const [bankAccountId, setBankAccountId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const refundsKey = ["/api/companies", companyId, "credit-notes", creditNote?.id, "refunds"];
  const { data, isLoading, isError } = useQuery<RefundsResponse>({
    queryKey: refundsKey,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/credit-notes/${creditNote!.id}/refunds`),
    enabled: !!creditNote && !!companyId,
  });
  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!creditNote && !!companyId,
  });
  const bankAccounts = useMemo(() => accounts.filter(isCashOrBankAccount), [accounts]);

  const refundable = data?.summary.refundable ?? 0;
  const currency = creditNote?.currency || "AED";

  // Start each refund at the whole remaining amount.
  useEffect(() => {
    if (creditNote) {
      setAmount(refundable > 0 ? String(refundable) : "");
      setFormError(null);
    }
  }, [creditNote?.id, refundable]);

  const refreshAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: refundsKey });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "credit-notes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal"] });
  };

  const refundMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/credit-notes/${creditNote!.id}/refunds`, {
        amount: Number(amount),
        date,
        bankAccountId,
        ...(exchangeRate ? { exchangeRate: Number(exchangeRate) } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: tr("refundRecorded"), description: tr("refundRecordedDescription") });
      setReference("");
      setNotes("");
      setExchangeRate("");
      refreshAfterChange();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: tr("refundFailed"), description: error?.message });
    },
  });

  const voidMutation = useMutation({
    mutationFn: (refundId: string) =>
      apiRequest("POST", `/api/companies/${companyId}/credit-notes/${creditNote!.id}/refunds/${refundId}/void`, {}),
    onSuccess: () => {
      toast({ title: tr("refundVoided") });
      refreshAfterChange();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: tr("voidFailed"), description: error?.message });
    },
  });

  const submit = () => {
    if (!(Number(amount) > 0)) return setFormError(tr("amountRequired"));
    if (!bankAccountId) return setFormError(tr("accountRequired"));
    setFormError(null);
    refundMutation.mutate();
  };

  return (
    <Dialog open={!!creditNote} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-credit-note-refunds">
        <DialogHeader>
          <DialogTitle>{tr("title", { number: creditNote?.number ?? "" })}</DialogTitle>
          <DialogDescription>{tr("description", { customer: creditNote?.customerName ?? "" })}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError || !data ? (
          <Alert variant="destructive">
            <AlertDescription>{tr("loadFailed")}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{tr("creditNoteTotal")}</div>
                <div dir="ltr" className="font-mono font-semibold">
                  {formatCurrency(data.summary.creditNoteTotal, currency, locale)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{tr("refundedSoFar")}</div>
                <div dir="ltr" className="font-mono font-semibold">
                  {formatCurrency(data.summary.refunded, currency, locale)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{tr("canStillBeRefunded")}</div>
                <div dir="ltr" className="font-mono font-semibold" data-testid="text-refundable">
                  {formatCurrency(refundable, currency, locale)}
                </div>
              </div>
            </div>

            {refundable > 0 ? (
              <div className="space-y-4 rounded-md border p-4" data-testid="form-new-refund">
                <h3 className="text-sm font-semibold">{tr("newRefund")}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="refund-amount">{tr("amount")}</Label>
                    <Input
                      id="refund-amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max={refundable}
                      dir="ltr"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      data-testid="input-refund-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="refund-date">{tr("refundDate")}</Label>
                    <Input
                      id="refund-date"
                      type="date"
                      dir="ltr"
                      max={todayYmd}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      data-testid="input-refund-date"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{tr("bankAccount")}</Label>
                    {bankAccounts.length > 0 ? (
                      <Select value={bankAccountId} onValueChange={setBankAccountId}>
                        <SelectTrigger data-testid="select-refund-account">
                          <SelectValue placeholder={tr("selectAccount")} />
                        </SelectTrigger>
                        <SelectContent>
                          {bankAccounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                              {acc.code} - {acc.nameEn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Alert>
                        <AlertDescription>{tr("noBankAccounts")}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                  {currency !== "AED" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="refund-rate">{tr("exchangeRate")}</Label>
                      <Input
                        id="refund-rate"
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        min="0"
                        dir="ltr"
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(e.target.value)}
                        data-testid="input-refund-rate"
                      />
                      <p className="text-xs text-muted-foreground">{tr("exchangeRateHint", { currency })}</p>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="refund-reference">{tr("reference")}</Label>
                    <Input
                      id="refund-reference"
                      maxLength={120}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      data-testid="input-refund-reference"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="refund-notes">{tr("notes")}</Label>
                    <Input
                      id="refund-notes"
                      maxLength={1000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      data-testid="input-refund-notes"
                    />
                  </div>
                </div>
                {formError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    {tr("close")}
                  </Button>
                  <Button type="button" onClick={submit} disabled={refundMutation.isPending} data-testid="button-submit-refund">
                    {refundMutation.isPending ? tr("refunding") : tr("refund")}
                  </Button>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertDescription>{tr("nothingToRefund")}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{tr("history")}</h3>
              {data.refunds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr("noRefunds")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("date")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                      <TableHead>{tr("reference")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                      <TableHead className="text-end">{tr("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.refunds.map((refund) => (
                      <TableRow key={refund.id} data-testid={`row-refund-${refund.id}`}>
                        <TableCell>{formatDate(refund.refundDate, locale)}</TableCell>
                        <TableCell dir="ltr" className="text-end font-mono">
                          {formatCurrency(Number(refund.amount), refund.currency || currency, locale)}
                        </TableCell>
                        <TableCell>{refund.reference || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={refund.voidedAt ? "outline" : "secondary"}>
                            {refund.voidedAt ? tr("voided") : tr("posted")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          {refund.voidedAt ? null : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={voidMutation.isPending}
                              onClick={() => {
                                if (window.confirm(tr("confirmVoid"))) voidMutation.mutate(refund.id);
                              }}
                              data-testid={`button-void-refund-${refund.id}`}
                            >
                              {tr("voidRefund")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
