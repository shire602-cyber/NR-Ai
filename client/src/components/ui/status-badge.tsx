import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  /* Semantic status tokens (index.css) — the same families the Badge
   * variants use, so a "success" pill looks identical everywhere. */
  neutral: "border-transparent bg-neutral-subtle text-neutral-subtle-foreground",
  info: "border-transparent bg-info-subtle text-info-subtle-foreground",
  success: "border-transparent bg-success-subtle text-success-subtle-foreground",
  warning: "border-transparent bg-warning-subtle text-warning-subtle-foreground",
  danger: "border-transparent bg-danger-subtle text-danger-subtle-foreground",
  accent: "border-transparent bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone: StatusTone;
  children: React.ReactNode;
}

/**
 * Themeable status badge. Replaces ad-hoc `bg-green-100 text-green-800` style usage
 * across the app so dark mode and brand changes flow through the design tokens.
 */
export function StatusBadge({ tone, className, children, ...rest }: StatusBadgeProps) {
  return (
    <Badge className={cn(TONE_CLASSES[tone], className)} {...rest}>
      {children}
    </Badge>
  );
}
