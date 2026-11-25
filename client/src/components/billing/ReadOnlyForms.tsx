import { useEffect } from "react";
import { useLocation } from "wouter";
import { featureForRoute, routeWritesAreGated } from "@/lib/plan-routes";
import { useSubscription } from "@/hooks/useSubscription";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const FLAG = "data-plan-locked-disabled";
/** Forms that stay usable in a read-only workspace: search and filters, and anything opted out. */
const EXEMPT = '[role="search"], [data-readonly-ok], form[method="get" i]';
/** Leaving a locked form must keep working: Cancel / Close / Back buttons are not disabled. */
const KEEP_OPEN = /cancel|close|back|dismiss|إلغاء|إغلاق|اغلاق|رجوع|عودة|تراجع/i;

/** Controls that only navigate or leave the form: tabs, and type="button" Cancel/Close/Back. */
function keepsOpen(control: HTMLElement): boolean {
  if (control.getAttribute("role") === "tab" || control.closest('[role="tablist"]')) return true;
  if (control.hasAttribute("data-radix-dialog-close") || control.closest("[data-dialog-close]"))
    return true;
  if (!(control instanceof HTMLButtonElement) || control.type !== "button") return false;
  const label = [
    control.getAttribute("data-testid"),
    control.getAttribute("aria-label"),
    control.textContent,
  ].join(" ");
  return KEEP_OPEN.test(label);
}

/** Disables the controls of one write form (marks what it changed). */
function lockForm(form: HTMLFormElement) {
  if (form.matches(EXEMPT) || form.closest(EXEMPT)) return;
  form.setAttribute("data-plan-locked", "true");
  // form.elements also holds controls outside the <form> that point at it (form="id").
  for (const control of Array.from(form.elements) as HTMLElement[]) {
    if (control.closest("[data-readonly-ok]") || keepsOpen(control)) continue;
    if ((control as HTMLInputElement).disabled) continue;
    (control as HTMLInputElement).disabled = true;
    control.setAttribute(FLAG, "true");
  }
}

/** Locks every write form in `node`'s subtree and the form `node` itself sits in. */
function lockNode(node: Element | Document) {
  if (node instanceof Element) {
    const own = node.closest("form");
    if (own) lockForm(own);
  }
  for (const form of Array.from(node.querySelectorAll<HTMLFormElement>("form"))) lockForm(form);
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
  const { data: user } = useCurrentUser();
  const feature = featureForRoute(location);
  // The server never gates platform admins and NR firm staff (featureGate isExemptCaller), and
  // only gates the modules in shared/plan-gates.ts and PLAN_ROUTE_FEATURES: lock exactly those.
  const exemptCaller = user?.isAdmin === true || !!user?.firmRole;
  const locked =
    enforcement &&
    !!entitlement &&
    !exemptCaller &&
    routeWritesAreGated(location) &&
    (isReadOnly || (feature !== null && feature !== undefined && !canWrite(feature)));

  useEffect(() => {
    if (!locked) return;
    lockNode(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) lockNode(node);
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
