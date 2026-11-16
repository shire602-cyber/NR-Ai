import { cn } from "@/lib/utils";

/** Badge variants a document status can map to (mirrors badgeVariants in ./badge). */
export type StatusVariant = "success" | "warning" | "info" | "danger" | "neutral" | "default";

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
  | "partial"
  | "cancelled"
  | "due_soon";

// R18-02: `label` is a translation key (components namespace).
export const STATUS_MAP: Record<
  StatusKind,
  { variant: StatusVariant | null | undefined; label: string }
> = {
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
  partial: { variant: "warning", label: "components.statusPartial" },
  due_soon: { variant: "warning", label: "components.statusDueSoon" },
  cancelled: { variant: "neutral", label: "components.statusCancelled" },
};

/** Semantic variant for a document status (green paid/posted, amber needs action, red overdue, blue sent, neutral draft/void). */
export function statusBadgeVariant(status: string): StatusVariant {
  const meta = STATUS_MAP[(status || "").toLowerCase() as StatusKind];
  return meta?.variant ?? "neutral";
}

/** Locale label key for a document status, or undefined for an unknown status. */
export function statusLabelKey(status: string): string | undefined {
  return STATUS_MAP[(status || "").toLowerCase() as StatusKind]?.label;
}

/** Dot colour inside a document-status badge. */
export function statusDotClass(variant: string | null | undefined): string {
  return cn(
    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
    variant === "success" && "bg-success",
    variant === "warning" && "bg-warning",
    variant === "info" && "bg-info",
    variant === "danger" && "bg-danger",
    (variant === "neutral" || !variant) && "bg-muted-foreground"
  );
}
