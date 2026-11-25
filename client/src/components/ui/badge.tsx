import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import {
  getStatusLabel,
  STATUS_NAMESPACES,
  statusBadgeVariant,
  statusDotClass,
  statusLabelKey,
} from "./status-meta";

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-4 transition-colors" +
    " focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border bg-transparent text-foreground",

        /* Semantic — subtle (filled background, slim border) */
        success: "border-transparent bg-success-subtle text-success-subtle-foreground",
        warning: "border-transparent bg-warning-subtle text-warning-subtle-foreground",
        info: "border-transparent bg-info-subtle text-info-subtle-foreground",
        danger: "border-transparent bg-danger-subtle text-danger-subtle-foreground",
        neutral: "border-transparent bg-neutral-subtle text-neutral-subtle-foreground",

        /* Semantic — solid (high contrast) */
        "success-solid": "border-transparent bg-success text-success-foreground",
        "warning-solid": "border-transparent bg-warning text-warning-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  /** Show a leading colored dot (good for status) */
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            statusDotClass(variant),
            (variant === "default" || !variant) && "bg-current"
          )}
        />
      )}
      {children}
    </div>
  );
}

/**
 * StatusBadge — convenience wrapper that maps an invoice/payment status string
 * to the right semantic Badge variant. Use this in tables.
 */
interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: string;
  /** Override the displayed label (default: the localized status label) */
  label?: React.ReactNode;
  /** For overdue documents: "45 days overdue" / "متأخر 45 يومًا". */
  overdueDays?: number;
}

/**
 * StatusBadge — the one document-status pill (CTO issue 7): localized label in sentence
 * case, semantic colour, a dot. Unknown statuses render neutral with the raw value.
 */
function StatusBadge({ status, label, overdueDays, className, ...props }: StatusBadgeProps) {
  // E3: some status labels live in `screens`, which a public route does not load by itself.
  const { t } = useTranslation(
    statusLabelKey(status)?.startsWith("screens.") ? STATUS_NAMESPACES : undefined
  );
  const overdueLabel =
    overdueDays !== undefined && overdueDays > 0
      ? overdueDays === 1
        ? t["components.statusOverdueOneDay"]
        : (t["components.statusOverdueDays"] ?? "{days}").replace("{days}", String(overdueDays))
      : undefined;
  const variant = overdueLabel ? "danger" : statusBadgeVariant(status);
  return (
    <Badge variant={variant} dot className={cn("py-0.5", className)} {...props}>
      {label ?? overdueLabel ?? getStatusLabel(status, t)}
    </Badge>
  );
}

export { Badge, badgeVariants, StatusBadge };
