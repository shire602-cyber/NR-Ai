import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors" +
  " focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
        outline:
          "border [border-color:var(--badge-outline)] shadow-xs",

        /* Semantic — subtle (filled background, slim border) */
        success:
          "border-transparent bg-success-subtle text-success-subtle-foreground",
        warning:
          "border-transparent bg-warning-subtle text-warning-subtle-foreground",
        info:
          "border-transparent bg-info-subtle text-info-subtle-foreground",
        danger:
          "border-transparent bg-danger-subtle text-danger-subtle-foreground",
        neutral:
          "border-transparent bg-neutral-subtle text-neutral-subtle-foreground",

        /* Semantic — solid (high contrast) */
        "success-solid":
          "border-transparent bg-success text-success-foreground shadow-xs",
        "warning-solid":
          "border-transparent bg-warning text-warning-foreground shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a leading colored dot (good for status) */
  dot?: boolean
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
            (variant === "default" || !variant) && "bg-current",
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
  | "submitted"

const STATUS_MAP: Record<StatusKind, { variant: BadgeProps["variant"]; label: string }> = {
  paid:      { variant: "success", label: "Paid" },
  posted:    { variant: "success", label: "Posted" },
  approved:  { variant: "success", label: "Approved" },
  active:    { variant: "success", label: "Active" },
  sent:      { variant: "info",    label: "Sent" },
  submitted: { variant: "info",    label: "Submitted" },
  pending:   { variant: "warning", label: "Pending" },
  overdue:   { variant: "danger",  label: "Overdue" },
  rejected:  { variant: "danger",  label: "Rejected" },
  void:      { variant: "neutral", label: "Void" },
  draft:     { variant: "neutral", label: "Draft" },
  inactive:  { variant: "neutral", label: "Inactive" },
}

interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: string
  /** Override the displayed label (default: capitalized status) */
  label?: React.ReactNode
}

function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const key = (status || "").toLowerCase() as StatusKind
  const meta = STATUS_MAP[key] ?? { variant: "neutral" as const, label: status }
  return (
    <Badge variant={meta.variant} dot className={cn("py-0.5", className)} {...props}>
      {label ?? meta.label}
    </Badge>
  )
}

export { Badge, badgeVariants, StatusBadge }
