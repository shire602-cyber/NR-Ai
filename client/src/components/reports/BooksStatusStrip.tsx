import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, AlertTriangle, Lock, LockOpen } from "lucide-react";
import { Money } from "@/components/ui/money";
import { formatDate } from "@/lib/format-date";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { readyReportCatalog, reportHref } from "@/lib/reportCatalog";

const trialBalanceReport = readyReportCatalog.find((report) => report.id === "trial-balance");
const TRIAL_BALANCE_HREF = (trialBalanceReport && reportHref(trialBalanceReport)) ?? "/reports";

interface PeriodLockSummary {
  lockThroughDate: string | null;
}

interface TrialBalanceSummary {
  to: string;
  totals: { sumDebits: number; sumCredits: number; difference: number };
  isBalanced: boolean;
}

/**
 * One-line ledger status for ledger and report screens (R3, CTO 23): whether the books
 * balance (trial balance from the reporting kernel, debits = credits as of today) and how far
 * the period lock reaches (GET /period-lock). Read-only; both links go to the screens where the
 * user can act (trial balance, month-end close).
 */
export function BooksStatusStrip({
  companyId,
  className,
}: {
  companyId: string | null | undefined;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const tt = t as Record<string, string>;
  const lock = useQuery<PeriodLockSummary>({
    queryKey: [`/api/companies/${companyId}/period-lock`],
    enabled: !!companyId,
    staleTime: 60_000,
    retry: 1,
  });
  const tb = useQuery<TrialBalanceSummary>({
    queryKey: [`/api/companies/${companyId}/reports/trial-balance`],
    enabled: !!companyId,
    staleTime: 60_000,
    retry: 1,
  });
  if (!companyId) return null;
  // Only render what the API actually returned in the expected shape.
  const trial =
    tb.data && typeof tb.data.isBalanced === "boolean" && tb.data.totals ? tb.data : null;
  const lockInfo = lock.data && "lockThroughDate" in lock.data ? lock.data : null;
  if (!trial && !lockInfo) return null;

  const balanced = trial?.isBalanced;
  const lockThrough = lockInfo?.lockThroughDate ?? null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2 text-small text-muted-foreground",
        className
      )}
      data-testid="books-status-strip"
    >
      {trial ? (
        <Link
          href={TRIAL_BALANCE_HREF}
          className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="books-status-balance"
          data-balanced={balanced ? "true" : "false"}
        >
          {balanced ? (
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          )}
          <span className="font-medium text-foreground">
            {balanced ? tt["shell.booksBalanced"] : tt["shell.booksOutOfBalance"]}
          </span>
          {balanced ? (
            <span>
              {formatMessage(tt["shell.booksBalancedAsOf"], {
                date: formatDate(trial.to, locale),
              })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              {tt["shell.booksDifference"]}
              <Money amount={Math.abs(Number(trial.totals.difference) || 0)} />
            </span>
          )}
        </Link>
      ) : null}
      {lockInfo ? (
        <Link
          href="/month-end"
          className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="books-status-lock"
        >
          {lockThrough ? (
            <Lock className="h-4 w-4" aria-hidden />
          ) : (
            <LockOpen className="h-4 w-4" aria-hidden />
          )}
          <span>
            {lockThrough
              ? formatMessage(tt["shell.booksLockedThrough"], {
                  date: formatDate(lockThrough, locale),
                })
              : tt["shell.booksNoLock"]}
          </span>
        </Link>
      ) : null}
    </div>
  );
}
