import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

/**
 * WQ1 (7.24): "Leave without saving?" for a document editor with unsaved changes.
 *
 * While `dirty` is true:
 *  - closing or reloading the tab asks the browser's own confirmation (beforeunload);
 *  - a click on any in-app link (the editor's back link, the sidebar, a hint link) is held and
 *    `pending` is set, so the page can show its confirmation dialog;
 *  - `guard(action)` runs `action` at once when clean, else holds it the same way (Cancel).
 * `confirm()` performs the held navigation / action, `cancel()` drops it.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState<null | { href?: string; action?: () => void }>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null
        | undefined;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (anchor.closest("[data-leave-guard-ignore]")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const href = `${url.pathname}${url.search}${url.hash}`;
      if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`)
        return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPending({ action });
    else action();
  }, []);

  const confirm = useCallback(() => {
    const held = pending;
    setPending(null);
    dirtyRef.current = false;
    if (held?.action) held.action();
    else if (held?.href) navigate(held.href);
  }, [navigate, pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending: pending !== null, guard, confirm, cancel };
}
