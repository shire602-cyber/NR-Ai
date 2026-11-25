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
  scope = "firm",
  title,
  description,
  compact,
  className,
  testId,
}: {
  error: unknown;
  onRetry?: () => void;
  scope?: "firm" | "portal";
  /** Overrides the title for the "server" and "offline" causes. */
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const kind = classifyLoadError(error);
  const retriable = kind === "offline" || kind === "server";
  const copy = {
    offline: { title: t[`${scope}.loadFailedTitle`], body: t[`${scope}.loadOfflineBody`] },
    server: { title: t[`${scope}.loadFailedTitle`], body: t[`${scope}.loadFailedBody`] },
    forbidden: { title: t[`${scope}.loadForbiddenTitle`], body: t[`${scope}.loadForbiddenBody`] },
    notFound: { title: t[`${scope}.loadNotFoundTitle`], body: t[`${scope}.loadNotFoundBody`] },
  }[kind];
  return (
    <ErrorState
      title={retriable && title ? title : copy.title}
      description={retriable && description ? description : copy.body}
      onRetry={retriable ? onRetry : undefined}
      retryLabel={t[`${scope}.retry`]}
      compact={compact}
      className={className}
      testId={testId ?? `load-error-${kind}`}
    />
  );
}
