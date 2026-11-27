import { useLayoutEffect } from "react";

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
