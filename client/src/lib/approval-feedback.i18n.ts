import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "approvalFeedback",
  {
    requiredTitle: "More approval needed",
    requiredBody: "Step {step} of {total} needs approval from a {role} or higher.",
    blockedTitle: "Approval not possible",
    alreadySignedBody: "You have already signed this document. A different person must give the next approval.",
    selfBody: "You cannot approve a document you created or submitted.",
    inProgressBody: "This document is waiting for approval and cannot be changed. Reject it first.",
    roleAccountant: "accountant",
    roleCfo: "CFO",
    roleOwner: "owner",
    roleApprover: "approver",
    submitForApproval: "Submit for approval",
    submittedTitle: "Submitted for approval",
    submittedBody: "The approvers can now sign it from the Approvals page.",
    noRuleBody: "No approval rule covers this journal. Post it directly.",
    submitFailed: "Could not submit for approval",
  },
  {
    requiredTitle: "مطلوب مزيد من الموافقات",
    requiredBody: "الخطوة {step} من {total} تحتاج إلى موافقة {role} أو أعلى.",
    blockedTitle: "تعذرت الموافقة",
    alreadySignedBody: "لقد وقّعت على هذا المستند بالفعل. يجب أن يمنح شخص آخر الموافقة التالية.",
    selfBody: "لا يمكنك الموافقة على مستند أنشأته أو قدّمته.",
    inProgressBody: "هذا المستند بانتظار الموافقة ولا يمكن تعديله. ارفضه أولاً.",
    roleAccountant: "المحاسب",
    roleCfo: "المدير المالي",
    roleOwner: "المالك",
    roleApprover: "المعتمد",
    submitForApproval: "إرسال للموافقة",
    submittedTitle: "أُرسل للموافقة",
    submittedBody: "يستطيع المعتمدون الآن توقيعه من صفحة الموافقات.",
    noRuleBody: "لا توجد قاعدة موافقة تشمل هذا القيد. رحّله مباشرة.",
    submitFailed: "تعذر الإرسال للموافقة",
  }
);
