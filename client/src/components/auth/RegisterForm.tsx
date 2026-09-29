import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { messages as pageMessages } from "./RegisterForm.i18n";

// TRN is optional at sign-up — many users register before they have one — but
// when supplied it must match the FTA's 15-digit format so the company record
// isn't seeded with a malformed value that breaks VAT filing later.
const registerSchema = z.object({
  name: z.string().min(2, pageMessages.marker("nameMustBeAtLeast2")),
  email: z.string().email(pageMessages.marker("pleaseEnterAValidEmail")),
  password: z.string().min(8, pageMessages.marker("passwordMustBeAtLeast8")),
  trn: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[0-9]{15}$/.test(v), pageMessages.marker("uaeTrnMustBeExactly15")),
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSuccess: (user: any) => void | Promise<void>;
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const tr = pageMessages.useT();

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

      const result = await response.json();
      await onSuccess(result.user);

      toast({
        title: tr("accountCreated"),
        description: tr("welcomeToAiBookkeepingLetS"),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("registrationFailed"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/60 shadow-xl">
      <CardHeader className="space-y-1.5">
        <CardTitle className="font-display text-[30px] font-normal leading-none tracking-tight">
          {tr("startYourBooks")}
          <span className="text-accent">.</span>
        </CardTitle>
        <CardDescription>{tr("createYourAccountToStartManaging")}</CardDescription>
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
                      placeholder={tr("johnDoe")}
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
                  <FormDescription>{tr("useAtLeast8Characters")}</FormDescription>
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
                    {tr("uaeTrn")}{" "}
                    <span className="text-muted-foreground font-normal">{tr("optional")}</span>
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
                  <FormDescription>{tr("your15DigitFtaTaxRegistration")}</FormDescription>
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
              <UserPlus className="w-4 h-4 me-2" />
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
