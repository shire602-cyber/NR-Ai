import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "EmployeeShell",
  {
    unavailableTitle: "Not available for your role",
    unavailableBody: "Your role in this company does not include this screen. Ask an owner or accountant if you need access.",
    goHome: "Go to my payroll",
    goDashboard: "Go to the dashboard",
    redirectedNotice: "That screen is for accountants and owners. Here is your own payroll, leave and loans.",
    someUnavailable: "Some information on this page is not available for your role.",
    dismiss: "Dismiss",
  },
  {
    unavailableTitle: "غير متاح لدورك",
    unavailableBody: "لا يشمل دورك في هذه الشركة هذه الشاشة. اطلب من المالك أو المحاسب إن كنت بحاجة إلى صلاحية.",
    goHome: "الانتقال إلى رواتبي",
    goDashboard: "الانتقال إلى لوحة التحكم",
    redirectedNotice: "تلك الشاشة مخصصة للمحاسبين والمالكين. وهذه رواتبك وإجازاتك وقروضك.",
    someUnavailable: "بعض المعلومات في هذه الصفحة غير متاحة لدورك.",
    dismiss: "إخفاء",
  }
);
