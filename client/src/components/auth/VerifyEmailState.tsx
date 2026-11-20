import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, MailCheck, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { fetchCurrentUser } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { AuthAlert, AuthState } from "./AuthBlocks";

type VerifyState = "working" | "done" | "failed";

/** W5-E: consumes /verify-email?token=… links. */
function useEmailVerificationLink(): VerifyState {
  const [state, setState] = useState<VerifyState>(() =>
    new URLSearchParams(window.location.search).get("token") ? "working" : "failed"
  );
  useEffect(() => {
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

/**
 * /verify-email (spec 3.2): its own states instead of the sign-in form with a note on top.
 * Checking · confirmed · invalid or expired (with "Send a new link" when signed in).
 */
export function VerifyEmailState() {
  const { t } = useTranslation();
  const state = useEmailVerificationLink();
  const [signedIn, setSignedIn] = useState(false);
  const [resent, setResent] = useState<"idle" | "busy" | "sent" | "error">("idle");

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => setSignedIn(!!u))
      .catch(() => undefined);
  }, []);

  if (state === "working") {
    return (
      <p
        className="flex items-center gap-3 text-small text-muted-foreground"
        role="status"
        data-testid="text-verify-email"
      >
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {t["security.verifyEmailWorking"]}
      </p>
    );
  }

  if (state === "done") {
    return (
      <AuthState
        icon={MailCheck}
        tone="success"
        testId="text-verify-email"
        title={t["marketing.authVerifyDoneTitle"]}
        body={t["security.verifyEmailDone"]}
        actions={
          <Button asChild className="h-11">
            <Link href={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? t["marketing.authOpenDashboard"] : t["marketing.authSignIn"]}
            </Link>
          </Button>
        }
      />
    );
  }

  const resend = async () => {
    setResent("busy");
    try {
      await apiRequest("POST", "/api/auth/verify-email/resend", {});
      setResent("sent");
    } catch {
      setResent("error");
    }
  };

  return (
    <div>
      {resent === "sent" ? (
        <AuthAlert tone="success">{t["marketing.authVerifyResent"]}</AuthAlert>
      ) : resent === "error" ? (
        <AuthAlert tone="danger">{t["marketing.authVerifyResendFailed"]}</AuthAlert>
      ) : null}
      <AuthState
        icon={MailX}
        testId="text-verify-email"
        title={t["marketing.authVerifyFailedTitle"]}
        body={t["marketing.authVerifyFailedBody"]}
        actions={
          signedIn ? (
            <Button
              className="h-11"
              onClick={resend}
              disabled={resent === "busy" || resent === "sent"}
              data-testid="button-verify-resend"
            >
              {t["marketing.authVerifyResend"]}
            </Button>
          ) : (
            <Button asChild className="h-11">
              <Link href="/login" data-testid="button-verify-sign-in">
                {t["marketing.authSignIn"]}
              </Link>
            </Button>
          )
        }
      />
    </div>
  );
}
