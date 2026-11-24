import { useEffect, useState, type RefObject } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

/** Live `prefers-reduced-motion: reduce` flag. False where `matchMedia` does not exist (jsdom). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED)?.matches
  );
  useEffect(() => {
    const query = typeof window !== "undefined" ? window.matchMedia?.(REDUCED) : undefined;
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export interface InViewOptions {
  /** Stay true after the first intersection (default true). Set false to also report leaving. */
  once?: boolean;
  rootMargin?: string;
  threshold?: number;
}

/**
 * True while `ref` is on screen. Without IntersectionObserver (jsdom, very old browsers) it is
 * true from the first render so content is never stuck hidden.
 */
export function useInView(
  ref: RefObject<Element | null>,
  { once = true, rootMargin = "0px 0px -8% 0px", threshold = 0.15 }: InViewOptions = {}
): boolean {
  const supported = typeof IntersectionObserver !== "undefined";
  const [inView, setInView] = useState(!supported);
  useEffect(() => {
    const el = ref.current;
    if (!supported || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, supported, once, rootMargin, threshold]);
  return inView;
}

export interface CountUpOptions {
  durationMs?: number;
  /** Start counting only when true (typically the result of `useInView`). */
  enabled?: boolean;
}

/**
 * Animates 0 -> `target`. Returns `target` straight away under reduced motion or when
 * requestAnimationFrame is unavailable; returns 0 while not `enabled`.
 */
export function useCountUp(
  target: number,
  { durationMs = 1400, enabled = true }: CountUpOptions = {}
): number {
  const reduced = usePrefersReducedMotion();
  const canAnimate = !reduced && typeof requestAnimationFrame === "function";
  const [value, setValue] = useState(canAnimate ? 0 : target);
  useEffect(() => {
    if (!canAnimate || !enabled) return;
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, durationMs));
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(progress >= 1 ? target : target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, enabled, canAnimate]);
  if (!canAnimate) return target;
  return enabled ? value : 0;
}
