import { useCallback, useRef, useState, type ComponentType } from "react";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { retryToken } from "@/lib/dialogChunk";

export type LoadStatus = "idle" | "loading" | "offline" | "failed";

/**
 * `retry` is null for the first import this hook ever runs and a fresh token for every one after
 * it (the automatic second try and each manual Retry): the loader must then import the chunk under
 * a fresh URL, because older engines cache a failed module URL for the life of the document.
 */
export type DialogLoader<P extends object> = (
  retry: string | null
) => Promise<{ default: ComponentType<P> }>;

/**
 * Loads a dialog's chunk the first time it is requested. A failure stays here as a status next to
 * the trigger: it never reloads the page or reaches an error boundary, so the cached list behind
 * it stays usable. `load` must be a stable (module-level) function; `key` names the dialog.
 */
export function useOnDemandDialog<P extends object>(load: DialogLoader<P>, key: string) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  // A ref, not state: a second click before the re-render must not start a second import.
  const started = useRef(false);
  // Import attempts so far, over every request: the first is the plain import, the rest are fresh.
  const attempts = useRef(0);

  const request = useCallback(() => {
    if (started.current) return;
    // Do not start an import that is known to fail while offline; Retry runs once back online.
    if (navigator.onLine === false) {
      setStatus("offline");
      return;
    }
    started.current = true;
    setStatus("loading");
    loadWithChunkRetry(
      () => {
        const attempt = attempts.current++;
        return load(attempt === 0 ? null : retryToken(attempt));
      },
      { key: `dialog:${key}`, reload: false }
    ).then(
      (module) => {
        // `started` stays set: a loaded dialog is never imported again.
        setComponent(() => module.default);
        setStatus("idle");
      },
      () => {
        started.current = false;
        setStatus("failed");
      }
    );
  }, [load, key]);

  return { Component, status, request };
}
