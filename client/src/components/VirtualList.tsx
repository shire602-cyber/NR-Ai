import { useRef, ReactNode, CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

interface VirtualListProps<T> {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  height?: number | string;
  overscan?: number;
  className?: string;
  emptyState?: ReactNode;
  threshold?: number;
}

/**
 * Virtualized list that only renders visible items. Falls back to plain
 * rendering when the item count is below `threshold` (default 100) — the
 * overhead of measurement isn't worth it for short lists.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  getKey,
  height = 600,
  overscan = 8,
  className,
  emptyState,
  threshold = 100,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  if (items.length < threshold) {
    return (
      <div className={className}>
        {items.map((item, i) => (
          <div key={getKey ? getKey(item, i) : i}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  const totalSize = rowVirtualizer.getTotalSize();
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto', className)}
      style={{ height: typeof height === 'number' ? `${height}px` : height, contain: 'strict' }}
      data-testid="virtual-list"
    >
      <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          const style: CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
          };
          return (
            <div
              key={getKey ? getKey(item, virtualRow.index) : virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={style}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
