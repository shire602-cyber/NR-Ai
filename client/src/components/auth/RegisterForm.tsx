import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { Link } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { apiUrl } from "@/lib/api";
import { OAuthButtons } from "./OAuthButtons";
import { AUTH_BUTTON, AUTH_INPUT, AuthAlert, AuthHeader, AuthSwitch } from "./AuthBlocks";

// TRN is optional at sign-up — many users register before they have one — but
// when supplied it must match the FTA's 15-digit format so the company record
// isn't seeded with a malformed value that breaks VAT filing later.
const registerSchema = z.object({
  name: z.string().min(2, "components.validation.nameMin2"),
  email: z.string().email("components.validation.emailInvalid"),
  password: z.string().min(8, "components.validation.passwordMin8"),
  trn: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[0-9]{15}$/.test(v), "forms.errors.uaeTrn15Digits"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSuccess: (user: any) => void | Promise<void>;
  /** W5-E: Turnstile token when the server requires CAPTCHA. */
  captchaToken?: string | null;
  /** The CAPTCHA widget, rendered just above the submit button. */
  captcha?: ReactNode;
}

export function RegisterForm({ onSuccess, captchaToken, captcha }: RegisterFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      trn: "",
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      // Strip empty optional TRN so the server-side schema doesn't see a
      // sentinel empty string and reject it on the regex check.
      const payload = {
        ...data,
        trn: data.trn?.trim() ? data.trn.trim() : undefined,
        // Localised default so the onboarding heading is not an English "X's Company".
        companyName: formatMessage(t["onboarding.defaultCompanyName"], { name: data.name.trim() }),
        ...(captchaToken ? { captchaToken } : {}),
      };
      const response = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.message || translateNow("shell.toastPleaseTryAgain"));
      }
      const registered = await response.json().catch(() => null);
      // Platform-level flag: with no email provider no confirmation email exists to check.
      const noEmail = registered?.emailDelivery === "unavailable";

      // W5-E (R17-14): registration never returns a session, so a new and an existing
      // address look the same. Sign in with the password just chosen; if that fails the
      // address already had an account and the generic "check your email" note stands.
      const login = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      if (!login.ok) {
        await onSuccess(null); // the page shows the generic "check your inbox" note
        return;
      }
      const result = await login.json();
      await onSuccess(result.user);

      toast({
        title: translateNow("shell.toastAccountCreated"),
        description: noEmail ? t["security.registerNoEmail"] : t["security.registerCheckEmail"],
      });
    } catch (failure: any) {
      // Spec 3.2: errors are inline above the form.
      setError(failure?.message || translateNow("shell.toastPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      <AuthHeader
        title={t["components.authStartBooks"]}
        description={t["components.authRegisterDescription"]}
      />
      {error ? (
        <AuthAlert
          tone="danger"
          title={translateNow("shell.toastRegistrationFailed")}
          testId="register-error"
        >
          {error}
        </AuthAlert>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t.name}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="name"
                    placeholder={t["components.authNamePlaceholder"]}
                    className={AUTH_INPUT}
                    disabled={isLoading}
                    data-testid="input-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                    disabled={isLoading}
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
                <FormLabel>{t.password}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className={AUTH_INPUT}
                    disabled={isLoading}
                    data-testid="input-password"
                  />
                </FormControl>
                <FormDescription>{t["components.authPasswordHint"]}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="trn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t["components.authUaeTrn"]}{" "}
                  <span className="font-normal text-muted-foreground">
                    {t["components.authOptional"]}
                  </span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode="numeric"
                    dir="ltr"
                    maxLength={15}
                    placeholder="100123456700003"
                    className={`${AUTH_INPUT} text-start tabular-nums`}
                    disabled={isLoading}
                    data-testid="input-trn"
                  />
                </FormControl>
                <FormDescription>{t["marketing.authTrnHelp"]}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {captcha}
          <Button
            type="submit"
            className={AUTH_BUTTON}
            disabled={isLoading}
            data-testid="button-register"
          >
            {isLoading ? t.loading : t["marketing.authCreateAccount"]}
          </Button>
          <p className="text-caption text-muted-foreground" data-testid="text-trial-claim">
            {t["marketing.trialClaim"]}
          </p>
        </form>
      </Form>
      <div className="mt-6">
        <OAuthButtons />
      </div>
      <AuthSwitch>
        {t.alreadyHaveAccount}{" "}
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center font-medium text-accent hover:underline md:min-h-0"
          data-testid="link-login"
        >
          {t["marketing.authSignIn"]}
        </Link>
      </AuthSwitch>
    </div>
  );
}
