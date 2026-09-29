import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useComplianceText } from "@/lib/i18n-compliance";
import { filingBase, type FilingKind, type SettlementView } from "./filing-types";

interface Account {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  isActive?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: FilingKind;
  returnId: string;
  companyId: string;
  settlement: SettlementView;
  invalidateKeys: unknown[][];
}

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Record a (possibly partial) payment to, or refund from, the FTA. */
export default function RecordPaymentDialog({
  open,
  onOpenChange,
  kind,
  returnId,
  companyId,
  settlement,
  invalidateKeys,
}: Props) {
  const { c, f, locale } = useComplianceText();
  const { toast } = useToast();
  const receiving = settlement.direction === "receive";
  const [amount, setAmount] = useState(settlement.remaining ? settlement.remaining.toFixed(2) : "");
  const [date, setDate] = useState(localToday());
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: open && !!companyId,
  });
  const bankAccounts = (accounts ?? []).filter((a) => a.type === "asset" && a.isActive !== false);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `${filingBase(kind, returnId)}/payments`, {
        amount: Number(amount),
        date,
        accountId,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal"] });
      toast({ title: c.paymentRecorded });
      onOpenChange(false);
    },
    onError: (err: any) => setError(err?.message || c.paymentFailed),
  });

  const submit = () => {
    setError(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError(c.amountInvalid);
    if (Math.round(value * 100) > Math.round(settlement.remaining * 100)) {
      return setError(f("amountTooHigh", { remaining: formatCurrency(settlement.remaining, "AED", locale) }));
    }
    if (!accountId) return setError(c.chooseAccount);
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-record-payment">
        <DialogHeader>
          <DialogTitle>{receiving ? c.recordRefund : c.recordPayment}</DialogTitle>
          <DialogDescription>{receiving ? c.recordRefundDescription : c.recordPaymentDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            <span className="text-muted-foreground">{receiving ? c.refundDue : c.balanceDue}: </span>
            <span className="font-mono font-semibold">{formatCurrency(settlement.remaining, "AED", locale)}</span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">{c.amount}</Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-payment-amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-date">{c.paymentDate}</Label>
            <Input id="pay-date" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{receiving ? c.received : c.paidFrom}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger data-testid="select-payment-account">
                <SelectValue placeholder={c.chooseAccount} />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">{c.reference}</Label>
            <Input id="pay-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-payment-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {c.cancel}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending} data-testid="button-save-payment">
            {mutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {receiving ? c.recordRefund : c.recordPayment}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
