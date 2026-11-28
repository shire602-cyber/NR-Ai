import type { ReactNode } from "react";
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
  retrying,
  disabled,
  scope = "firm",
  title,
  description,
  compact,
  className,
  testId,
  forbiddenDescription,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  disabled?: boolean;
  scope?: "firm" | "portal";
  /** Overrides the title for the "server" and "offline" causes. */
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
  forbiddenDescription?: ReactNode;
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
  const descriptionOverride =
    kind === "forbidden" ? forbiddenDescription : retriable ? description : undefined;
  return (
    <ErrorState
      title={retriable && title ? title : copy.title}
      description={descriptionOverride || copy.body}
      onRetry={retriable ? onRetry : undefined}
      retryLabel={t[`${scope}.retry`]}
      retrying={retrying}
      disabled={disabled}
      compact={compact}
      className={className}
      testId={testId ?? `load-error-${kind}`}
    />
  );
}
