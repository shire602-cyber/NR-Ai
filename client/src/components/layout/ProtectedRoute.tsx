import { useEffect } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTranslation } from "@/lib/i18n";

interface ProtectedRouteProps {
  children: React.ReactNode;
  replaceOnLoginRedirect?: boolean;
}

export function ProtectedRoute({ children, replaceOnLoginRedirect = false }: ProtectedRouteProps) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useCurrentUser();
  const { t } = useTranslation();
  // A portal customer never uses the company app: their home is the portal (STEP5, G1e).
  const isPortalUser = user?.userType === "client_portal";
  useEffect(() => {
    if (isPortalUser) setLocation("/client-portal/dashboard");
  }, [isPortalUser, setLocation]);

  // Only a definitive "not authenticated" (the session endpoint answered and
  // said so) sends the user to login. Transient failures — rate limiting,
  // network blips, 5xx — must never eject an active session.
  useEffect(() => {
    if (!isLoading && !isError && !user) {
      const next = `${window.location.pathname}${window.location.search}`;
      const safeNext =
        next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
          ? next
          : "/dashboard";
      const target = `/login?next=${encodeURIComponent(safeNext)}`;
      setLocation(target, { replace: replaceOnLoginRedirect });
      if (`${window.location.pathname}${window.location.search}` !== target) {
        window.location.replace(target);
      }
    }
  }, [isLoading, isError, user, setLocation, replaceOnLoginRedirect]);

  if (isPortalUser) return null;
  if (user) return <>{children}</>;

  if (isError) {
    // Session check hit a transient failure; react-query is retrying.
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
        {t["shell.reconnecting"]}
      </div>
    );
  }

  return null;
}
