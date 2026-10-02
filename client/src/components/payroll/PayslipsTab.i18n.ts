import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "PayslipsTab",
  {
    intro: "Payslips of approved and paid payroll runs. Each employee sees only their own.",
    introAll: "Payslips of approved and paid payroll runs, one per employee.",
    colPeriod: "Period",
    colEmployee: "Employee",
    colNet: "Net pay",
    colStatus: "Status",
    colActions: "Actions",
    statusApproved: "Approved",
    statusPaid: "Paid",
    download: "Download payslip",
    downloadFailed: "Could not download the payslip",
    empty: "No payslips yet. They appear here once a payroll run is approved.",
    loading: "Loading...",
    loadFailed: "Could not load payslips.",
  },
  {
    intro: "قسائم الرواتب لمسيّرات الرواتب المعتمدة والمدفوعة. يرى كل موظف قسيمته فقط.",
    introAll: "قسائم الرواتب لمسيّرات الرواتب المعتمدة والمدفوعة، قسيمة لكل موظف.",
    colPeriod: "الفترة",
    colEmployee: "الموظف",
    colNet: "صافي الراتب",
    colStatus: "الحالة",
    colActions: "الإجراءات",
    statusApproved: "معتمدة",
    statusPaid: "مدفوعة",
    download: "تنزيل القسيمة",
    downloadFailed: "تعذر تنزيل القسيمة",
    empty: "لا توجد قسائم بعد. تظهر هنا بمجرد اعتماد مسيّر الرواتب.",
    loading: "جارٍ التحميل...",
    loadFailed: "تعذر تحميل القسائم.",
  }
);
