import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ListPager",
  {
    range: "Showing {from} to {to} of {total}",
    previous: "Previous",
    next: "Next",
    perPage: "Per page",
    pageOf: "Page {page} of {pages}",
    capped: "Only the latest {cap} are loaded.",
  },
  {
    range: "عرض {from} إلى {to} من {total}",
    previous: "السابق",
    next: "التالي",
    perPage: "في الصفحة",
    pageOf: "صفحة {page} من {pages}",
    capped: "تُحمَّل أحدث {cap} فقط.",
  }
);
