import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "VendorCreditStockDialog",
  {
    title: "Stock movement of credit note {number}",
    description: "Goods returned to the supplier leave stock when the credit note is approved, and come back if it is voided.",
    colItem: "Item",
    colDate: "Date",
    colQuantity: "Quantity",
    colValue: "Value (AED)",
    colReference: "Reference",
    colOnHand: "On hand now",
    none: "No stock item is on this credit note, so no stock moved.",
    draftNote: "This credit note is still a draft. Stock moves when it is approved.",
    loading: "Loading...",
    loadFailed: "The stock movement could not be loaded.",
    close: "Close",
  },
  {
    title: "حركة المخزون للإشعار الدائن {number}",
    description: "تخرج البضاعة المرتجعة إلى المورّد من المخزون عند اعتماد الإشعار الدائن، وتعود إليه إذا أُبطل.",
    colItem: "الصنف",
    colDate: "التاريخ",
    colQuantity: "الكمية",
    colValue: "القيمة (بالدرهم)",
    colReference: "المرجع",
    colOnHand: "المتوفر الآن",
    none: "لا يوجد صنف مخزني في هذا الإشعار الدائن، لذلك لم يتحرك المخزون.",
    draftNote: "هذا الإشعار الدائن ما زال مسودة. يتحرك المخزون عند اعتماده.",
    loading: "جارٍ التحميل...",
    loadFailed: "تعذر تحميل حركة المخزون.",
    close: "إغلاق",
  }
);
