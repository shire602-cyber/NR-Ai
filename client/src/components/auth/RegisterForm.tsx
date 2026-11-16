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
import { useTranslation } from "@/lib/i18n";
import { apiUrl } from "@/lib/api";
import { UserPlus } from "lucide-react";
import { OAuthButtons } from "./OAuthButtons";

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
}

export function RegisterForm({ onSuccess, captchaToken }: RegisterFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

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
    try {
      // Strip empty optional TRN so the server-side schema doesn't see a
      // sentinel empty string and reject it on the regex check.
      const payload = {
        ...data,
        trn: data.trn?.trim() ? data.trn.trim() : undefined,
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
        throw new Error(error?.message || "Registration failed");
      }
      await response.json().catch(() => null);

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
        title: "Account created!",
        description: t["security.registerCheckEmail"],
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: error?.message || "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/60 shadow-xl">
      <CardHeader className="space-y-1.5">
        <CardTitle className="font-display text-[30px] font-normal leading-none tracking-tight">
          {t["components.authStartBooks"]}
          <span className="text-accent">.</span>
        </CardTitle>
        <CardDescription>{t["components.authRegisterDescription"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.name}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="John Doe"
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
                      placeholder="you@example.com"
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
                      placeholder="••••••••"
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
                    <span className="text-muted-foreground font-normal">
                      {t["components.authOptional"]}
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      maxLength={15}
                      placeholder="100123456700003"
                      disabled={isLoading}
                      data-testid="input-trn"
                    />
                  </FormControl>
                  <FormDescription>{t["components.authTrnHelp"]}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="button-register"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              {isLoading ? t.loading : t.signUp}
            </Button>
          </form>
        </Form>
        <div className="mt-4">
          <OAuthButtons />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="text-sm text-muted-foreground text-center">
          {t.alreadyHaveAccount}{" "}
          <Link
            href="/login"
            className="text-primary hover:underline font-medium"
            data-testid="link-login"
          >
            {t.signIn}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
