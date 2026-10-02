import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCanManageFinance } from "@/hooks/useCanManageFinance";
import { accountName } from "@/lib/account-name";
import { formatCalendarDate, todayYmd } from "@/lib/calendar-date";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isCashOrBankAccount, salesErrorMessage } from "@/lib/sales-api";
import { salesEndpoints } from "@/lib/sales-endpoints";
import { messages } from "./SalesShared.i18n";

export interface CustomerCreditRefund {
  id: string;
  amount: number | string;
  refundDate: string;
  reference?: string | null;
  voidedAt?: string | null;
}

interface CreditInfo {
  balance: { available: number; received: number; refunded: number };
  refunds: CustomerCreditRefund[];
}

interface Props {
  companyId: string;
  contact: { id: string; name: string } | null;
  onClose: () => void;
}

/** The customer's credit balance from overpayments (2050), the refunds paid out of it, and a way to pay it back or void a refund. */
export function CustomerCreditDialog({ companyId, contact, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const canManage = useCanManageFinance(companyId);
  const open = contact !== null;
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");

  const { data } = useCustomerCredit(companyId, contact?.id, open);
  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: open });
  const paying = accounts.filter((a) => isCashOrBankAccount(a) && a.isActive !== false);
  const available = data?.balance.available ?? 0;

  useEffect(() => {
    if (!open) return;
    setDate(todayYmd());
    setAccountId("");
    setReference("");
  }, [open]);
  useEffect(() => {
    setAmount(available > 0 ? String(available) : "");
  }, [available, open]);

  const n = Number(amount);
  const valid = n > 0 && n <= available + 0.004 && !!accountId && !!date;
  const fail = (title: string) => (error: unknown) =>
    toast({ variant: "destructive", title, description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });
  const refresh = () => refreshCustomerCredit(companyId, contact?.id);

  const refund = useMutation({
    mutationFn: () =>
      apiRequest("POST", salesEndpoints.customerCreditRefunds(companyId, contact!.id), { amount: n, date, bankAccountId: accountId, ...(reference.trim() ? { reference: reference.trim() } : {}) }),
    onSuccess: () => {
      refresh();
      setReference("");
      toast({ title: tr("creditRefunded") });
    },
    onError: fail(tr("creditRefundFailed")),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="customer-credit-dialog">
        <DialogHeader>
          <DialogTitle>{tr("customerCreditTitle")}{contact ? ` — ${contact.name}` : ""}</DialogTitle>
          <DialogDescription>{tr("customerCreditHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-baseline justify-between rounded-md border bg-muted/40 p-3">
            <span className="text-sm">{tr("creditAvailable")}</span>
            <span dir="ltr" className="font-mono text-lg font-semibold" data-testid="customer-credit-available">{formatCurrency(available, "AED", locale)}</span>
          </div>

          {available > 0 && canManage ? (
            <div className="space-y-3" data-testid="customer-credit-form">
              <div className="space-y-1.5">
                <Label htmlFor="credit-refund-amount">{tr("creditRefundAmount")}</Label>
                <Input id="credit-refund-amount" type="number" min={0.01} max={available} step="0.01" dir="ltr" className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-credit-refund-amount" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="credit-refund-date">{tr("date")}</Label>
                  <Input id="credit-refund-date" type="date" dir="ltr" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{tr("refundFrom")}</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger data-testid="select-credit-refund-account"><SelectValue placeholder={tr("selectAccount")} /></SelectTrigger>
                    <SelectContent>
                      {paying.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} - {accountName(a, locale)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="credit-refund-reference">{tr("creditRefundReference")}</Label>
                <Input id="credit-refund-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <Button className="w-full" disabled={!valid || refund.isPending} onClick={() => refund.mutate()} data-testid="button-confirm-credit-refund">
                {refund.isPending ? tr("saving") : tr("creditRefundButton")}
              </Button>
            </div>
          ) : (
            available <= 0 && <p className="text-sm text-muted-foreground">{tr("creditNoBalance")}</p>
          )}

          <CreditRefundList companyId={companyId} contactId={contact?.id ?? null} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const customerCreditKey = (companyId: string, contactId: string | null | undefined) => ["customer-credit", companyId, contactId];

export function useCustomerCredit(companyId: string, contactId: string | null | undefined, enabled = true) {
  return useQuery<CreditInfo>({
    queryKey: customerCreditKey(companyId, contactId),
    enabled: enabled && !!contactId,
    queryFn: () => apiRequest("GET", salesEndpoints.customerCredit(companyId, contactId!)),
  });
}

/** Everything that shows a customer's credit or refunds is read again after a refund or a void. */
export function refreshCustomerCredit(companyId: string, contactId: string | null | undefined) {
  queryClient.invalidateQueries({ queryKey: customerCreditKey(companyId, contactId) });
  queryClient.invalidateQueries({ queryKey: ["statement-advances", companyId, contactId] });
  queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal"] });
  queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
}

/** The refunds paid out of a customer's credit balance, each with a two-step "Void refund". */
export function CreditRefundList({ companyId, contactId }: { companyId: string; contactId: string | null }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const canManage = useCanManageFinance(companyId);
  const { data } = useCustomerCredit(companyId, contactId);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);
  const voidRefund = useMutation({
    mutationFn: (refundId: string) => apiRequest("POST", salesEndpoints.voidCustomerCreditRefund(companyId, contactId!, refundId), {}),
    onSuccess: () => {
      refreshCustomerCredit(companyId, contactId);
      setConfirmVoid(null);
      toast({ title: tr("creditRefundVoided") });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("creditRefundVoidFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  return (
    <div className="space-y-2" data-testid="credit-refund-list">
            <h4 className="text-sm font-medium">{tr("creditRefundsPaid")}</h4>
            {(data?.refunds ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("creditRefundsNone")}</p>
            ) : (
              <ul className="space-y-2" data-testid="customer-credit-refunds">
                {data!.refunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm" data-testid={`credit-refund-${r.id}`}>
                    <div className="min-w-0">
                      <div dir="ltr" className={`font-mono ${r.voidedAt ? "line-through text-muted-foreground" : ""}`}>{formatCurrency(Number(r.amount), "AED", locale)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCalendarDate(r.refundDate, locale)}
                        {r.reference ? ` · ${r.reference}` : ""}
                      </div>
                    </div>
                    {r.voidedAt ? (
                      <Badge variant="secondary">{tr("creditRefundIsVoid")}</Badge>
                    ) : canManage ? (
                      confirmVoid === r.id ? (
                        <Button size="sm" variant="destructive" disabled={voidRefund.isPending} onClick={() => voidRefund.mutate(r.id)} data-testid={`button-confirm-void-credit-refund-${r.id}`}>
                          {tr("creditRefundVoidConfirm")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setConfirmVoid(r.id)} data-testid={`button-void-credit-refund-${r.id}`}>
                          {tr("creditRefundVoid")}
                        </Button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
  );
}
