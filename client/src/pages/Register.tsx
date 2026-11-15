import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMPANY_ROLE_LABELS, type CompanyRole } from "@shared/permissions";

type Bilingual = { en: string; ar: string };

const COPY = {
  checkInbox: {
    en: "If this email can be used, your account is ready. If you already have an account, sign in instead or reset your password.",
    ar: "إذا كان يمكن استخدام هذا البريد فحسابك جاهز. إذا كان لديك حساب بالفعل، سجّل الدخول أو أعد تعيين كلمة المرور.",
  },
  inviteTitle: { en: "Join your team", ar: "انضم إلى فريقك" },
  inviteBody: { en: "You were invited to join", ar: "تمت دعوتك للانضمام إلى" },
  asRole: { en: "as", ar: "بدور" },
  name: { en: "Your name", ar: "اسمك" },
  password: { en: "Choose a password", ar: "اختر كلمة مرور" },
  passwordHint: {
    en: "8+ characters with upper and lower case and a digit; common passwords are refused.",
    ar: "8 أحرف أو أكثر مع أحرف كبيرة وصغيرة ورقم؛ تُرفض كلمات المرور الشائعة.",
  },
  accept: { en: "Accept invitation", ar: "قبول الدعوة" },
  signInFirst: {
    en: "An account already exists for this email. Sign in with it, then open this invitation link again.",
    ar: "يوجد حساب لهذا البريد. سجّل الدخول به ثم افتح رابط الدعوة مرة أخرى.",
  },
  signIn: { en: "Sign in", ar: "تسجيل الدخول" },
  invalid: {
    en: "This invitation is no longer valid. Ask the person who invited you to resend it.",
    ar: "هذه الدعوة لم تعد صالحة. اطلب من الشخص الذي دعاك إعادة إرسالها.",
  },
} satisfies Record<string, Bilingual>;

interface InvitationPreview {
  email: string;
  role: CompanyRole;
  company: { id: string; name: string } | null;
  accountExists: boolean;
}

function TeamInviteAccept({ token }: { token: string }) {
  const { locale } = useTranslation();
  const tr = (b: Bilingual) => (locale === "ar" ? b.ar : b.en);
  const [, setLocation] = useLocation();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(apiUrl(`/api/team-invitations/${encodeURIComponent(token)}`), { credentials: "include" })
      .then(async (r) => (r.ok ? setPreview(await r.json()) : setInvalid(true)))
      .catch(() => setInvalid(true));
    fetchCurrentUser()
      .then((u) => setSignedIn(!!u))
      .catch(() => undefined);
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest(
        "POST",
        `/api/team-invitations/${encodeURIComponent(token)}/accept`,
        preview?.accountExists ? {} : { name, password }
      );
      if (result?.user) await establishAuthenticatedSession(result.user);
      setLocation("/dashboard");
    } catch (err) {
      setError((err as Error)?.message ?? null);
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-sm" data-testid="text-invite-invalid">
          {tr(COPY.invalid)}
        </CardContent>
      </Card>
    );
  }
  if (!preview) return null;
  const roleLabel = tr(COMPANY_ROLE_LABELS[preview.role] ?? COMPANY_ROLE_LABELS.employee);
  const needsSignIn = preview.accountExists && !signedIn;

  return (
    <Card className="w-full max-w-md" data-testid="card-team-invite">
      <CardHeader>
        <CardTitle>{tr(COPY.inviteTitle)}</CardTitle>
        <CardDescription>
          {tr(COPY.inviteBody)} {preview.company?.name} {tr(COPY.asRole)} {roleLabel} (
          {preview.email})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {needsSignIn ? (
          <>
            <p className="text-sm">{tr(COPY.signInFirst)}</p>
            <Button onClick={() => setLocation("/login")} data-testid="button-invite-sign-in">
              {tr(COPY.signIn)}
            </Button>
          </>
        ) : (
          <>
            {!preview.accountExists && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="invite-name">{tr(COPY.name)}</Label>
                  <Input
                    id="invite-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-invite-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password">{tr(COPY.password)}</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="input-invite-password"
                  />
                  <p className="text-xs text-muted-foreground">{tr(COPY.passwordHint)}</p>
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              onClick={accept}
              disabled={busy || (!preview.accountExists && (!name || !password))}
              data-testid="button-accept-invite"
            >
              {tr(COPY.accept)}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Register() {
  const [, setLocation] = useLocation();
  const { locale } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const teamInvite =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("teamInvite")
      : null;

  useEffect(() => {
    if (teamInvite) return;
    fetchCurrentUser()
      .then((user) => {
        if (user)
          setLocation(
            user.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
          );
      })
      .catch(() => {});
  }, [setLocation, teamInvite]);

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const handleSuccess = async (user: any) => {
    // R17-14: an email that is already registered gets a generic answer with
    // no session; tell the person what to do instead of failing silently.
    if (!user) {
      setNotice(locale === "ar" ? COPY.checkInbox.ar : COPY.checkInbox.en);
      return;
    }
    const currentUser = await establishAuthenticatedSession(user);
    setLocation(
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
    );
  };

  return (
    <AuthLayout
      headline={
        <>
          The ledger,{" "}
          <span className="italic" style={{ color: "#C19E50" }}>
            handled
          </span>
          .
        </>
      }
      subline="Snap a receipt, forward an invoice, or import a bank line; Muhasib turns daily accounting into VAT-ready records from day one."
    >
      {teamInvite ? (
        <TeamInviteAccept token={teamInvite} />
      ) : (
        <div className="w-full max-w-md">
          {notice && (
            <p
              className="mb-4 rounded-md border p-3 text-sm"
              role="status"
              data-testid="text-register-notice"
            >
              {notice}
            </p>
          )}
          <TurnstileWidget onToken={setCaptchaToken} />
          <RegisterForm onSuccess={handleSuccess} captchaToken={captchaToken} />
        </div>
      )}
    </AuthLayout>
  );
}
