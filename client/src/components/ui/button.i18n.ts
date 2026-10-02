import { defineMessages } from "@/lib/i18n-messages";

/** Names for icon-only buttons shared by several pages. Use `iconLabels.t("edit")` in an aria-label. */
export const messages = defineMessages(
  "IconLabels",
  {
    edit: "Edit",
    delete: "Delete",
    remove: "Remove",
    back: "Back",
    refresh: "Refresh",
    markAsRead: "Mark as read",
    dismiss: "Dismiss",
  },
  {
    edit: "تعديل",
    delete: "حذف",
    remove: "إزالة",
    back: "رجوع",
    refresh: "تحديث",
    markAsRead: "تحديد كمقروء",
    dismiss: "إخفاء",
  }
);
