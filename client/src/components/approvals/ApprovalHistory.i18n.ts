import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ApprovalHistory",
  {
    title: "Approval history",
    description: "Every approval request on this document and who signed each step.",
    loading: "Loading history...",
    loadFailed: "The history could not be loaded.",
    empty: "No approval has been requested for this document.",
    rule: "Rule: {name}",
    amount: "Amount (AED): {amount}",
    stepRole: "Step {step}: {role}",
    waiting: "Waiting for {role}",
    by: "by {name}",
    noComment: "No comment",
    decisionApproved: "Approved",
    decisionRejected: "Rejected",
  },
  {
    title: "سجل الموافقات",
    description: "كل طلبات الموافقة على هذا المستند ومن وقّع كل خطوة.",
    loading: "جارٍ تحميل السجل...",
    loadFailed: "تعذر تحميل السجل.",
    empty: "لم يُطلب أي اعتماد لهذا المستند.",
    rule: "القاعدة: {name}",
    amount: "المبلغ (بالدرهم): {amount}",
    stepRole: "الخطوة {step}: {role}",
    waiting: "بانتظار {role}",
    by: "بواسطة {name}",
    noComment: "لا يوجد تعليق",
    decisionApproved: "معتمدة",
    decisionRejected: "مرفوض",
  }
);
