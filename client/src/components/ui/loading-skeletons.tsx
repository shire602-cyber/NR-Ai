import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  /** When provided, renders an actual <thead> with these labels for accessibility/parity. */
  columnLabels?: string[];
  className?: string;
}

/**
 * Skeleton loader for tabular data. Use instead of "Loading..." text or spinners
 * when the page is rendering a table-shaped result.
 */
export function TableSkeleton({
  rows = 5,
  columns = 5,
  columnLabels,
  className,
}: TableSkeletonProps) {
  const cols = columnLabels?.length ?? columns;
  return (
    <div className={cn('w-full overflow-x-auto', className)} data-testid="table-skeleton">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}>
                {columnLabels ? (
                  columnLabels[i]
                ) : (
                  <Skeleton className="h-4 w-20" />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <TableRow key={rowIdx}>
              {Array.from({ length: cols }).map((_, colIdx) => (
                <TableCell key={colIdx}>
                  <Skeleton className={cn('h-4', colIdx === 0 ? 'w-24' : 'w-full max-w-[160px]')} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface CardListSkeletonProps {
  count?: number;
  className?: string;
}

/** Skeleton loader for a vertical list of card-shaped rows (e.g. receipts list). */
export function CardListSkeleton({ count = 4, className }: CardListSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)} data-testid="card-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 p-4 border rounded-lg"
        >
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Skeleton className="w-12 h-12 rounded-md shrink-0" />
            <div className="space-y-2 flex-1 min-w-0">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

interface StatCardSkeletonProps {
  count?: number;
  className?: string;
}

/** Skeleton loader for a row of summary/stat cards. */
export function StatCardSkeleton({ count = 3, className }: StatCardSkeletonProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
        className,
      )}
      data-testid="stat-card-skeleton"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface PageSkeletonProps {
  showStats?: boolean;
  showTable?: boolean;
  rows?: number;
  columns?: number;
  className?: string;
}

/** Composite page-level skeleton: header + stats + table. */
export function PageSkeleton({
  showStats = true,
  showTable = true,
  rows = 6,
  columns = 5,
  className,
}: PageSkeletonProps) {
  return (
    <div className={cn('space-y-6', className)} data-testid="page-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {showStats && <StatCardSkeleton />}
      {showTable && (
        <Card>
          <CardContent className="pt-6">
            <TableSkeleton rows={rows} columns={columns} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
