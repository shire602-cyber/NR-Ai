import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "AnomalyDetection",
  {
    critical: "Critical",
    warning: "Warning",
    info: "Info",
    anomalyDismissed: "Anomaly dismissed",
    theAnomalyHasBeenRemovedFrom: "The anomaly has been removed from the list.",
    error: "Error",
    pleaseCreateACompanyFirstTo: "Please create a company first to use anomaly detection.",
    aiAnomalyDetection: "AI Anomaly Detection",
    automaticallyScanTransactionsForIrregularitiesAn:
      "Automatically scan transactions for irregularities and potential issues",
    lastScanned: "Last scanned: {value}",
    scanning: "Scanning...",
    runScan: "Run Scan",
    totalAnomalies: "Total Anomalies",
    filter: "Filter:",
    allSeverities: "All Severities",
    clearFilter: "Clear filter",
    dismiss: "Dismiss",
    noAnomaliesFound: "No Anomalies Found",
    noAnomaliesDetectedTryChangingThe:
      "No {severityFilter} anomalies detected. Try changing the filter.",
    yourTransactionsLookCleanNoIrregularities:
      "Your transactions look clean. No irregularities detected in the latest scan.",
  },
  {
    critical: "حرج",
    warning: "تنبيه",
    info: "معلومة",
    anomalyDismissed: "تم تجاهل الحالة الشاذة",
    theAnomalyHasBeenRemovedFrom: "تمت إزالة الحالة الشاذة من القائمة.",
    error: "خطأ",
    pleaseCreateACompanyFirstTo: "يرجى إنشاء شركة أولًا لاستخدام كشف الحالات الشاذة.",
    aiAnomalyDetection: "كشف الحالات الشاذة بالذكاء الاصطناعي",
    automaticallyScanTransactionsForIrregularitiesAn:
      "افحص المعاملات تلقائيًا بحثًا عن المخالفات والمشكلات المحتملة",
    lastScanned: "آخر فحص: {value}",
    scanning: "جارٍ الفحص...",
    runScan: "تشغيل الفحص",
    totalAnomalies: "إجمالي الحالات الشاذة",
    filter: "تصفية",
    allSeverities: "جميع المستويات",
    clearFilter: "مسح التصفية",
    dismiss: "تجاهل",
    noAnomaliesFound: "لم يتم العثور على حالات شاذة",
    noAnomaliesDetectedTryChangingThe:
      "لم يتم اكتشاف حالات شاذة بمستوى {severityFilter}. جرّب تغيير عامل التصفية.",
    yourTransactionsLookCleanNoIrregularities:
      "تبدو معاملاتك سليمة. لم يتم اكتشاف أي مخالفات في آخر فحص.",
  }
);
