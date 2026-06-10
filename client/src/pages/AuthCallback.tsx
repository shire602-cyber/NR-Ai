import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { currentUserQueryKey } from '@/hooks/useCurrentUser';
import { fetchCurrentUser } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/dashboard';
  }
  try {
    const parsed = new URL(value, 'https://muhasib.local');
    if (parsed.origin !== 'https://muhasib.local') return '/dashboard';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard';
  }
}

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedNext = safeNextPath(params.get('next'));
        const user = await fetchCurrentUser();
        if (!user) throw new Error('Session was not established');

        queryClient.setQueryData(currentUserQueryKey, user);
        await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });

        if (cancelled) return;
        const fallback = user.userType === 'client_portal' ? '/client-portal/dashboard' : '/dashboard';
        setLocation(requestedNext === '/dashboard' ? fallback : requestedNext);
      } catch {
        if (cancelled) return;
        toast({
          variant: 'destructive',
          title: 'Login failed',
          description: 'We could not complete social login. Please try again.',
        });
        setLocation('/login?oauth_error=1');
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [setLocation, toast]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Completing secure login...
      </div>
    </div>
  );
}
