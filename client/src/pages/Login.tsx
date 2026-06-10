import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { LoginForm } from '@/components/auth/LoginForm';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { fetchCurrentUser } from '@/lib/auth';
import { establishAuthenticatedSession } from '@/lib/authSession';
import { useToast } from '@/hooks/use-toast';

function safeNextPath(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/dashboard';
  }

  try {
    const parsed = new URL(next, 'https://muhasib.local');
    if (parsed.origin !== 'https://muhasib.local') return '/dashboard';
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (path === '/login' || path === '/register' || path === '/forgot-password' || path.startsWith('/reset-password')) {
      return '/dashboard';
    }
    return path;
  } catch {
    return '/dashboard';
  }
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_error') === '1') {
      toast({
        title: 'Login failed',
        description: 'We could not complete social login. Please try again.',
        variant: 'destructive',
      });
      window.history.replaceState({}, '', '/login');
    }

    fetchCurrentUser()
      .then((user) => {
        if (user) {
          const fallback = user.userType === 'client_portal' ? '/client-portal/dashboard' : '/dashboard';
          const next = safeNextPath();
          setLocation(next === '/dashboard' ? fallback : next);
        }
      })
      .catch(() => {});
  }, [setLocation, toast]);

  const handleSuccess = async (user: any) => {
    const currentUser = await establishAuthenticatedSession(user);
    const fallback = currentUser?.userType === 'client_portal' ? '/client-portal/dashboard' : '/dashboard';
    const next = safeNextPath();
    setLocation(next === '/dashboard' ? fallback : next);
  };

  return (
    <AuthLayout
      headline={
        <>
          Your books,{' '}
          <span className="italic" style={{ color: '#C19E50' }}>
            beautifully
          </span>{' '}
          kept.
        </>
      }
      subline="Sign back in to a real-time portrait of your revenue, expenses, and filings — every number where you left it."
    >
      <LoginForm onSuccess={handleSuccess} />
    </AuthLayout>
  );
}
