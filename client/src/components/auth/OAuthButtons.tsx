import { Button } from '@/components/ui/button';
import { apiUrl } from '@/lib/api';
import { useEffect,useState } from 'react';
import { FaMicrosoft } from 'react-icons/fa';
import { FcGoogle } from 'react-icons/fc';

type OAuthProvider = 'google' | 'microsoft';
type OAuthProviderInfo = {
  id: OAuthProvider;
  label: string;
  configured: boolean;
};

const PROVIDER_ICONS = {
  google: FcGoogle,
  microsoft: FaMicrosoft,
} as const;

const PROVIDER_ICON_CLASS = {
  google: 'h-4 w-4',
  microsoft: 'h-4 w-4 text-[#00a4ef]',
} as const;

function safeNextPath(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next?.startsWith('/') && !next.startsWith('//')) return next;
  return '/dashboard';
}

export function OAuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl('/api/auth/oauth/providers'), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return [];
        const body = await response.json();
        if (!Array.isArray(body?.providers)) return [];
        return body.providers.filter(
          (provider: Partial<OAuthProviderInfo>) =>
            (provider.id === 'google' || provider.id === 'microsoft') && provider.configured === true,
        ) as OAuthProviderInfo[];
      })
      .then((configuredProviders) => {
        if (!cancelled) setProviders(configuredProviders);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const startOAuth = (provider: OAuthProvider) => {
    setPendingProvider(provider);
    const next = encodeURIComponent(safeNextPath());
    window.location.assign(apiUrl(`/api/auth/oauth/${provider}/start?next=${next}`));
  };

  if (providers.length === 0) return null;

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
        {providers.map((provider) => {
          const Icon = PROVIDER_ICONS[provider.id];
          return (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={pendingProvider !== null}
              onClick={() => startOAuth(provider.id)}
              data-testid={`button-oauth-${provider.id}`}
            >
              <Icon className={PROVIDER_ICON_CLASS[provider.id]} />
              {provider.label}
            </Button>
          );
        })}
      </div>
      {pendingProvider && (
        <p className="text-center text-xs text-muted-foreground" role="status">
          Redirecting to {pendingProvider === 'google' ? 'Google' : 'Microsoft'}...
        </p>
      )}
    </div>
  );
}
