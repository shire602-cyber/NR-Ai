/**
 * WQ2 (8.5, 8.16): supplier credits (vendor debit notes). A UI over the existing server: the note
 * posts through createDebitNote (Dr A/P, Cr the line accounts, Cr input VAT following the bill's
 * VAT treatment: blocked / partial / reverse charge, A1 C2; returned stock leaves inventory at
 * cost, A2 M4) and is applied to a bill through applyDebitNote (settlement rule).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Ban, Plus, Trash2, Undo2 } from "lucide-react";
import { DocumentSearchInput } from "@/components/documents/DocumentSearchInput";
import { matchesDocumentSearch } from "@/lib/document-search";
import { PageHeader } from "@/components/ui/page-header";
import { EditorShell } from "@/components/ui/editor-shell";
import { DataTableCard } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Money, MoneyCell } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { FormSection, FormTotals } from "@/components/ui/form-layout";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PurchaseAccountOptions } from "@/components/accounts/PurchaseAccountOptions";
import { SupplierPicker, type SupplierOption } from "@/components/bills/SupplierPicker";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { withoutControlAccounts } from "@/lib/control-account-options";
import { uaeToday as uaeTodayIso } from "@shared/uae-date";
import {
  debitNoteRemaining,
  debitNoteTotals,
  linesFromBill,
  type DebitNoteDraftLine,
} from "@/lib/debit-note-form";

interface DebitNoteRow {
  id: string;
  debit_note_number: string | null;
  vendor_name: string | null;
  bill_id: string | null;
  note_date: string;
  currency: string | null;
  total_amount: string;
  amount_applied: string | null;
  status: string | null;
  reason: string | null;
}

interface BillRow {
  id: string;
  vendor_id?: string | null;
  vendor_name: string;
  bill_number: string | null;
  currency: string;
  status: string;
  total_amount: string;
  open_balance?: number;
}

interface BillDetail extends BillRow {
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
const PAYABLE = ["approved", "partial", "overdue"];

export default function DebitNotes() {
  const [location] = useLocation();
  return location.startsWith("/debit-notes/new") ? <DebitNoteEditor /> : <DebitNoteList />;
}

function DebitNoteList() {
  const { t, locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { gate } = useCompanyPermission();
  const [, navigate] = useLocation();
  const [applying, setApplying] = useState<DebitNoteRow | null>(null);
  const [voiding, setVoiding] = useState<DebitNoteRow | null>(null);
  const { data: notes = [], isLoading } = useQuery<DebitNoteRow[]>({
    queryKey: ["/api/companies", companyId, "debit-notes"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/debit-notes`),
    enabled: !!companyId,
  });
  const { data: bills = [] } = useQuery<BillRow[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });
  const billNumber = (id: string | null) =>
    id ? (bills.find((b) => b.id === id)?.bill_number ?? "—") : "—";
  const [search, setSearch] = useState("");
  const searching = search.trim() !== "";
  const visibleNotes = notes.filter((n) =>
    matchesDocumentSearch(search, n.debit_note_number, n.vendor_name, billNumber(n.bill_id))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["purchases.eyebrow"]}
        title={t["purchases.debitNote.listTitle"]}
        description={t["purchases.debitNote.listDesc"]}
        backHref="/bill-pay"
        backLabel={t["invoices.editor.backBills"]}
        actions={
          <Button
            onClick={() => navigate("/debit-notes/new")}
            {...gate("ledger.post")}
            data-testid="button-new-debit-note"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t["purchases.debitNote.new"]}
          </Button>
        }
      />
      <DocumentSearchInput
        value={search}
        onChange={setSearch}
        placeholder={t["screens.searchDebitNotes"]}
        testId="input-search-debit-notes"
      />
      <DataTableCard
        status={isLoading ? "loading" : visibleNotes.length === 0 ? "empty" : "ready"}
        columnLabels={[
          t["purchases.debitNote.number"],
          t["purchases.supplier.label"],
          t["purchases.debitNote.date"],
          t["purchases.debitNote.total"],
        ]}
        testId="debit-notes-table"
        empty={
          searching
            ? {
                icon: Undo2,
                title: t["screens.noMatchingDocuments"],
                description: t["screens.noMatchingDocumentsBody"],
              }
            : {
                icon: Undo2,
                title: t["purchases.debitNote.emptyTitle"],
                description: t["purchases.debitNote.emptyBody"],
              }
        }
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead>{t["purchases.debitNote.number"]}</TableHead>
              <TableHead className="w-full">{t["purchases.supplier.label"]}</TableHead>
              <TableHead>{t["purchases.debitNote.date"]}</TableHead>
              <TableHead>{t["purchases.debitNote.bill"]}</TableHead>
              <TableHead data-numeric="">{t["purchases.debitNote.total"]}</TableHead>
              <TableHead data-numeric="">{t["purchases.debitNote.remaining"]}</TableHead>
              <TableHead>{t["purchases.debitNote.status"]}</TableHead>
              <TableHead>
                <span className="sr-only">{t.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleNotes.map((n) => {
              const isVoid = n.status === "void";
              const remaining = isVoid ? 0 : debitNoteRemaining(n);
              return (
                <TableRow key={n.id} data-testid={`debit-note-row-${n.id}`}>
                  <TableCell data-nowrap="" data-cell="meta" className="font-medium">
                    <MiddleTruncate text={n.debit_note_number || "—"} />
                  </TableCell>
                  <TableCell data-truncate="" data-cell="title" dir="auto">
                    {n.vendor_name}
                  </TableCell>
                  <TableCell data-nowrap="" className="text-muted-foreground">
                    {formatDate(n.note_date, locale)}
                  </TableCell>
                  <TableCell data-nowrap="" className="text-muted-foreground">
                    {billNumber(n.bill_id)}
                  </TableCell>
                  <MoneyCell
                    amount={Number(n.total_amount)}
                    currency={n.currency || "AED"}
                    data-cell="amount"
                  />
                  <MoneyCell
                    amount={remaining}
                    currency={n.currency || "AED"}
                    className="text-muted-foreground"
                  />
                  <TableCell data-cell="status" data-nowrap="">
                    <StatusBadge status={isVoid ? "void" : remaining > 0 ? "open" : "applied"} />
                  </TableCell>
                  <TableCell data-cell="actions">
                    <RowActions maxInline={2}>
                      {remaining > 0 && (
                        <RowActionButton
                          label={t["purchases.debitNote.apply"]}
                          icon={Undo2}
                          onClick={() => setApplying(n)}
                          {...gate("payments.release")}
                        />
                      )}
                      {!isVoid && (
                        <RowActionButton
                          label={t["purchases.debitNote.void"]}
                          icon={Ban}
                          onClick={() => setVoiding(n)}
                          data-testid={`button-void-debit-note-${n.id}`}
                          {...gate("ledger.post")}
                        />
                      )}
                    </RowActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTableCard>
      <ApplyDialog
        companyId={companyId}
        note={applying}
        bills={bills}
        onClose={() => setApplying(null)}
      />
      <VoidDialog companyId={companyId} note={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function VoidDialog({
  companyId,
  note,
  onClose,
}: {
  companyId: string | undefined;
  note: DebitNoteRow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };
  const voidNote = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/debit-notes/${note!.id}/void`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      toast({ title: t["purchases.debitNote.voided"] });
      close();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md" data-testid="void-debit-note-dialog">
        <DialogHeader>
          <DialogTitle>{t["purchases.debitNote.voidTitle"]}</DialogTitle>
          <DialogDescription>{t["purchases.debitNote.voidDesc"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">{t["purchases.debitNote.voidReason"]}</Label>
          <Textarea
            id="void-reason"
            dir="auto"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="void-debit-note-reason"
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="void-debit-note-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t["pages.cancel"]}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || voidNote.isPending}
            onClick={() => voidNote.mutate()}
            data-testid="button-confirm-void-debit-note"
          >
            {t["purchases.debitNote.voidConfirm"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyDialog({
  companyId,
  note,
  bills,
  onClose,
}: {
  companyId: string | undefined;
  note: DebitNoteRow | null;
  bills: BillRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      note
        ? bills.filter(
            (b) =>
              PAYABLE.includes(b.status) &&
              (b.currency || "AED") === (note.currency || "AED") &&
              (b.vendor_name === note.vendor_name || b.id === note.bill_id)
          )
        : [],
    [bills, note]
  );
  if (note && seededFor !== note.id) {
    setSeededFor(note.id);
    const initial = candidates.find((b) => b.id === note.bill_id) ?? candidates[0];
    setBillId(initial?.id ?? "");
    const open = Number(initial?.open_balance ?? 0);
    const rem = debitNoteRemaining(note);
    setAmount((initial ? Math.min(rem, open) : rem).toFixed(2));
  }
  const apply = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/debit-notes/${note!.id}/apply`, {
        bill_id: billId,
        amount,
        date: uaeTodayIso(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      toast({ title: t["purchases.debitNote.applied"] });
      onClose();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t["purchases.debitNote.applyTitle"]}</DialogTitle>
          <DialogDescription>{t["purchases.debitNote.applyDesc"]}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t["purchases.debitNote.noOpenBills"]}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="apply-bill">{t["purchases.debitNote.bill"]}</Label>
              <Select value={billId} onValueChange={setBillId}>
                <SelectTrigger id="apply-bill">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bill_number || b.vendor_name} · {Number(b.open_balance ?? 0).toFixed(2)}{" "}
                      {b.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apply-amount">{t["purchases.debitNote.applyAmount"]}</Label>
              <Input
                id="apply-amount"
                ltr
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t["pages.cancel"]}
          </Button>
          <Button
            type="button"
            disabled={!billId || !(Number(amount) > 0) || apply.isPending}
            onClick={() => apply.mutate()}
            data-testid="button-apply-debit-note"
          >
            {t["purchases.debitNote.apply"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const blankLine = (): DebitNoteDraftLine => ({
  description: "",
  amount: "",
  vatRate: 5,
  accountId: "",
  productId: null,
  quantity: 1,
});

function DebitNoteEditor() {
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

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const { data: bills = [] } = useQuery<BillRow[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });
  const { data: bill } = useQuery<BillDetail>({
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
      const open = Number(bills.find((b) => b.id === billId)?.open_balance ?? 0);
      if (applyNow && billId && open > 0 && bill && PAYABLE.includes(bill.status)) {
        await apiRequest("POST", `/api/companies/${companyId}/debit-notes/${note.id}/apply`, {
          bill_id: billId,
          amount: Math.min(open, Number(note.total_amount)).toFixed(2),
          date: noteDate,
        });
      }
      return note;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      toast({ title: t["purchases.debitNote.saved"] });
      navigate("/debit-notes");
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = () => {
    setError(null);
    if (!vendorName.trim()) return setError(t["forms.errors.vendorNameRequired"]);
    if (!reason.trim()) return setError(t["purchases.debitNote.reasonRequired"]);
    if (lines.some((l) => !l.description.trim() || !(Number(l.amount) > 0)))
      return setError(t["purchases.debitNote.lineRequired"]);
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
            disabled={save.isPending}
            {...gate("ledger.post")}
            data-testid="button-save-debit-note"
          >
            {save.isPending ? t["forms.saving"] : t["purchases.debitNote.save"]}
          </Button>
        </>
      }
    >
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
        {billId && bill && PAYABLE.includes(bill.status) && (
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
