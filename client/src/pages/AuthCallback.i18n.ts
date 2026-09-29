import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "AuthCallback",
  {
    loginFailed: "Login failed",
    weCouldNotCompleteSocialLogin: "We could not complete social login. Please try again.",
    completingSecureLogin: "Completing secure login...",
  },
  {
    loginFailed: "فشل تسجيل الدخول",
    weCouldNotCompleteSocialLogin:
      "تعذّر إكمال تسجيل الدخول عبر الحساب الاجتماعي. يرجى المحاولة مرة أخرى.",
    completingSecureLogin: "جارٍ إكمال تسجيل الدخول الآمن...",
  }
);
