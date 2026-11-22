import { useEffect, useState, type FormEvent } from "react";
import { landingPathFor } from "@/lib/app-landing";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { serverErrorMessage, VALIDATION_NAMESPACES } from "@/lib/validation-messages";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTH_BUTTON, AUTH_INPUT, AuthAlert, AuthHeader } from "@/components/auth/AuthBlocks";
import { VerifyEmailState } from "@/components/auth/VerifyEmailState";
import { BANK_STATEMENT_ENTRY } from "@shared/bank-statement-routes";
import { toAsciiDigits } from "@shared/arabic-text";

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
  const { t } = useTranslation(VALIDATION_NAMESPACES);
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
      if (!res.ok) throw new Error(serverErrorMessage(body, t["security.error"]));
      await onDone(body.user, body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="mfa-challenge">
      <AuthHeader title={t["security.loginMfaTitle"]} description={t["security.loginMfaHelp"]} />
      {error && <AuthAlert tone="danger">{error}</AuthAlert>}
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="mfa-code">{t["security.mfaCode"]}</Label>
          <Input
            id="mfa-code"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            className={AUTH_INPUT}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="input-mfa-code"
          />
        </div>
        <Button type="submit" className={AUTH_BUTTON} disabled={busy || code.trim().length < 6}>
          {t["security.verify"]}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          {t["security.loginMfaBack"]}
        </Button>
      </form>
    </div>
  );
}

function isVerifyEmailPath(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/verify-email";
}

function MicrosoftMailboxChallenge({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation(VALIDATION_NAMESPACES);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !/^[0-9]{8}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await apiRequest("POST", "/api/auth/oauth/microsoft/verify-mailbox", {
        code,
      });
      window.location.assign(redirectTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t["security.error"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="microsoft-mailbox-challenge">
      <AuthHeader
        title={t["security.loginMicrosoftMailboxTitle"]}
        description={t["security.loginMicrosoftMailboxHelp"]}
      />
      {error && <AuthAlert tone="danger">{error}</AuthAlert>}
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="microsoft-mailbox-code">{t["security.loginMicrosoftMailboxCode"]}</Label>
          <Input
            id="microsoft-mailbox-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            dir="ltr"
            maxLength={8}
            autoFocus
            className={AUTH_INPUT}
            value={code}
            onChange={(event) => setCode(toAsciiDigits(event.target.value).replace(/\D/g, ""))}
            data-testid="input-microsoft-mailbox-code"
          />
        </div>
        <Button type="submit" className={AUTH_BUTTON} disabled={busy || code.length !== 8}>
          {t["security.verify"]}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          {t["security.loginMfaBack"]}
        </Button>
      </form>
    </div>
  );
}

export default function Login() {
  if (isVerifyEmailPath()) {
    return (
      <AuthLayout variant="login">
        <VerifyEmailState />
      </AuthLayout>
    );
  }
  return <SignIn />;
}

function SignIn() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  // Spec 3.2: a failed social sign-in is an inline alert above the form, not a toast.
  const [oauthFailed] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("oauth_error") === "1"
  );
  const [mfa, setMfa] = useState<{ token: string | null } | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mfa") === "1"
      ? { token: null }
      : null
  );
  const [microsoftMailbox, setMicrosoftMailbox] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("microsoft_mailbox") === "1"
  );

  useEffect(() => {
    if (microsoftMailbox) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error") === "1") {
      params.delete("oauth_error");
      window.history.replaceState({}, "", params.size ? `/login?${params}` : "/login");
    }

    fetchCurrentUser()
      .then((user) => {
        if (user) {
          const fallback = landingPathFor(user);
          const next = safeNextPath();
          setLocation(next === "/dashboard" ? fallback : next, {
            replace: next === BANK_STATEMENT_ENTRY,
          });
        }
      })
      .catch(() => {});
  }, [microsoftMailbox, setLocation]);

  const handleSuccess = async (user: any, result?: Record<string, unknown>) => {
    if (result?.mfaRequired) {
      setMfa({ token: typeof result.mfaToken === "string" ? result.mfaToken : null });
      return;
    }
    const currentUser = await establishAuthenticatedSession(user);
    const fallback = landingPathFor(currentUser);
    const next = result?.mfaEnrollmentRequired ? "/settings/security" : safeNextPath();
    setLocation(next === "/dashboard" ? fallback : next, {
      replace: next === BANK_STATEMENT_ENTRY,
    });
  };

  return (
    <AuthLayout variant="login">
      {microsoftMailbox ? (
        <MicrosoftMailboxChallenge
          onBack={() => {
            window.history.replaceState({}, "", "/login");
            setMicrosoftMailbox(false);
          }}
        />
      ) : mfa ? (
        <MfaChallenge
          mfaToken={mfa.token}
          onDone={(user, body) => handleSuccess(user, { ...body, mfaRequired: false })}
          onBack={() => setMfa(null)}
        />
      ) : (
        <LoginForm
          onSuccess={handleSuccess}
          notice={
            oauthFailed
              ? {
                  title: t["marketing.authOauthFailedTitle"],
                  body: t["marketing.authOauthFailedBody"],
                }
              : null
          }
        />
      )}
    </AuthLayout>
  );
}
