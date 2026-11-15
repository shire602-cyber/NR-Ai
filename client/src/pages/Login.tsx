import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

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

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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

  const handleSuccess = async (user: any) => {
    const currentUser = await establishAuthenticatedSession(user);
    const fallback =
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard";
    const next = safeNextPath();
    setLocation(next === "/dashboard" ? fallback : next);
  };

  return (
    <AuthLayout
      headline={
        <>
          Your books,{" "}
          <span className="italic" style={{ color: "#C19E50" }}>
            beautifully
          </span>{" "}
          kept.
        </>
      }
      subline="Sign back in to a real-time portrait of your revenue, expenses, and filings — every number where you left it."
    >
      <div className="w-full max-w-md">
        <LoginForm onSuccess={handleSuccess} />
        <SsoStatusNote />
      </div>
    </AuthLayout>
  );
}
