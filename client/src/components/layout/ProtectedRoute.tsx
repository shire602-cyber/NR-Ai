import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useCurrentUser } from '@/hooks/useCurrentUser';

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

  if (isLoading || !user) {
    return null;
  }

  return <>{children}</>;
}
