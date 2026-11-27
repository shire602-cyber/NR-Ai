import { useEffect } from "react";
import { useMotionPreference } from "./preference";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Loads the pointer tilt / parallax code on idle, only for a mouse or trackpad and only while
 * motion is allowed. Pausing motion (or the OS reduced-motion setting) removes the listeners.
 */
export function useAmbientMotion(): void {
  const { enabled } = useMotionPreference();
  useEffect(() => {
    if (!enabled) return;
    if (typeof window.matchMedia !== "function" || !window.matchMedia(FINE_POINTER).matches) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void import("./tilt").then((mod) => {
        if (!cancelled) stop = mod.startPointerDepth();
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop?.();
    };
  }, [enabled]);
}
