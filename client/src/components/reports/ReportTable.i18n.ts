import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ReportTable",
  {
    noRows: "No rows for these choices.",
    total: "Total",
    openRecord: "Open {name}",
    loadMore: "Load more rows",
    loadingMore: "Loading...",
    showing: "Showing {shown} of {total} rows",
    notAvailable: "n/a",
  },
  {
    noRows: "لا توجد صفوف لهذه الخيارات.",
    total: "الإجمالي",
    openRecord: "فتح {name}",
    loadMore: "تحميل المزيد من الصفوف",
    loadingMore: "جارٍ التحميل...",
    showing: "عرض {shown} من {total} صفًا",
    notAvailable: "غير متاح",
  }
);
