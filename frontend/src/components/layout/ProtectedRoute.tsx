import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { isAuthenticated } from '@/lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated()) {
      setLocation('/login');
    }
  }, [setLocation]);

  if (!isAuthenticated()) {
    return null;
  }

  return <>{children}</>;
}
