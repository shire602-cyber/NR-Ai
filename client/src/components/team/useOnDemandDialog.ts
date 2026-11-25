import { useCallback, useRef, useState, type ComponentType } from "react";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";

export type LoadStatus = "idle" | "loading" | "offline" | "failed";

/**
 * Loads a dialog's chunk the first time it is requested. A failure stays here as a status next to
 * the trigger: it never reloads the page or reaches an error boundary, so the cached list behind
 * it stays usable. `load` must be a stable (module-level) function.
 */
export function useOnDemandDialog<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>
) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  // A ref, not state: a second click before the re-render must not start a second import.
  const started = useRef(false);

  const request = useCallback(() => {
    if (started.current) return;
    // Older browsers cache a failed import() for the life of the page, so do not try one that is
    // known to fail.
    if (navigator.onLine === false) {
      setStatus("offline");
      return;
    }
    started.current = true;
    setStatus("loading");
    loadWithChunkRetry(load, { key: "on-demand-dialog", reload: false }).then(
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
  }, [load]);

  return { Component, status, request };
}
