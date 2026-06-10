import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useCurrentUser();

  // Only a definitive "not authenticated" (the session endpoint answered and
  // said so) sends the user to login. Transient failures — rate limiting,
  // network blips, 5xx — must never eject an active session.
  useEffect(() => {
    if (!isLoading && !isError && !user) {
      const next = `${window.location.pathname}${window.location.search}`;
      const safeNext = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
        ? next
        : '/dashboard';
      const target = `/login?next=${encodeURIComponent(safeNext)}`;
      setLocation(target);
      if (`${window.location.pathname}${window.location.search}` !== target) {
        window.location.replace(target);
      }
    }
  }, [isLoading, isError, user, setLocation]);

  if (user) return <>{children}</>;

  if (isError) {
    // Session check hit a transient failure; react-query is retrying.
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
        Reconnecting…
      </div>
    );
  }

  return null;
}
