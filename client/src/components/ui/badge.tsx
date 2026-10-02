import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { messages as pageMessages } from "./badge.i18n";

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
  | "credited"
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
  | "partial"
  | "cancelled"
  | "open"
  | "closed"
  | "accepted"
  | "declined"
  | "expired"
  | "issued";

const getStatusMap = (): Record<StatusKind, { variant: BadgeProps["variant"]; label: string }> => ({
  paid: { variant: "success", label: pageMessages.t("paid") },
  credited: { variant: "neutral", label: pageMessages.t("credited") },
  posted: { variant: "success", label: pageMessages.t("posted") },
  approved: { variant: "success", label: pageMessages.t("approved") },
  active: { variant: "success", label: pageMessages.t("active") },
  sent: { variant: "info", label: pageMessages.t("sent") },
  submitted: { variant: "info", label: pageMessages.t("submitted") },
  pending: { variant: "warning", label: pageMessages.t("pending") },
  overdue: { variant: "danger", label: pageMessages.t("overdue") },
  rejected: { variant: "danger", label: pageMessages.t("rejected") },
  void: { variant: "neutral", label: pageMessages.t("void") },
  draft: { variant: "neutral", label: pageMessages.t("draft") },
  inactive: { variant: "neutral", label: pageMessages.t("inactive") },
  partial: { variant: "warning", label: pageMessages.t("partial") },
  cancelled: { variant: "neutral", label: pageMessages.t("cancelled") },
  open: { variant: "info", label: pageMessages.t("open") },
  closed: { variant: "neutral", label: pageMessages.t("closed") },
  accepted: { variant: "success", label: pageMessages.t("accepted") },
  declined: { variant: "danger", label: pageMessages.t("declined") },
  expired: { variant: "warning", label: pageMessages.t("expired") },
  issued: { variant: "info", label: pageMessages.t("issued") },
});

/** A document status in the reader's language (for toasts and text; badges use StatusBadge). Unknown values are shown as they are. */
export function statusText(status: string | null | undefined): string {
  const key = (status || "").toLowerCase();
  const entry = (getStatusMap() as Record<string, { label: string } | undefined>)[key];
  return entry?.label ?? (status || "");
}

interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: string;
  /** Override the displayed label (default: capitalized status) */
  label?: React.ReactNode;
}

function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  pageMessages.useT(); // subscribe so labels re-render on language switch
  const key = (status || "").toLowerCase() as StatusKind;
  const meta = getStatusMap()[key] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={meta.variant} dot className={cn("py-0.5", className)} {...props}>
      {label ?? meta.label}
    </Badge>
  );
}

export { Badge, badgeVariants, StatusBadge };
