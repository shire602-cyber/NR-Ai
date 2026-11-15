import { Badge } from "@/components/ui/badge";
import { useHr } from "./shared";

const STATUS_KEYS: Record<string, string> = {
  active: "hr.status.active",
  inactive: "hr.status.inactive",
  terminated: "hr.status.terminated",
  draft: "hr.status.draft",
  calculated: "hr.status.calculated",
  approved: "hr.status.approved",
  paid: "hr.status.paid",
  reversed: "hr.status.reversed",
  cancelled: "hr.status.cancelled",
  pending: "hr.status.pending",
  rejected: "hr.status.rejected",
  not_submitted: "hr.status.notSubmitted",
  submitted: "hr.status.submitted",
  accepted: "hr.status.accepted",
  posted: "hr.status.posted",
};

export function StatusBadge({ status }: { status: string }) {
  const { tx } = useHr();
  const label = STATUS_KEYS[status] ? tx(STATUS_KEYS[status]) : status;
  const tone =
    status === "paid" || status === "approved" || status === "active" || status === "accepted"
      ? "bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle"
      : status === "calculated" || status === "submitted"
        ? "bg-info-subtle text-info-subtle-foreground hover:bg-info-subtle"
        : "";
  return (
    <Badge variant={tone ? "default" : "outline"} className={tone}>
      {label}
    </Badge>
  );
}
