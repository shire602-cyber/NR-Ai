import type { UseQueryResult } from "@tanstack/react-query";
import { DataTableCard, type DataTableCardProps } from "@/components/ui/data-table";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { useTranslation } from "@/lib/i18n";
import { classifyLoadError } from "@/lib/loadError";

export interface ListQueryTableProps extends Omit<DataTableCardProps, "status" | "error"> {
  query: Pick<
    UseQueryResult<unknown[]>,
    "data" | "fetchStatus" | "isLoadingError" | "isRefetchError" | "error" | "refetch"
  >;
  rowCount: number;
  loadErrorTestId?: string;
}

export function ListQueryTable({
  query,
  rowCount,
  loadErrorTestId,
  statusMessage,
  children,
  ...card
}: ListQueryTableProps) {
  const { t } = useTranslation();
  const paused = query.data === undefined && query.fetchStatus === "paused";
  const failed = query.isLoadingError && !paused;
  const retry = () => void query.refetch();
  const refreshError = query.isRefetchError ? classifyLoadError(query.error) : null;
  const canRetryRefresh = refreshError === "offline" || refreshError === "server";
  let status: DataTableCardProps["status"] = "ready";
  if (query.data !== undefined) {
    status = rowCount > 0 ? "ready" : "empty";
  } else if (!paused && !failed) {
    status = "loading";
  }

  let body = children;
  if (paused) {
    body = (
      <p
        role="status"
        data-testid="list-query-waiting"
        className="px-4 py-6 text-small text-muted-foreground"
      >
        {t["common.loadPaused"]}
      </p>
    );
  } else if (failed) {
    body = <LoadErrorState compact error={query.error} onRetry={retry} testId={loadErrorTestId} />;
  }

  return (
    <>
      {refreshError && <StaleDataNotice onRetry={canRetryRefresh ? retry : undefined} />}
      <DataTableCard {...card} status={status} statusMessage={paused ? undefined : statusMessage}>
        {body}
      </DataTableCard>
    </>
  );
}
