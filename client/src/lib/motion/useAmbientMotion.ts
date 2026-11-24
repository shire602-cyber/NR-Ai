import { useEffect, useLayoutEffect } from "react";
import { useMotionPreference } from "./preference";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Marks the document as the signed-in app surface (`<html data-surface="app">`), which switches
 * on the roomier spacing, calmer type weights and layered depth tokens in index.css. Public
 * pages never set it, so they keep the base tokens.
 */
export function useAppSurface(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.surface;
    root.dataset.surface = "app";
    return () => {
      if (previous === undefined) delete root.dataset.surface;
      else root.dataset.surface = previous;
    };
  }, []);
}

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
