import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
  variant?: React.ComponentProps<typeof Button>["variant"];
  testId?: string;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
  /** Render a more compact version, e.g. inside a table cell */
  compact?: boolean;
  testId?: string;
}

/**
 * Standard empty state for lists, tables, and panels.
 * Pairs a soft icon with a title, optional description, and 0–2 CTAs.
 * Uses semantic tokens (muted-foreground, foreground) only — never hardcoded colors.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
  testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId ?? "empty-state"}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "relative rounded-xl bg-muted/60 ring-1 ring-border flex items-center justify-center mb-4",
            compact ? "w-11 h-11" : "w-14 h-14"
          )}
          aria-hidden="true"
        >
          <Icon
            className={cn("text-muted-foreground/70", compact ? "w-5 h-5" : "w-6 h-6")}
            strokeWidth={1.5}
          />
          <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-accent/15 ring-1 ring-accent/30" />
        </div>
      )}
      <h3
        className={cn(
          "font-semibold tracking-tight text-foreground",
          compact ? "text-[15px]" : "text-[17px]"
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            "text-muted-foreground mt-1.5 max-w-md leading-relaxed",
            compact ? "text-xs" : "text-[13px]"
          )}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-2",
            compact ? "mt-4" : "mt-6"
          )}
        >
          {action && <EmptyStateButton {...action} />}
          {secondaryAction && (
            <EmptyStateButton {...secondaryAction} variant={secondaryAction.variant ?? "outline"} />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyStateButton({
  label,
  onClick,
  href,
  icon: Icon,
  variant = "default",
  testId,
}: EmptyStateAction) {
  const content = (
    <>
      {Icon && <Icon className="w-4 h-4 mr-2" />}
      {label}
    </>
  );
  if (href) {
    return (
      <Button asChild variant={variant} data-testid={testId}>
        <a href={href}>{content}</a>
      </Button>
    );
  }
  return (
    <Button onClick={onClick} variant={variant} data-testid={testId}>
      {content}
    </Button>
  );
}
