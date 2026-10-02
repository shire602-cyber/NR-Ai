import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ReportExportMenu",
  {
    download: "Download",
    asPdf: "PDF",
    asCsv: "CSV",
    asXlsx: "Excel (XLSX)",
    preparing: "Preparing...",
    downloaded: "Report downloaded",
    downloadedDescription: "{report} was saved as {format}.",
    failed: "The report could not be downloaded",
    serverNote: "Files are produced on the server from your books, in the language you are using.",
  },
  {
    download: "تنزيل",
    asPdf: "PDF",
    asCsv: "CSV",
    asXlsx: "Excel (XLSX)",
    preparing: "جارٍ التحضير...",
    downloaded: "تم تنزيل التقرير",
    downloadedDescription: "تم حفظ {report} بصيغة {format}.",
    failed: "تعذر تنزيل التقرير",
    serverNote: "تُنشأ الملفات على الخادم من دفاترك وباللغة التي تستخدمها.",
  }
);
