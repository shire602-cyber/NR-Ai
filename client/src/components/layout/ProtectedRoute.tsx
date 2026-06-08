import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation } from 'wouter';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && !user) {
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
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking your session...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">Redirecting to sign in...</div>
      </div>
    );
  }

  return <>{children}</>;
}
