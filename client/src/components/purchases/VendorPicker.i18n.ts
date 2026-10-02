import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "VendorPicker",
  {
    placeholder: "Choose a vendor",
    search: "Search vendors by name, TRN or email",
    none: "No vendor matches.",
    create: "Create vendor \"{name}\"",
    creating: "Creating...",
    created: "Vendor created",
    createFailed: "Could not create the vendor",
    trn: "TRN {trn}",
    both: "Customer and vendor",
    loadFailed: "Vendors could not be loaded. You can still type a name.",
  },
  {
    placeholder: "اختر مورداً",
    search: "ابحث عن الموردين بالاسم أو الرقم الضريبي أو البريد",
    none: "لا يوجد مورد مطابق.",
    create: "إنشاء مورد \"{name}\"",
    creating: "جارٍ الإنشاء...",
    created: "تم إنشاء المورد",
    createFailed: "تعذر إنشاء المورد",
    trn: "الرقم الضريبي {trn}",
    both: "عميل ومورد",
    loadFailed: "تعذر تحميل الموردين. يمكنك كتابة الاسم مع ذلك.",
  }
);
