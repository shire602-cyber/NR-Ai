import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Money } from "@/components/ui/money";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { accountDisplayName } from "@/lib/account-name";
import { formatDate } from "@/lib/format-date";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { confidenceWord, type ConfidenceWord } from "./model";

interface QueueItem {
  id: string;
  description: string;
  amount: string;
  transaction_date: string;
  suggested_account_id: string | null;
  suggested_account_name: string | null;
  suggested_account_code: string | null;
  ai_confidence: string;
  ai_reason: string | null;
}

interface AnomalyAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  isResolved: boolean;
  createdAt: string;
}

interface AccountOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
}

type Filter = "all" | "bank" | "checks";

// The classifier's reason is shown only when it explains a suggestion; server notes about
// configuration (e.g. a provider not being set up) are operator copy and never shown.
const OPERATOR_NOTE = /openai|not configured|api key|provider|model/i;
function customerReason(reason: string | null, hasSuggestion: boolean): string | null {
  if (!reason || !hasSuggestion || OPERATOR_NOTE.test(reason)) return null;
  return reason;
}

const CONFIDENCE_TONE: Record<ConfidenceWord, StatusTone> = {
  high: "success",
  medium: "neutral",
  low: "warning",
};

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

/**
 * Assistant → Review: the drafts the assistant prepared, in one queue. Bank lines it
 * categorised (accept, edit the account, dismiss) and checks it flagged (duplicates,
 * unusual entries). Nothing here posts without the user's click.
 */
export default function ReviewPanel() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<QueueItem | null>(null);
  const [accountId, setAccountId] = useState("");

  const queueKey = ["/api/companies", companyId, "ai-gl", "queue?status=pending_review"];
  const pending = useQuery<QueueItem[]>({ queryKey: queueKey, enabled: !!companyId });
  const alerts = useQuery<AnomalyAlert[]>({
    queryKey: ["/api/companies", companyId, "anomaly-alerts"],
    enabled: !!companyId,
  });
  const accounts = useQuery<AccountOption[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId && !!editing,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "ai-gl"] });
    void queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "bank-transactions"],
    });
  };
  const failed = (title: string) => (error: Error) =>
    toast({ title: translateNow(title), description: error?.message, variant: "destructive" });

  const scan = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/ai-gl/scan`),
    onSuccess: (data: { scan?: { classified?: number } }) => {
      toast({
        title: translateNow("toasts.scanComplete2"),
        description: formatMessage(translateNow("assistant.scanResult"), {
          count: data?.scan?.classified ?? 0,
        }),
      });
      invalidate();
    },
    onError: failed("toasts.scanFailed2"),
  });
  const accept = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/ai-gl/queue/${id}/accept`),
    onSuccess: () => {
      toast({ title: translateNow("toasts.accepted") });
      invalidate();
    },
    onError: failed("toasts.acceptFailed"),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/companies/${companyId}/ai-gl/queue/${id}/reject`),
    onSuccess: () => {
      toast({ title: translateNow("assistant.dismissed") });
      invalidate();
    },
    onError: failed("toasts.rejectFailed"),
  });
  const correct = useMutation({
    mutationFn: ({ id, account }: { id: string; account: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/ai-gl/queue/${id}/correct`, {
        accountId: account,
      }),
    onSuccess: () => {
      toast({ title: translateNow("toasts.corrected") });
      setEditing(null);
      setAccountId("");
      invalidate();
    },
    onError: failed("toasts.correctionFailed"),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/anomaly-alerts/${id}/resolve`, {}),
    onSuccess: () => {
      toast({ title: translateNow("toasts.alertResolved") });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "anomaly-alerts"],
      });
    },
    onError: failed("toasts.failedToResolveAlert"),
  });

  const bankItems = pending.data ?? [];
  const checkItems = (alerts.data ?? []).filter((a) => !a.isResolved);
  const showBank = filter !== "checks";
  const showChecks = filter !== "bank";
  const loading = pending.isLoading || alerts.isLoading;
  const visibleCount = (showBank ? bankItems.length : 0) + (showChecks ? checkItems.length : 0);

  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: t["assistant.filterAll"], count: bankItems.length + checkItems.length },
    { id: "bank", label: t["assistant.filterBank"], count: bankItems.length },
    { id: "checks", label: t["assistant.filterChecks"], count: checkItems.length },
  ];

  return (
    <div className="space-y-4" data-testid="assistant-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t["assistant.filterLabel"]}
          className="inline-flex rounded-lg border border-border bg-card p-0.5"
        >
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-small font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`review-filter-${f.id}`}
            >
              {f.label}
              {f.count > 0 && <span className="ms-1.5 tabular-nums">{f.count}</span>}
            </button>
          ))}
        </div>
        <Button
          onClick={() => scan.mutate()}
          disabled={scan.isPending || !companyId}
          data-testid="button-review-scan"
        >
          {scan.isPending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />
          )}
          {t["assistant.scanNow"]}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visibleCount === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={CheckCircle2}
            title={t["assistant.reviewEmptyTitle"]}
            description={t["assistant.reviewEmptyBody"]}
            testId="assistant-review-empty"
          />
        </div>
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
          data-testid="assistant-review-list"
        >
          {showBank &&
            bankItems.map((item) => {
              const word = confidenceWord(item.ai_confidence);
              const hasSuggestion = !!item.suggested_account_id;
              const reason = customerReason(item.ai_reason, hasSuggestion);
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start"
                  data-testid={`review-item-${item.id}`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-medium text-foreground">{item.description}</p>
                      <span className="tabular-nums text-foreground">
                        <Money amount={Number.parseFloat(item.amount)} />
                      </span>
                    </div>
                    <p className="text-small text-muted-foreground">
                      {t["assistant.kindBank"]} · {formatDate(item.transaction_date, locale)}
                    </p>
                    <p className="text-small text-foreground">
                      {hasSuggestion
                        ? formatMessage(t["assistant.suggestAccount"], {
                            account:
                              `${item.suggested_account_code ?? ""} ${item.suggested_account_name ?? ""}`.trim(),
                          })
                        : t["assistant.noSuggestion"]}
                      {hasSuggestion && (
                        <StatusBadge tone={CONFIDENCE_TONE[word]} className="ms-2 align-middle">
                          {t[`assistant.confidence.${word}`]}
                        </StatusBadge>
                      )}
                    </p>
                    {reason && (
                      <p className="line-clamp-2 text-small text-muted-foreground">{reason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {hasSuggestion ? (
                      <Button
                        size="sm"
                        onClick={() => accept.mutate(item.id)}
                        disabled={accept.isPending}
                        data-testid={`button-accept-${item.id}`}
                      >
                        {t["pages.accept"]}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(item);
                          setAccountId("");
                        }}
                        data-testid={`button-choose-${item.id}`}
                      >
                        {t["assistant.editAccount"]}
                      </Button>
                    )}
                    <RowActions
                      menu={
                        <>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(item);
                              setAccountId(item.suggested_account_id ?? "");
                            }}
                          >
                            <Pencil aria-hidden />
                            {t["assistant.editAccount"]}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => dismiss.mutate(item.id)}>
                            <X aria-hidden />
                            {t["assistant.dismiss"]}
                          </DropdownMenuItem>
                        </>
                      }
                    />
                  </div>
                </li>
              );
            })}
          {showChecks &&
            checkItems.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start"
                data-testid={`review-check-${alert.id}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{alert.title}</p>
                    <StatusBadge tone={SEVERITY_TONE[alert.severity] ?? "neutral"}>
                      {t[`assistant.severity.${alert.severity}`] ?? t["assistant.severity.low"]}
                    </StatusBadge>
                  </div>
                  <p className="text-small text-muted-foreground">
                    {t["assistant.kindCheck"]} · {formatDate(alert.createdAt, locale)}
                  </p>
                  <p className="line-clamp-2 text-small text-foreground">{alert.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolve.mutate(alert.id)}
                    disabled={resolve.isPending}
                    data-testid={`button-resolve-${alert.id}`}
                  >
                    {t["assistant.markResolved"]}
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t["assistant.editAccountTitle"]}</DialogTitle>
            <DialogDescription>{editing?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="review-account" className="text-small font-medium">
              {t["assistant.account"]}
            </label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="review-account">
                <SelectValue placeholder={t["aiInbox.chooseAnAccount"]} />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.code} — {accountDisplayName(acc, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t["pages.cancel"]}
            </Button>
            <Button
              onClick={() =>
                editing && accountId && correct.mutate({ id: editing.id, account: accountId })
              }
              disabled={!accountId || correct.isPending}
            >
              {t["assistant.saveAndPost"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
