import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnline = () => onlineManager.isOnline();

/**
 * Why a portal list is not current: React Query paused the request (offline, or online and waiting
 * for the window to regain focus before retrying), or the load or refresh failed. Renders nothing
 * otherwise.
 */
export function PortalLoadNotice({
  error,
  paused,
  retrying,
  onRetry,
  compact,
  resource,
}: {
  error: unknown;
  paused?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
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
        compact={compact}
        testId={`portal-${resource}-${state}`}
      />
    );
  }
  if (!error) return null;
  return (
    <LoadErrorState
      error={error}
      onRetry={onRetry}
      retrying={retrying}
      scope="portal"
      compact={compact}
      testId={`portal-${resource}-load-error`}
    />
  );
}
