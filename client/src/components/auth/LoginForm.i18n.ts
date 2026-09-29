import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "LoginForm",
  {
    pleaseEnterAValidEmail: "Please enter a valid email",
    passwordMustBeAtLeast6: "Password must be at least 6 characters",
    welcomeBack: "Welcome back!",
    youHaveSuccessfullyLoggedIn: "You have successfully logged in.",
    loginFailed: "Login failed",
    pleaseCheckYourCredentialsAndTry: "Please check your credentials and try again.",
    welcomeBack2: "Welcome back",
    enterYourCredentialsToAccessYour: "Enter your credentials to access your account",
    forgotPassword: "Forgot password?",
    tryAgainInS: "Try again in {cooldownSeconds}s",
    tooManyFailedAttemptsForThis:
      "Too many failed attempts for this email. Try again in {cooldownSeconds} seconds.",
  },
  {
    pleaseEnterAValidEmail: "يرجى إدخال بريد إلكتروني صالح",
    passwordMustBeAtLeast6: "يجب ألا تقل كلمة المرور عن 6 أحرف",
    welcomeBack: "مرحبًا بعودتك!",
    youHaveSuccessfullyLoggedIn: "تم تسجيل الدخول بنجاح.",
    loginFailed: "فشل تسجيل الدخول",
    pleaseCheckYourCredentialsAndTry: "يرجى التحقق من بيانات الدخول والمحاولة مرة أخرى.",
    welcomeBack2: "مرحبًا بعودتك",
    enterYourCredentialsToAccessYour: "أدخل بيانات الدخول للوصول إلى حسابك",
    forgotPassword: "هل نسيت كلمة المرور؟",
    tryAgainInS: "حاول مجددًا بعد {cooldownSeconds} ثانية",
    tooManyFailedAttemptsForThis:
      "محاولات فاشلة كثيرة لهذا البريد الإلكتروني. حاول مجددًا بعد {cooldownSeconds} ثانية.",
  }
);
