import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { FaMicrosoft } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { apiUrl } from '@/lib/api';

type OAuthProvider = 'google' | 'microsoft';

function safeNextPath(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next?.startsWith('/') && !next.startsWith('//')) return next;
  return '/dashboard';
}

export function OAuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);

  const startOAuth = (provider: OAuthProvider) => {
    setPendingProvider(provider);
    const next = encodeURIComponent(safeNextPath());
    window.location.assign(apiUrl(`/api/auth/oauth/${provider}/start?next=${next}`));
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={pendingProvider !== null}
          onClick={() => startOAuth('google')}
          data-testid="button-oauth-google"
        >
          <FcGoogle className="h-4 w-4" />
          Google
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={pendingProvider !== null}
          onClick={() => startOAuth('microsoft')}
          data-testid="button-oauth-microsoft"
        >
          <FaMicrosoft className="h-4 w-4 text-[#00a4ef]" />
          Microsoft
        </Button>
      </div>
      {pendingProvider && (
        <p className="text-center text-xs text-muted-foreground" role="status">
          Redirecting to {pendingProvider === 'google' ? 'Google' : 'Microsoft'}...
        </p>
      )}
    </div>
  );
}
