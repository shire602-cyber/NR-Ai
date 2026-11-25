import { useTranslation } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a lazily loaded Reports panel or tab chunk loads. */
export function ReportPanelFallback() {
  const { t } = useTranslation();
  return (
    <div role="status" className="space-y-4" data-testid="report-panel-loading">
      <span className="sr-only">{t["components.ui.loading"]}</span>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
