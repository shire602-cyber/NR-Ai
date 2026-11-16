import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors" +
    " focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow-xs",
        outline: "border [border-color:var(--badge-outline)] shadow-xs",

        /* Semantic — subtle (filled background, slim border) */
        success: "border-transparent bg-success-subtle text-success-subtle-foreground",
        warning: "border-transparent bg-warning-subtle text-warning-subtle-foreground",
        info: "border-transparent bg-info-subtle text-info-subtle-foreground",
        danger: "border-transparent bg-danger-subtle text-danger-subtle-foreground",
        neutral: "border-transparent bg-neutral-subtle text-neutral-subtle-foreground",

        /* Semantic — solid (high contrast) */
        "success-solid": "border-transparent bg-success text-success-foreground shadow-xs",
        "warning-solid": "border-transparent bg-warning text-warning-foreground shadow-xs",
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
            "inline-block h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-success",
            variant === "warning" && "bg-warning",
            variant === "info" && "bg-info",
            variant === "danger" && "bg-destructive",
            variant === "neutral" && "bg-muted-foreground",
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
export type StatusKind =
  | "paid"
  | "sent"
  | "draft"
  | "void"
  | "overdue"
  | "pending"
  | "approved"
  | "rejected"
  | "posted"
  | "active"
  | "inactive"
  | "submitted";

// R18-02: `label` is a translation key (components namespace).
const STATUS_MAP: Record<StatusKind, { variant: BadgeProps["variant"]; label: string }> = {
  paid: { variant: "success", label: "components.statusPaid" },
  posted: { variant: "success", label: "components.statusPosted" },
  approved: { variant: "success", label: "components.statusApproved" },
  active: { variant: "success", label: "components.statusActive" },
  sent: { variant: "info", label: "components.statusSent" },
  submitted: { variant: "info", label: "components.statusSubmitted" },
  pending: { variant: "warning", label: "components.statusPending" },
  overdue: { variant: "danger", label: "components.statusOverdue" },
  rejected: { variant: "danger", label: "components.statusRejected" },
  void: { variant: "neutral", label: "components.statusVoid" },
  draft: { variant: "neutral", label: "components.statusDraft" },
  inactive: { variant: "neutral", label: "components.statusInactive" },
};

interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: string;
  /** Override the displayed label (default: capitalized status) */
  label?: React.ReactNode;
}

function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const { t } = useTranslation();
  const key = (status || "").toLowerCase() as StatusKind;
  const meta = STATUS_MAP[key];
  return (
    <Badge variant={meta?.variant ?? "neutral"} dot className={cn("py-0.5", className)} {...props}>
      {label ?? (meta ? (t[meta.label] ?? status) : status)}
    </Badge>
  );
}

export { Badge, badgeVariants, StatusBadge };
