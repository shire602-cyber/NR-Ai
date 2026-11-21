import * as React from "react";

import { cn } from "@/lib/utils";

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Row height: default 44px body rows, compact 36px (dense ledgers, embedded lists). */
  density?: "default" | "compact";
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = "default", ...props }, ref) => (
    // A scrolling region must be reachable by keyboard (axe: scrollable-region-focusable).
    <div
      className="relative w-full min-w-0 max-w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role={props["aria-label"] ? "region" : undefined}
      aria-label={props["aria-label"]}
    >
      <table
        ref={ref}
        data-density={density}
        className={cn(
          "group/table w-full caption-bottom text-sm border-separate border-spacing-0 tabular-nums",
          className
        )}
        {...props}
      />
    </div>
  )
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "[&_tr]:border-0 [&_tr:hover]:bg-transparent",
      "sticky top-0 z-10 bg-surface-sunken/95 backdrop-blur supports-[backdrop-filter]:bg-surface-sunken/80",
      className
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child>td]:border-b-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "bg-surface-sunken font-semibold [&>tr>td]:border-t [&>tr>td]:border-border-strong [&>tr>td]:border-b-0",
      className
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "transition-colors duration-fast hover:bg-muted/50 data-[state=selected]:bg-primary/5",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 px-4 text-start align-middle text-caption font-medium text-muted-foreground whitespace-nowrap",
      "border-b border-border",
      "[&[data-numeric]]:text-end",
      "[&:has([role=checkbox])]:pe-0",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      /* 44px body rows (36px when the table is density="compact"), CTO issue 3. */
      "h-11 px-4 py-2 align-middle border-b border-border/70 group-data-[density=compact]/table:h-9 group-data-[density=compact]/table:py-1.5",
      "[&[data-numeric]]:text-end [&[data-numeric]]:tabular-nums [&[data-numeric]]:whitespace-nowrap",
      /* data-nowrap: dates, document numbers, IDs, statuses never wrap. */
      "[&[data-nowrap]]:whitespace-nowrap",
      /* data-truncate: the flexible name column, one line, ellipsis. */
      "[&[data-truncate]]:max-w-[280px] [&[data-truncate]]:truncate [&[data-truncate]]:[unicode-bidi:plaintext]",
      "[&:has([role=checkbox])]:pe-0",
      className
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
