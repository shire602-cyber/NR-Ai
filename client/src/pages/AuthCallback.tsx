import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { currentUserQueryKey } from "@/hooks/useCurrentUser";
import { probeCurrentUser } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { landingPathFor } from "@/lib/app-landing";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthState } from "@/components/auth/AuthBlocks";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/dashboard";
  }
  try {
    const parsed = new URL(value, "https://muhasib.local");
    if (parsed.origin !== "https://muhasib.local") return "/dashboard";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}

/**
 * OAuth return page. Success hands over to the app; a failure is its own state on the auth
 * layout (spec 3.2: "We could not sign you in", the reason, "Back to sign in"), never a toast.
 */
export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedNext = safeNextPath(params.get("next"));
        const user = await probeCurrentUser();
        if (!user) throw new Error("Session was not established");

        queryClient.setQueryData(currentUserQueryKey, user);
        await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });

        if (cancelled) return;
        const fallback = landingPathFor(user);
        setLocation(requestedNext === "/dashboard" ? fallback : requestedNext);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [setLocation]);

  return (
    <AuthLayout variant="login">
      {failed ? (
        <AuthState
          icon={ShieldAlert}
          tone="danger"
          testId="auth-callback-failed"
          title={t["marketing.authCallbackFailedTitle"]}
          body={t["marketing.authCallbackFailedBody"]}
          actions={
            <Button asChild className="h-11">
              <Link href="/login" data-testid="button-callback-sign-in">
                {t["marketing.authBackToSignIn"]}
              </Link>
            </Button>
          }
        />
      ) : (
        <p
          className="flex items-center gap-3 text-small text-muted-foreground"
          role="status"
          data-testid="auth-callback-working"
        >
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {t["pageLabels.completingSecureLogin"]}
        </p>
      )}
    </AuthLayout>
  );
}
