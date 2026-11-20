import * as React from "react";
import { useTranslation } from "@/lib/i18n";

/** One entry of a form error summary (see ErrorSummary in components/ui/form-layout). */
export interface SummaryItem {
  /** DOM id of the field to focus when the item is clicked. */
  id?: string;
  label?: React.ReactNode;
  message: React.ReactNode;
}

/** Scroll a field into view and focus it (error summary links, first invalid field). */
export function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ block: "center" });
  el.focus?.();
}

/**
 * useFormGate — client-side "required" checks for state-based forms. Errors show only after
 * the first submit attempt; `attempt()` returns false and focuses the first invalid control.
 */
export function useFormGate(
  checks: Array<{ id: string; label: React.ReactNode; invalid: boolean; message?: React.ReactNode }>
) {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = React.useState(false);
  const failing = checks.filter((c) => c.invalid);
  const errorFor = (id: string): React.ReactNode | undefined => {
    if (!submitted) return undefined;
    const c = failing.find((x) => x.id === id);
    return c ? (c.message ?? t["forms.errors.required"]) : undefined;
  };
  const summary: SummaryItem[] = submitted
    ? failing.map((c) => ({
        id: c.id,
        label: c.label,
        message: c.message ?? t["forms.errors.required"],
      }))
    : [];
  const attempt = () => {
    setSubmitted(true);
    if (failing.length === 0) return true;
    const first = failing[0];
    // after the error state renders
    requestAnimationFrame(() => focusField(first.id));
    return false;
  };
  const reset = () => setSubmitted(false);
  return { submitted, errorFor, summary, attempt, reset };
}
