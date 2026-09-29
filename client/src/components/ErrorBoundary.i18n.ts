import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ErrorBoundary",
  {
    somethingWentWrong: "Something went wrong",
    anUnexpectedErrorOccurredYouCan:
      "An unexpected error occurred. You can try again or return to the dashboard.",
    dashboard: "Dashboard",
    tryAgain: "Try Again",
    couldnTLoad: "{name} couldn't load",
    thisSectionCouldnTLoad: "This section couldn't load",
    weVeBeenNotifiedYouCan:
      "We've been notified. You can retry, or continue using the rest of the app.",
    retry: "Retry",
  },
  {
    somethingWentWrong: "حدث خطأ ما",
    anUnexpectedErrorOccurredYouCan:
      "حدث خطأ غير متوقع. يمكنك المحاولة مرة أخرى أو العودة إلى لوحة التحكم.",
    dashboard: "لوحة التحكم",
    tryAgain: "حاول مرة أخرى",
    couldnTLoad: "تعذّر تحميل {name}",
    thisSectionCouldnTLoad: "تعذّر تحميل هذا القسم",
    weVeBeenNotifiedYouCan:
      "تم إخطارنا بالمشكلة. يمكنك إعادة المحاولة أو متابعة استخدام بقية التطبيق.",
    retry: "إعادة المحاولة",
  }
);
