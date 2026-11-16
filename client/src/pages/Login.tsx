import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SsoStatus {
  providers: Array<{ id: string; label: string; configured: boolean }>;
  saml: { status: string; implemented: boolean };
}

/** R01-15: honest SSO availability, from GET /api/auth/sso/status. */
const SSO_COPY = {
  samlUnavailable: {
    en: "Enterprise SSO (SAML) is not available yet: it needs your identity provider's metadata. Contact support to set it up.",
    ar: "الدخول الموحد للمؤسسات (SAML) غير متاح بعد: يتطلب بيانات مزود الهوية لديكم. تواصل مع الدعم لإعداده.",
  },
  noSocial: {
    en: "Google and Microsoft sign-in are not configured on this server.",
    ar: "تسجيل الدخول عبر Google وMicrosoft غير مُعد على هذا الخادم.",
  },
};

function SsoStatusNote() {
  const { locale } = useTranslation();
  const [status, setStatus] = useState<SsoStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/auth/sso/status"), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setStatus(body))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!status) return null;
  const pick = (b: { en: string; ar: string }) => (locale === "ar" ? b.ar : b.en);
  const anySocial = status.providers.some((p) => p.configured);
  return (
    <div className="mt-4 space-y-1 text-xs text-muted-foreground" data-testid="sso-status">
      {!anySocial && <p>{pick(SSO_COPY.noSocial)}</p>}
      {!status.saml.implemented && <p>{pick(SSO_COPY.samlUnavailable)}</p>}
    </div>
  );
}

function safeNextPath(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(next, "https://muhasib.local");
    if (parsed.origin !== "https://muhasib.local") return "/dashboard";
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      path === "/login" ||
      path === "/register" ||
      path === "/forgot-password" ||
      path.startsWith("/reset-password")
    ) {
      return "/dashboard";
    }
    return path;
  } catch {
    return "/dashboard";
  }
}

/** W5-E: second sign-in step (TOTP or recovery code). */
function MfaChallenge({
  mfaToken,
  onDone,
  onBack,
}: {
  mfaToken: string | null;
  onDone(user: unknown, body: Record<string, unknown>): Promise<void>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/auth/mfa/verify-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...(mfaToken ? { mfaToken } : {}), code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || t["security.error"]);
      await onDone(body.user, body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="w-full max-w-md border-border/60 shadow-xl" data-testid="mfa-challenge">
      <CardHeader>
        <CardTitle>{t["security.loginMfaTitle"]}</CardTitle>
        <CardDescription>{t["security.loginMfaHelp"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Label htmlFor="mfa-code">{t["security.mfaCode"]}</Label>
          <Input
            id="mfa-code"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="input-mfa-code"
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.trim().length < 6}>
              {t["security.verify"]}
            </Button>
            <Button type="button" variant="ghost" onClick={onBack}>
              {t["security.loginMfaBack"]}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** W5-E: consumes /verify-email?token=… links. */
function useEmailVerificationLink(): "idle" | "working" | "done" | "failed" {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">(() => {
    if (typeof window === "undefined" || window.location.pathname !== "/verify-email") {
      return "idle";
    }
    return new URLSearchParams(window.location.search).get("token") ? "working" : "failed";
  });
  useEffect(() => {
    if (window.location.pathname !== "/verify-email") return;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    fetch(apiUrl("/api/auth/verify-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "done" : "failed"))
      .catch(() => setState("failed"));
  }, []);
  return state;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const verification = useEmailVerificationLink();
  const [mfa, setMfa] = useState<{ token: string | null } | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mfa") === "1"
      ? { token: null }
      : null
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error") === "1") {
      toast({
        title: "Login failed",
        description: "We could not complete social login. Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/login");
    }

    fetchCurrentUser()
      .then((user) => {
        if (user) {
          const fallback =
            user.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard";
          const next = safeNextPath();
          setLocation(next === "/dashboard" ? fallback : next);
        }
      })
      .catch(() => {});
  }, [setLocation, toast]);

  const handleSuccess = async (user: any, result?: Record<string, unknown>) => {
    if (result?.mfaRequired) {
      setMfa({ token: typeof result.mfaToken === "string" ? result.mfaToken : null });
      return;
    }
    const currentUser = await establishAuthenticatedSession(user);
    const fallback =
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard";
    const next = result?.mfaEnrollmentRequired ? "/settings/security" : safeNextPath();
    setLocation(next === "/dashboard" ? fallback : next);
  };

  return (
    <AuthLayout variant="login">
      <div className="w-full max-w-md">
        {verification !== "idle" && (
          <p
            className="mb-4 rounded-md border p-3 text-sm"
            role="status"
            data-testid="text-verify-email"
          >
            {verification === "working"
              ? t["security.verifyEmailWorking"]
              : verification === "done"
                ? t["security.verifyEmailDone"]
                : t["security.verifyEmailFailed"]}
          </p>
        )}
        {mfa ? (
          <MfaChallenge
            mfaToken={mfa.token}
            onDone={(user, body) => handleSuccess(user, { ...body, mfaRequired: false })}
            onBack={() => setMfa(null)}
          />
        ) : (
          <LoginForm onSuccess={handleSuccess} />
        )}
        <SsoStatusNote />
      </div>
    </AuthLayout>
  );
}
