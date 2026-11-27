import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { ErrorState, type ErrorStateProps } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
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
  /**
   * A failed list query. Shown instead of the empty state or the table (a failed load must not
   * read as "nothing here yet"), with cause-specific copy and Retry. Ignored while loading.
   */
  loadError?: Pick<ComponentProps<typeof LoadErrorState>, "error" | "onRetry" | "testId"> | null;
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
  loadError,
  footer,
  className,
  testId,
  children,
}: DataTableCardProps) {
  // One decision for the empty / error slot. A failed load (loadError) wins over empty and ready
  // but never over the loading skeleton; it is cause-specific, the plain `error` is not.
  const [Slot, slotProps]: [ComponentType<any>?, object?] =
    loadError && status !== "loading"
      ? [LoadErrorState, loadError]
      : status === "empty" && empty
        ? [EmptyState, empty]
        : status === "error"
          ? [ErrorState, error]
          : [];
  return (
    <Card className={`overflow-hidden ${className ?? ""}`} data-testid={testId}>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {toolbar}
        </div>
      )}
      {status === "loading" && <TableSkeleton rows={loadingRows} columnLabels={columnLabels} />}
      {Slot && <Slot compact {...slotProps} />}
      {statusMessage !== undefined && <div role="status">{statusMessage}</div>}
      {status === "ready" && !Slot && children}
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-sunken/60 px-4 py-3 text-small text-muted-foreground">
          {footer}
        </div>
      )}
    </Card>
  );
}
