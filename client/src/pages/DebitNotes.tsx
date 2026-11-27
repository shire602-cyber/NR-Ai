/**
 * WQ2 (8.5, 8.16): supplier credits (vendor debit notes). A UI over the existing server: the note
 * posts through createDebitNote (Dr A/P, Cr the line accounts, Cr input VAT following the bill's
 * VAT treatment: blocked / partial / reverse charge, A1 C2; returned stock leaves inventory at
 * cost, A2 M4) and is applied to a bill through applyDebitNote (settlement rule).
 */
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Ban, Plus, Undo2 } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DocumentListTable } from "@/components/documents/DocumentListTable";
import { DocumentSearchInput } from "@/components/documents/DocumentSearchInput";
import { matchesDocumentSearch } from "@/lib/document-search";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyCell } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
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
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { uaeToday as uaeTodayIso } from "@shared/uae-date";
import {
  debitNoteRemaining,
  PAYABLE_BILL_STATUSES,
  type DebitNoteBill,
} from "@/lib/debit-note-form";
import { lazyWithReload } from "@/lib/lazyWithReload";

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

const DebitNoteEditor = lazyWithReload(() => import("./DebitNoteEditor"));

export default function DebitNotes() {
  const [location] = useLocation();
  if (location.startsWith("/debit-notes/new")) {
    return (
      <Suspense fallback={<PageSkeleton variant="form" />}>
        <DebitNoteEditor />
      </Suspense>
    );
  }
  return <DebitNoteList />;
}

function DebitNoteList() {
  const { t, locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { gate } = useCompanyPermission();
  const [, navigate] = useLocation();
  const [applying, setApplying] = useState<DebitNoteRow | null>(null);
  const [voiding, setVoiding] = useState<DebitNoteRow | null>(null);
  const notesQuery = useQuery<DebitNoteRow[]>({
    queryKey: ["/api/companies", companyId, "debit-notes"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/debit-notes`),
    enabled: !!companyId,
  });
  const billsQuery = useQuery<DebitNoteBill[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });
  const [search, setSearch] = useState("");
  const notes = notesQuery.data ?? [];
  const bills = billsQuery.data ?? [];
  const billNumber = (id: string | null) => bills.find((bill) => bill.id === id)?.bill_number;
  const needsBills = notes.some((note) => note.bill_id !== null);
  const billsLoading = needsBills && billsQuery.isPending;
  const billsFailed = needsBills && billsQuery.isLoadingError;
  const visibleNotes =
    billsLoading || billsFailed
      ? notes
      : notes.filter((note) =>
          matchesDocumentSearch(
            search,
            note.debit_note_number,
            note.vendor_name,
            billNumber(note.bill_id)
          )
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
      {billsLoading && (
        <p role="status" className="text-small text-muted-foreground">
          {t["purchases.debitNote.billsLoading"]}
        </p>
      )}
      {billsFailed && (
        <ErrorState
          compact
          title={t["purchases.debitNote.billsLoadFailed"]}
          description={t["common.loadFailedBody"]}
          onRetry={() => void billsQuery.refetch()}
          retrying={billsQuery.isFetching}
        />
      )}
      <DocumentListTable
        query={notesQuery}
        matchCount={visibleNotes.length}
        columnLabels={[
          t["purchases.debitNote.number"],
          t["purchases.supplier.label"],
          t["purchases.debitNote.date"],
          t["purchases.debitNote.total"],
        ]}
        testId="debit-notes-table"
        noMatch={{
          icon: Undo2,
          title: t["screens.noMatchingDocuments"],
          description: t["screens.noMatchingDocumentsBody"],
        }}
        empty={{
          icon: Undo2,
          title: t["purchases.debitNote.emptyTitle"],
          description: t["purchases.debitNote.emptyBody"],
        }}
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
                    {billNumber(n.bill_id) ?? "—"}
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
      </DocumentListTable>
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
  bills: DebitNoteBill[];
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
              PAYABLE_BILL_STATUSES.includes(b.status) &&
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
