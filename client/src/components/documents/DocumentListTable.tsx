import type { UseQueryResult } from "@tanstack/react-query";
import { DataTableCard, type DataTableCardProps } from "@/components/ui/data-table";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { useTranslation } from "@/lib/i18n";

interface DocumentListTableProps extends Omit<DataTableCardProps, "status" | "error"> {
  query: Pick<
    UseQueryResult<unknown[]>,
    "data" | "fetchStatus" | "isPending" | "isLoadingError" | "isRefetchError" | "refetch"
  >;
  matchCount: number;
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

  return (
    <>
      {query.isRefetchError && <StaleDataNotice onRetry={retry} />}
      <DataTableCard
        {...cardProps}
        status={
          paused
            ? "ready"
            : query.isPending
              ? "loading"
              : query.isLoadingError
                ? "error"
                : matchCount > 0
                  ? "ready"
                  : query.data?.length
                    ? "no-match"
                    : "empty"
        }
        noMatch={paused ? undefined : noMatch}
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
          children
        )}
      </DataTableCard>
    </>
  );
}
