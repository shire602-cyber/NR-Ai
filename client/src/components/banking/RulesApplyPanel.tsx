import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Loader2, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { BankAccount, BankTransaction, RuleApplyResult, RulePreviewItem } from "@/lib/banking-api-types";
import { messages } from "./RulesApplyPanel.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, bankingErrorText } from "./banking-common";
import { ProposedLinesPreview } from "./ProposedLinesPreview";

export function RulesApplyPanel({ companyId, bankAccounts }: { companyId: string; bankAccounts: BankAccount[] }) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [preview, setPreview] = useState<RulePreviewItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const base = `/api/companies/${companyId}/bank-statements`;

  const { data: transactions } = useQuery<BankTransaction[]>({ queryKey: bankKey(companyId, "transactions"), enabled: !!companyId && preview !== null });
  const txById = new Map((transactions ?? []).map((t) => [t.id, t]));
  const currencyOf = (id: string) => bankAccounts.find((a) => a.id === txById.get(id)?.bankStatementAccountId)?.currency ?? "AED";

  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/apply-rules`, { commit: false })) as RulePreviewItem[],
    onSuccess: (items) => {
      setPreview(items);
      setSelected(new Set());
      setOpen(new Set());
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("previewFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/apply-rules`, { commit: true, transactionIds: [...selected] })) as RuleApplyResult,
    onSuccess: (result) => {
      const failed = result.results.filter((r) => r.error);
      queryClient.invalidateQueries({ queryKey: bankKey(companyId) });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reconciliation-rules"] });
      toast({
        variant: failed.length ? "destructive" : "default",
        title: tr("postDone"),
        description: [
          tr("postDoneBody", { applied: result.applied, failed: failed.length }),
          ...failed.slice(0, 3).map((f) => tr("failedLine", { description: txById.get(f.transactionId)?.description ?? f.transactionId.slice(0, 8), reason: f.error?.message ?? "" })),
        ].join(" "),
      });
      // what is left to apply
      run.mutate();
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("postFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <Card data-testid="rules-apply-panel">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4" />
              {tr("title")}
            </CardTitle>
            <CardDescription>{tr("description")}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending} data-testid="button-preview-rules">
            {run.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            {run.isPending ? tr("previewing") : tr("previewBtn")}
          </Button>
        </div>
      </CardHeader>
      {preview && (
        <CardContent className="space-y-3">
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="rules-preview-empty">
              {tr("nothing")}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{tr("found", { count: preview.length })}</p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setSelected(new Set(preview.map((p) => p.transactionId)))}>
                    {tr("selectAll")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    {tr("clear")}
                  </Button>
                  <Button size="sm" onClick={() => post.mutate()} disabled={selected.size === 0 || post.isPending} data-testid="button-post-rules">
                    {post.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Check className="h-4 w-4 me-2" />}
                    {post.isPending ? tr("posting") : tr("postBtn", { count: selected.size })}
                  </Button>
                </div>
              </div>
              <ul className="divide-y rounded-md border" data-testid="rules-preview-list">
                {preview.map((p) => {
                  const tx = txById.get(p.transactionId);
                  const isOpen = open.has(p.transactionId);
                  return (
                    <li key={p.transactionId} className="p-3 space-y-2" data-testid={`rule-preview-${p.transactionId}`}>
                      <div className="flex items-start gap-3">
                        <Checkbox checked={selected.has(p.transactionId)} onCheckedChange={() => setSelected((s) => toggle(s, p.transactionId))} aria-label={tr("selectRow")} className="mt-1" />
                        <div className="min-w-0 flex-1 grid gap-1 sm:grid-cols-[1fr_auto] sm:items-start">
                          <div className="min-w-0">
                            <p className="text-sm font-medium break-words" dir="auto">
                              {tx?.description ?? p.transactionId.slice(0, 8)}
                            </p>
                            <p className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                              {tx && <span>{formatCalendarDate(tx.transactionDate, locale, "short")}</span>}
                              {tx && (
                                <span dir="ltr" className={`font-mono font-medium ${tx.amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                                  {formatCurrency(tx.amount, currencyOf(p.transactionId), locale)}
                                </span>
                              )}
                              <span dir="auto">{tr("ruleLabel", { name: p.ruleName })}</span>
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setOpen((s) => toggle(s, p.transactionId))}>
                            {isOpen ? <ChevronUp className="h-4 w-4 me-1" /> : <ChevronDown className="h-4 w-4 me-1" />}
                            {isOpen ? tr("hideLines") : tr("showLines")}
                          </Button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="ps-7">
                          <ProposedLinesPreview lines={p.proposedLines} posts />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
