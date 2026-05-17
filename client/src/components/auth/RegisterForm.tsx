import { useEffect, useState } from "react";
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
import { withCsrfHeader } from "@/lib/csrf";
import { UserPlus } from "lucide-react";

// TRN is optional at sign-up — many users register before they have one — but
// when supplied it must match the FTA's 15-digit format so the company record
// isn't seeded with a malformed value that breaks VAT filing later.
const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  trn: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^[0-9]{15}$/.test(v), "UAE TRN must be exactly 15 digits"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

type InvitationDetails = {
  email: string;
  role: string;
  userType: string;
  company: { id: string; name: string } | null;
};

interface RegisterFormProps {
  onSuccess: (user: any) => void | Promise<void>;
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const inviteToken =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("invite");
  const [isVerifyingInvite, setIsVerifyingInvite] = useState(() => Boolean(inviteToken));

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      trn: "",
    },
  });

  useEffect(() => {
    if (!inviteToken) return;

    let cancelled = false;

    fetch(apiUrl(`/api/invitations/verify/${encodeURIComponent(inviteToken)}`), {
      credentials: "include",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.message || "Invitation link is invalid or has expired");
        }
        return body as InvitationDetails;
      })
      .then((details) => {
        if (cancelled) return;
        setInvitation(details);
        setInviteError(null);
        form.setValue("email", details.email);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setInvitation(null);
        setInviteError(error?.message || "Invitation link is invalid or has expired");
      })
      .finally(() => {
        if (!cancelled) setIsVerifyingInvite(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form, inviteToken]);

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      // Strip empty optional TRN so the server-side schema doesn't see a
      // sentinel empty string and reject it on the regex check.
      const isInvitationSignup = Boolean(inviteToken && invitation && !inviteError);
      const payload = isInvitationSignup
        ? { name: data.name, password: data.password }
        : {
            ...data,
            trn: data.trn?.trim() ? data.trn.trim() : undefined,
          };
      const headers = isInvitationSignup
        ? await withCsrfHeader("POST", { "Content-Type": "application/json" })
        : { "Content-Type": "application/json" };
      const endpoint = isInvitationSignup
        ? `/api/invitations/accept/${encodeURIComponent(inviteToken!)}`
        : "/api/auth/register";

      const response = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers,
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
        title: isInvitationSignup ? "Invitation accepted!" : "Account created!",
        description: isInvitationSignup
          ? "Your account is ready."
          : "Welcome to AI Bookkeeping. Let's get started!",
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
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-semibold">
          {inviteToken ? "Accept invitation" : t.register}
        </CardTitle>
        <CardDescription>
          {inviteToken
            ? invitation?.company
              ? `Create your account for ${invitation.company.name}`
              : "Create your invited account"
            : "Create your account to start managing your books"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {inviteError ? (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {inviteError}
          </div>
        ) : null}
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
                      disabled={isLoading || Boolean(inviteToken)}
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
                  <FormDescription>Use at least 8 characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!inviteToken ? (
              <FormField
                control={form.control}
                name="trn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      UAE TRN <span className="text-muted-foreground font-normal">(optional)</span>
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
                    <FormDescription>
                      Your 15-digit FTA Tax Registration Number. You can add this later from the
                      company profile.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || isVerifyingInvite || Boolean(inviteError)}
              data-testid="button-register"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              {isLoading || isVerifyingInvite
                ? t.loading
                : inviteToken
                  ? "Accept invitation"
                  : t.signUp}
            </Button>
          </form>
        </Form>
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
