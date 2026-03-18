import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showInstallPrompt, onInstallPromptAvailable, isStandalone } from '@/lib/pwa';

const SESSION_DISMISSED_KEY = 'muhasib-pwa-prompt-dismissed';

/**
 * PWA Install Prompt Banner
 *
 * Shows a banner suggesting app installation when:
 * - The browser fires the `beforeinstallprompt` event (app is installable)
 * - The app is not already running in standalone mode
 * - The user has not dismissed the prompt this session
 *
 * Only shows once per session (dismissal is stored in sessionStorage).
 */
export function PWAInstallPrompt() {
  const [canShow, setCanShow] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isStandalone()) return;

    // Don't show if dismissed this session
    if (sessionStorage.getItem(SESSION_DISMISSED_KEY)) return;

    const unsubscribe = onInstallPromptAvailable(() => {
      setCanShow(true);
      // Delay showing the banner slightly so it doesn't interrupt initial load
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    });

    return unsubscribe;
  }, []);

  const handleInstall = useCallback(async () => {
    const outcome = await showInstallPrompt();
    if (outcome === 'accepted') {
      setVisible(false);
      setCanShow(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true');
  }, []);

  if (!canShow) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md md:left-auto md:right-4 md:mx-0"
        >
          <div className="rounded-xl border bg-card p-4 shadow-lg">
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm text-foreground">
                  Install Muhasib.ai
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  Add to your home screen for quick access and offline support.
                </p>

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleInstall}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Install
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismiss}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    Not now
                  </Button>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Dismiss install prompt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
