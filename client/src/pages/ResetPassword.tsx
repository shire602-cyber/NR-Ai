import { T } from "@/components/layout/T";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
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
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type ResetFormData = z.infer<typeof resetSchema>;

function getTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export default function ResetPassword() {
  const { locale, t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const token = useMemo(() => getTokenFromUrl(), []);

  const form = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!token) {
      toast({
        variant: "destructive",
        title: "Invalid reset link",
        description: "This link is missing its token. Request a new one.",
      });
    }
  }, [token, toast]);

  const onSubmit = async (data: ResetFormData) => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Could not reset password");
      }
      setDone(true);
      toast({
        title: "Password reset",
        description: "You can now sign in with your new password.",
      });
      // Redirect to login after a brief moment so the user sees confirmation.
      setTimeout(() => setLocation("/login"), 1500);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t["marketing.resetErrorTitle"],
        description: error?.message || t["marketing.resetErrorBody"],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout variant="reset">
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
            <T k="pageLabels.setANewPassword" />
          </CardTitle>
          <CardDescription>{t["marketing.resetDescription"]}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-success-subtle border border-success/30 ">
              <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-success-subtle-foreground ">
                  <T k="pageLabels.passwordReset" />
                </p>
                <p className="text-success mt-0.5">{t["marketing.resetRedirecting"]}</p>
                <p className="text-muted-foreground mt-1" data-testid="text-sessions-revoked">
                  {locale === "ar" ? RESET_COPY.signedOut.ar : RESET_COPY.signedOut.en}
                </p>
              </div>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  className="w-full"
                  disabled={isLoading || !token}
                  data-testid="button-reset-password"
                >
                  <KeyRound className="w-4 h-4 me-2" aria-hidden="true" />
                  {isLoading ? t["marketing.resetSubmitting"] : t["marketing.resetSubmit"]}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-muted-foreground text-center">
            {t["marketing.resetNeedLink"]}{" "}
            <Link href="/forgot-password" className="text-primary hover:underline font-medium">
              <T k="pageLabels.startOver" />
            </Link>
          </div>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
