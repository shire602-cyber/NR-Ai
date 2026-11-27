// Loading, connection and failure states shared by the statement tabs.
import type { ReactNode } from "react";
import { T } from "@/components/layout/T";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import type { reportQueryState } from "./model/reportQueryState";

/** The request is paused until the connection returns. */
function Waiting({ messageKey, testId }: { messageKey: string; testId: string }) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md bg-warning-subtle p-3 text-small text-warning-subtle-foreground"
    >
      <T k={messageKey} />
    </p>
  );
}

/**
 * A statement's body: `children` render only when a response backs them, with a message above
 * them when a refresh is paused or failed.
 */
export function ReportBody({
  state: { view, notice },
  error,
  testId,
  skeletonClassName,
  children,
}: {
  state: ReturnType<typeof reportQueryState>;
  error: { error: unknown; retry: () => void } | null;
  /** Prefix of the state test ids. */
  testId: string;
  skeletonClassName: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (view === "loading") return <Skeleton className={skeletonClassName} />;
  if (view === "waiting") {
    return <Waiting messageKey="reportCenter.tabs.waitingForData" testId={`${testId}-waiting`} />;
  }
  if (view === "error") {
    return error ? (
      <LoadErrorState error={error.error} onRetry={error.retry} testId={`${testId}-load-error`} />
    ) : null;
  }
  if (view === "idle") return null;
  return (
    <div className="space-y-4">
      {notice === "paused" && (
        <Waiting
          messageKey="reportCenter.tabs.waitingToRefresh"
          testId={`${testId}-refresh-paused`}
        />
      )}
      {notice === "failed" && error && (
        <ErrorState
          compact
          onRetry={error.retry}
          retryLabel={t["firm.retry"]}
          title={t["reportCenter.tabs.refreshFailedTitle"]}
          description={t["reportCenter.tabs.refreshFailedBody"]}
          testId={`${testId}-refresh-error`}
        />
      )}
      {children}
    </div>
  );
}

/**
 * Inline error notice for a secondary query (list data).
 * Shows nothing when `error` is null (i.e. the query succeeded or hasn't run yet).
 */
export function SecondaryQueryError({
  error,
  testId,
}: {
  error: { retry: () => void } | null;
  testId: string;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <ErrorState
      compact
      onRetry={error.retry}
      retryLabel={t["firm.retry"]}
      title={t["reportCenter.tabs.refreshFailedTitle"]}
      description={t["reportCenter.tabs.refreshFailedBody"]}
      testId={testId}
    />
  );
}
