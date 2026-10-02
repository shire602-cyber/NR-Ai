import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "PdfAiFallbackSetting",
  {
    title: "Read scanned PDF statements with AI",
    off: "Off",
    on: "On",
    description: "Off by default. Text PDFs are read without AI. When this is on and a PDF has no readable text, its pages (up to {pages}) are sent to the AI provider, which is paid per call. You still review every row before anything is imported.",
    notConfigured: "The AI provider is not configured on this server, so turning this on has no effect yet.",
    saved: "Setting saved",
    saveFailed: "The setting could not be saved",
  },
  {
    title: "قراءة كشوف PDF الممسوحة ضوئيًا بالذكاء الاصطناعي",
    off: "متوقف",
    on: "مفعّل",
    description: "متوقف افتراضيًا. تُقرأ ملفات PDF النصية دون ذكاء اصطناعي. عند تفعيله، وإذا لم يحتوِ الملف على نص مقروء، تُرسل صفحاته (حتى {pages}) إلى مزوّد الذكاء الاصطناعي، وهو مدفوع لكل استدعاء. تراجع كل صف بنفسك قبل استيراد أي شيء.",
    notConfigured: "مزوّد الذكاء الاصطناعي غير مُهيّأ على هذا الخادم، لذا لن يكون للتفعيل أثر بعد.",
    saved: "تم حفظ الإعداد",
    saveFailed: "تعذّر حفظ الإعداد",
  }
);
