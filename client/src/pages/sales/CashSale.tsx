import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { EditorShell } from "@/components/ui/editor-shell";
import { FormSection } from "@/components/ui/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/ui/error-state";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { accountDisplayName } from "@/lib/account-name";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
} from "@/lib/payment-accounts";
import { computeInvoiceFormTotals, lineVatRate } from "@/lib/invoice-totals";
import { isVatRegisteredCompany } from "@/lib/invoice-defaults";
import { UAE_STANDARD_VAT_RATE } from "@shared/vat-classification";

const SUPPLY_TYPES = ["standard_rated", "zero_rated", "exempt", "out_of_scope"] as const;
type SupplyType = (typeof SUPPLY_TYPES)[number];
const EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

interface CashLine {
  description: string;
  quantity: string;
  unitPrice: string;
  vatSupplyType: SupplyType;
}

const NO_CONTACT = "__none__";
const BUYER_TYPES = ["consumer", "business", "government"] as const;

/**
 * WQ1 (7.7): a sale paid on the spot. The customer is optional (a walk-in customer is "Cash
 * customer"); the cash or bank account the money went into is required. The server creates
 * the invoice, posts its revenue and records the payment in one transaction.
 */
export default function CashSale() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { company, companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const vatRegistered = isVatRegisteredCompany(company);
  const standardRate = UAE_STANDARD_VAT_RATE;
  const blank = (): CashLine => ({
    description: "",
    quantity: "1",
    unitPrice: "",
    vatSupplyType: vatRegistered ? "standard_rated" : "out_of_scope",
  });

  const { data: contacts = [] } = useQuery<
    Array<{ id: string; name: string; emirate?: string | null }>
  >({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled: !!companyId,
  });
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isLoadingError: accountsFailed,
    refetch: refetchAccounts,
  } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  const paymentAccounts = postablePaymentAccounts(accounts);
  // CASH-SERIES: the number comes from the cash sale series (Settings › Numbering), not the
  // tax-invoice series; the server allocates it on save, so this is the next one, not a hold.
  const numberingKey = ["/api/companies", companyId, "numbering"];
  const { data: numbering } = useQuery<{
    numbering: Array<{ docType: string; nextFormatted: string }>;
  }>({ queryKey: numberingKey, enabled: !!companyId });
  const nextNumber = numbering?.numbering.find((n) => n.docType === "cash_sale")?.nextFormatted;

  const [contactId, setContactId] = useState(NO_CONTACT);
  const [buyerType, setBuyerType] = useState<(typeof BUYER_TYPES)[number] | "unknown">("unknown");
  const [customerName, setCustomerName] = useState("");
  const [pickedAccountId, setAccountId] = useState("");
  // The primary bank (or cash) account until one is picked.
  const accountId =
    pickedAccountId || defaultPaymentAccountId(accounts, bankAccounts, { method: "cash" });
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [emirate, setEmirate] = useState<string>(
    (company as { emirate?: string | null } | undefined)?.emirate ?? ""
  );
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<CashLine[]>(() => [blank()]);

  const totals = computeInvoiceFormTotals(
    lines.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      vatSupplyType: l.vatSupplyType,
      discountPercent: 0,
    })),
    standardRate
  );
  const linesValid =
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) > 0);
  const needsPlace = vatRegistered && lines.some((l) => l.vatSupplyType === "standard_rated");

  const setLine = (i: number, patch: Partial<CashLine>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const record = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/cash-sales`, {
        ...(contactId !== NO_CONTACT
          ? { contactId }
          : { customerName: customerName.trim() || t["invoices.cashSale.cashCustomer"] }),
        date,
        ...(buyerType === "unknown" ? {} : { buyerType }),
        paymentAccountId: accountId,
        ...(emirate ? { placeOfSupplyEmirate: emirate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Math.round(Number(l.unitPrice) * 100) / 100,
          vatRate: lineVatRate(l.vatSupplyType, standardRate),
          vatSupplyType: l.vatSupplyType,
        })),
      }),
    onSuccess: (inv: { number: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      void queryClient.invalidateQueries({ queryKey: numberingKey });
      toast({
        title: t["invoices.cashSale.recorded"],
        description: formatMessage(t["invoices.cashSale.recordedBody"], { number: inv.number }),
      });
      navigate("/invoices");
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["invoices.cashSale.failed"],
        description: error?.message,
      }),
  });

  const canSubmit =
    linesValid &&
    !!accountId &&
    (!needsPlace || !!emirate) &&
    can("ledger.post") &&
    !record.isPending;

  return (
    <EditorShell
      testId="cash-sale-page"
      backHref="/invoices"
      backLabel={t["invoices.editor.back"]}
      eyebrow={t["invoices.receive.eyebrow"]}
      title={t["invoices.cashSale.title"]}
      description={t["invoices.cashSale.desc"]}
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
          <span>{t["invoices.editor.total"]}</span>
          <Money
            amount={totals.total}
            currency={(company as { baseCurrency?: string } | undefined)?.baseCurrency || "AED"}
            className="text-h3 font-semibold text-foreground"
          />
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
            data-testid="button-record-cash-sale"
          >
            {record.isPending ? t["forms.saving"] : t["invoices.cashSale.submit"]}
          </Button>
        </>
      }
    >
      <FormSection title={t["invoices.cashSale.section.sale"]}>
        <div className="mb-4 rounded-md border bg-muted/40 p-3" data-testid="cash-sale-number">
          <p className="text-small">
            <span className="text-muted-foreground">{t["invoices.cashSale.number"]}</span>{" "}
            <span
              dir="ltr"
              className="font-medium tabular-nums [unicode-bidi:isolate]"
              data-testid="cash-sale-next-number"
            >
              {nextNumber ?? "—"}
            </span>
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            {t["invoices.cashSale.numberHint"]}{" "}
            <Link href="/settings/numbering" className="underline underline-offset-2">
              {t["invoices.cashSale.numberSettings"]}
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cash-customer">{t["invoices.cashSale.customer"]}</Label>
            <Select
              value={contactId}
              onValueChange={(v) => {
                setContactId(v);
                const c = contacts.find((x) => x.id === v);
                if (c?.emirate) setEmirate(c.emirate);
              }}
            >
              <SelectTrigger id="cash-customer" data-testid="select-cash-customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTACT}>{t["invoices.cashSale.walkIn"]}</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {contactId === NO_CONTACT && (
            <div className="space-y-2">
              <Label htmlFor="cash-customer-name">{t["invoices.cashSale.customerName"]}</Label>
              <Input
                id="cash-customer-name"
                dir="auto"
                value={customerName}
                placeholder={t["invoices.cashSale.cashCustomer"]}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="cash-buyer-type">{t["invoices.cashSale.buyerType"]}</Label>
            <Select
              value={buyerType}
              onValueChange={(value: typeof buyerType) => setBuyerType(value)}
            >
              <SelectTrigger id="cash-buyer-type" data-testid="select-cash-buyer-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">{t["invoices.cashSale.buyerType.unknown"]}</SelectItem>
                {BUYER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t[`invoices.cashSale.buyerType.${type}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-account">{t["invoices.cashSale.paidInto"]}</Label>
            <Select
              value={accountId}
              onValueChange={setAccountId}
              disabled={paymentAccounts.length === 0}
            >
              <SelectTrigger id="cash-account" data-testid="select-cash-account">
                <SelectValue
                  placeholder={
                    accountsLoading
                      ? t["components.ui.loading"]
                      : t["invoices.receive.chooseAccount"]
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {accountDisplayName(a, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accountsFailed ? (
              <ErrorState compact onRetry={() => void refetchAccounts()} />
            ) : !accountsLoading && paymentAccounts.length === 0 ? (
              <p className="text-small text-muted-foreground">{t["invoices.noCashBankAccounts"]}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-date">{t["invoices.receive.date"]}</Label>
            <DatePicker id="cash-date" value={date} onChange={(d) => d && setDate(d)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-emirate">{t["invoices.placeOfSupply"]}</Label>
            <Select value={emirate} onValueChange={setEmirate}>
              <SelectTrigger id="cash-emirate" data-testid="select-cash-emirate">
                <SelectValue placeholder={t["invoices.placeOfSupplyDefault"]} />
              </SelectTrigger>
              <SelectContent>
                {EMIRATES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t[`invoices.emirate.${e}`]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-reference">{t["invoices.receive.reference"]}</Label>
            <Input
              id="cash-reference"
              dir="auto"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title={t["invoices.cashSale.section.lines"]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines([...lines, blank()])}
            data-testid="button-cash-add-line"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t.addLine}
          </Button>
        }
      >
        <ol className="divide-y divide-border rounded-lg bg-surface-sunken/60 px-3">
          {lines.map((line, i) => (
            <li key={i} className="space-y-3 py-3">
              <div className="flex items-start gap-2">
                <Input
                  dir="auto"
                  value={line.description}
                  placeholder={t.description}
                  aria-label={formatMessage(t["forms.lineDescription"], { n: i + 1 })}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  data-testid={`input-cash-line-description-${i}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  disabled={lines.length <= 1}
                  aria-label={formatMessage(t["forms.removeLine"], { n: i + 1 })}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="mobile-keep-cols grid grid-cols-2 gap-3 sm:grid-cols-[6rem_8rem_minmax(0,1fr)_auto]">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={line.quantity}
                  aria-label={t["forms.col.qty"]}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                  data-testid={`input-cash-line-quantity-${i}`}
                />
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={line.unitPrice}
                  aria-label={t["forms.col.unitPrice"]}
                  placeholder={t["forms.col.unitPrice"]}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                  data-testid={`input-cash-line-price-${i}`}
                />
                <Select
                  value={line.vatSupplyType}
                  onValueChange={(v) => setLine(i, { vatSupplyType: v as SupplyType })}
                >
                  <SelectTrigger
                    className="col-span-2 sm:col-span-1"
                    aria-label={t["invoices.supplyType"]}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPLY_TYPES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {t[`invoices.supply.${st}`]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="flex h-9 items-center justify-end text-sm font-medium">
                  <Money amount={totals.lines[i]?.lineTotal ?? 0} />
                </span>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 space-y-1 text-small">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t["invoices.cashSale.subtotal"]}</span>
            <Money amount={totals.subtotal} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t["invoices.cashSale.vat"]}</span>
            <Money amount={totals.vatAmount} />
          </div>
        </div>
      </FormSection>

      <FormSection title={t["invoices.notes.label"]}>
        <Textarea
          dir="auto"
          rows={3}
          maxLength={4000}
          aria-label={t["invoices.notes.label"]}
          value={notes}
          placeholder={t["invoices.notes.placeholder"]}
          onChange={(e) => setNotes(e.target.value)}
        />
      </FormSection>
    </EditorShell>
  );
}
