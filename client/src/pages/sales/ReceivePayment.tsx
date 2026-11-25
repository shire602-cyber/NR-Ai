import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Wand2 } from "lucide-react";
import { EditorShell } from "@/components/ui/editor-shell";
import { FormSection } from "@/components/ui/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Money } from "@/components/ui/money";
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
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { accountDisplayName } from "@/lib/account-name";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
} from "@/lib/payment-accounts";
import { autoApplyOldestFirst } from "@shared/sales-documents";

interface OpenInvoice {
  id: string;
  number: string;
  date: string | null;
  dueDate: string | null;
  currency: string;
  exchangeRate: number;
  total: number;
  openBalance: number;
}

const toFils = (v: string | number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const fromFils = (f: number) => (f / 100).toFixed(2);
const NO_OPEN_INVOICES: readonly OpenInvoice[] = [];

/**
 * WQ1 (7.6): one payment from a customer applied to several open invoices. "Auto apply" pays
 * the oldest due first; anything left over becomes customer credit; a bank fee is what the bank
 * kept. The server settles each invoice through invoices.recordPayment in one transaction.
 */
export default function ReceivePayment() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { company, companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const baseCurrency = (company as { baseCurrency?: string } | undefined)?.baseCurrency || "AED";

  const contactsQuery = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled: !!companyId,
  });
  const contacts = contactsQuery.data ?? [];
  const accountsQuery = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const accounts = accountsQuery.data ?? [];
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const paymentAccounts = postablePaymentAccounts(accounts);

  const [contactId, setContactId] = useState("");
  const [pickedAccountId, setAccountId] = useState("");
  // The primary bank (or cash) account until one is picked.
  const accountId = pickedAccountId || defaultPaymentAccountId(accounts, bankAccounts);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  // A typed rate belongs to the currency it was typed for.
  const [typedRate, setTypedRate] = useState({ currency: "", value: "" });
  const [reference, setReference] = useState("");
  const [applied, setApplied] = useState<Record<string, string>>({});

  const openQuery = useQuery<OpenInvoice[]>({
    queryKey: ["/api/companies", companyId, "receive-payments", "open-invoices", contactId],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${companyId}/receive-payments/open-invoices?contactId=${encodeURIComponent(contactId)}`
      ),
    enabled: !!companyId && !!contactId,
  });
  const open = openQuery.data ?? NO_OPEN_INVOICES;

  // The invoice whose currency applies to the receipt: the first applied one (the API validates
  // only allocated invoices), the first open one as a preview before any is applied.
  const rateInvoice = open.find((i) => toFils(applied[i.id] ?? 0) > 0) ?? open[0];
  const currency = rateInvoice?.currency ?? baseCurrency;
  const foreign = currency !== baseCurrency;
  const amountFils = toFils(amount);
  const appliedFils = open.reduce((s, i) => s + toFils(applied[i.id] ?? 0), 0);
  const feeFils = toFils(fee);
  const creditFils = Math.max(0, amountFils - appliedFils);
  const overApplied = appliedFils > amountFils;
  // The rate sent with the receipt; the field only exists for a foreign currency. Derived during
  // render, so another currency never sees (or submits) this one's rate.
  const rate = typedRate.currency === currency ? typedRate.value : "";
  const enteredRate = foreign && Number(rate) > 0 ? Number(rate) : undefined;
  // The fee (base currency) must be less than the amount received. Only a base-currency receipt
  // can be checked here; for a foreign one the API checks the cash its journals actually book
  // (payment-date or typed rate, converted per allocation).
  const feeTooHigh = !foreign && feeFils > 0 && amountFils > 0 && feeFils >= amountFils;
  const overInvoice = open.some(
    (i) => toFils(applied[i.id] ?? 0) > Math.round(i.openBalance * 100)
  );

  const autoApply = () => {
    const plan = autoApplyOldestFirst(
      amountFils,
      open.map((i) => ({
        id: i.id,
        openFils: Math.round(i.openBalance * 100),
        dueDate: i.dueDate,
        date: i.date,
        number: i.number,
      }))
    );
    const next: Record<string, string> = {};
    for (const a of plan.allocations) next[a.invoiceId] = fromFils(a.amountFils);
    setApplied(next);
  };

  const allocations = useMemo(
    () =>
      open
        .filter((i) => toFils(applied[i.id] ?? 0) > 0)
        .map((i) => ({ invoiceId: i.id, amount: fromFils(toFils(applied[i.id])) })),
    [open, applied]
  );

  const record = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/receive-payments`, {
        contactId,
        paymentAccountId: accountId,
        date,
        amount: fromFils(amountFils),
        ...(feeFils > 0 ? { bankFee: fromFils(feeFils) } : {}),
        ...(foreign && enteredRate ? { exchangeRate: enteredRate } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        allocations,
      }),
    onSuccess: (r: { customerCredit: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-credits"],
      });
      toast({
        title: t["invoices.receive.recorded"],
        description:
          Number(r.customerCredit) > 0
            ? formatMessage(t["invoices.receive.recordedCredit"], {
                credit: r.customerCredit,
                currency,
              })
            : t["invoices.receive.recordedBody"],
      });
      navigate("/invoices");
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["invoices.receive.failed"],
        description: error?.message,
      }),
  });

  const canSubmit =
    !!contactId &&
    !!accountId &&
    amountFils > 0 &&
    allocations.length > 0 &&
    !overApplied &&
    !overInvoice &&
    !feeTooHigh &&
    can("ledger.post") &&
    !record.isPending;

  return (
    <EditorShell
      testId="receive-payment-page"
      backHref="/invoices"
      backLabel={t["invoices.editor.back"]}
      eyebrow={t["invoices.receive.eyebrow"]}
      title={t["invoices.receive.title"]}
      description={t["invoices.receive.desc"]}
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-3" data-testid="receive-summary">
          <span>
            {t["invoices.receive.applied"]}{" "}
            <Money amount={appliedFils / 100} currency={currency} className="font-semibold" />
          </span>
          {creditFils > 0 && (
            <span data-testid="receive-credit">
              {t["invoices.receive.toCredit"]}{" "}
              <Money amount={creditFils / 100} currency={currency} className="font-semibold" />
            </span>
          )}
        </span>
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => navigate("/invoices")}>
            {t["invoices.receive.cancel"]}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => record.mutate()}
            data-testid="button-record-receipt"
          >
            {t["invoices.receive.submit"]}
          </Button>
        </>
      }
    >
      <FormSection title={t["invoices.receive.section.payment"]}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="receive-customer">{t["invoices.receive.customer"]}</Label>
            <Select
              value={contactId}
              onValueChange={(v) => {
                setContactId(v);
                setApplied({});
              }}
            >
              <SelectTrigger id="receive-customer" data-testid="select-receive-customer">
                <SelectValue placeholder={t["invoices.receive.chooseCustomer"]} />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Sweep: with no customers the picker opened empty and the page was a dead end. */}
            {contactsQuery.isSuccess &&
              !contactsQuery.isFetching &&
              !contactsQuery.isPaused &&
              contacts.length === 0 && (
                <p className="text-small text-muted-foreground" data-testid="receive-no-customers">
                  {t["invoices.receive.noCustomers"]}{" "}
                  <Link
                    href="/contacts"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t["invoices.receive.addCustomer"]}
                  </Link>
                </p>
              )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-account">{t["invoices.receive.depositTo"]}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="receive-account" data-testid="select-receive-account">
                <SelectValue placeholder={t["invoices.receive.chooseAccount"]} />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {accountDisplayName(a, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accountsQuery.isSuccess &&
              !accountsQuery.isFetching &&
              !accountsQuery.isPaused &&
              paymentAccounts.length === 0 && (
                <p className="text-small text-muted-foreground" data-testid="receive-no-accounts">
                  {t["invoices.receive.noAccounts"]}
                </p>
              )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-date">{t["invoices.receive.date"]}</Label>
            <DatePicker id="receive-date" value={date} onChange={(d) => d && setDate(d)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-amount">
              {formatMessage(t["invoices.receive.amount"], { currency })}
            </Label>
            <Input
              id="receive-amount"
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-receive-amount"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-fee">
              {formatMessage(t["invoices.receive.fee"], { currency: baseCurrency })}
            </Label>
            <Input
              id="receive-fee"
              type="number"
              step="0.01"
              min={0}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              data-testid="input-receive-fee"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receive-reference">{t["invoices.receive.reference"]}</Label>
            <Input
              id="receive-reference"
              value={reference}
              dir="auto"
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          {foreign && (
            <div className="space-y-2">
              <Label htmlFor="receive-rate">
                {formatMessage(t["invoices.receive.rate"], { currency, base: baseCurrency })}
              </Label>
              <Input
                id="receive-rate"
                ltr
                inputMode="decimal"
                value={rate}
                onChange={(e) => setTypedRate({ currency, value: e.target.value })}
                placeholder={t["invoices.receive.ratePlaceholder"]}
              />
            </div>
          )}
        </div>
      </FormSection>

      <FormSection
        title={t["invoices.receive.section.invoices"]}
        description={t["invoices.receive.section.invoicesDesc"]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!open.length || amountFils <= 0}
            onClick={autoApply}
            data-testid="button-auto-apply"
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            {t["invoices.receive.autoApply"]}
          </Button>
        }
      >
        {!contactId ? (
          <p className="text-small text-muted-foreground">{t["invoices.receive.pickFirst"]}</p>
        ) : open.length === 0 && openQuery.isPaused ? (
          <p
            className="text-small text-muted-foreground"
            role="status"
            data-testid="receive-paused"
          >
            {t["invoices.receive.paused"]}
          </p>
        ) : open.length === 0 && openQuery.isError && !openQuery.isFetching ? (
          <p className="text-small text-danger" role="alert" data-testid="receive-load-error">
            {t["invoices.receive.loadError"]}
          </p>
        ) : open.length === 0 && (openQuery.isFetching || !openQuery.isSuccess) ? (
          <p
            className="text-small text-muted-foreground"
            role="status"
            data-testid="receive-loading"
          >
            {t["invoices.receive.loading"]}
          </p>
        ) : open.length === 0 ? (
          <p className="text-small text-muted-foreground" data-testid="receive-no-open">
            {t["invoices.receive.noOpen"]}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t["invoices.receive.col.number"]}</TableHead>
                  <TableHead>{t["invoices.receive.col.due"]}</TableHead>
                  <TableHead data-numeric="">{t["invoices.receive.col.open"]}</TableHead>
                  <TableHead data-numeric="">{t["invoices.receive.col.payment"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((inv) => {
                  const over = toFils(applied[inv.id] ?? 0) > Math.round(inv.openBalance * 100);
                  return (
                    <TableRow key={inv.id} data-testid={`receive-row-${inv.id}`}>
                      <TableCell data-nowrap="" className="font-medium">
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {inv.number}
                        </span>
                      </TableCell>
                      <TableCell data-nowrap="" className="text-muted-foreground">
                        {inv.dueDate ? formatDate(inv.dueDate, locale) : "—"}
                      </TableCell>
                      <TableCell data-numeric="">
                        <Money amount={inv.openBalance} currency={inv.currency} />
                      </TableCell>
                      <TableCell data-numeric="" className="w-40">
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={applied[inv.id] ?? ""}
                          aria-label={formatMessage(t["invoices.receive.applyTo"], {
                            number: inv.number,
                          })}
                          aria-invalid={over || undefined}
                          onChange={(e) => setApplied({ ...applied, [inv.id]: e.target.value })}
                          data-testid={`input-apply-${inv.id}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {(overApplied || overInvoice) && (
          <p className="mt-3 text-small text-danger" role="alert" data-testid="receive-error">
            {overApplied ? t["invoices.receive.overApplied"] : t["invoices.receive.overInvoice"]}
          </p>
        )}
        {feeTooHigh && (
          <p className="mt-3 text-small text-danger" role="alert" data-testid="receive-fee-error">
            {t["invoices.receive.feeTooHigh"]}
          </p>
        )}
        {feeFils > 0 && amountFils > 0 && !foreign && !feeTooHigh && (
          <p className="mt-3 text-small text-muted-foreground" data-testid="receive-bank-net">
            {formatMessage(t["invoices.receive.bankNet"], {
              amount: fromFils(amountFils - feeFils),
              currency,
            })}
          </p>
        )}
      </FormSection>
    </EditorShell>
  );
}
