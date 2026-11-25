import { useEffect, type RefObject } from "react";

/** Pointer position relative to a box, as -1..1 from its centre on each axis (clamped). */
export function tiltFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const axis = (value: number, start: number, size: number) =>
    size > 0 ? Math.max(-1, Math.min(1, ((value - start) / size) * 2 - 1)) : 0;
  return {
    x: axis(clientX, rect.left, rect.width),
    y: axis(clientY, rect.top, rect.height),
  };
}

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Pointer-driven depth for the hero. While a mouse moves over `area` (the hero band) it writes
 * `--mz-px` / `--mz-py` (-1..1) on that element; hero.css turns them into the stage tilt, the card
 * parallax, the glare and the spotlight. One write per animation frame. Touch screens and reduced
 * motion get nothing (`enabled` false), and the values reset when the pointer leaves.
 */
export function usePointerTilt(stage: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = stage.current;
    const area = el?.closest<HTMLElement>(".mz-hero") ?? el;
    if (!enabled || !el || !area || !window.matchMedia?.(FINE_POINTER)?.matches) return;
    let frame = 0;
    let next = { x: 0, y: 0 };
    const write = () => {
      frame = 0;
      area.style.setProperty("--mz-px", next.x.toFixed(3));
      area.style.setProperty("--mz-py", next.y.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      next = tiltFromPointer(el.getBoundingClientRect(), event.clientX, event.clientY);
      schedule();
    };
    const leave = () => {
      next = { x: 0, y: 0 };
      schedule();
    };
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave);
    return () => {
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
      area.style.removeProperty("--mz-px");
      area.style.removeProperty("--mz-py");
    };
  }, [stage, enabled]);
}
