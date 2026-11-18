import { useEffect, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { apiUrl } from "@/lib/api";
import { serverErrorMessage } from "@/lib/validation-messages";
import { OAuthButtons } from "./OAuthButtons";
import { AUTH_BUTTON, AUTH_INPUT, AuthAlert, AuthHeader, AuthSwitch } from "./AuthBlocks";

const loginSchema = z.object({
  email: z.string().email("components.validation.emailInvalid"),
  password: z.string().min(6, "components.validation.passwordMin6"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  /** W5-E: `result` is the full login body (it may be an MFA challenge without a user). */
  onSuccess: (user: any, result?: Record<string, unknown>) => void | Promise<void>;
  /** A page-level error to show inline above the form (e.g. a failed social sign-in). */
  notice?: { title: string; body: string } | null;
}

function currentEpochMs(): number {
  if (typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin)) {
    return Math.round(performance.timeOrigin + performance.now());
  }
  return new Date().getTime();
}

export function LoginForm({ onSuccess, notice }: LoginFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!cooldownUntil) return;

    const update = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - currentEpochMs()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const isCoolingDown = cooldownSeconds > 0;

  const onSubmit = async (data: LoginFormData) => {
    if (isCoolingDown) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) {
          const retryAfter = Number(
            error?.details?.retryAfterSeconds ?? response.headers.get("Retry-After") ?? 60
          );
          const seconds =
            Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60;
          setCooldownUntil(currentEpochMs() + seconds * 1000);
          setCooldownSeconds(seconds);
        }
        const failure = new Error(
          error?.code === "INVALID_CREDENTIALS"
            ? t["components.authInvalidCredentials"]
            : serverErrorMessage(error, t["components.authLoginFailed"])
        );
        throw failure;
      }

      const result = await response.json();
      await onSuccess(result.user, result);
      if (result?.mfaRequired) return; // the page asks for the second factor

      toast({
        title: translateNow("shell.toastWelcomeBack"),
        description: translateNow("shell.toastYouHaveSuccessfullyLoggedIn"),
      });
    } catch (failure: any) {
      // Spec 3.2: wrong credentials appear inline above the form, not as a corner toast.
      setError(failure?.message || t["components.authInvalidCredentials"]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      <AuthHeader
        title={t["components.authWelcomeBack"]}
        description={t["components.authLoginDescription"]}
      />
      {error ? (
        <AuthAlert tone="danger" title={t["components.authLoginFailed"]} testId="login-error">
          {error}
        </AuthAlert>
      ) : notice ? (
        <AuthAlert tone="danger" title={notice.title} testId="login-notice">
          {notice.body}
        </AuthAlert>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.email}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={AUTH_INPUT}
                    disabled={isLoading || isCoolingDown}
                    data-testid="input-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel>{t.password}</FormLabel>
                  <Link
                    href="/forgot-password"
                    className="inline-flex min-h-11 items-center text-small font-medium text-accent hover:underline md:min-h-0"
                    data-testid="link-forgot-password"
                  >
                    {t["components.authForgotPassword"]}
                  </Link>
                </div>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={AUTH_INPUT}
                    disabled={isLoading || isCoolingDown}
                    data-testid="input-password"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className={AUTH_BUTTON}
            disabled={isLoading || isCoolingDown}
            data-testid="button-login"
          >
            {isLoading
              ? t.loading
              : isCoolingDown
                ? formatMessage(t["marketing.authTryAgainIn"], { seconds: cooldownSeconds })
                : t["marketing.authSignIn"]}
          </Button>
          {isCoolingDown && (
            <p className="text-small text-muted-foreground" role="status">
              {formatMessage(t["marketing.authCooldown"], { seconds: cooldownSeconds })}
            </p>
          )}
        </form>
      </Form>
      <div className="mt-6">
        <OAuthButtons />
      </div>
      <AuthSwitch>
        {t.dontHaveAccount}{" "}
        <Link
          href="/register"
          className="inline-flex min-h-11 items-center font-medium text-accent hover:underline md:min-h-0"
          data-testid="link-register"
        >
          {t["marketing.authCreateAccount"]}
        </Link>
      </AuthSwitch>
    </div>
  );
}
