import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { ListQueryTable, type ListQueryTableProps } from "@/components/ui/list-query-table";

interface DocumentListTableProps extends Omit<ListQueryTableProps, "rowCount" | "statusMessage"> {
  matchCount: number;
  noMatch?: EmptyStateProps;
}

export function DocumentListTable({
  query,
  matchCount,
  noMatch,
  children,
  ...card
}: DocumentListTableProps) {
  const hasNoMatches = matchCount === 0 && !!query.data?.length;
  return (
    <ListQueryTable
      {...card}
      query={query}
      rowCount={query.data?.length ?? 0}
      statusMessage={noMatch ? hasNoMatches && <EmptyState compact {...noMatch} /> : undefined}
    >
      {matchCount > 0 && children}
    </ListQueryTable>
  );
}
