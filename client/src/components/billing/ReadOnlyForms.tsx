import { useEffect } from "react";
import { useLocation } from "wouter";
import { PLAN_LOCK_ALWAYS_OPEN, featureForRoute } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";

const FLAG = "data-plan-locked-disabled";
const CONTROLS = "input, select, textarea, button";
/** Forms that stay usable in a read-only workspace: search and filters, and anything opted out. */
const EXEMPT = '[role="search"], [data-readonly-ok], form[method="get" i]';

/** Disables the controls of every write form under `root` (marks what it changed). */
function lockForms(root: ParentNode) {
  for (const form of Array.from(root.querySelectorAll<HTMLFormElement>("form"))) {
    if (form.matches(EXEMPT) || form.closest(EXEMPT)) continue;
    form.setAttribute("data-plan-locked", "true");
    for (const control of Array.from(form.querySelectorAll<HTMLElement>(CONTROLS))) {
      if (control.closest("[data-readonly-ok]")) continue;
      if ((control as HTMLInputElement).disabled) continue;
      (control as HTMLInputElement).disabled = true;
      control.setAttribute(FLAG, "true");
    }
  }
}

function unlockForms() {
  for (const control of Array.from(document.querySelectorAll<HTMLElement>(`[${FLAG}]`))) {
    (control as HTMLInputElement).disabled = false;
    control.removeAttribute(FLAG);
  }
  for (const form of Array.from(document.querySelectorAll("form[data-plan-locked]"))) {
    form.removeAttribute("data-plan-locked");
  }
}

/**
 * STEP4 polish: in a read-only workspace (trial over, no active plan) or on a module the plan
 * does not include, create and edit forms render disabled under the lock banner, instead of
 * accepting input and failing only on save (the server still refuses the write either way,
 * server/middleware/featureGate.ts). Reading, searching, filtering and exporting stay open:
 * search and GET forms, `[data-readonly-ok]` regions and the always-open pages are left alone.
 * Dialogs opened from a locked page are caught by the observer.
 */
export function ReadOnlyForms() {
  const [location] = useLocation();
  const { enforcement, entitlement, isReadOnly, canWrite } = useSubscription();
  const feature = featureForRoute(location);
  const alwaysOpen = PLAN_LOCK_ALWAYS_OPEN.some(
    (p) => location === p || location.startsWith(`${p}/`)
  );
  const locked =
    enforcement &&
    !!entitlement &&
    !alwaysOpen &&
    (isReadOnly || (feature !== null && feature !== undefined && !canWrite(feature)));

  useEffect(() => {
    if (!locked) return;
    lockForms(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) lockForms(node.parentElement ?? document);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      unlockForms();
    };
  }, [locked, location]);

  return null;
}
