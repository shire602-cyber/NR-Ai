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
  | "due_soon"
  | "accepted"
  | "expired"
  | "converted"
  | "received"
  | "partially_received"
  | "closed"
  | "reconciled"
  | "unmatched"
  | "matched"
  | "suggested"
  | "reimbursed"
  | "disposed"
  | "applied"
  | "open"
  | "completed"
  | "paused"
  | "issued"
  | "confirmed"
  | "unposted"
  | "ordered"
  | "billed";

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
  // D3a: sales, purchase, banking, ledger and asset statuses (screens namespace).
  accepted: { variant: "success", label: "screens.statusAccepted" },
  expired: { variant: "warning", label: "screens.statusExpired" },
  converted: { variant: "info", label: "screens.statusConverted" },
  received: { variant: "success", label: "screens.statusReceived" },
  partially_received: { variant: "warning", label: "screens.statusPartiallyReceived" },
  closed: { variant: "neutral", label: "screens.statusClosed" },
  reconciled: { variant: "success", label: "screens.statusReconciled" },
  unmatched: { variant: "neutral", label: "screens.statusUnmatched" },
  matched: { variant: "success", label: "screens.statusMatched" },
  suggested: { variant: "warning", label: "screens.statusSuggested" },
  reimbursed: { variant: "success", label: "screens.statusReimbursed" },
  disposed: { variant: "neutral", label: "screens.statusDisposed" },
  applied: { variant: "success", label: "screens.statusApplied" },
  open: { variant: "info", label: "screens.statusOpen" },
  completed: { variant: "success", label: "screens.statusCompleted" },
  paused: { variant: "neutral", label: "screens.statusPaused" },
  issued: { variant: "info", label: "screens.statusIssued" },
  confirmed: { variant: "info", label: "screens.statusConfirmed" },
  unposted: { variant: "warning", label: "screens.statusUnposted" },
  ordered: { variant: "info", label: "screens.statusOrdered" },
  billed: { variant: "success", label: "screens.statusBilled" },
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
