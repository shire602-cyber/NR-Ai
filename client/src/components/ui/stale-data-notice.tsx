import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/** Warning above data kept from the last successful read after a refresh failed. */
export function StaleDataNotice({ onRetry, testId }: { onRetry: () => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      data-testid={testId ?? "stale-data-notice"}
      className="flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm text-warning-subtle-foreground"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t["components.staleDataNotice"]}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden />
        {t["components.errorRetry"]}
      </Button>
    </div>
  );
}
