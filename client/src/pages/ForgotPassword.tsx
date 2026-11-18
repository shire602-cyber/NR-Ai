import { T } from "@/components/layout/T";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { apiUrl } from "@/lib/api";
import { serverErrorMessage } from "@/lib/validation-messages";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AuthAlert,
  AuthHeader,
  AuthSwitch,
} from "@/components/auth/AuthBlocks";
import { UPGRADE_CONTACT_EMAIL } from "@shared/trial";
import { formatMessage, useTranslation } from "@/lib/i18n";

const forgotSchema = z.object({
  email: z.string().email("components.validation.emailInvalid"),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const form = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captchaToken ? { ...data, captchaToken } : data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(serverErrorMessage(err, t["marketing.forgotErrorBody"]));
      }
      const body = await res.json();
      // Server returns devResetUrl outside of production so QA can verify
      // the flow without a wired-up email service.
      if (body?.devResetUrl) setDevResetUrl(body.devResetUrl);
      // Spec 3.2: one customer sentence whatever the delivery set-up; it never claims a link
      // was sent and never mentions how email is delivered.
      setSubmitted(true);
    } catch (failure: any) {
      setError(failure?.message || t["marketing.forgotErrorBody"]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout variant="forgot">
      <Link
        href="/login"
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-small font-medium text-muted-foreground hover:text-foreground md:min-h-0"
        data-testid="button-back-login"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        <T k="pages.backToSignIn" />
      </Link>
      <AuthHeader
        title={<T k="pageLabels.forgotPassword" />}
        description={t["marketing.forgotDescription"]}
      />
      {error ? (
        <AuthAlert tone="danger" title={t["marketing.forgotErrorTitle"]}>
          {error}
        </AuthAlert>
      ) : null}
      {submitted ? (
        <div data-testid="text-forgot-result">
          <AuthAlert tone="info" title={t["marketing.forgotDoneTitle"]}>
            {formatMessage(t["marketing.forgotDoneBody"], { email: UPGRADE_CONTACT_EMAIL })}
          </AuthAlert>
          {devResetUrl && (
            <div className="break-all rounded-lg border border-border p-3 text-caption text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">{t["marketing.forgotDevLink"]}</p>
              <a href={devResetUrl} className="text-accent underline" data-testid="link-dev-reset">
                {devResetUrl}
              </a>
            </div>
          )}
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <T k="pages.email" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={AUTH_INPUT}
                      disabled={isLoading}
                      data-testid="input-email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <TurnstileWidget onToken={setCaptchaToken} />
            <Button
              type="submit"
              className={AUTH_BUTTON}
              disabled={isLoading}
              data-testid="button-send-reset"
            >
              {isLoading ? t["marketing.forgotSending"] : t["marketing.forgotSubmit"]}
            </Button>
          </form>
        </Form>
      )}
      <AuthSwitch>
        {t["marketing.forgotRemembered"]}{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t["marketing.authSignIn"]}
        </Link>
      </AuthSwitch>
    </AuthLayout>
  );
}
