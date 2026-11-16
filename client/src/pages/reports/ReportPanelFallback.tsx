import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while a lazily loaded Reports panel or tab chunk loads. */
export function ReportPanelFallback() {
  return <Skeleton className="h-64 w-full" data-testid="report-panel-loading" />;
}
