import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Header-end slot: a ghost/outline Button, a link, a filter. */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  /** Remove body padding so a table or list can run edge to edge. */
  flush?: boolean;
  /** Heading level for the title (default h2). */
  as?: "h2" | "h3";
  testId?: string;
}

/**
 * SectionCard — a titled surface for one topic on a page (a table, a chart,
 * a list). Header: title + description on the start side, actions on the end.
 */
export function SectionCard({
  title,
  description,
  actions,
  footer,
  flush = false,
  as: Heading = "h2",
  testId,
  className,
  children,
  ...props
}: SectionCardProps) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Card
      className={cn("flex flex-col overflow-hidden", className)}
      data-testid={testId}
      {...props}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-card pt-card">
          <div className="min-w-0 flex-1">
            {title && <Heading className="text-h3 font-semibold text-foreground">{title}</Heading>}
            {description && <p className="mt-1 text-small text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div
        className={cn(
          "flex-1",
          flush ? (hasHeader ? "mt-5" : "") : "px-card pb-card",
          !flush && (hasHeader ? "pt-5" : "pt-card")
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="border-t border-border bg-surface-sunken/60 px-card py-3.5 text-small text-muted-foreground">
          {footer}
        </div>
      )}
    </Card>
  );
}
