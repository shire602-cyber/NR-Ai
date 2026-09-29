import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "FirmHealth",
  {
    healthy: "Healthy",
    attention: "Attention",
    critical: "Critical",
    dOverdue: "{abs}d overdue",
    dueInD: "Due in {daysTilDue}d",
    inD: "In {daysTilDue}d",
    trn: "TRN: {trn}",
    overdue: "{overdueCount} overdue",
    clear: "Clear",
    unmatched: "{unreconciledCount} unmatched",
    balanced: "Balanced",
    off: "Off",
  },
  {
    healthy: "سليم",
    attention: "يتطلب انتباهًا",
    critical: "حرج",
    dOverdue: "متأخر {abs} يوم",
    dueInD: "يستحق خلال {daysTilDue} يوم",
    inD: "خلال {daysTilDue} يوم",
    trn: "الرقم الضريبي: {trn}",
    overdue: "{overdueCount} متأخرة",
    clear: "مسح",
    unmatched: "{unreconciledCount} غير مطابقة",
    balanced: "متوازن",
    off: "متوقف",
  }
);
