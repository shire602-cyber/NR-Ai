import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoadStatus } from "@/components/team/useOnDemandDialog";
import { useTranslation } from "@/lib/i18n";

/** Inline loading / failure notice shown beside the button that opens the dialog. */
export function OnDemandDialogStatus({
  status,
  onRetry,
  testId,
}: {
  status: LoadStatus;
  onRetry: () => void;
  testId: string;
}) {
  const { t } = useTranslation();

  if (status === "idle") return null;
  if (status === "loading") {
    return (
      <span
        role="status"
        className="text-sm text-muted-foreground"
        data-testid={`${testId}-loading`}
      >
        {t["common.loading"]}
      </span>
    );
  }
  return (
    <span
      role="alert"
      className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      data-testid={`${testId}-error`}
    >
      {t[status === "offline" ? "common.errorHeading.offline" : "common.loadFailedTitle"]}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetry}
        data-testid={`${testId}-retry`}
      >
        <RefreshCw className="w-4 h-4 me-2" />
        {t["pages.retry"]}
      </Button>
    </span>
  );
}
