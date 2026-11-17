import * as React from "react";

/**
 * Edge fade for a horizontal scroller (spec G4): a `size` px mask only on the inline edges
 * that still hide content. Works in LTR and RTL. Returns a style to spread on the scroller.
 */
export function useEdgeFade(
  ref: React.RefObject<HTMLElement | null>,
  size = 24
): React.CSSProperties | undefined {
  const [fade, setFade] = React.useState({ left: false, right: false });
  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setFade((f) => (f.left || f.right ? { left: false, right: false } : f));
      return;
    }
    const rtl = getComputedStyle(el).direction === "rtl";
    const x = el.scrollLeft;
    const next = rtl ? { left: -x < max - 1, right: x < -1 } : { left: x > 1, right: x < max - 1 };
    setFade((f) => (f.left === next.left && f.right === next.right ? f : next));
  }, [ref]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [ref, update]);
  if (!fade.left && !fade.right) return undefined;
  const mask = `linear-gradient(to right, ${fade.left ? `transparent 0, #000 ${size}px` : "#000 0"}, ${
    fade.right ? `#000 calc(100% - ${size}px), transparent 100%` : "#000 100%"
  })`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/** Scrolls the active child (`[data-state=active]` or `[aria-current=page]`) into view. */
export function useActiveIntoView(ref: React.RefObject<HTMLElement | null>, margin = 24) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => {
      const active = el.querySelector<HTMLElement>(
        '[data-state="active"], [aria-current="page"], [aria-selected="true"]'
      );
      if (!active || el.scrollWidth <= el.clientWidth) return;
      const box = el.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      if (r.left < box.left + margin) el.scrollLeft += r.left - box.left - margin;
      else if (r.right > box.right - margin) el.scrollLeft += r.right - box.right + margin;
    };
    reveal();
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(reveal);
    mo.observe(el, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-current"],
    });
    return () => mo.disconnect();
  }, [ref, margin]);
}
