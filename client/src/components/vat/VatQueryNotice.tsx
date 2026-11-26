// Waiting, load-failure and refresh-failure states of the VAT filing screen's two queries.
import { T } from "@/components/layout/T";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";

/** The request is paused until the connection returns or the tab is active again. */
export function VatWaiting({ messageKey, testId }: { messageKey: string; testId: string }) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md bg-warning-subtle p-3 text-start text-small text-warning-subtle-foreground"
    >
      <T k={messageKey} />
    </p>
  );
}

/** A first load that failed: nothing is cached, so only the error and a retry are shown. */
export function VatLoadFailed({
  error,
  titleKey,
  onRetry,
  testId,
}: {
  error: unknown;
  titleKey: string;
  onRetry: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return <LoadErrorState error={error} onRetry={onRetry} title={t[titleKey]} testId={testId} />;
}

/** A refresh that failed while the last loaded data stays on screen. */
export function VatRefreshNotice({
  titleKey,
  bodyKey,
  onRetry,
  testId,
}: {
  titleKey: string;
  bodyKey: string;
  onRetry: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <ErrorState
      compact
      className="rounded-md border border-border"
      onRetry={onRetry}
      retryLabel={t["firm.retry"]}
      title={t[titleKey]}
      description={t[bodyKey]}
      testId={testId}
    />
  );
}
