import { useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { LoginForm } from '@/components/auth/LoginForm';
import { fetchCurrentUser } from '@/lib/auth';
import { establishAuthenticatedSession } from '@/lib/authSession';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Briefcase } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      {/* Background Effect */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Back to Home Link */}
      <div className="absolute top-8 left-8">
        <Link href="/">
          <Button variant="ghost" className="gap-2" data-testid="button-back-home">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Button>
        </Link>
      </div>

      {/* Logo/Brand at top */}
      <div className="absolute top-8 right-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg">Muhasib.ai</span>
        </Link>
      </div>

      <LoginForm onSuccess={handleSuccess} />
    </div>
  );
}
