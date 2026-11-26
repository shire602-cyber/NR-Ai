import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import type { LoadState } from "@/lib/cost-center-view";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  state: LoadState;
  /** True when earlier successful data stays on screen next to this notice. */
  hasData: boolean;
  errorTitle: string;
  errorBody: string;
  onRetry: () => void;
  testId: string;
  className?: string;
}

/** Loading, paused, retrying and failed copy for one cost center query. */
export function CostCenterLoadNotice({
  state,
  hasData,
  errorTitle,
  errorBody,
  onRetry,
  testId,
  className,
}: Props) {
  const { t } = useTranslation();
  if (state === "ready") return null;

  if (state === "error") {
    return (
      <ErrorState
        compact
        title={errorTitle}
        description={errorBody}
        onRetry={onRetry}
        testId={testId}
        className={className}
      />
    );
  }

  const message = {
    pending: t["screens.ccLoading"],
    paused: t["screens.ccLoadPaused"],
    retrying: t["screens.ccRetrying"],
    pausedRetry: t["screens.ccRetryPaused"],
    refreshError: t["screens.ccRefreshFailed"],
  }[state];

  return (
    <div
      role={state === "refreshError" ? "alert" : "status"}
      data-testid={testId}
      data-state={state}
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-3 text-small text-muted-foreground",
        className
      )}
    >
      <p>
        {message}
        {hasData && <> {t["screens.ccShowingLastLoaded"]}</>}
      </p>
      {state === "refreshError" && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          {t["components.errorRetry"]}
        </Button>
      )}
    </div>
  );
}
