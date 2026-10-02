import { useEffect } from "react";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { useToast } from "@/hooks/use-toast";
import { messages as pageMessages } from "./Login.i18n";

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
  const tr = pageMessages.useT();

  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_error") === "1") {
      toast({
        title: tr("loginFailed"),
        description: tr("weCouldNotCompleteSocialLogin"),
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

  const startAtTwoFactor = new URLSearchParams(window.location.search).get("step") === "2fa";

  const handleSuccess = async (user: any, extra?: { twoFactorEnrolmentRequired: boolean }) => {
    const currentUser = await establishAuthenticatedSession(user);
    // A company requires 2FA from this user and they have none yet: go set it up first.
    if (extra?.twoFactorEnrolmentRequired) {
      setLocation("/settings/security?required=1");
      return;
    }
    const fallback =
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard";
    const next = safeNextPath();
    setLocation(next === "/dashboard" ? fallback : next);
  };

  return (
    <AuthLayout
      headline={
        <>
          {tr("yourBooks")}
          <span className="italic" style={{ color: "#C19E50" }}>
            {tr("beautifully")}
          </span>{" "}
          {tr("kept")}
        </>
      }
      subline={tr("signBackInToAReal")}
    >
      <LoginForm onSuccess={handleSuccess} startAtTwoFactor={startAtTwoFactor} />
    </AuthLayout>
  );
}
