import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { messages } from "./ApprovalStatusBadge.i18n";

interface ApprovalStatusBadgeProps {
  /** A document status (`pending_approval`) or an approval request status (`pending`, `approved`, `rejected`, `cancelled`). */
  status: string;
  completedSteps?: number;
  requiredSteps?: number;
  className?: string;
}

const TONES: Record<string, StatusTone> = {
  pending_approval: "warning",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

/** The role name a user sees for an approver role code (non-hook form for callbacks and toasts). */
export function approverRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "accountant":
      return messages.t("roleAccountant");
    case "cfo":
      return messages.t("roleCfo");
    case "owner":
      return messages.t("roleOwner");
    default:
      return role ? messages.t("roleEmployee") : "";
  }
}

/** Hook form: re-renders on a language switch. */
export function useApproverRoleLabel() {
  messages.useT();
  return approverRoleLabel;
}

/** Where a document is in its approval chain: "Pending approval 1/2", "Approved", "Rejected". */
export function ApprovalStatusBadge({ status, completedSteps, requiredSteps, className }: ApprovalStatusBadgeProps) {
  const tr = messages.useT();
  const tone = TONES[status] ?? "neutral";
  let label: string;
  if (status === "pending_approval" || status === "pending") {
    label =
      requiredSteps && requiredSteps > 1
        ? tr("pendingApprovalSteps", { done: completedSteps ?? 0, total: requiredSteps })
        : tr("pendingApproval");
  } else if (status === "approved") label = tr("approved");
  else if (status === "rejected") label = tr("rejected");
  else if (status === "cancelled") label = tr("cancelled");
  else label = status;
  return (
    <StatusBadge tone={tone} className={className} data-testid={`badge-approval-${status}`}>
      {label}
    </StatusBadge>
  );
}
