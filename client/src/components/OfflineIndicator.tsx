import { useEffect, useState } from 'react';
import { Wifi, WifiOff, CloudOff } from 'lucide-react';
import { isOnline, onConnectivityChange } from '@/lib/pwa';
import { cn } from '@/lib/utils';

interface OfflineIndicatorProps {
  className?: string;
  /** When true, also shows a brief flash when reconnecting. */
  showReconnect?: boolean;
}

/**
 * Compact connectivity indicator. Renders nothing when online unless we just
 * came back from being offline (showReconnect), in which case a brief
 * confirmation pill appears.
 */
export function OfflineIndicator({ className, showReconnect = true }: OfflineIndicatorProps) {
  const [online, setOnline] = useState(() => isOnline());
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    return onConnectivityChange((next) => {
      setOnline((prev) => {
        if (!prev && next) {
          setJustReconnected(true);
          window.setTimeout(() => setJustReconnected(false), 2500);
        }
        return next;
      });
    });
  }, []);

  if (online && !justReconnected) {
    return null;
  }

  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="offline-indicator"
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
          'bg-amber-100 text-amber-800 border border-amber-200',
          'dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
          className,
        )}
      >
        <WifiOff className="w-3 h-3" />
        <span>Offline</span>
      </div>
    );
  }

  if (!showReconnect) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reconnected-indicator"
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
        'bg-emerald-100 text-emerald-800 border border-emerald-200',
        'dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
        'animate-in fade-in slide-in-from-top-1',
        className,
      )}
    >
      <Wifi className="w-3 h-3" />
      <span>Back online</span>
    </div>
  );
}

/**
 * Persistent offline banner shown above the page content. Use this only on
 * pages where lack of connectivity will block primary user flows.
 */
export function OfflineBanner({ className }: { className?: string }) {
  const [online, setOnline] = useState(() => isOnline());

  useEffect(() => {
    return onConnectivityChange(setOnline);
  }, []);

  if (online) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-sm bg-amber-50 border-b border-amber-200 text-amber-900',
        'dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-100',
        className,
      )}
    >
      <CloudOff className="w-4 h-4 shrink-0" />
      <p>
        You&apos;re offline. Changes will be queued and synced when you reconnect.
      </p>
    </div>
  );
}
