/**
 * Notices for a contact or supplier list whose latest request is paused or failed (the view is
 * derived by queryView in @/lib/query-view). Paused copy and icon are neutral: a request can wait
 * for reasons other than being offline.
 */
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTableCard, type DataTableCardProps } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";
import { classifyLoadError } from "@/lib/loadError";
import type { QueryView } from "@/lib/query-view";

/** First load that is paused (for any reason): no spinner, no claim of being offline or empty. */
export function QueryWaiting() {
  const { t } = useTranslation();
  return (
    <div role="status" data-testid="query-waiting">
      <EmptyState
        compact
        icon={Clock}
        title={t["pages.listWaitingTitle"]}
        description={t["pages.listWaitingBody"]}
      />
    </div>
  );
}

/** Shown beside saved rows (or a saved empty result) when the latest refresh did not succeed. */
export function QueryStaleNotice({ view, onRetry }: { view: QueryView; onRetry: () => void }) {
  const { t } = useTranslation();
  if (view.kind !== "data" || !view.stale) return null;
  const failed = view.stale === "error";
  const retriable = failed && ["offline", "server"].includes(classifyLoadError(view.error));
  return (
    <Alert
      tone={failed ? "warning" : "info"}
      data-testid={`query-stale-${view.stale}`}
      action={
        retriable ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t["firm.retry"]}
          </Button>
        ) : undefined
      }
    >
      {failed ? t["pages.listStaleError"] : t["pages.listStalePaused"]}
    </Alert>
  );
}

/** No company to load for: a plain notice, never an empty list. */
export function QueryNoCompany() {
  const { t } = useTranslation();
  return (
    <p
      className="p-4 text-center text-sm text-muted-foreground"
      role="status"
      data-testid="query-no-company"
    >
      {t["pages.noCompanySelected"]}
    </p>
  );
}

/** The non-data bodies (waiting, no company, error); null when the view has data to show. */
function queryViewBody(view: QueryView, onRetry: () => void): ReactNode {
  if (view.kind === "waiting") return <QueryWaiting />;
  if (view.kind === "noCompany") return <QueryNoCompany />;
  if (view.kind === "error") {
    return (
      <LoadErrorState compact error={view.error} onRetry={view.canRetry ? onRetry : undefined} />
    );
  }
  return null;
}

/**
 * DataTableCard driven by a QueryView. Children (the table markup) render only when the view has
 * data; loading, waiting, no-company and error states are handled here.
 */
export function QueryTableCard({
  view,
  rowCount,
  onRetry,
  children,
  ...card
}: Omit<DataTableCardProps, "status" | "error"> & {
  view: QueryView;
  rowCount: number;
  onRetry: () => void;
}) {
  const status =
    view.kind === "loading"
      ? "loading"
      : view.kind === "data" && rowCount === 0
        ? "empty"
        : "ready";
  return (
    <DataTableCard {...card} status={status}>
      {view.kind === "data" ? children : queryViewBody(view, onRetry)}
    </DataTableCard>
  );
}
