import { useRef, ReactNode, CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

export interface VirtualTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
  width?: string;
  align?: "left" | "right" | "center";
}

interface VirtualTableProps<T> {
  rows: T[];
  columns: VirtualTableColumn<T>[];
  estimateRowHeight?: number;
  height?: number | string;
  overscan?: number;
  getRowId?: (row: T, index: number) => string | number;
  rowTestId?: (row: T, index: number) => string;
  emptyState?: ReactNode;
  className?: string;
  threshold?: number;
}

/**
 * Virtualized data table. Uses CSS grid (not <table>) so absolute-positioned
 * rows work cleanly. Falls back to non-virtualized rendering below `threshold`
 * (default 100 rows).
 */
export function VirtualTable<T>({
  rows,
  columns,
  estimateRowHeight = 52,
  height = 640,
  overscan = 8,
  getRowId,
  rowTestId,
  emptyState,
  className,
  threshold = 100,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gridTemplateColumns = columns.map((c) => c.width ?? "minmax(0, 1fr)").join(" ");

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  const renderHeader = () => (
    <div
      className="sticky top-0 z-10 grid h-9 items-center border-b border-border bg-surface-sunken/95 text-caption font-medium text-muted-foreground"
      style={{ gridTemplateColumns }}
      role="row"
    >
      {columns.map((col) => (
        <div
          key={col.key}
          role="columnheader"
          className={cn(
            "px-4",
            // Ellipsis only for text headers: a control (e.g. a checkbox) wider
            // than a narrow column's content box would otherwise sprout a "…".
            typeof col.header === "string" && "truncate",
            col.align === "right" && "text-end",
            col.align === "center" && "text-center",
            col.headerClassName
          )}
        >
          {col.header}
        </div>
      ))}
    </div>
  );

  const renderRow = (
    row: T,
    index: number,
    style?: CSSProperties,
    measureRef?: (el: HTMLDivElement | null) => void
  ) => (
    <div
      key={getRowId ? getRowId(row, index) : index}
      ref={measureRef}
      data-index={index}
      data-testid={rowTestId ? rowTestId(row, index) : undefined}
      role="row"
      className="grid min-h-11 items-center border-b border-border/70 transition-colors duration-fast last:border-b-0 hover:bg-muted/50"
      style={{ gridTemplateColumns, ...style }}
    >
      {columns.map((col) => (
        <div
          key={col.key}
          role="cell"
          className={cn(
            "px-4 py-2 text-sm",
            col.align === "right" && "text-end",
            col.align === "center" && "text-center",
            col.className
          )}
        >
          {col.cell(row, index)}
        </div>
      ))}
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className={cn("overflow-hidden bg-card", className)}>
        {renderHeader()}
        <div>{emptyState}</div>
      </div>
    );
  }

  if (rows.length < threshold) {
    return (
      <div className={cn("overflow-hidden bg-card", className)} role="table">
        {renderHeader()}
        <div className="overflow-x-auto">{rows.map((row, i) => renderRow(row, i))}</div>
      </div>
    );
  }

  const totalSize = rowVirtualizer.getTotalSize();
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      className={cn("overflow-hidden bg-card", className)}
      role="table"
      data-testid="virtual-table"
    >
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: typeof height === "number" ? `${height}px` : height, contain: "strict" }}
      >
        {renderHeader()}
        <div style={{ height: totalSize, position: "relative", width: "100%" }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const style: CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            };
            return renderRow(row, virtualRow.index, style, rowVirtualizer.measureElement);
          })}
        </div>
      </div>
    </div>
  );
}
