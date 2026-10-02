import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Check, CheckCircle2, Link2, Loader2, Lock, Search, Sparkles, Upload, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, BankTransaction, BulkMatchItem, BulkMatchResult, MatchSuggestion } from "@/lib/banking-api-types";
import { messages } from "./BankTransactionsTab.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, bankingErrorText, confidenceTone, kindText } from "./banking-common";
import { describeBulkFailure } from "./bulk-outcome";
import { MatchDialog } from "./MatchDialog";

const PAGE = 200;
/** A suggestion that only links to something posted or settles a document: safe to accept from the list row. */
const QUICK_KINDS = new Set(["invoice", "invoices", "bill", "journal", "receipt"]);
const TONE = { success: "text-[hsl(var(--chart-5))]", warning: "text-[hsl(var(--chart-4))]", danger: "text-destructive" } as const;

interface Props {
  companyId: string;
  bankAccounts: BankAccount[];
  onImport: () => void;
}

export function BankTransactionsTab({ companyId, bankAccounts, onImport }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [accountFilter, setAccountFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showReconciled, setShowReconciled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [matchTx, setMatchTx] = useState<BankTransaction | null>(null);

  const { data: transactions, isLoading } = useQuery<BankTransaction[]>({
    queryKey: bankKey(companyId, "transactions"),
    enabled: !!companyId,
  });
  const suggestionPath = `suggestions?minConfidence=60${accountFilter ? `&bankAccountId=${accountFilter}` : ""}`;
  const { data: suggestions } = useQuery<MatchSuggestion[]>({
    queryKey: bankKey(companyId, suggestionPath),
    enabled: !!companyId && (transactions?.length ?? 0) > 0,
  });

  const currencyOf = (tx: BankTransaction) => bankAccounts.find((a) => a.id === tx.bankStatementAccountId)?.currency ?? "AED";
  const best = useMemo(() => {
    const map = new Map<string, MatchSuggestion>();
    for (const s of suggestions ?? []) {
      const current = map.get(s.transactionId);
      if (!current || s.confidence > current.confidence) map.set(s.transactionId, s);
    }
    return map;
  }, [suggestions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (transactions ?? []).filter((tx) => {
      if (!showReconciled && tx.isReconciled) return false;
      if (accountFilter && tx.bankStatementAccountId !== accountFilter) return false;
      if (!q) return true;
      return tx.description.toLowerCase().includes(q) || (tx.reference ?? "").toLowerCase().includes(q) || String(Math.abs(tx.amount)).includes(q);
    });
  }, [transactions, showReconciled, accountFilter, search]);
  const visible = filtered.slice(0, limit);

  const stats = useMemo(() => {
    // the net is per currency: a USD line is never added into an AED total
    const all = (transactions ?? []).filter((t) => !accountFilter || t.bankStatementAccountId === accountFilter);
    const net = new Map<string, number>();
    for (const t of all) {
      const cur = currencyOf(t);
      net.set(cur, Math.round(((net.get(cur) ?? 0) + t.amount) * 100) / 100);
    }
    const reconciled = all.filter((t) => t.isReconciled).length;
    return {
      total: all.length,
      reconciled,
      suggested: all.filter((t) => !t.isReconciled && (t.matchStatus === "suggested" || best.has(t.id))).length,
      net: [...net.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, best, accountFilter, bankAccounts]);

  const selectable = (tx: BankTransaction) => !tx.isReconciled && best.has(tx.id) && QUICK_KINDS.has(best.get(tx.id)!.kind);
  const selectableIds = visible.filter(selectable).map((t) => t.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyBulk = useMutation({
    mutationFn: async (items: BulkMatchItem[]) =>
      (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/bulk-match`, { items })) as BulkMatchResult,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
      setSelected(new Set());
      toast({ title: tr("bulkDoneTitle"), description: tr("bulkDoneBody", { count: result.applied }) });
    },
    onError: (err: unknown) => {
      const f = describeBulkFailure(trc, err, locale);
      queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
      if (f.kind === "partial") setSelected(new Set());
      toast({
        variant: "destructive",
        title: f.kind === "partial" ? tr("bulkPartialTitle") : tr("bulkFailedTitle"),
        description: f.kind === "partial" ? tr("bulkPartialBody", { count: f.applied.length, reason: f.summary }) : f.summary,
      });
    },
  });

  const toItems = (ids: string[]): BulkMatchItem[] =>
    ids.flatMap((id) => {
      const s = best.get(id);
      return s ? [{ transactionId: id, kind: s.kind, targetId: s.targetId, ...(s.targetIds ? { targetIds: s.targetIds } : {}) }] : [];
    });

  const quickAccept = useMutation({
    mutationFn: async (tx: BankTransaction) =>
      (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/bulk-match`, { items: toItems([tx.id]) })) as BulkMatchResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
      toast({ title: tr("quickAcceptedTitle"), description: tr("quickAcceptedBody") });
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("quickAcceptFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const statusCell = (tx: BankTransaction) => {
    const s = best.get(tx.id);
    return (
      <div className="flex flex-col gap-1">
        {tx.isReconciled ? (
          <StatusBadge tone="success" className="w-fit">
            <CheckCircle2 className="h-3 w-3 me-1" />
            {tr("statusMatched")}
          </StatusBadge>
        ) : s || tx.matchStatus === "suggested" ? (
          <StatusBadge tone="warning" className="w-fit">
            <Sparkles className="h-3 w-3 me-1" />
            {tr("statusSuggested")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral" className="w-fit">
            <XCircle className="h-3 w-3 me-1" />
            {tr("statusUnmatched")}
          </StatusBadge>
        )}
        {tx.reconciliationId && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lock className="h-3 w-3" />
            {tr("statusFrozen")}
          </span>
        )}
        {s && !tx.isReconciled && (
          <span className={`text-xs ${TONE[confidenceTone(s.confidence)]}`} data-testid={`suggestion-hint-${tx.id}`} dir="auto">
            {tr("confidence", { score: s.confidence })} {tr("suggestionLine", { kind: kindText(trc, s.kind), label: s.label })}
          </span>
        )}
      </div>
    );
  };

  const actionsCell = (tx: BankTransaction) => {
    const s = best.get(tx.id);
    if (tx.isReconciled) {
      return (
        <Button size="sm" variant="outline" onClick={() => setMatchTx(tx)} data-testid={`button-details-${tx.id}`}>
          {tr("details")}
        </Button>
      );
    }
    return (
      <div className="flex items-center justify-end gap-1.5 flex-wrap">
        {s && QUICK_KINDS.has(s.kind) && (
          <Button size="sm" onClick={() => quickAccept.mutate(tx)} disabled={quickAccept.isPending} data-testid={`button-accept-${tx.id}`}>
            {quickAccept.isPending && quickAccept.variables?.id === tx.id ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <Check className="h-3.5 w-3.5 me-1" />}
            {tr("accept")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setMatchTx(tx)} data-testid={`button-match-${tx.id}`}>
          {s ? tr("review") : <Link2 className="h-3.5 w-3.5 me-1" />}
          {s ? null : tr("match")}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tr("total")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">
              {stats.total}
            </div>
          </CardContent>
        </Card>
        <Card className="border-[hsl(var(--chart-5)/0.30)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-[hsl(var(--chart-5))]" />
              {tr("reconciled")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[hsl(var(--chart-5))]">{stats.reconciled}</div>
            {stats.total > 0 && <Progress value={(stats.reconciled / stats.total) * 100} className="h-1 mt-2" />}
          </CardContent>
        </Card>
        <Card className="border-[hsl(var(--chart-4)/0.30)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-[hsl(var(--chart-4))]" />
              {tr("suggested")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[hsl(var(--chart-4))]">{stats.suggested}</div>
            <p className="text-xs text-muted-foreground mt-1">{tr("pendingReview")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{tr("netAmount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5" data-testid="stat-net">
              {(stats.net.length ? stats.net : [["AED", 0] as [string, number]]).map(([cur, amount]) => (
                <div key={cur} dir="ltr" className={`${stats.net.length > 1 ? "text-lg" : "text-2xl"} font-bold text-start whitespace-nowrap ${amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                  {formatCurrency(amount, cur, locale)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>{tr("title")}</CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox id="show-reconciled" checked={showReconciled} onCheckedChange={(c) => setShowReconciled(c === true)} />
                <Label htmlFor="show-reconciled" className="text-sm cursor-pointer">
                  {tr("showReconciled")}
                </Label>
              </div>
              <Select value={accountFilter || "all"} onValueChange={(v) => setAccountFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-44" data-testid="select-bank-account">
                  <SelectValue placeholder={tr("allAccounts")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allAccounts")}</SelectItem>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder={tr("search")} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 w-full sm:w-56" data-testid="input-search" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border bg-muted/40 px-3 py-2" data-testid="bulk-bar">
              <span className="text-sm">{tr("selectedCount", { count: selected.size })}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {tr("clearSelection")}
                </Button>
                <Button size="sm" onClick={() => applyBulk.mutate(toItems([...selected]))} disabled={applyBulk.isPending} data-testid="button-bulk-accept">
                  {applyBulk.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Check className="h-4 w-4 me-2" />}
                  {tr("bulkAccept", { count: selected.size })}
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={(transactions?.length ?? 0) === 0 ? tr("empty") : tr("emptyFiltered")}
              description={(transactions?.length ?? 0) === 0 ? tr("emptyHint") : undefined}
              action={
                (transactions?.length ?? 0) === 0 ? { label: tr("importStatement"), icon: Upload, variant: "outline", onClick: onImport } : undefined
              }
              testId="empty-state-bank-transactions"
            />
          ) : (
            <>
              <div className="grid gap-3 md:hidden" data-testid="mobile-bank-transaction-list">
                {visible.map((tx) => (
                  <Card key={tx.id} className={tx.matchStatus === "suggested" || best.has(tx.id) ? "border-[hsl(var(--chart-4)/0.35)]" : ""}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-2">
                          {selectable(tx) && <Checkbox checked={selected.has(tx.id)} onCheckedChange={() => toggle(tx.id)} aria-label={tr("selectRow")} className="mt-1" />}
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">{formatCalendarDate(tx.transactionDate, locale, "short")}</p>
                            <p className="font-medium break-words" dir="auto">
                              {tx.description}
                            </p>
                            <p className="text-xs text-muted-foreground">{tx.reference || tr("noReference")}</p>
                          </div>
                        </div>
                        <p dir="ltr" className={`font-mono text-sm font-semibold shrink-0 ${tx.amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                          {formatCurrency(tx.amount, currencyOf(tx), locale)}
                        </p>
                      </div>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        {statusCell(tx)}
                        {actionsCell(tx)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="hidden rounded-md border overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          disabled={selectableIds.length === 0}
                          onCheckedChange={(c) => setSelected(c === true ? new Set(selectableIds) : new Set())}
                          aria-label={tr("selectAll")}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead className="w-28">{tr("colDate")}</TableHead>
                      <TableHead>{tr("colDescription")}</TableHead>
                      <TableHead className="w-28">{tr("colReference")}</TableHead>
                      <TableHead className="text-end w-32">{tr("colAmount")}</TableHead>
                      <TableHead className="w-56">{tr("colStatus")}</TableHead>
                      <TableHead className="text-end w-44">{tr("colActions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((tx) => (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`} className={best.has(tx.id) && !tx.isReconciled ? "bg-[hsl(var(--chart-4)/0.06)]" : ""}>
                        <TableCell>
                          {selectable(tx) && <Checkbox checked={selected.has(tx.id)} onCheckedChange={() => toggle(tx.id)} aria-label={tr("selectRow")} data-testid={`checkbox-${tx.id}`} />}
                        </TableCell>
                        <TableCell className="font-mono text-sm whitespace-nowrap">{formatCalendarDate(tx.transactionDate, locale, "short")}</TableCell>
                        <TableCell className="max-w-xs">
                          <div className="truncate font-medium" dir="auto" title={tx.description}>
                            {tx.description}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{tx.reference || "-"}</TableCell>
                        <TableCell dir="ltr" className={`text-end font-mono font-medium whitespace-nowrap ${tx.amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                          {formatCurrency(tx.amount, currencyOf(tx), locale)}
                        </TableCell>
                        <TableCell>{statusCell(tx)}</TableCell>
                        <TableCell className="text-end">{actionsCell(tx)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filtered.length > limit && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                    {tr("showMore", { count: filtered.length - limit })}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <MatchDialog
        open={!!matchTx}
        onOpenChange={(open) => !open && setMatchTx(null)}
        companyId={companyId}
        transaction={matchTx}
        currency={matchTx ? currencyOf(matchTx) : "AED"}
        transactions={transactions ?? []}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
