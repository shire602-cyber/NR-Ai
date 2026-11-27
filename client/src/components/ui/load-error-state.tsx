import { ErrorState } from "@/components/ui/error-state";
import { classifyLoadError } from "@/lib/loadError";
import { useTranslation } from "@/lib/i18n";

/**
 * ErrorState for a failed query: translated copy chosen by cause (offline, server, forbidden,
 * not found), a Retry button for the causes a retry can fix, and never the raw error message.
 */
export function LoadErrorState({
  error,
  onRetry,
  title,
  description,
  compact,
  className,
  testId,
  forbiddenDescription,
}: {
  error: unknown;
  onRetry?: () => void;
  /** Overrides the title for the "server" and "offline" causes. */
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
  forbiddenDescription?: string;
}) {
  const { t } = useTranslation();
  const kind = classifyLoadError(error);
  const retriable = kind === "offline" || kind === "server";
  const copy = {
    offline: { title: t["firm.loadFailedTitle"], body: t["firm.loadOfflineBody"] },
    server: { title: t["firm.loadFailedTitle"], body: t["firm.loadFailedBody"] },
    forbidden: { title: t["firm.loadForbiddenTitle"], body: t["firm.loadForbiddenBody"] },
    notFound: { title: t["firm.loadNotFoundTitle"], body: t["firm.loadNotFoundBody"] },
  }[kind];
  const descriptionOverride =
    kind === "forbidden" ? forbiddenDescription : retriable ? description : undefined;
  return (
    <ErrorState
      title={retriable && title ? title : copy.title}
      description={descriptionOverride || copy.body}
      onRetry={retriable ? onRetry : undefined}
      retryLabel={t["firm.retry"]}
      compact={compact}
      className={className}
      testId={testId ?? `load-error-${kind}`}
    />
  );
}
