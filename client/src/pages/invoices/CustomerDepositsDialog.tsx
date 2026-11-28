import { useState } from "react";
import { uaeToday } from "@shared/uae-date";
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
import {
  applyBody,
  depositBody,
  validateApply,
  validateDeposit,
  type DepositField,
} from "@/lib/deposit-body";
import { Link } from "wouter";

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
  // SWEEP: the bare list endpoint answers a page ({ items, nextCursor }); `all=true` answers
  // the plain array this dialog filters (the dialog crashed with "filter is not a function").
  const { data: invoices = [] } = useQuery<InvoiceLite[]>({
    queryKey: ["/api/companies", companyId, "invoices?all=true"],
    enabled: open,
  });
  const { data: customers = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: [`/api/companies/${companyId}/customer-contacts`],
    enabled: open,
  });
  const banks = postablePaymentAccounts(accounts);
  const today = uaeToday();
  const [form, setForm] = useState({
    contactId: "",
    date: today,
    amount: "",
    vatTreatment: "standard" as (typeof TREATMENTS)[number],
    paymentAccountId: "",
    reference: "",
  });
  const [errors, setErrors] = useState<Partial<Record<DepositField, "required" | "amount">>>({});
  const [applyErrors, setApplyErrors] = useState<{ invoice?: true; amount?: true }>({});
  const [applying, setApplying] = useState<Deposit | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [applyAmount, setApplyAmount] = useState("");
  const fail = (e: Error) =>
    toast({ variant: "destructive", title: t["invoices.deposits.failed"], description: e.message });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: depositsKey });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices?all=true"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/customer-deposits`, depositBody(form)),
    onSuccess: () => {
      refresh();
      setForm({ ...form, contactId: "", amount: "", reference: "" });
      setErrors({});
      toast({ title: t["invoices.deposits.recorded"] });
    },
    onError: fail,
  });

  const apply = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/customer-credits/${applying!.creditId}/apply`,
        applyBody(invoiceId, applyAmount)
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
  const fieldError = (field: DepositField) =>
    errors[field] === "amount"
      ? t["invoices.deposits.error.amount"]
      : errors[field]
        ? t[`invoices.deposits.error.${field}`]
        : undefined;
  const setField = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

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
            const found = validateDeposit(form);
            setErrors(found);
            if (Object.keys(found).length === 0 && !create.isPending) create.mutate();
          }}
        >
          <FormGrid>
            <Field
              id="dep-customer"
              label={t["invoices.deposits.customer"]}
              required
              error={fieldError("contactId")}
              help={
                customers.length === 0 ? (
                  <span data-testid="deposit-no-customers">
                    {t["invoices.deposits.noCustomers"]}{" "}
                    <Link
                      href="/contacts"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {t["invoices.receive.addCustomer"]}
                    </Link>
                  </span>
                ) : undefined
              }
            >
              <Select
                value={form.contactId || undefined}
                onValueChange={(v) => setField({ contactId: v })}
              >
                <SelectTrigger id="dep-customer" aria-invalid={!!errors.contactId || undefined}>
                  <SelectValue placeholder={t["invoices.deposits.select"]} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span dir="auto">{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="dep-date"
              label={t["invoices.deposits.date"]}
              required
              error={fieldError("date")}
            >
              <DatePicker value={form.date} onChange={(v) => setField({ date: v })} />
            </Field>
            <Field
              id="dep-amount"
              label={t["invoices.deposits.amount"]}
              required
              error={fieldError("amount")}
            >
              <Input
                inputMode="decimal"
                dir="ltr"
                value={form.amount}
                aria-invalid={!!errors.amount || undefined}
                onChange={(e) => setField({ amount: e.target.value })}
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
            <Field
              id="dep-account"
              label={t["invoices.deposits.account"]}
              required
              error={fieldError("paymentAccountId")}
            >
              <Select
                value={form.paymentAccountId || undefined}
                onValueChange={(v) => setField({ paymentAccountId: v })}
              >
                <SelectTrigger
                  id="dep-account"
                  aria-invalid={!!errors.paymentAccountId || undefined}
                >
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
          <Button type="submit" disabled={create.isPending}>
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
              const found = validateApply(invoiceId, applyAmount);
              setApplyErrors(found);
              if (Object.keys(found).length === 0 && !apply.isPending) apply.mutate();
            }}
          >
            <p className="text-sm">{t["invoices.deposits.applyHint"]}</p>
            <FormGrid>
              <Field
                id="dep-invoice"
                label={t["invoices.deposits.invoice"]}
                required
                error={applyErrors.invoice ? t["invoices.deposits.error.invoice"] : undefined}
              >
                <Select
                  value={invoiceId || undefined}
                  onValueChange={(v) => {
                    setInvoiceId(v);
                    setApplyErrors({});
                  }}
                >
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
              <Field
                id="dep-apply-amount"
                label={t["invoices.deposits.amount"]}
                required
                error={applyErrors.amount ? t["invoices.deposits.error.amount"] : undefined}
              >
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
              <Button type="submit" disabled={apply.isPending}>
                {t["invoices.deposits.apply"]}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
