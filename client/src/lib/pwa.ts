/**
 * PWA Utilities for Muhasib.ai
 *
 * Handles service worker registration, update checks, and install prompt management.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

type UpdateCallback = (registration: ServiceWorkerRegistration) => void;
type InstallPromptCallback = (event: BeforeInstallPromptEvent) => void;

// ─── State ──────────────────────────────────────────────────────────────────

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
const updateCallbacks: UpdateCallback[] = [];
const installPromptCallbacks: InstallPromptCallback[] = [];

// ─── Service Worker Registration ────────────────────────────────────────────

/**
 * Registers the service worker and sets up update detection.
 * Should be called once on app startup (e.g., in main.tsx).
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.info('[PWA] Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    swRegistration = registration;

    // Detect updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content available - notify callbacks
          updateCallbacks.forEach((cb) => cb(registration));
        }
      });
    });

    // Handle controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Optionally reload when new SW takes over
      // window.location.reload();
    });

    console.info('[PWA] Service worker registered successfully');
    return registration;
  } catch (error) {
    console.error('[PWA] Service worker registration failed:', error);
    return null;
  }
}

// ─── Update Management ──────────────────────────────────────────────────────

/**
 * Checks for service worker updates.
 * Returns true if an update is available.
 */
export async function checkForUpdates(): Promise<boolean> {
  if (!swRegistration) {
    return false;
  }

  try {
    await swRegistration.update();

    // Check if there's a waiting worker (update available)
    return swRegistration.waiting !== null;
  } catch (error) {
    console.error('[PWA] Update check failed:', error);
    return false;
  }
}

/**
 * Applies a pending service worker update by telling the waiting SW to activate.
 * The page will reload when the new SW takes control.
 */
export function applyUpdate(): void {
  if (!swRegistration?.waiting) {
    return;
  }

  swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  // Reload after the new SW takes over
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  }, { once: true });
}

/**
 * Registers a callback to be notified when an update is available.
 */
export function onUpdateAvailable(callback: UpdateCallback): () => void {
  updateCallbacks.push(callback);
  return () => {
    const index = updateCallbacks.indexOf(callback);
    if (index > -1) updateCallbacks.splice(index, 1);
  };
}

// ─── Install Prompt ─────────────────────────────────────────────────────────

/**
 * Sets up the install prompt listener.
 * Must be called early (before the browser fires beforeinstallprompt).
 */
export function setupInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;

    // Notify all registered callbacks
    installPromptCallbacks.forEach((cb) => cb(deferredPrompt!));
  });

  // Detect if app was successfully installed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    console.info('[PWA] App installed successfully');
  });
}

/**
 * Shows the native install prompt if available.
 * Returns the user's choice or null if the prompt isn't available.
 */
export async function showInstallPrompt(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferredPrompt) {
    return null;
  }

  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    // Clear the prompt - it can only be used once
    deferredPrompt = null;

    return outcome;
  } catch (error) {
    console.error('[PWA] Install prompt failed:', error);
    return null;
  }
}

/**
 * Returns whether the install prompt is currently available.
 */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/**
 * Registers a callback to be notified when the install prompt becomes available.
 */
export function onInstallPromptAvailable(callback: InstallPromptCallback): () => void {
  installPromptCallbacks.push(callback);

  // If prompt is already available, fire immediately
  if (deferredPrompt) {
    callback(deferredPrompt);
  }

  return () => {
    const index = installPromptCallbacks.indexOf(callback);
    if (index > -1) installPromptCallbacks.splice(index, 1);
  };
}

// ─── Background Sync ────────────────────────────────────────────────────────

/**
 * Queues a failed request for background sync retry.
 */
export async function queueForSync(request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
    return;
  }

  navigator.serviceWorker.controller.postMessage({
    type: 'QUEUE_REQUEST',
    request,
  });
}

// ─── Cache Management ───────────────────────────────────────────────────────

/**
 * Clears all PWA caches. Useful for troubleshooting or logout.
 */
export async function clearAllCaches(): Promise<void> {
  if (!navigator.serviceWorker.controller) {
    return;
  }

  navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
}

// ─── Connectivity ───────────────────────────────────────────────────────────

/**
 * Returns the current online status.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
}

/**
 * Registers callbacks for online/offline events.
 * Returns an unsubscribe function.
 */
export function onConnectivityChange(
  callback: (online: boolean) => void
): () => void {
  const onOnline = () => callback(true);
  const onOffline = () => callback(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

// ─── Standalone Detection ───────────────────────────────────────────────────

/**
 * Checks if the app is running in standalone (installed) mode.
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}
