import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";
import { classifyLoadError } from "@/lib/loadError";

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnline = () => onlineManager.isOnline();

/**
 * Why a portal list is not current, in order of precedence: React Query paused the request (offline,
 * or online and waiting for the window to regain focus before retrying); a retry the customer asked
 * for is fetching with no error, or with a retained one that offers no retry of its own, which shows
 * a disabled, spinning "Try again"; or the load or refresh failed (a retryable failure keeps this
 * notice, with its button busy, while retrying). Renders nothing otherwise.
 */
export function PortalLoadNotice({
  error,
  paused,
  retrying,
  retryPending,
  onRetry,
  compact,
  resource,
}: {
  error: unknown;
  paused?: boolean;
  /** A request is in flight now: the button spins. */
  retrying?: boolean;
  /** A manual retry has not settled: the button stays disabled, even while queued. */
  retryPending?: boolean;
  onRetry?: () => void;
  /** The list already shows cached rows. */
  compact?: boolean;
  resource: "account" | "dashboard" | "documents" | "invoices" | "messages" | "statements";
}) {
  const { t } = useTranslation();
  const online = useSyncExternalStore(subscribeOnline, isOnline);
  if (paused) {
    const state = online ? "paused" : "offline";
    return (
      <ErrorState
        title={t[`portal.${state}Title`]}
        description={t[`portal.${state}Body`]}
        onRetry={onRetry}
        retryLabel={t["portal.retry"]}
        disabled={retryPending}
        compact={compact}
        testId={`portal-${resource}-${state}`}
      />
    );
  }
  // A retryable error keeps its own notice while retrying, so the same button stays mounted and
  // keyboard focus is not lost. The generic notice only covers states that have no such button.
  const kind = error ? classifyLoadError(error) : null;
  if (retryPending && retrying && (!kind || kind === "forbidden" || kind === "notFound")) {
    return (
      <ErrorState
        title={t["portal.retryingTitle"]}
        description={t["portal.retryingBody"]}
        onRetry={onRetry}
        retryLabel={t["portal.retry"]}
        retrying
        compact={compact}
        testId={`portal-${resource}-retrying`}
      />
    );
  }
  if (!error) return null;
  return (
    <LoadErrorState
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      disabled={retryPending}
      scope="portal"
      compact={compact}
      testId={`portal-${resource}-load-error`}
    />
  );
}
