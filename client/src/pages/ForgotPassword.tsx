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
import { ArrowLeft, Briefcase, CheckCircle2, Mail } from "lucide-react";
import { messages as pageMessages } from "./ForgotPassword.i18n";
import { LanguageToggle } from "@/components/LanguageToggle";

const forgotSchema = z.object({
  email: z.string().email(pageMessages.marker("pleaseEnterAValidEmail")),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

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
        body: JSON.stringify(data),
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
        title: tr("couldNotSendResetLink"),
        description: error?.message || tr("pleaseTryAgainInAMoment"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <LanguageToggle floating />
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 start-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[128px] animate-pulse" />
        <div
          className="absolute bottom-0 end-1/4 w-[500px] h-[500px] bg-chart-5/10 rounded-full blur-[128px] animate-pulse"
          style={{ animationDelay: "1s" }}
        />
      </div>

      <div className="absolute top-8 start-8">
        <Link href="/login">
          <Button variant="ghost" className="gap-2" data-testid="button-back-login">
            <ArrowLeft className="w-4 h-4" />
            {tr("backToSignIn")}
          </Button>
        </Link>
      </div>

      <div className="absolute top-8 end-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">Muhasib.ai</span>
        </Link>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-semibold">{tr("forgotPassword")}</CardTitle>
          <CardDescription>{tr("enterTheEmailAssociatedWithYour")}</CardDescription>
        </CardHeader>

        <CardContent>
          {submitted ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-success-subtle border border-success/30 ">
                <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-success-subtle-foreground ">
                    {tr("checkYourInbox")}
                  </p>
                  <p className="text-success mt-0.5">{tr("ifThatEmailIsRegisteredA")}</p>
                </div>
              </div>
              {devResetUrl && (
                <div className="text-xs text-muted-foreground p-3 border rounded-md break-all">
                  <p className="font-medium mb-1 text-foreground">{tr("devModeOpenThisLinkTo")}</p>
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
                      <FormLabel>{tr("email")}</FormLabel>
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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-send-reset"
                >
                  <Mail className="w-4 h-4 me-2" />
                  {isLoading ? tr("sending") : tr("sendResetLink")}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-muted-foreground text-center">
            {tr("rememberedYourPassword")}
            <Link href="/login" className="text-primary hover:underline font-medium">
              {tr("signIn")}
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
