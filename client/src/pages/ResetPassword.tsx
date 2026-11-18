import { T } from "@/components/layout/T";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { apiUrl } from "@/lib/api";
import { serverErrorMessage, VALIDATION_NAMESPACES } from "@/lib/validation-messages";
import { ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AuthAlert,
  AuthHeader,
  AuthSwitch,
} from "@/components/auth/AuthBlocks";
import { useTranslation } from "@/lib/i18n";

/** R01-06: a reset signs out every device that was signed in before it. */
const RESET_COPY = {
  signedOut: {
    en: "For your security, every device that was signed in to your account has been signed out.",
    ar: "لحماية حسابك، تم تسجيل الخروج من جميع الأجهزة التي كانت متصلة بحسابك.",
  },
};

const resetSchema = z
  .object({
    password: z.string().min(8, "components.validation.passwordMin8"),
    confirmPassword: z.string().min(1, "components.validation.confirmPasswordRequired"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "components.validation.passwordsMismatch",
  });

type ResetFormData = z.infer<typeof resetSchema>;

function getTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export default function ResetPassword() {
  const { locale, t } = useTranslation(VALIDATION_NAMESPACES);
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useMemo(() => getTokenFromUrl(), []);

  const form = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: ResetFormData) => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(serverErrorMessage(err, t["marketing.resetErrorBody"]));
      }
      setDone(true);
      // Redirect to login after a brief moment so the user sees confirmation.
      setTimeout(() => setLocation("/login"), 1500);
    } catch (failure: any) {
      setError(failure?.message || t["marketing.resetErrorBody"]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout variant="reset">
      <Link
        href="/login"
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-small font-medium text-muted-foreground hover:text-foreground md:min-h-0"
        data-testid="button-back-login"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        <T k="pages.backToSignIn" />
      </Link>
      <AuthHeader
        title={<T k="pageLabels.setANewPassword" />}
        description={t["marketing.resetDescription"]}
      />
      {!token ? (
        <AuthAlert tone="danger" title={t["shell.toastInvalidResetLink"]}>
          {t["shell.toastThisLinkIsMissingItsTokenRequest"]}
        </AuthAlert>
      ) : error ? (
        <AuthAlert tone="danger" title={t["marketing.resetErrorTitle"]}>
          {error}
        </AuthAlert>
      ) : null}
      {done ? (
        <AuthAlert tone="success" title={<T k="pageLabels.passwordReset" />}>
          <p>{t["marketing.resetRedirecting"]}</p>
          <p className="mt-1 text-muted-foreground" data-testid="text-sessions-revoked">
            {locale === "ar" ? RESET_COPY.signedOut.ar : RESET_COPY.signedOut.en}
          </p>
        </AuthAlert>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <T k="pageLabels.newPassword" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={AUTH_INPUT}
                      disabled={isLoading || !token}
                      data-testid="input-password"
                    />
                  </FormControl>
                  <FormDescription>{t["marketing.resetHint"]}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <T k="pageLabels.confirmNewPassword" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={AUTH_INPUT}
                      disabled={isLoading || !token}
                      data-testid="input-confirm-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className={AUTH_BUTTON}
              disabled={isLoading || !token}
              data-testid="button-reset-password"
            >
              {isLoading ? t["marketing.resetSubmitting"] : t["marketing.resetSubmit"]}
            </Button>
          </form>
        </Form>
      )}
      <AuthSwitch>
        {t["marketing.resetNeedLink"]}{" "}
        <Link href="/forgot-password" className="font-medium text-accent hover:underline">
          <T k="pageLabels.startOver" />
        </Link>
      </AuthSwitch>
    </AuthLayout>
  );
}
