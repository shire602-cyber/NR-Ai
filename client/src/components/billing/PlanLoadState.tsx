import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";
import { classifyLoadError } from "@/lib/loadError";

/**
 * What stands in for the plan while it is unknown: the load error, the offline state (only when the
 * device really is offline), or a neutral "loading" for a fetch that is paused for another reason.
 */
export function PlanLoadState({
  error,
  online,
  onRetry,
  testId = "subscription",
}: {
  error?: unknown;
  online: boolean;
  onRetry: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  if (error) {
    if (classifyLoadError(error) === "notFound") {
      return (
        <ErrorState
          title={t["pages.subscriptionBillingUnavailable"]}
          description={t["pages.subscriptionBillingUnavailableHelp"]}
          onRetry={onRetry}
          testId={`${testId}-load-error`}
        />
      );
    }
    return <LoadErrorState error={error} onRetry={onRetry} testId={`${testId}-load-error`} />;
  }
  if (!online) {
    // An error without an HTTP status is classified as "offline" (lib/loadError.ts).
    return (
      <LoadErrorState error={new Error("offline")} onRetry={onRetry} testId={`${testId}-offline`} />
    );
  }
  return (
    <div role="status" className="grid place-items-center px-4 py-8">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <span className="sr-only">{t["common.loading"]}</span>
    </div>
  );
}

/** A refresh failed: the cached figures stay on screen under this note. */
export function RefreshFailedNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert
      tone="warning"
      title={t["common.refreshFailed"]}
      data-testid="billing-refresh-failed"
      action={
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {t["firm.retry"]}
        </Button>
      }
    />
  );
}

/** The Billing page frame around a plan that has not loaded (also used by the trial gate). */
export function BillingUnloaded(props: Parameters<typeof PlanLoadState>[0]) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["pages.companyProfileEyebrow"]}
        title={t["pages.subscriptionPageTitle"]}
        description={t["pages.subscriptionPlanPageDescription"]}
      />
      <PlanLoadState {...props} />
    </div>
  );
}
