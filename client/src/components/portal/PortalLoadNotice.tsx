import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnline = () => onlineManager.isOnline();

/**
 * Why a portal list is not current: React Query paused the request (offline, or online and waiting
 * for the window to regain focus before retrying), the load or refresh failed, or a retry the
 * customer queued before any data arrived is now fetching. Renders nothing otherwise.
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
  resource: "documents" | "invoices" | "statements";
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
  // Queued from a paused first load, so there is no earlier error to keep on screen.
  if (!error && retryPending && retrying && !compact) {
    return (
      <ErrorState
        title={t["portal.retryingTitle"]}
        description={t["portal.retryingBody"]}
        onRetry={onRetry}
        retryLabel={t["portal.retry"]}
        retrying
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
