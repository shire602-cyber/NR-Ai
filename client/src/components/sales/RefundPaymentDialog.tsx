import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { todayYmd } from "@/lib/calendar-date";
import { accountName } from "@/lib/account-name";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isCashOrBankAccount, salesErrorMessage } from "@/lib/sales-api";
import { salesEndpoints } from "@/lib/sales-endpoints";
import { messages } from "./SalesShared.i18n";

interface Props {
  companyId: string;
  invoiceId: string;
  currency: string;
  /** What the customer has paid on the invoice (the most that can be paid back). Null closes the dialog. */
  paidAmount: number | null;
  onClose: () => void;
}

/** Pay what a customer paid back (all or part): a credit note and its refund, so the invoice owes it again and the statement shows it. */
export function RefundPaymentDialog({ companyId, invoiceId, currency, paidAmount, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");

  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: paidAmount !== null });
  const paying = accounts.filter((a) => isCashOrBankAccount(a) && a.isActive !== false);

  useEffect(() => {
    if (paidAmount === null) return;
    setAmount(String(paidAmount));
    setDate(todayYmd());
    setAccountId("");
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidAmount === null]);

  const max = paidAmount ?? 0;
  const n = Number(amount);
  const valid = n > 0 && n <= max + 0.004 && !!accountId;

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", salesEndpoints.refundPayment(companyId, invoiceId), { amount: n, date, bankAccountId: accountId, ...(reason.trim() ? { notes: reason.trim() } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "credit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      toast({ title: tr("paymentRefunded") });
      onClose();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("paymentRefundFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  return (
    <Dialog open={paidAmount !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="refund-payment-dialog">
        <DialogHeader>
          <DialogTitle>{tr("refundPaymentTitle")}</DialogTitle>
          <DialogDescription>{tr("refundPaymentHelp", { amount: formatCurrency(max, currency, locale) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-payment-amount">{tr("refundPaymentAmount")}</Label>
            <Input id="refund-payment-amount" type="number" min={0.01} max={max} step="0.01" dir="ltr" className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-refund-payment-amount" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-payment-date">{tr("date")}</Label>
            <Input id="refund-payment-date" type="date" dir="ltr" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("refundFrom")}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger data-testid="select-refund-payment-account"><SelectValue placeholder={tr("selectAccount")} /></SelectTrigger>
              <SelectContent>
                {paying.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} - {accountName(a, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-payment-reason">{tr("creditReason")}</Label>
            <Input id="refund-payment-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>{tr("cancel")}</Button>
            <Button className="flex-1" disabled={!valid || submit.isPending} onClick={() => submit.mutate()} data-testid="button-confirm-refund-payment">
              {submit.isPending ? tr("saving") : tr("refundPayment")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
