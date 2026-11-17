import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FormGrid } from "@/components/ui/form-layout";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { accountDisplayName } from "@/lib/account-name";
import { postablePaymentAccounts } from "@/lib/payment-accounts";

interface Deposit {
  id: string;
  number: string | null;
  customerName: string;
  date: string;
  amount: number;
  vatAmount: number;
  remaining: number | null;
  status: string;
  creditId: string | null;
}

interface InvoiceLite {
  id: string;
  number: string;
  customerName: string;
  status: string;
  invoiceType?: string | null;
  total: number | string;
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

const TREATMENTS = ["standard", "zero_rated", "exempt", "out_of_scope"] as const;
const toFils = (v: string) => Math.round(Number(v) * 100);

/**
 * A4 (M1): customer deposits / advances. VAT is due on receipt (FDL 8/2017 Art. 26); applying
 * the deposit to the final invoice reverses the advance VAT, so the supply is taxed once.
 */
export function CustomerDepositsDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const depositsKey = [`/api/companies/${companyId}/customer-deposits`];
  const { data: deposits = [] } = useQuery<Deposit[]>({ queryKey: depositsKey, enabled: open });
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: [`/api/companies/${companyId}/accounts`],
    enabled: open,
  });
  const { data: invoices = [] } = useQuery<InvoiceLite[]>({
    queryKey: [`/api/companies/${companyId}/invoices`],
    enabled: open,
  });
  const banks = postablePaymentAccounts(accounts);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customerName: "",
    date: today,
    amount: "",
    vatTreatment: "standard" as (typeof TREATMENTS)[number],
    paymentAccountId: "",
    reference: "",
  });
  const [applying, setApplying] = useState<Deposit | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [applyAmount, setApplyAmount] = useState("");
  const fail = (e: Error) =>
    toast({ variant: "destructive", title: t["invoices.deposits.failed"], description: e.message });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: depositsKey });
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/invoices`] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/customer-deposits`, {
        customerName: form.customerName,
        date: form.date,
        amount: toFils(form.amount),
        vatTreatment: form.vatTreatment,
        paymentAccountId: form.paymentAccountId,
        reference: form.reference || null,
      }),
    onSuccess: () => {
      refresh();
      setForm({ ...form, customerName: "", amount: "", reference: "" });
      toast({ title: t["invoices.deposits.recorded"] });
    },
    onError: fail,
  });

  const apply = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/customer-credits/${applying!.creditId}/apply`,
        {
          invoiceId,
          amount: toFils(applyAmount),
        }
      ),
    onSuccess: () => {
      refresh();
      setApplying(null);
      toast({ title: t["invoices.deposits.applied"] });
    },
    onError: fail,
  });

  const openInvoices = invoices.filter(
    (i) =>
      ["sent", "posted", "partial"].includes(i.status) &&
      i.invoiceType !== "credit_note" &&
      (!applying || i.customerName === applying.customerName)
  );
  const valid =
    form.customerName.trim() && Number(form.amount) > 0 && form.paymentAccountId && form.date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="dialog-customer-deposits">
        <DialogHeader>
          <DialogTitle>{t["invoices.deposits.title"]}</DialogTitle>
          <DialogDescription>{t["invoices.deposits.hint"]}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !create.isPending) create.mutate();
          }}
        >
          <FormGrid>
            <Field id="dep-customer" label={t["invoices.deposits.customer"]} required>
              <Input
                dir="auto"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </Field>
            <Field id="dep-date" label={t["invoices.deposits.date"]} required>
              <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            </Field>
            <Field id="dep-amount" label={t["invoices.deposits.amount"]} required>
              <Input
                inputMode="decimal"
                dir="ltr"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
            <Field id="dep-vat" label={t["invoices.deposits.vatTreatment"]}>
              <Select
                value={form.vatTreatment}
                onValueChange={(v) =>
                  setForm({ ...form, vatTreatment: v as (typeof TREATMENTS)[number] })
                }
              >
                <SelectTrigger id="dep-vat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREATMENTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t[`invoices.deposits.vat.${v}`]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="dep-account" label={t["invoices.deposits.account"]} required>
              <Select
                value={form.paymentAccountId || undefined}
                onValueChange={(v) => setForm({ ...form, paymentAccountId: v })}
              >
                <SelectTrigger id="dep-account">
                  <SelectValue placeholder={t["invoices.deposits.select"]} />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} · {accountDisplayName(a, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="dep-ref" label={t["invoices.deposits.reference"]}>
              <Input
                dir="auto"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </Field>
          </FormGrid>
          <Button type="submit" disabled={!valid || create.isPending}>
            {t["invoices.deposits.record"]}
          </Button>
        </form>

        {deposits.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t["invoices.deposits.number"]}</TableHead>
                  <TableHead>{t["invoices.deposits.customer"]}</TableHead>
                  <TableHead data-numeric>{t["invoices.deposits.amount"]}</TableHead>
                  <TableHead data-numeric>{t["invoices.deposits.vatAmount"]}</TableHead>
                  <TableHead data-numeric>{t["invoices.deposits.remaining"]}</TableHead>
                  <TableHead data-numeric>{t["invoices.deposits.actions"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell dir="ltr">{d.number ?? "—"}</TableCell>
                    <TableCell dir="auto">{d.customerName}</TableCell>
                    <MoneyCell amount={Number(d.amount)} currency="AED" />
                    <MoneyCell amount={Number(d.vatAmount)} currency="AED" />
                    <MoneyCell amount={Number(d.remaining ?? 0)} currency="AED" />
                    <TableCell data-numeric>
                      {Number(d.remaining ?? 0) > 0 && d.creditId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setApplying(d);
                            setInvoiceId("");
                            setApplyAmount(String(d.remaining ?? ""));
                          }}
                        >
                          {t["invoices.deposits.apply"]}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {applying && (
          <form
            className="space-y-3 rounded border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (invoiceId && Number(applyAmount) > 0 && !apply.isPending) apply.mutate();
            }}
          >
            <p className="text-sm">{t["invoices.deposits.applyHint"]}</p>
            <FormGrid>
              <Field id="dep-invoice" label={t["invoices.deposits.invoice"]} required>
                <Select value={invoiceId || undefined} onValueChange={setInvoiceId}>
                  <SelectTrigger id="dep-invoice">
                    <SelectValue placeholder={t["invoices.deposits.select"]} />
                  </SelectTrigger>
                  <SelectContent>
                    {openInvoices.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="dep-apply-amount" label={t["invoices.deposits.amount"]} required>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  value={applyAmount}
                  onChange={(e) => setApplyAmount(e.target.value)}
                />
              </Field>
            </FormGrid>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setApplying(null)}>
                {t["invoices.deposits.cancel"]}
              </Button>
              <Button type="submit" disabled={!invoiceId || apply.isPending}>
                {t["invoices.deposits.apply"]}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
