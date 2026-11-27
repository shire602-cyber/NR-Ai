import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { ErrorState, type ErrorStateProps } from "@/components/ui/error-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";

export type DataTableStatus = "ready" | "loading" | "empty" | "error";

export interface DataTableCardProps {
  /** Toolbar row above the table: search, filters, bulk actions. */
  toolbar?: ReactNode;
  status?: DataTableStatus;
  /** Column labels for the loading skeleton (keeps header parity). */
  columnLabels?: string[];
  loadingRows?: number;
  empty?: EmptyStateProps;
  /** Pass null to keep the status region mounted with no announcement. */
  statusMessage?: ReactNode;
  error?: ErrorStateProps;
  /** Footer row: pagination, totals note. */
  footer?: ReactNode;
  className?: string;
  testId?: string;
  /** The <Table> (rendered when status is "ready"). */
  children?: ReactNode;
}

/**
 * DataTableCard — the standard frame for a list screen's table. It owns the
 * four data states (loading skeleton, empty, error with retry, ready) so every
 * table in the app behaves the same. Put a `<Table>` from ./table inside; use
 * `<MoneyCell>` / `data-numeric` on amount columns so they end-align.
 */
export function DataTableCard({
  toolbar,
  status = "ready",
  columnLabels,
  loadingRows = 6,
  empty,
  statusMessage,
  error,
  footer,
  className,
  testId,
  children,
}: DataTableCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)} data-testid={testId}>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {toolbar}
        </div>
      )}
      {status === "loading" && (
        <TableSkeleton
          rows={loadingRows}
          columnLabels={columnLabels}
          columns={columnLabels?.length ?? 5}
        />
      )}
      {status === "empty" && empty && <EmptyState compact {...empty} />}
      {statusMessage !== undefined && <div role="status">{statusMessage}</div>}
      {status === "error" && <ErrorState compact {...error} />}
      {status === "ready" && children}
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-sunken/60 px-4 py-3 text-small text-muted-foreground">
          {footer}
        </div>
      )}
    </Card>
  );
}
