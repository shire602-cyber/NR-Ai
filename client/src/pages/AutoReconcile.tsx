import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BankAccount, BankTransaction, BulkMatchItem, BulkMatchResult, MatchSuggestion } from "@/lib/banking-api-types";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankKey, kindText, reasonText } from "@/components/banking/banking-common";
import { ConfidenceLabel } from "@/components/banking/BankingCommon";
import { describeBulkFailure } from "@/components/banking/bulk-outcome";
import { ProposedLinesPreview } from "@/components/banking/ProposedLinesPreview";
import { messages as pageMessages } from "./AutoReconcile.i18n";

const THRESHOLDS = [60, 70, 80, 90] as const;
const SAFE_SCORE = 80;
/** Kinds that settle a document or link an entry: selecting them in bulk is safe. Rules and accounts create new postings. */
const SAFE_KINDS = new Set(["invoice", "bill", "journal", "receipt"]);

/** One suggestion per bank line, the best first. */
function bestPerTransaction(list: MatchSuggestion[]): MatchSuggestion[] {
  const map = new Map<string, MatchSuggestion>();
  for (const s of list) {
    const cur = map.get(s.transactionId);
    if (!cur || s.confidence > cur.confidence) map.set(s.transactionId, s);
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence);
}

export default function AutoReconcile() {
  const tr = pageMessages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [accountId, setAccountId] = useState("");
  const [minConfidence, setMinConfidence] = useState<number>(80); // default 80: an amount that does not match the open balance is only offered above it
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, string>>({});

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/companies", companyId, "bank-accounts"], enabled: !!companyId });
  const { data: transactions } = useQuery<BankTransaction[]>({ queryKey: bankKey(companyId ?? "", "transactions"), enabled: !!companyId });
  const path = `suggestions?minConfidence=${minConfidence}${accountId ? `&bankAccountId=${accountId}` : ""}`;
  const { data, isLoading, isFetching, isError, refetch } = useQuery<MatchSuggestion[]>({ queryKey: bankKey(companyId ?? "", path), enabled: !!companyId });

  const rows = useMemo(() => bestPerTransaction(data ?? []), [data]);
  const txById = useMemo(() => new Map((transactions ?? []).map((t) => [t.id, t])), [transactions]);
  const currencyOf = (id: string) => bankAccounts.find((a) => a.id === txById.get(id)?.bankStatementAccountId)?.currency ?? "AED";
  const isSafe = (s: MatchSuggestion) => s.confidence >= SAFE_SCORE && SAFE_KINDS.has(s.kind);

  const counts = useMemo(
    () => ({ total: rows.length, high: rows.filter((s) => s.confidence >= SAFE_SCORE).length, posting: rows.filter((s) => !SAFE_KINDS.has(s.kind)).length }),
    [rows]
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = useMutation({
    mutationFn: async () => {
      const items: BulkMatchItem[] = rows.filter((s) => selected.has(s.transactionId)).map((s) => ({ transactionId: s.transactionId, kind: s.kind, targetId: s.targetId }));
      return (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/bulk-match`, { items })) as BulkMatchResult;
    },
    onSuccess: (result) => {
      setSelected(new Set());
      setProblems({});
      queryClient.invalidateQueries({ queryKey: bankKey(companyId!) });
      toast({ title: tr("toastApplied"), description: tr("toastAppliedBody", { count: result.applied }) });
    },
    onError: (err: unknown) => {
      const f = describeBulkFailure(trc, err, locale);
      setProblems(f.byTransaction);
      if (f.kind === "partial") {
        setSelected(new Set());
        queryClient.invalidateQueries({ queryKey: bankKey(companyId!) });
      }
      toast({
        variant: "destructive",
        title: f.kind === "partial" ? tr("toastPartial") : tr("toastFailed"),
        description: f.kind === "partial" ? tr("toastPartialBody", { count: f.applied.length, reason: f.summary }) : f.summary,
      });
    },
  });

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!companyId) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">{tr("noCompany")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="auto-reconcile-page">
      <PageHeader
        eyebrow={tr("accounting")}
        title={tr("title")}
        description={tr("description")}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-suggestions">
            {isFetching ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <RefreshCw className="h-4 w-4 me-2" />}
            {isFetching ? tr("rescoring") : tr("refresh")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: tr("summaryOpen"), value: counts.total, testId: "summary-total" },
          { label: tr("summaryHigh"), value: counts.high, testId: "summary-high" },
          { label: tr("summaryPosting"), value: counts.posting, testId: "summary-posting" },
          { label: tr("summarySelected"), value: selected.size, testId: "summary-selected" },
        ].map((c) => (
          <Card key={c.testId}>
            <CardHeader className="pb-1 pt-4 px-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold" data-testid={c.testId}>
                {c.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>{tr("bankAccount")}</Label>
                <Select value={accountId || "all"} onValueChange={(v) => { setAccountId(v === "all" ? "" : v); setSelected(new Set()); }}>
                  <SelectTrigger className="w-48" data-testid="select-suggest-account">
                    <SelectValue />
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
              </div>
              <div className="space-y-1">
                <Label>{tr("minConfidence")}</Label>
                <Select value={String(minConfidence)} onValueChange={(v) => { setMinConfidence(Number(v)); setSelected(new Set()); }}>
                  <SelectTrigger className="w-32" data-testid="select-min-confidence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THRESHOLDS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set(rows.filter(isSafe).map((s) => s.transactionId)))} data-testid="button-select-safe">
                {tr("selectHigh")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set(rows.map((s) => s.transactionId)))}>
                {tr("selectAll")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {tr("clear")}
              </Button>
              <Button onClick={() => apply.mutate()} disabled={selected.size === 0 || apply.isPending} data-testid="button-apply-selected">
                {apply.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Check className="h-4 w-4 me-2" />}
                {apply.isPending ? tr("applying") : tr("apply", { count: selected.size })}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">{tr("loadFailed")}</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={tr("emptyTitle")}
              description={tr("emptyBody")}
              action={{ label: tr("emptyLink"), href: "/bank-reconciliation", variant: "outline" }}
              testId="empty-suggestions"
            />
          ) : (
            <ul className="divide-y rounded-md border" data-testid="suggestion-rows">
              {rows.map((s) => {
                const tx = txById.get(s.transactionId);
                const cur = currencyOf(s.transactionId);
                const isOpen = open.has(s.transactionId);
                const problem = problems[s.transactionId];
                return (
                  <li key={s.transactionId} className={`p-3 space-y-2 ${selected.has(s.transactionId) ? "bg-primary/5" : ""}`} data-testid={`suggestion-row-${s.transactionId}`}>
                    <div className="grid gap-3 md:grid-cols-[2rem_1.1fr_1.1fr_11rem] items-start">
                      <Checkbox checked={selected.has(s.transactionId)} onCheckedChange={() => toggle(s.transactionId)} aria-label={tr("selectRow")} className="mt-1" data-testid={`checkbox-${s.transactionId}`} />
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs text-muted-foreground">{tr("colBank")}</p>
                        <p className="text-sm font-medium break-words" dir="auto">
                          {tx?.description ?? s.transactionId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                          {tx && <span>{formatDate(tx.transactionDate, locale)}</span>}
                          {tx && (
                            <span dir="ltr" className={`font-mono font-medium ${tx.amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                              {formatCurrency(tx.amount, cur, locale)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs text-muted-foreground">{tr("colMatch")}</p>
                        <p className="text-sm font-medium break-words" dir="auto">
                          {kindText(trc, s.kind)}: {s.label}
                        </p>
                        <p className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                          <span>{formatDate(s.date, locale)}</span>
                          <span dir="ltr" className="font-mono">
                            {formatCurrency(s.amount, cur, locale)}
                          </span>
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{tr("colConfidence")}</p>
                        <p className="text-sm">
                          <ConfidenceLabel score={s.confidence} />
                        </p>
                        <Progress value={s.confidence} className="h-1.5" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 ps-0 md:ps-8">
                      <div className="flex flex-wrap gap-1">
                        {s.reasons.map((r) => (
                          <Badge key={r} variant="secondary" className="text-[11px] font-normal">
                            {reasonText(trc, r)}
                          </Badge>
                        ))}
                        <Badge variant={SAFE_KINDS.has(s.kind) ? "secondary" : "outline"} className="text-[11px] font-normal">
                          {s.kind === "invoice" ? tr("effectInvoice") : s.kind === "bill" ? tr("effectBill") : SAFE_KINDS.has(s.kind) ? tr("linksOnly") : tr("postsNew")}
                        </Badge>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => toggleOpen(s.transactionId)} data-testid={`button-preview-${s.transactionId}`}>
                        {isOpen ? <ChevronUp className="h-4 w-4 me-1" /> : <ChevronDown className="h-4 w-4 me-1" />}
                        {isOpen ? tr("previewHide") : tr("previewShow")}
                      </Button>
                    </div>
                    {problem && <p className="text-xs text-destructive md:ps-8">{tr("rowProblem", { reason: problem })}</p>}
                    {isOpen && (
                      <div className="md:ps-8">
                        <ProposedLinesPreview lines={s.proposedLines} posts={s.posts} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
