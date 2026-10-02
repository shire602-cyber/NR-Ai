import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatCurrency, formatNumber } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { parseAmountText } from "@/lib/statement-review";
import type { BankAccount, BankTransaction, LedgerAccount } from "@/lib/banking-api-types";
import { messages } from "./MatchDialogPanels.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";
import { allocateInOrder, allocationState, splitState, type OpenInvoice, type SplitAmountLine } from "./allocation";

interface PanelBase {
  companyId: string;
  transaction: BankTransaction;
  currency: string;
  /** Called after the server accepted the posting. */
  onPosted: () => void;
}

const base = (companyId: string, tid: string) => `/api/companies/${companyId}/bank-statements/${tid}`;

/** A collapsible section: the match dialog's extras stay out of the way until they are needed. */
export function Section({ title, hint, testId, children }: { title: string; hint?: string; testId: string; children: React.ReactNode }) {
  const tr = messages.useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border" data-testid={testId}>
      <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-start" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`${testId}-toggle`}>
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          {open ? tr("sectionClose") : tr("sectionOpen")}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open && <div className="border-t p-3 space-y-3">{children}</div>}
    </div>
  );
}

function usePost(props: PanelBase, path: string) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: unknown) => apiRequest("POST", `${base(props.companyId, props.transaction.id)}/${path}`, body),
    onSuccess: () => {
      toast({ title: tr("posted"), description: tr("postedBody") });
      props.onPosted();
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("failed"), description: bankingErrorText(trc, err, locale) }),
  });
}

// ─── one receipt, several invoices ─────────────────────────────────────────

interface InvoiceRow {
  id: string;
  number: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  currency: string;
  status: string;
  invoiceType?: string;
  outstandingAmount?: number;
}

export function InvoiceAllocationPanel(props: PanelBase & { exchangeRate?: number }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const line = Math.abs(props.transaction.amount);
  const { data, isLoading } = useQuery<InvoiceRow[]>({ queryKey: ["/api/companies", props.companyId, "invoices"], enabled: !!props.companyId });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [keepCredit, setKeepCredit] = useState(false);

  const open: OpenInvoice[] = useMemo(
    () =>
      (data ?? [])
        .filter((i) => (i.currency || "AED").toUpperCase() === props.currency.toUpperCase() && (i.invoiceType ?? "invoice") === "invoice" && i.status !== "draft" && i.status !== "void" && (i.outstandingAmount ?? 0) > 0.005)
        .map((i) => ({ id: i.id, number: i.number, customerName: i.customerName, date: i.date, dueDate: i.dueDate, outstanding: Number(i.outstandingAmount) }))
        .sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date)),
    [data, props.currency]
  );
  const outstandingById = useMemo(() => Object.fromEntries(open.map((i) => [i.id, i.outstanding])), [open]);
  const allocations = open.filter((i) => picked[i.id] !== undefined).map((i) => ({ invoiceId: i.id, amount: parseAmountText(picked[i.id]) ?? NaN }));
  const state = allocationState(line, allocations, outstandingById);
  const money = (n: number) => formatCurrency(n, props.currency, locale);
  const post = usePost(props, "match");

  const toggle = (inv: OpenInvoice, on: boolean) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (!on) delete next[inv.id];
      else {
        const used = Object.entries(prev).reduce((s, [id, t]) => s + (parseAmountText(t) ?? 0), 0);
        const room = Math.max(0, Math.round((line - used) * 100) / 100);
        next[inv.id] = (room > 0 ? Math.min(room, inv.outstanding) : inv.outstanding).toFixed(2);
      }
      return next;
    });

  const fill = () => {
    const { allocations: a } = allocateInOrder(line, open);
    setPicked(Object.fromEntries(a.map((x) => [x.invoiceId, x.amount.toFixed(2)])));
  };

  const issueText = state.issues.includes("NONE_SELECTED") ? tr("issueNone") : state.issues.includes("AMOUNT_INVALID") ? tr("issueAmount") : state.issues.includes("OVER_OUTSTANDING") ? tr("issueOutstanding") : state.issues.includes("OVER_LINE") ? tr("issueLine") : "";
  const needsChoice = state.issues.length === 0 && state.excess > 0.004 && !keepCredit;
  const canPost = state.issues.length === 0 && (state.excess < 0.005 || (keepCredit && state.canKeepExcess));

  return (
    <Section title={tr("invoicesTitle")} hint={tr("invoicesHint")} testId="allocation-panel">
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("invoicesNone")}</p>
      ) : (
        <>
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={fill} data-testid="button-fill-allocation">
              {tr("fillInOrder")}
            </Button>
          </div>
          <ul className="space-y-2" data-testid="allocation-list">
            {open.map((inv) => {
              const on = picked[inv.id] !== undefined;
              return (
                <li key={inv.id} className="grid grid-cols-[auto_1fr_7rem] items-center gap-2 rounded-md border p-2" data-testid={`allocation-row-${inv.id}`}>
                  <Checkbox checked={on} onCheckedChange={(c) => toggle(inv, c === true)} aria-label={inv.number} data-testid={`allocation-check-${inv.id}`} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-words" dir="auto">
                      <span dir="ltr" className="font-mono me-2">
                        {inv.number}
                      </span>
                      {inv.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tr("colDue")}: {formatCalendarDate(inv.dueDate ?? inv.date, locale, "short")} - {tr("colOutstanding")}: <span dir="ltr">{formatNumber(inv.outstanding, locale)}</span>
                    </p>
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!on}
                    value={picked[inv.id] ?? ""}
                    onChange={(e) => setPicked((p) => ({ ...p, [inv.id]: e.target.value }))}
                    aria-label={tr("colPay")}
                    className="h-8 text-end font-mono"
                    data-testid={`allocation-amount-${inv.id}`}
                  />
                </li>
              );
            })}
          </ul>
          <div className="text-sm space-y-1" data-testid="allocation-summary">
            <p>
              {tr("allocated")}: <span dir="ltr" className="font-mono">{money(state.total)}</span> {tr("ofLine", { amount: money(line) })}
            </p>
            {state.excess > 0.004 && (
              <p className="text-[hsl(var(--chart-4))]" data-testid="allocation-left">
                {tr("left", { amount: money(state.excess) })}
              </p>
            )}
          </div>
          {state.excess > 0.004 && state.issues.length === 0 && (
            <div className="rounded-md border p-3 space-y-1" data-testid="allocation-credit-choice">
              <div className="flex items-center gap-2">
                <Checkbox id="keep-credit" checked={keepCredit} disabled={!state.canKeepExcess} onCheckedChange={(c) => setKeepCredit(c === true)} data-testid="allocation-keep-credit" />
                <Label htmlFor="keep-credit" className="text-sm">
                  {tr("keepCredit", { amount: money(state.excess) })}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">{state.canKeepExcess ? tr("keepCreditHint") : tr("cannotKeep")}</p>
              {needsChoice && <p className="text-xs text-destructive">{tr("needChoice", { amount: money(state.excess) })}</p>}
            </div>
          )}
          {issueText && <p className="text-xs text-destructive">{issueText}</p>}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!canPost || post.isPending}
              onClick={() => post.mutate({ matchedType: "invoices", allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })), keepAsCredit: keepCredit && state.excess > 0.004 ? true : undefined, ...(props.exchangeRate ? { exchangeRate: props.exchangeRate } : {}) })}
              data-testid="button-post-allocation"
            >
              {post.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {tr("settle", { count: allocations.length })}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

// ─── one line, several accounts ────────────────────────────────────────────

interface SplitRow {
  accountId: string;
  amount: string;
  description: string;
}

export function SplitEntryPanel(props: PanelBase & { accounts: LedgerAccount[] }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const line = Math.abs(props.transaction.amount);
  const blank = (): SplitRow[] => [
    { accountId: "", amount: "", description: "" },
    { accountId: "", amount: "", description: "" },
  ];
  const [rows, setRows] = useState<SplitRow[]>(blank);
  const post = usePost(props, "create-entry");
  const amounts: SplitAmountLine[] = rows.map((r) => ({ accountId: r.accountId, amount: parseAmountText(r.amount) ?? NaN }));
  const state = splitState(line, amounts);
  const money = (n: number) => formatCurrency(n, props.currency, locale);
  const patch = (i: number, change: Partial<SplitRow>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const issue = state.issues.includes("ACCOUNT_MISSING") ? tr("splitIssueAccount") : state.issues.includes("AMOUNT_INVALID") ? tr("splitIssueAmount") : state.issues.includes("TOTAL_MISMATCH") ? tr("splitIssueTotal") : "";

  return (
    <Section title={tr("splitTitle")} hint={tr("splitHint")} testId="split-panel">
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-start" data-testid={`split-row-${i}`}>
            <div className="space-y-1 min-w-0">
              <Select value={r.accountId} onValueChange={(v) => v && patch(i, { accountId: v })}>
                <SelectTrigger aria-label={tr("splitAccount")} data-testid={`split-entry-account-${i}`}>
                  <SelectValue placeholder={tr("splitAccountPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {props.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span dir="ltr" className="font-mono">
                        {a.code}
                      </span>{" "}
                      {accountName(a, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={r.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder={tr("splitDescription")} maxLength={200} dir="auto" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Input dir="ltr" inputMode="decimal" value={r.amount} onChange={(e) => patch(i, { amount: e.target.value })} aria-label={tr("splitAmount")} className="text-end font-mono" data-testid={`split-entry-amount-${i}`} />
              {state.remaining > 0.004 && r.amount.trim() === "" && (
                <button type="button" className="text-[11px] text-primary underline" onClick={() => patch(i, { amount: state.remaining.toFixed(2) })}>
                  {tr("splitFill")}
                </button>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={tr("splitRemove")} disabled={rows.length <= 1} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={rows.length >= 10} onClick={() => setRows((prev) => [...prev, { accountId: "", amount: "", description: "" }])} data-testid="button-add-split-entry">
          <Plus className="h-4 w-4 me-1" />
          {tr("splitAdd")}
        </Button>
        <p className="text-sm" data-testid="split-entry-summary">
          {tr("splitTotal", { assigned: money(state.total), amount: money(line) })}
          {state.remaining > 0.004 && <span className="text-[hsl(var(--chart-4))] ms-2">{tr("splitLeft", { amount: money(state.remaining) })}</span>}
        </p>
      </div>
      {issue && rows.some((r) => r.accountId || r.amount) && <p className="text-xs text-destructive">{issue}</p>}
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={state.issues.length > 0 || post.isPending}
          onClick={() => post.mutate({ lines: rows.map((r, i) => ({ accountId: r.accountId, amount: amounts[i].amount, ...(r.description.trim() ? { description: r.description.trim() } : {}) })) })}
          data-testid="button-post-split"
        >
          {post.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
          {tr("splitPost")}
        </Button>
      </div>
    </Section>
  );
}

// ─── own-account transfer ──────────────────────────────────────────────────

export function TransferPanel(props: PanelBase & { transactions: BankTransaction[]; bankAccounts: BankAccount[] }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const [otherId, setOtherId] = useState("");
  const post = usePost(props, "transfer");
  const t = props.transaction;
  const candidates = props.transactions
    .filter((o) => o.id !== t.id && !o.isReconciled && o.matchStatus !== "matched" && o.bankStatementAccountId && o.bankStatementAccountId !== t.bankStatementAccountId && Math.sign(o.amount) === -Math.sign(t.amount))
    .sort((a, b) => Math.abs(new Date(a.transactionDate).getTime() - new Date(t.transactionDate).getTime()) - Math.abs(new Date(b.transactionDate).getTime() - new Date(t.transactionDate).getTime()))
    .slice(0, 25);
  const cur = (o: BankTransaction) => props.bankAccounts.find((a) => a.id === o.bankStatementAccountId)?.currency ?? "AED";
  const label = (o: BankTransaction) => `${props.bankAccounts.find((a) => a.id === o.bankStatementAccountId)?.nameEn ?? ""} - ${formatCalendarDate(o.transactionDate, locale, "short")} - ${formatCurrency(o.amount, cur(o), locale)} - ${o.description}`;

  return (
    <Section title={tr("transferTitle")} hint={tr("transferHint")} testId="transfer-panel">
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("transferNone")}</p>
      ) : (
        <>
          <Select value={otherId} onValueChange={(v) => v && setOtherId(v)}>
            <SelectTrigger data-testid="select-transfer-other">
              <SelectValue placeholder={tr("transferPick")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {candidates.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  <span dir="auto">{label(o)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={!otherId || post.isPending} onClick={() => post.mutate({ otherTransactionId: otherId })} data-testid="button-post-transfer">
              {post.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {tr("transferPost")}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

// ─── what a matched line was matched to ────────────────────────────────────

interface EntryView {
  id: string;
  entryNumber: string;
  memo: string | null;
  lines?: Array<{ accountId: string; debit: number; credit: number; account?: LedgerAccount }>;
}

export function MatchedSummary({ companyId, transaction, currency }: { companyId: string; transaction: BankTransaction; currency: string }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const entryId = transaction.matchedJournalEntryId;
  const { data: entry, isLoading } = useQuery<EntryView>({ queryKey: ["/api/journal", entryId ?? ""], enabled: !!entryId });
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: !!companyId });
  const { data: invoices = [] } = useQuery<InvoiceRow[]>({ queryKey: ["/api/companies", companyId, "invoices"], enabled: !!transaction.matchedInvoiceId });
  const invoice = invoices.find((i) => i.id === transaction.matchedInvoiceId);
  const nameOf = (id: string, fallback?: LedgerAccount) => {
    const a = accounts.find((x) => x.id === id) ?? fallback;
    return a ? `${a.code} ${accountName(a, locale)}` : id.slice(0, 8);
  };
  return (
    <div className="rounded-md border p-3 space-y-2 text-sm" data-testid="matched-summary">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("matchedTo")}</p>
      {transaction.matchedInvoiceId && <p>{tr("matchedInvoice", { number: invoice?.number ?? "" })}</p>}
      {transaction.matchedBillId && <p>{tr("matchedBill")}</p>}
      {transaction.matchedReceiptId && <p>{tr("matchedReceipt")}</p>}
      {entryId &&
        (isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : entry ? (
          <div className="space-y-1">
            <p className="font-medium" dir="auto">
              {tr("matchedEntry", { number: entry.entryNumber })}
              {entry.memo ? ` - ${entry.memo}` : ""}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-start font-normal">{tr("matchedLinesAccount")}</th>
                  <th className="text-end font-normal w-24">{tr("matchedLinesDebit")}</th>
                  <th className="text-end font-normal w-24">{tr("matchedLinesCredit")}</th>
                </tr>
              </thead>
              <tbody>
                {(entry.lines ?? []).map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-0.5" dir="auto">
                      {nameOf(l.accountId, l.account)}
                    </td>
                    <td dir="ltr" className="text-end font-mono">
                      {Number(l.debit) ? formatNumber(Number(l.debit), locale) : ""}
                    </td>
                    <td dir="ltr" className="text-end font-mono">
                      {Number(l.credit) ? formatNumber(Number(l.credit), locale) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground" dir="ltr">
              {currency}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">{tr("matchedLoading")}</p>
        ))}
    </div>
  );
}
