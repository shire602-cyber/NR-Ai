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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { useTranslation } from "@/lib/i18n";

const forgotSchema = z.object({
  email: z.string().email("components.validation.emailInvalid"),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const form = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotFormData) => {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captchaToken ? { ...data, captchaToken } : data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Could not start password reset");
      }
      const body = await res.json();
      // Server returns devResetUrl outside of production so QA can verify
      // the flow without a wired-up email service.
      if (body?.devResetUrl) setDevResetUrl(body.devResetUrl);
      setSubmitted(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t["marketing.forgotErrorTitle"],
        description: error?.message || t["marketing.forgotErrorBody"],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout variant="forgot">
      <Link
        href="/login"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        data-testid="button-back-login"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        <T k="pages.backToSignIn" />
      </Link>
      <Card className="w-full">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-semibold">
            <T k="pageLabels.forgotPassword" />
          </CardTitle>
          <CardDescription>{t["marketing.forgotDescription"]}</CardDescription>
        </CardHeader>

        <CardContent>
          {submitted ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-success-subtle border border-success/30 ">
                <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-success-subtle-foreground ">
                    <T k="pageLabels.checkYourInbox" />
                  </p>
                  <p className="text-success mt-0.5">{t["marketing.forgotSent"]}</p>
                </div>
              </div>
              {devResetUrl && (
                <div className="text-xs text-muted-foreground p-3 border rounded-md break-all">
                  <p className="font-medium mb-1 text-foreground">{t["marketing.forgotDevLink"]}</p>
                  <a
                    href={devResetUrl}
                    className="text-primary underline"
                    data-testid="link-dev-reset"
                  >
                    {devResetUrl}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-send-reset"
                >
                  <Mail className="w-4 h-4 me-2" aria-hidden="true" />
                  {isLoading ? t["marketing.forgotSending"] : t["marketing.forgotSubmit"]}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-muted-foreground text-center">
            {t["marketing.forgotRemembered"]}{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              <T k="portal.signIn" />
            </Link>
          </div>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
