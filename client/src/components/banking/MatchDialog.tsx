import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import { accountName } from "@/lib/account-name";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, BankTransaction, LedgerAccount, MatchSuggestion } from "@/lib/banking-api-types";
import { ApiError } from "@/lib/queryClient";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { InvoiceAllocationPanel, MatchedSummary, SplitEntryPanel, TransferPanel } from "./MatchDialogPanels";
import { messages as panels } from "./MatchDialogPanels.i18n";
import { messages } from "./MatchDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, bankingErrorText, kindText, reasonText } from "./banking-common";
import { ConfidenceLabel } from "./BankingCommon";
import { ProposedLinesPreview } from "./ProposedLinesPreview";

/** Accounts that only an invoice or bill may touch (the server refuses a direct entry to them). */
const DOCUMENT_ONLY_CODES = new Set(["1040", "2010", "1050", "2020"]);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  transaction: BankTransaction | null;
  currency: string;
  /** All bank lines and bank accounts, for the own-account transfer. */
  transactions?: BankTransaction[];
  bankAccounts?: BankAccount[];
}

export function MatchDialog({ open, onOpenChange, companyId, transaction, currency, transactions = [], bankAccounts = [] }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [overpay, setOverpay] = useState<{ suggestion: MatchSuggestion; excess: number } | null>(null);
  const trp = panels.useT();

  // every bank line starts clean: the account and memo of the previous line never carry over
  useEffect(() => {
    setAccountId("");
    setMemo("");
    setOverpay(null);
  }, [open, transaction?.id]);

  const base = `/api/companies/${companyId}/bank-statements`;
  const matched = !!transaction?.isReconciled || transaction?.matchStatus === "matched";
  const frozen = !!transaction?.reconciliationId;

  const { data: suggestions, isLoading } = useQuery<MatchSuggestion[]>({
    queryKey: bankKey(companyId, `${transaction?.id}`, "suggestions"),
    enabled: open && !!transaction?.id && !matched,
  });

  const { data: accounts } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: open && !!companyId && !matched,
  });

  const pickable = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.isActive !== false && a.isArchived !== true && !DOCUMENT_ONLY_CODES.has(a.code))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts]
  );

  const done = (title: string, description: string) => {
    queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "auto-reconcile"] });
    toast({ title, description });
    onOpenChange(false);
  };
  const fail = (title: string) => (err: unknown) =>
    toast({ variant: "destructive", title, description: bankingErrorText(trc, err, locale) });

  const matchMutation = useMutation({
    mutationFn: (args: MatchSuggestion | { suggestion: MatchSuggestion; keepAsCredit: true }) => {
      const s = "suggestion" in args ? args.suggestion : args;
      const keepAsCredit = "suggestion" in args;
      const tid = transaction!.id;
      if (s.kind === "rule") return apiRequest("POST", `${base}/${tid}/apply-rule`, { ruleId: s.targetId });
      if (s.kind === "transfer") return apiRequest("POST", `${base}/${tid}/transfer`, { otherTransactionId: s.targetId });
      if (s.kind === "invoices") return apiRequest("POST", `${base}/${tid}/match`, { matchedType: "invoices", allocations: (s.targetIds ?? [s.targetId]).map((invoiceId) => ({ invoiceId })), ...(keepAsCredit ? { keepAsCredit: true } : {}) });
      if (s.kind === "account") return apiRequest("POST", `${base}/${tid}/create-entry`, { accountId: s.targetId });
      return apiRequest("POST", `${base}/${tid}/match`, { matchedType: s.kind, matchedId: s.targetId, ...(keepAsCredit ? { keepAsCredit: true } : {}) });
    },
    onSuccess: () => done(tr("toastMatched"), tr("toastMatchedBody")),
    onError: (err: unknown, args) => {
      const d = err instanceof ApiError ? (err.details as { excess?: number; canKeepAsCredit?: boolean } | undefined) : undefined;
      // the bank line is more than the invoice owes: the person chooses what happens to the excess
      if (err instanceof ApiError && err.code === "MATCH_AMOUNT_MISMATCH" && d?.canKeepAsCredit && "kind" in args) {
        setOverpay({ suggestion: args, excess: d.excess ?? 0 });
        return;
      }
      fail(tr("toastFailed"))(err);
    },
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/${transaction!.id}/create-entry`, { accountId, memo: memo.trim() || undefined }),
    onSuccess: () => done(tr("toastCreated"), tr("toastMatchedBody")),
    onError: fail(tr("toastCreateFailed")),
  });

  const unmatchMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `${base}/${transaction!.id}/match`),
    onSuccess: () => done(tr("toastUnmatched"), tr("toastUnmatchedBody")),
    onError: fail(tr("toastUnmatchFailed")),
  });

  const busy = matchMutation.isPending || createMutation.isPending || unmatchMutation.isPending;
  const amount = transaction?.amount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="match-dialog">
        <DialogHeader>
          <DialogTitle>{matched ? tr("matchedTitle") : tr("title")}</DialogTitle>
          <DialogDescription dir="auto">{transaction?.description}</DialogDescription>
        </DialogHeader>

        {transaction && (
          <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-4">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm self-start">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("bankLine")}</p>
              <div>
                <p className="text-xs text-muted-foreground">{tr("date")}</p>
                <p className="font-medium">{formatCalendarDate(transaction.transactionDate, locale, "short")}</p>
              </div>
              {transaction.reference && (
                <div>
                  <p className="text-xs text-muted-foreground">{tr("reference")}</p>
                  <p dir="ltr" className="font-mono text-xs text-start">
                    {transaction.reference}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">{tr("amount")}</p>
                <p dir="ltr" className={`text-lg font-bold text-start ${amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                  {formatCurrency(amount, currency, locale)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{tr("direction")}</p>
                <Badge variant="outline">{amount >= 0 ? trc("inflow") : trc("outflow")}</Badge>
              </div>
            </div>

            <div className="space-y-4 min-w-0">
              {matched ? (
                <div className="space-y-3">
                  <MatchedSummary companyId={companyId} transaction={transaction} currency={currency} />
                  {frozen ? (
                    <p className="text-sm text-[hsl(var(--chart-4))]" data-testid="match-frozen">
                      {tr("frozen")}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{tr("unmatchHint")}</p>
                      <Button variant="outline" onClick={() => unmatchMutation.mutate()} disabled={busy} data-testid="button-unmatch">
                        {unmatchMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Unlink className="h-4 w-4 me-2" />}
                        {tr("unmatch")}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("suggestions")}</p>
                    {isLoading ? (
                      <div className="space-y-2" aria-busy="true" aria-label={tr("loading")}>
                        {[1, 2].map((i) => (
                          <Skeleton key={i} className="h-24" />
                        ))}
                      </div>
                    ) : suggestions && suggestions.length > 0 ? (
                      <ul className="space-y-2" data-testid="suggestion-list">
                        {suggestions.map((s) => {
                          return (
                            <li key={`${s.kind}-${s.targetId}`} className="rounded-lg border bg-card p-3 space-y-2" data-testid={`suggestion-${s.kind}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs text-muted-foreground">{kindText(trc, s.kind)}</p>
                                  <p className="text-sm font-medium truncate" dir="auto">
                                    {s.label}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{formatCalendarDate(s.date, locale, "short")}</p>
                                </div>
                                <div className="text-end shrink-0">
                                  <p dir="ltr" className="font-mono text-sm font-semibold">
                                    {formatCurrency(s.amount, currency, locale)}
                                  </p>
                                  <p className="text-xs">
                                    <ConfidenceLabel score={s.confidence} />
                                  </p>
                                </div>
                              </div>
                              <Progress value={s.confidence} className="h-1" />
                              <div className="flex flex-wrap gap-1">
                                {s.reasons.map((r) => (
                                  <Badge key={r} variant="secondary" className="text-[11px] font-normal">
                                    {reasonText(trc, r)}
                                  </Badge>
                                ))}
                              </div>
                              <ProposedLinesPreview lines={s.proposedLines} posts={s.posts} />
                              <div className="flex justify-end">
                                <Button size="sm" onClick={() => matchMutation.mutate(s)} disabled={busy} data-testid={`button-match-${s.kind}`}>
                                  {matchMutation.isPending && (matchMutation.variables && ("suggestion" in matchMutation.variables ? matchMutation.variables.suggestion.targetId : matchMutation.variables.targetId)) === s.targetId ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : null}
                                  {s.kind === "rule" ? tr("matchRule") : s.kind === "account" ? tr("matchAccount") : s.kind === "transfer" ? tr("matchTransfer") : tr("match")}
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">{tr("noSuggestions")}</p>
                        <p className="text-xs mt-1">{tr("noSuggestionsHint")}</p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border p-3 space-y-3" data-testid="create-entry">
                    <div>
                      <p className="text-sm font-semibold">{tr("createTitle")}</p>
                      <p className="text-xs text-muted-foreground">{tr("createHint")}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>{tr("createAccount")}</Label>
                        <Select value={accountId} onValueChange={setAccountId}>
                          <SelectTrigger data-testid="select-create-account">
                            <SelectValue placeholder={tr("createAccountPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {pickable.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                <span dir="ltr" className="font-mono">
                                  {a.code}
                                </span>{" "}
                                {accountName(a, locale)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="create-memo">{tr("createMemo")}</Label>
                        <Input id="create-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} dir="auto" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{amount >= 0 ? tr("createPreviewIn") : tr("createPreviewOut")}</p>
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={busy || !accountId} data-testid="button-create-entry">
                        {createMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                        {tr("createButton")}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2" data-testid="match-extras">
                    {amount > 0 && <InvoiceAllocationPanel companyId={companyId} transaction={transaction} currency={currency} onPosted={() => done(tr("toastMatched"), tr("toastMatchedBody"))} />}
                    <SplitEntryPanel companyId={companyId} transaction={transaction} currency={currency} accounts={pickable} onPosted={() => done(tr("toastCreated"), tr("toastMatchedBody"))} />
                    <TransferPanel companyId={companyId} transaction={transaction} currency={currency} transactions={transactions} bankAccounts={bankAccounts} onPosted={() => done(tr("toastMatched"), tr("toastMatchedBody"))} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={!!overpay} onOpenChange={(o) => !o && setOverpay(null)}>
        <AlertDialogContent data-testid="overpay-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{trp("overTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {overpay && trp("overBody", { line: formatCurrency(Math.abs(amount), currency, locale), owed: formatCurrency(Math.abs(amount) - overpay.excess, currency, locale), excess: formatCurrency(overpay.excess, currency, locale) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{trp("overCancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-keep-credit"
              onClick={() => {
                if (overpay) matchMutation.mutate({ suggestion: overpay.suggestion, keepAsCredit: true });
                setOverpay(null);
              }}
            >
              {overpay && trp("overKeep", { excess: formatCurrency(overpay.excess, currency, locale) })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
