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
import { formatMessage, loadNamespaces, useI18n, useTranslation, translateNow } from "@/lib/i18n";
import { apiUrl } from "@/lib/api";
import { serverErrorMessage, VALIDATION_NAMESPACES } from "@/lib/validation-messages";
import { OAuthButtons } from "./OAuthButtons";
import { AUTH_BUTTON, AUTH_INPUT, AuthAlert, AuthHeader, AuthSwitch } from "./AuthBlocks";
import { oauthNextForPlan, type SignupPlanSource } from "./signup-plan";
import { ArrowLeft } from "lucide-react";
import { formatMoneyText } from "@/lib/format-money";
import {
  planNameKey,
  planPrice,
  PLANS,
  type BillingCycle,
  type PlanId,
} from "@/components/marketing/plans";

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
  /** STEP4: the plan chosen on step 1; sent with the sign-up and carried through OAuth. */
  plan?: { planId: PlanId; cycle: BillingCycle; source: SignupPlanSource };
  /** STEP4: back to the plan step. */
  onChangePlan?: () => void;
}

/**
 * E3 (J2-r3 High): namespaces this form reads beyond the public /register set: the onboarding
 * default company name and the validation / server-error copy. Declared so an in-page language
 * switch fetches them too (it used to leave `onboarding` unloaded and registration threw).
 */
const REGISTER_FORM_NAMESPACES = ["onboarding", ...VALIDATION_NAMESPACES] as const;

/** "{name}'s Company" in the active language, loading its namespace first if needed. */
async function defaultCompanyName(name: string): Promise<string> {
  await loadNamespaces(useI18n.getState().locale, REGISTER_FORM_NAMESPACES).catch(() => undefined);
  const key = "onboarding.defaultCompanyName";
  const template = translateNow(key);
  return template === key ? name : formatMessage(template, { name });
}

export function RegisterForm({
  onSuccess,
  captchaToken,
  captcha,
  plan,
  onChangePlan,
}: RegisterFormProps) {
  const { t, locale } = useTranslation(REGISTER_FORM_NAMESPACES);
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
        companyName: await defaultCompanyName(data.name.trim()),
        ...(captchaToken ? { captchaToken } : {}),
        ...(plan ? { plan: plan.planId, billingCycle: plan.cycle, planSource: plan.source } : {}),
      };
      const response = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(serverErrorMessage(error, translateNow("shell.toastPleaseTryAgain")));
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
      {plan ? (
        <div className="mb-6">
          <button
            type="button"
            onClick={onChangePlan}
            className="-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-small font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="button-back-to-plans"
          >
            <ArrowLeft className="mk-flip h-4 w-4" aria-hidden="true" />
            {t["marketing.signupBackToPlans"]}
          </button>
          <p className="mt-1 text-caption text-muted-foreground" data-testid="signup-step-caption">
            {formatMessage(t["marketing.signupStep"], { n: 2 })}
          </p>
        </div>
      ) : null}
      <AuthHeader
        title={t["components.authStartBooks"]}
        description={t["components.authRegisterDescription"]}
      />
      {plan ? (
        <div
          className="mb-6 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border px-4 py-2"
          data-testid="signup-plan-summary"
        >
          <p className="min-w-0 text-small">
            <span className="block text-caption text-muted-foreground">
              {t["marketing.signupPlanAfterTrial"]}
            </span>
            <strong className="font-semibold text-foreground">{t[planNameKey(plan.planId)]}</strong>{" "}
            <span aria-hidden="true">·</span>{" "}
            <span className="text-muted-foreground">
              {formatMessage(
                t[
                  plan.cycle === "yearly"
                    ? "marketing.signupPricePerYear"
                    : "marketing.signupPricePerMonth"
                ],
                {
                  amount: formatMoneyText(
                    planPrice(PLANS.find((p) => p.id === plan.planId)!, plan.cycle),
                    "AED",
                    locale,
                    { fractionDigits: 0 }
                  ),
                }
              )}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 flex-none"
            onClick={onChangePlan}
            data-testid="button-change-plan"
          >
            {t["marketing.signupChange"]}
          </Button>
        </div>
      ) : null}
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
        <OAuthButtons nextPath={plan ? oauthNextForPlan(plan) : undefined} />
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
