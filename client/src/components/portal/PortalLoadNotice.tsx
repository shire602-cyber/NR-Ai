import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";

/**
 * Why a portal list is not current: React Query paused the request until the browser is back
 * online (no error exists yet), or the load or refresh failed. Renders nothing otherwise.
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
  if (paused) {
    return (
      <ErrorState
        title={t["portal.offlineTitle"]}
        description={t["portal.offlineBody"]}
        onRetry={onRetry}
        retryLabel={t["portal.retry"]}
        compact={compact}
        testId={`portal-${resource}-offline`}
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
