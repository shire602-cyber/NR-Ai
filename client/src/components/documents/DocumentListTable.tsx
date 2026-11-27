import type { UseQueryResult } from "@tanstack/react-query";
import { DataTableCard, type DataTableCardProps } from "@/components/ui/data-table";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { useTranslation } from "@/lib/i18n";

interface DocumentListTableProps extends Omit<
  DataTableCardProps,
  "status" | "statusMessage" | "error"
> {
  query: Pick<
    UseQueryResult<unknown[]>,
    "data" | "fetchStatus" | "isPending" | "isLoadingError" | "isRefetchError" | "refetch"
  >;
  matchCount: number;
  noMatch?: EmptyStateProps;
}

export function DocumentListTable({
  query,
  matchCount,
  noMatch,
  children,
  ...cardProps
}: DocumentListTableProps) {
  const { t } = useTranslation();
  const paused = query.data === undefined && query.fetchStatus === "paused";
  const retry = () => void query.refetch();
  const hasMatches = matchCount > 0;
  const status = paused
    ? "ready"
    : query.isPending
      ? "loading"
      : query.isLoadingError
        ? "error"
        : hasMatches || query.data?.length
          ? "ready"
          : "empty";
  return (
    <>
      {query.isRefetchError && <StaleDataNotice onRetry={retry} />}
      <DataTableCard
        {...cardProps}
        status={status}
        statusMessage={
          paused || !noMatch
            ? undefined
            : status === "ready" && !hasMatches && <EmptyState compact {...noMatch} />
        }
        error={{
          title: t["common.loadFailedTitle"],
          description: t["common.loadFailedBody"],
          onRetry: retry,
        }}
      >
        {paused ? (
          <p role="status" className="px-4 py-6 text-small text-muted-foreground">
            {t["common.loadPaused"]}
          </p>
        ) : (
          hasMatches && children
        )}
      </DataTableCard>
    </>
  );
}
