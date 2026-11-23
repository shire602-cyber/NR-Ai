import { errorHeading } from "@/lib/error-heading";
import { useContext, useState } from "react";
import { TrialReadOnlyContext } from "@/lib/trial-access";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format-date";
import { uaeToday } from "@shared/uae-date";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FormActions, FormGrid } from "@/components/ui/form-layout";
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
import { MoneyCell } from "@/components/ui/money";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { accountDisplayName } from "@/lib/account-name";
import { postablePaymentAccounts } from "@/lib/payment-accounts";
import { errorMessage, useHr } from "./shared";
import { StatusBadge } from "./StatusBadge";

interface FundBalance {
  fund: "gpssa" | "adpf";
  accrued: string;
  paid: string;
  outstanding: string;
}

interface PensionPayment {
  id: string;
  fund: "gpssa" | "adpf";
  payment_date: string;
  amount: string;
  reference: string | null;
  status: string;
  entry_number: string | null;
}

interface Account {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  subType?: string | null;
  isArchived?: boolean;
  isActive?: boolean;
}

/**
 * A4 (M14): pension contributions accrued by approved payroll runs (2032), per fund (GPSSA /
 * Abu Dhabi Pension Fund), and the payments that clear them from the bank. The contribution is
 * paid in the fund's own portal; this records the payment.
 */
export function PensionTab({ companyId }: { companyId: string }) {
  const readOnly = useContext(TrialReadOnlyContext);
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const liabilityKey = [`/api/companies/${companyId}/payroll/pension-liability`];
  const paymentsKey = [`/api/companies/${companyId}/payroll/pension-payments`];
  const { data: liability } = useQuery<{ funds: FundBalance[]; totalOutstanding: string }>({
    queryKey: liabilityKey,
  });
  const { data: payments = [] } = useQuery<PensionPayment[]>({ queryKey: paymentsKey });
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: [`/api/companies/${companyId}/accounts`],
  });
  const bankAccounts = postablePaymentAccounts(accounts);
  const [paying, setPaying] = useState<FundBalance | null>(null);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(() => uaeToday());
  const [reference, setReference] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: liabilityKey });
    queryClient.invalidateQueries({ queryKey: paymentsKey });
  };
  const fail = (err: unknown) =>
    toast({ title: errorHeading(err), description: errorMessage(err), variant: "destructive" });

  const pay = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/pension-payments`, {
        fund: paying!.fund,
        amount,
        paymentDate: date,
        paymentAccountId: account,
        reference: reference || undefined,
      }),
    onSuccess: () => {
      refresh();
      setPaying(null);
      toast({ title: tx("hr.pension.paid") });
    },
    onError: fail,
  });

  const reverse = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/pension-payments/${id}/reverse`, {
        reason: tx("hr.pension.reverseReason"),
      }),
    onSuccess: () => {
      refresh();
      toast({ title: tx("hr.pension.reversed") });
    },
    onError: fail,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("hr.pension.title")}</CardTitle>
        <CardDescription>{tx("hr.pension.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(liability?.funds ?? []).length === 0 ? (
          <EmptyState size="sm" title={tx("hr.pension.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.pension.fund")}</TableHead>
                  <TableHead data-numeric>{tx("hr.pension.accrued")}</TableHead>
                  <TableHead data-numeric>{tx("hr.pension.paidCol")}</TableHead>
                  <TableHead data-numeric>{tx("hr.pension.outstanding")}</TableHead>
                  <TableHead data-numeric>{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(liability?.funds ?? []).map((f) => (
                  <TableRow key={f.fund}>
                    <TableCell className="font-medium">{tx(`hr.pension.fund.${f.fund}`)}</TableCell>
                    <MoneyCell amount={Number(f.accrued)} currency="AED" />
                    <MoneyCell amount={Number(f.paid)} currency="AED" />
                    <MoneyCell amount={Number(f.outstanding)} currency="AED" />
                    <TableCell data-numeric>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly || !(Number(f.outstanding) > 0)}
                        onClick={() => {
                          setPaying(f);
                          setAmount(f.outstanding);
                          setDate(uaeToday());
                          setReference("");
                        }}
                        data-testid={`button-pay-pension-${f.fund}`}
                      >
                        <Wallet className="me-2 h-4 w-4" />
                        {tx("hr.pension.pay")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {payments.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.paymentDate")}</TableHead>
                  <TableHead>{tx("hr.pension.fund")}</TableHead>
                  <TableHead>{tx("hr.pension.reference")}</TableHead>
                  <TableHead data-numeric>{tx("hr.pension.amount")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead data-numeric>{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell data-nowrap>{formatDate(p.payment_date, locale)}</TableCell>
                    <TableCell>{tx(`hr.pension.fund.${p.fund}`)}</TableCell>
                    <TableCell dir="auto">{p.reference ?? p.entry_number ?? "—"}</TableCell>
                    <MoneyCell amount={Number(p.amount)} currency="AED" />
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell data-numeric>
                      {p.status === "posted" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={readOnly || reverse.isPending}
                          onClick={() => reverse.mutate(p.id)}
                        >
                          {tx("hr.pension.reverse")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {paying
                ? tx("hr.pension.payTitle", { fund: tx(`hr.pension.fund.${paying.fund}`) })
                : ""}
            </DialogTitle>
            <DialogDescription>{tx("hr.pension.payHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!account || !amount || pay.isPending) return;
              pay.mutate();
            }}
          >
            <FormGrid cols={1}>
              <Field id="pension-amount" label={tx("hr.pension.amount")} required>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field id="pension-account" label={tx("hr.paymentAccount")} required>
                <Select value={account || undefined} onValueChange={setAccount}>
                  <SelectTrigger id="pension-account">
                    <SelectValue placeholder={tx("hr.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} · {accountDisplayName(a, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="pension-date" label={tx("hr.paymentDate")} required>
                <DatePicker value={date} onChange={setDate} />
              </Field>
              <Field id="pension-ref" label={tx("hr.pension.reference")}>
                <Input
                  dir="auto"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </FormGrid>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setPaying(null)}>
                {tx("hr.cancel")}
              </Button>
              <Button type="submit" disabled={readOnly || !account || !amount || pay.isPending}>
                {tx("hr.pension.pay")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
