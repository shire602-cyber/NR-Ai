import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ApprovalStatusBadge",
  {
    pendingApproval: "Pending approval",
    pendingApprovalSteps: "Pending approval {done}/{total}",
    approved: "Approved",
    rejected: "Rejected",
    cancelled: "Cancelled",
    roleAccountant: "Accountant",
    roleCfo: "CFO",
    roleOwner: "Owner",
    roleEmployee: "Team member",
    nextRole: "Next: {role}",
  },
  {
    pendingApproval: "بانتظار الموافقة",
    pendingApprovalSteps: "بانتظار الموافقة {done}/{total}",
    approved: "معتمدة",
    rejected: "مرفوض",
    cancelled: "ملغى",
    roleAccountant: "المحاسب",
    roleCfo: "المدير المالي",
    roleOwner: "المالك",
    roleEmployee: "عضو الفريق",
    nextRole: "التالي: {role}",
  }
);
