/**
 * Shared behaviour of the no-login pages a customer or approver opens from an e-mail
 * (`/portal/<token>` and `/portal/einvoicing-approve/<token>`): which language to open in,
 * the page title, and bidi-safe inline names.
 */
import { useEffect } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

export const LOCALE_CHOICE_KEY = "portal-locale-chosen";

/** Has the viewer picked a language on one of these pages (remembered in this browser)? */
export function viewerChoseLocale(): boolean {
  try {
    return localStorage.getItem(LOCALE_CHOICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberViewerLocaleChoice(): void {
  try {
    localStorage.setItem(LOCALE_CHOICE_KEY, "1");
  } catch {
    // private mode: the choice just lasts for this page
  }
}

const asLocale = (value: string | null | undefined): Locale | null =>
  value === "ar" || value === "en" ? value : null;

/** The browser's first language when it is Arabic, else null (we never force English). */
function browserLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const first = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return first.startsWith("ar") ? "ar" : null;
}

/**
 * Open in the customer's own language when the firm recorded one, else Arabic when the
 * browser is Arabic, else the company's language, unless the viewer already chose one. Runs
 * once when the preferences arrive (`ready`); later switches are the viewer's.
 */
export function useLinkLocale(
  ready: boolean,
  customerLanguage?: string | null,
  companyLanguage?: string | null
): void {
  const setLocale = useI18n((s) => s.setLocale);
  const current = useI18n((s) => s.locale);
  const wanted: Locale | null = !ready
    ? null
    : (asLocale(customerLanguage) ?? browserLocale() ?? asLocale(companyLanguage));
  useEffect(() => {
    if (wanted && wanted !== current && !viewerChoseLocale()) setLocale(wanted);
    // Only when the preferences arrive; later switches are the viewer's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
}

/** Set `document.title` (the browser tab, history and screen-reader page name). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}

/**
 * Unicode bidi isolate (FSI ... PDI): a Latin name inside an Arabic sentence (or the other
 * way round) keeps its own direction and no longer drags neighbouring punctuation and words
 * to the wrong side. Harmless when the direction matches.
 */
export const bidiIsolate = (value: string): string => `⁨${value}⁩`;
