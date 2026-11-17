import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";

/**
 * Bank reconciliation → Suggestions (spec 3.9; the former /auto-reconcile page). "Find matches"
 * asks the server for candidate matches; each suggestion is accepted or skipped one by one, or
 * all confident ones at once. Accepting uses the same apply endpoint as before, so the ledger
 * and reconciliation state change exactly as they did.
 */

interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: "journal_entry" | "invoice" | "receipt" | "bill";
  matchedId: string;
  confidence: number;
  matchReason: string;
  bankDescription?: string;
  bankAmount?: number;
  bankDate?: string;
  matchedDescription?: string;
  matchedAmount?: number;
  matchedDate?: string;
}

interface AutoReconcileResult {
  matches: ReconcileMatch[];
  autoMatchedCount: number;
  manualReviewCount: number;
  totalUnreconciled: number;
}

/** At or above this confidence a suggestion counts as confident. */
const CONFIDENT = 75;

/** The server explains a match with fixed English phrases; each one has a catalog label. */
const REASON_KEYS: Record<string, string> = {
  "Exact amount match": "banking.suggest.reason.exactAmount",
  "Amount within 1%": "banking.suggest.reason.amount1",
  "Amount within 5%": "banking.suggest.reason.amount5",
  "Same date": "banking.suggest.reason.sameDate",
  "Within 1 day": "banking.suggest.reason.day1",
  "Within 3 days": "banking.suggest.reason.day3",
  "Within 7 days": "banking.suggest.reason.day7",
  "Reference number match": "banking.suggest.reason.reference",
  "Strong description match": "banking.suggest.reason.descStrong",
  "Partial description match": "banking.suggest.reason.descPartial",
  "Weak description match": "banking.suggest.reason.descWeak",
  "Entry on this bank account": "banking.suggest.reason.sameAccount",
};

function confidenceTone(confidence: number): StatusTone {
  if (confidence >= CONFIDENT) return "success";
  if (confidence >= 60) return "warning";
  return "neutral";
}

export function MatchSuggestions({
  companyId,
  scanRequest,
}: {
  companyId?: string;
  /** Incremented by the page's "Find matches" button; each change runs a new search. */
  scanRequest: number;
}) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [result, setResult] = useState<AutoReconcileResult | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/companies/${companyId}/auto-reconcile`),
    onSuccess: (data: AutoReconcileResult) => {
      setResult(data);
      setSkipped(new Set());
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.scanFailed"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  const apply = useMutation({
    mutationFn: async (matches: ReconcileMatch[]) =>
      apiRequest("POST", `/api/companies/${companyId}/auto-reconcile/apply`, {
        matches: matches.map((m) => ({
          bankTransactionId: m.bankTransactionId,
          matchedType: m.matchedType,
          matchedId: m.matchedId,
        })),
      }),
    onSuccess: (data: { message: string; skipped?: number; errors?: string[] }) => {
      // Failed or skipped lines are reported, never counted as reconciled.
      toast({
        title: translateNow("toasts.reconciliationApplied"),
        description: [data.message, ...(data.errors ?? []).slice(0, 3)].join(" · "),
        variant: data.errors && data.errors.length > 0 ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
      scan.mutate();
    },
    onError: (error: Error) =>
      toast({
        title: translateNow("toasts.applyFailed"),
        description: error?.message,
        variant: "destructive",
      }),
  });

  useEffect(() => {
    if (scanRequest > 0 && companyId) scan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanRequest, companyId]);

  const open = useMemo(
    () => (result?.matches ?? []).filter((m) => !skipped.has(m.bankTransactionId)),
    [result, skipped]
  );
  const confident = open.filter((m) => m.confidence >= CONFIDENT);
  const reasons = (raw: string) =>
    raw
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (REASON_KEYS[r] ? tt[REASON_KEYS[r]] : null))
      .filter(Boolean)
      .join(" · ");

  if (scan.isPending && !result) {
    return (
      <Card className="space-y-2 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <EmptyState
          size="md"
          title={tt["banking.suggest.readyTitle"]}
          description={tt["banking.suggest.readyBody"]}
          action={{
            label: tt["banking.suggest.find"],
            onClick: () => scan.mutate(),
            testId: "button-find-matches-empty",
          }}
        />
      </Card>
    );
  }

  if (open.length === 0) {
    return (
      <Card>
        <EmptyState
          size="md"
          title={
            result.totalUnreconciled === 0
              ? tt["banking.suggest.allDoneTitle"]
              : tt["banking.suggest.noneTitle"]
          }
          description={
            result.totalUnreconciled === 0
              ? tt["banking.suggest.allDoneBody"]
              : formatMessage(tt["banking.suggest.noneBody"], {
                  count: result.totalUnreconciled,
                })
          }
        />
      </Card>
    );
  }

  const side = (description?: string, date?: string, amount?: number, typeLabel?: string) => (
    <div className="min-w-0">
      {typeLabel && <div className="text-caption text-muted-foreground">{typeLabel}</div>}
      <div dir="auto" className="truncate text-small font-medium text-foreground">
        {description || "—"}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
        {date && <span className="tabular-nums">{formatDate(date, locale)}</span>}
        {amount != null && <Money amount={amount} tone="auto" />}
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden" data-testid="match-suggestions">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <p className="text-small text-muted-foreground">
          {formatMessage(tt["banking.suggest.summary"], {
            count: open.length,
            confident: confident.length,
          })}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={confident.length === 0 || apply.isPending}
          onClick={() => apply.mutate(confident)}
          data-testid="button-accept-confident"
        >
          {apply.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
          {formatMessage(tt["banking.suggest.acceptConfident"], { count: confident.length })}
        </Button>
      </div>
      <ul className="divide-hairline">
        {open.map((match) => (
          <li
            key={match.bankTransactionId}
            className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center"
            data-testid={`suggestion-${match.bankTransactionId}`}
          >
            {side(match.bankDescription, match.bankDate, match.bankAmount)}
            <ArrowRight
              className="hidden h-4 w-4 text-muted-foreground rtl:rotate-180 md:block"
              aria-hidden
            />
            <div className="min-w-0 space-y-1.5">
              {side(
                match.matchedDescription,
                match.matchedDate,
                match.matchedAmount,
                tt[`banking.suggest.type.${match.matchedType}`]
              )}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={confidenceTone(match.confidence)}>
                  {formatMessage(tt["banking.suggest.confidence"], { value: match.confidence })}
                </StatusBadge>
                {reasons(match.matchReason) && (
                  <span className="text-caption text-muted-foreground">
                    {reasons(match.matchReason)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 md:justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSkipped((prev) => new Set(prev).add(match.bankTransactionId))}
              >
                {tt["banking.suggest.skip"]}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={apply.isPending}
                onClick={() => apply.mutate([match])}
                data-testid={`button-accept-${match.bankTransactionId}`}
              >
                {tt["banking.suggest.accept"]}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
