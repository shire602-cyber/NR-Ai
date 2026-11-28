import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Plus, Trash2 } from "lucide-react";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { EditorShell } from "@/components/ui/editor-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/ui/money";
import { FormSection, FormTotals } from "@/components/ui/form-layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchaseAccountOptions } from "@/components/accounts/PurchaseAccountOptions";
import { SupplierPicker, type SupplierOption } from "@/components/bills/SupplierPicker";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { withoutControlAccounts } from "@/lib/control-account-options";
import { uaeToday as uaeTodayIso } from "@shared/uae-date";
import {
  debitNoteTotals,
  linesFromBill,
  PAYABLE_BILL_STATUSES,
  type DebitNoteBill,
  type DebitNoteDraftLine,
} from "@/lib/debit-note-form";

interface BillDetail extends DebitNoteBill {
  line_items: Array<{
    description: string;
    amount: string;
    vat_rate: string;
    vat_supply_type?: string;
    account_id: string | null;
    product_id?: string | null;
    quantity: string;
  }>;
}

const CREDITABLE = ["approved", "partial", "paid", "overdue"];

/** The note posted but applying it to the bill failed; it is not safe to submit again. */
class NoteSavedNotAppliedError extends Error {}

const blankLine = (): DebitNoteDraftLine => ({
  description: "",
  amount: "",
  vatRate: 5,
  accountId: "",
  productId: null,
  quantity: 1,
});

export default function DebitNoteEditor() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { gate } = useCompanyPermission();
  const [, navigate] = useLocation();
  const search = useSearch();
  const fromBill = new URLSearchParams(search).get("billId");

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [billId, setBillId] = useState<string>(fromBill ?? "");
  const [noteDate, setNoteDate] = useState(uaeTodayIso());
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<DebitNoteDraftLine[]>([blankLine()]);
  const [applyNow, setApplyNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seededBill, setSeededBill] = useState<string | null>(null);

  const {
    data: accounts = [],
    isError: accountsFailed,
    error: accountsError,
    refetch: refetchAccounts,
    isFetching: accountsFetching,
    isSuccess: accountsLoaded,
  } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const {
    data: bills = [],
    isError: billsFailed,
    error: billsError,
    refetch: refetchBills,
    isFetching: billsFetching,
    isSuccess: billsLoaded,
  } = useQuery<DebitNoteBill[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });
  const {
    data: bill,
    isError: billFailed,
    error: billError,
    refetch: refetchBill,
    isFetching: billFetching,
  } = useQuery<BillDetail>({
    queryKey: ["/api/bills", billId],
    queryFn: () => apiRequest("GET", `/api/bills/${billId}`),
    enabled: !!billId,
  });
  // Prefill from the bill once: supplier, currency and its lines (amounts editable).
  if (bill && seededBill !== bill.id) {
    setSeededBill(bill.id);
    setVendorId(bill.vendor_id ?? null);
    setVendorName(bill.vendor_name);
    setLines(linesFromBill(bill.line_items));
  }
  const creditable = bills.filter(
    (b) => CREDITABLE.includes(b.status) && (!vendorName || b.vendor_name === vendorName)
  );
  const lineAccounts = withoutControlAccounts(accounts).filter(
    (a: any) => a.type === "expense" || a.type === "asset"
  );
  const currency = bill?.currency || "AED";
  const totals = debitNoteTotals(lines);

  const save = useMutation({
    mutationFn: async () => {
      const note = await apiRequest("POST", `/api/companies/${companyId}/debit-notes`, {
        vendor_id: vendorId,
        vendor_name: vendorName || undefined,
        bill_id: billId || null,
        note_date: noteDate,
        debit_note_number: number.trim() || null,
        currency: bill?.currency,
        reason: reason.trim(),
        lines: lines.map((l) => ({
          description: l.description.trim(),
          amount: l.amount,
          vat_rate: l.vatRate,
          account_id: l.accountId || null,
          ...(l.productId ? { product_id: l.productId, quantity: l.quantity } : {}),
        })),
      });
      if (applyNow && billId && bill && PAYABLE_BILL_STATUSES.includes(bill.status)) {
        // Checked in submit() before anything posts; re-resolved here from the same lists.
        const open = Number(bills.find((b) => b.id === billId)?.open_balance ?? 0);
        try {
          await apiRequest("POST", `/api/companies/${companyId}/debit-notes/${note.id}/apply`, {
            bill_id: billId,
            amount: Math.min(open, Number(note.total_amount)).toFixed(2),
            date: noteDate,
          });
        } catch (e) {
          // The note is already posted (create and apply are two calls): say so, do not invite a
          // retry that would post a second note.
          throw new NoteSavedNotAppliedError((e as Error).message);
        }
      }
      return note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      toast({ title: t["purchases.debitNote.saved"] });
      navigate("/debit-notes");
    },
    onError: (e: Error) => {
      if (e instanceof NoteSavedNotAppliedError) {
        void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
        toast({
          title: t["purchases.debitNote.savedNotApplied"],
          description: e.message,
          variant: "destructive",
        });
        navigate("/debit-notes");
        return;
      }
      setError(e.message);
    },
  });

  // The pickers are empty when these lists fail to load: do not let a note be saved blind.
  const listsFailed = accountsFailed || billsFailed;
  const listsReady = accountsLoaded && billsLoaded;
  // A linked bill supplies the currency, supplier and the apply step: wait for it too.
  const billReady = !billId || !!bill;
  const canSave = listsReady && billReady;

  const block = (message: string) => {
    setError(message);
    toast({ title: message, variant: "destructive" });
  };

  const submit = () => {
    setError(null);
    if (!canSave) {
      return block(
        listsFailed || billFailed
          ? t["purchases.debitNote.loadFailedBlock"]
          : t["purchases.debitNote.stillLoading"]
      );
    }
    if (!vendorName.trim()) return setError(t["forms.errors.vendorNameRequired"]);
    if (!reason.trim()) return setError(t["purchases.debitNote.reasonRequired"]);
    if (lines.some((l) => !l.description.trim() || !(Number(l.amount) > 0)))
      return setError(t["purchases.debitNote.lineRequired"]);
    if (applyNow && billId && bill && PAYABLE_BILL_STATUSES.includes(bill.status)) {
      const listed = bills.find((b) => b.id === billId);
      if (!listed) return block(t["purchases.debitNote.billNotInList"]);
      if (!(Number(listed.open_balance ?? 0) > 0))
        return block(t["purchases.debitNote.noOpenBalance"]);
    }
    save.mutate();
  };

  const setLine = (i: number, patch: Partial<DebitNoteDraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <EditorShell
      testId="debit-note-editor"
      backHref="/debit-notes"
      backLabel={t["purchases.debitNote.listTitle"]}
      eyebrow={t["purchases.eyebrow"]}
      title={t["purchases.debitNote.new"]}
      description={t["purchases.debitNote.editorDesc"]}
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>{t["purchases.debitNote.total"]}</span>
          <Money
            amount={totals.total}
            currency={currency}
            className="text-h3 font-semibold text-foreground"
          />
        </span>
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => navigate("/debit-notes")}>
            {t["pages.cancel"]}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={save.isPending || !canSave}
            {...gate("ledger.post")}
            data-testid="button-save-debit-note"
          >
            {save.isPending ? t["forms.saving"] : t["purchases.debitNote.save"]}
          </Button>
        </>
      }
    >
      {accountsFailed ? (
        <LoadErrorState
          error={accountsError}
          onRetry={() => void refetchAccounts()}
          retrying={accountsFetching}
          compact
          testId="debit-note-accounts-load-error"
        />
      ) : null}
      {billsFailed ? (
        <LoadErrorState
          error={billsError}
          onRetry={() => void refetchBills()}
          retrying={billsFetching}
          compact
          testId="debit-note-bills-load-error"
        />
      ) : null}
      {billId && billFailed ? (
        <LoadErrorState
          error={billError}
          onRetry={() => void refetchBill()}
          retrying={billFetching}
          compact
          testId="debit-note-bill-load-error"
        />
      ) : null}
      <FormSection title={t["purchases.debitNote.sectionSupplier"]}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t["purchases.supplier.label"]}</Label>
            <SupplierPicker
              companyId={companyId}
              vendorId={vendorId}
              vendorName={vendorName}
              onPick={(s: SupplierOption) => {
                setVendorId(s.id);
                setVendorName(s.name);
              }}
              onFreeText={(name) => {
                setVendorId(null);
                setVendorName(name);
              }}
              testId="debit-note-supplier"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn-bill">{t["purchases.debitNote.bill"]}</Label>
            <Select
              value={billId || "__none__"}
              onValueChange={(v) => {
                setBillId(v === "__none__" ? "" : v);
                if (v === "__none__") setSeededBill(null);
              }}
            >
              <SelectTrigger id="dn-bill" data-testid="debit-note-bill">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t["purchases.debitNote.noBill"]}</SelectItem>
                {creditable.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {(b.bill_number || "—") + " · " + b.vendor_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t["purchases.debitNote.billHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn-date">{t["purchases.debitNote.date"]}</Label>
            <DatePicker
              id="dn-date"
              value={noteDate}
              onChange={setNoteDate}
              data-testid="debit-note-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dn-number">{t["purchases.debitNote.numberOptional"]}</Label>
            <Input id="dn-number" ltr value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dn-reason">{t["purchases.debitNote.reason"]}</Label>
            <Textarea
              id="dn-reason"
              dir="auto"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="debit-note-reason"
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title={t["purchases.debitNote.sectionLines"]}
        description={t["purchases.debitNote.linesDesc"]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((ls) => [...ls, blankLine()])}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t["pages.addLine"]}
          </Button>
        }
      >
        <ul className="space-y-4">
          {lines.map((l, i) => (
            <li key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-6">
              <div className="space-y-1.5 sm:col-span-6">
                <Label htmlFor={`dn-desc-${i}`}>{t["purchases.debitNote.description"]}</Label>
                <Input
                  id={`dn-desc-${i}`}
                  dir="auto"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>{t["forms.col.account"]}</Label>
                <Select
                  value={l.accountId || ""}
                  onValueChange={(v) => setLine(i, { accountId: v })}
                  disabled={!!l.productId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        l.productId ? t["purchases.debitNote.stockReturn"] : t["screens.account"]
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <PurchaseAccountOptions accounts={lineAccounts} />
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-1">
                <Label>{t["forms.col.vat"]}</Label>
                <Select
                  value={String(l.vatRate)}
                  onValueChange={(v) => setLine(i, { vatRate: Number(v) as 0 | 5 })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="0">0%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`dn-amount-${i}`}>{t["purchases.lines.amountBeforeVat"]}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`dn-amount-${i}`}
                    ltr
                    inputMode="decimal"
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    data-testid={`debit-note-amount-${i}`}
                  />
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={formatMessage(t["purchases.debitNote.removeLine"], { n: i + 1 })}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <FormTotals
          rows={[
            {
              label: t["forms.preview.subtotal"],
              value: <Money amount={totals.subtotal} currency={currency} />,
            },
            { label: t["forms.col.vat"], value: <Money amount={totals.vat} currency={currency} /> },
          ]}
          total={{
            label: t["purchases.debitNote.total"],
            value: <Money amount={totals.total} currency={currency} />,
          }}
        />
        <p className="text-xs text-muted-foreground">{t["purchases.debitNote.vatHint"]}</p>
        {billId && bill && PAYABLE_BILL_STATUSES.includes(bill.status) && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="dn-apply-now"
              checked={applyNow}
              onCheckedChange={(v) => setApplyNow(v === true)}
            />
            <Label htmlFor="dn-apply-now" className="font-normal">
              {t["purchases.debitNote.applyNow"]}
            </Label>
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="debit-note-error">
            {error}
          </p>
        )}
      </FormSection>
    </EditorShell>
  );
}
