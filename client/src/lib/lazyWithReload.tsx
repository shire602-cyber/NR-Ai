import { lazy, type ComponentType } from "react";

/**
 * Drop-in replacement for React.lazy that survives stale-chunk failures.
 *
 * After a deploy, a browser holding an old module graph will request a hashed
 * chunk filename that no longer exists on the server ("Failed to fetch
 * dynamically imported module" / "error loading dynamically imported module").
 * Plain React.lazy surfaces that as a render error — a broken page or, if it
 * happens above an error boundary, a blank white screen.
 *
 * This helper:
 *   1. retries the import once after a short delay (covers transient network
 *      blips and CDN 5xx), then
 *   2. if it still fails with a chunk-load error, forces a one-time hard reload
 *      to fetch a fresh index.html + chunk manifest. A storage-backed guard
 *      prevents an infinite reload loop when the failure is genuinely
 *      persistent (e.g. offline) — after one reload attempt it rethrows so the
 *      error boundary can show a real message.
 *
 * The service worker (network-first navigation) is the primary defense; this is
 * belt-and-suspenders for the browser HTTP cache and edge cases.
 */

const RELOAD_GUARD_PREFIX = "chunk-reload:";

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) || // Safari
    /is not a valid JavaScript MIME type/i.test(message) // stale index served HTML
  );
}

function safeStorage(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Clear the reload guard once the app has successfully booted. */
export function clearChunkReloadGuards(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (k && k.startsWith(RELOAD_GUARD_PREFIX)) storage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export interface ChunkRetryOptions {
  key: string;
  reload?: () => void;
  storage?: Storage | null;
  delayMs?: number;
}

/**
 * Core loader: try → retry once → reload once → rethrow. Exported for testing;
 * `reload` and `storage` are injectable so the logic can be exercised in node.
 */
export async function loadWithChunkRetry<T>(
  factory: () => Promise<T>,
  opts: ChunkRetryOptions
): Promise<T> {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const reload = opts.reload ?? (() => window.location.reload());
  const guardKey = RELOAD_GUARD_PREFIX + opts.key;

  try {
    return await factory();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;

    try {
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 400));
      return await factory();
    } catch (retryError) {
      if (!isChunkLoadError(retryError)) throw retryError;

      const alreadyReloaded = (() => {
        try {
          return storage?.getItem(guardKey) === "1";
        } catch {
          return false;
        }
      })();

      if (!alreadyReloaded) {
        try {
          storage?.setItem(guardKey, "1");
        } catch {
          /* best effort */
        }
        reload();
        // Never resolve — let the reload take over before anything renders.
        return new Promise<T>(() => {});
      }
      throw retryError;
    }
  }
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  key?: string
): React.LazyExoticComponent<T> {
  const guardKey = key || factory.toString().slice(0, 120);
  return lazy(() => loadWithChunkRetry(factory, { key: guardKey }));
}
