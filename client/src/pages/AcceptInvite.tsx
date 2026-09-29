import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { apiUrl } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { establishAuthenticatedSession } from "@/lib/authSession";

interface InvitationInfo {
  email: string;
  userType: string;
  company: { id: string; name: string } | null;
}

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/** Public page opened from the emailed invitation link (client-portal invites). */
export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { locale } = useI18n();
  const en = locale === "en";
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/invitations/verify/${encodeURIComponent(token ?? "")}`))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            body?.message ||
              (en ? "This invitation is not valid." : "هذه الدعوة غير صالحة.")
          );
          return;
        }
        setInfo(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError(en ? "Could not load the invitation." : "تعذر تحميل الدعوة.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, en]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError(en ? "Please enter your name." : "يرجى إدخال اسمك.");
      return;
    }
    if (!PASSWORD_RULE.test(password)) {
      setFormError(
        en
          ? "Use at least 8 characters with an uppercase letter, a lowercase letter and a number."
          : "استخدم 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم."
      );
      return;
    }
    if (password !== confirm) {
      setFormError(en ? "Passwords do not match." : "كلمتا المرور غير متطابقتين.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRequest("POST", `/api/invitations/accept/${encodeURIComponent(token ?? "")}`, {
        name: name.trim(),
        password,
      });
      await establishAuthenticatedSession(result.user);
      setLocation(result.user?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard");
    } catch (err: any) {
      setFormError(err?.message || (en ? "Could not accept the invitation." : "تعذر قبول الدعوة."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background p-4"
      dir={en ? "ltr" : "rtl"}
    >
      <Card className="w-full max-w-md" data-testid="accept-invite-card">
        <CardHeader>
          <CardTitle className="text-2xl">
            {en ? "Join your client portal" : "انضم إلى بوابة العميل"}
          </CardTitle>
          <CardDescription>
            {info
              ? en
                ? `You have been invited to ${info.company?.name ?? "the client portal"}.`
                : `تمت دعوتك إلى ${info.company?.name ?? "بوابة العميل"}.`
              : en
                ? "Checking your invitation…"
                : "جارٍ التحقق من دعوتك…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p className="text-sm text-destructive" role="alert" data-testid="accept-invite-error">
              {loadError}{" "}
              {en
                ? "Ask your accountant to send a new invitation."
                : "اطلب من محاسبك إرسال دعوة جديدة."}
            </p>
          ) : info ? (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">{en ? "Email" : "البريد الإلكتروني"}</Label>
                <Input id="invite-email" value={info.email} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">{en ? "Your name" : "اسمك"}</Label>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  data-testid="input-invite-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-password">{en ? "Password" : "كلمة المرور"}</Label>
                <Input
                  id="invite-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  data-testid="input-invite-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-confirm">
                  {en ? "Confirm password" : "تأكيد كلمة المرور"}
                </Label>
                <Input
                  id="invite-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  data-testid="input-invite-confirm"
                />
              </div>
              {formError && (
                <p className="text-sm text-destructive" role="alert" data-testid="accept-invite-form-error">
                  {formError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting} data-testid="button-accept-invite">
                {submitting
                  ? en
                    ? "Creating your account…"
                    : "جارٍ إنشاء حسابك…"
                  : en
                    ? "Accept invitation"
                    : "قبول الدعوة"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {en ? "One moment…" : "لحظة من فضلك…"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
