import { useSyncExternalStore } from "react";

/**
 * Motion preference (pause control for decorative motion).
 *
 * Per browser: on (default) or paused. When paused, `<html data-motion="off">` is set and
 * index.css neutralises animations, transitions, tilt and parallax. The operating-system
 * "reduce motion" setting always wins: with it on, motion stays off whatever is stored here.
 */
export const MOTION_STORAGE_KEY = "muhasib-motion";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const listeners = new Set<() => void>();

function readPaused(): boolean {
  try {
    return localStorage.getItem(MOTION_STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

function reducedQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_QUERY)
    : null;
}

export function systemReducesMotion(): boolean {
  return reducedQuery()?.matches ?? false;
}

function applyMotion(paused: boolean): void {
  if (typeof document === "undefined") return;
  if (paused) document.documentElement.dataset.motion = "off";
  else delete document.documentElement.dataset.motion;
}

export function setMotionPaused(paused: boolean): void {
  try {
    if (paused) localStorage.setItem(MOTION_STORAGE_KEY, "off");
    else localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    /* storage blocked: still apply for this page view */
  }
  applyMotion(paused);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const query = reducedQuery();
  query?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener?.("change", listener);
  };
}

// Applied at import time so a paused preference holds from the first paint of the shell.
applyMotion(readPaused());

/** Motion state for the pause control and for lazy motion code. Re-renders on change. */
export function useMotionPreference() {
  const paused = useSyncExternalStore(subscribe, readPaused, () => false);
  const systemReduced = useSyncExternalStore(subscribe, systemReducesMotion, () => false);
  return {
    /** The user pressed pause in this browser. */
    paused,
    /** The operating system asks for reduced motion (motion is off and cannot be resumed here). */
    systemReduced,
    /** Decorative motion may run. */
    enabled: !paused && !systemReduced,
    toggle: () => setMotionPaused(!paused),
  };
}
