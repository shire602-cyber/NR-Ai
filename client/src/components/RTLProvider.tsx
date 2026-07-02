import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/* ── Types ────────────────────────────────────────────────────────────── */

interface RTLContextValue {
  /** Whether the current locale renders right-to-left */
  isRTL: boolean;
  /** `"rtl"` or `"ltr"` */
  direction: "rtl" | "ltr";
  /** `"right"` or `"left"` — convenience for text-align, float, etc. */
  align: "right" | "left";
  /** The opposite alignment — useful for "end" positioning */
  alignOpposite: "left" | "right";
  /** Returns `start` or `end` values for logical flex alignment */
  flexStart: "flex-start" | "flex-end";
  flexEnd: "flex-end" | "flex-start";
  /** Resolves a directional class name.
   *  e.g., `rtlClass('ml-4', 'mr-4')` returns `'mr-4'` in RTL. */
  rtlClass: (ltrClass: string, rtlClass: string) => string;
  /** Resolves directional inline styles.
   *  e.g., `rtlValue(8, -8)` returns `-8` in RTL.
   *  Useful for Framer Motion translateX. */
  rtlValue: <T>(ltrValue: T, rtlValue: T) => T;
}

/* ── Context ──────────────────────────────────────────────────────────── */

const RTLContext = createContext<RTLContextValue>({
  isRTL: false,
  direction: "ltr",
  align: "left",
  alignOpposite: "right",
  flexStart: "flex-start",
  flexEnd: "flex-end",
  rtlClass: (ltr) => ltr,
  rtlValue: (ltr) => ltr,
});

/* ── Hook ─────────────────────────────────────────────────────────────── */

/**
 * Access RTL-aware utilities anywhere inside `<RTLProvider>`.
 *
 * ```tsx
 * const { isRTL, direction, align, rtlClass, rtlValue } = useRTL();
 * ```
 */
export function useRTL(): RTLContextValue {
  return useContext(RTLContext);
}

/* ── Provider ─────────────────────────────────────────────────────────── */

interface RTLProviderProps {
  children: ReactNode;
}

/**
 * Wraps the application and synchronises the `<html>` element's `dir` and
 * `lang` attributes with the active locale from the i18n store.
 *
 * Usage (typically in App.tsx or main.tsx):
 *
 * ```tsx
 * import { RTLProvider } from '@/components/RTLProvider';
 *
 * function App() {
 *   return (
 *     <RTLProvider>
 *       <Router>...</Router>
 *     </RTLProvider>
 *   );
 * }
 * ```
 */
export function RTLProvider({ children }: RTLProviderProps) {
  const { locale } = useI18n();
  const isRTL = locale === "ar";

  /* ── Synchronise document attributes ──────────────────────────────── */
  useEffect(() => {
    const html = document.documentElement;

    // Direction & language
    html.dir = isRTL ? "rtl" : "ltr";
    html.lang = locale;

    // Load Arabic-optimised font when switching to RTL
    if (isRTL) {
      loadArabicFont();
    }

    // Add/remove a class so plain CSS can also target the state
    html.classList.toggle("rtl", isRTL);
    html.classList.toggle("ltr", !isRTL);

    return () => {
      html.classList.remove("rtl", "ltr");
    };
  }, [isRTL, locale]);

  /* ── Context value (memoised) ─────────────────────────────────────── */
  const value = useMemo<RTLContextValue>(
    () => ({
      isRTL,
      direction: isRTL ? "rtl" : "ltr",
      align: isRTL ? "right" : "left",
      alignOpposite: isRTL ? "left" : "right",
      flexStart: isRTL ? "flex-end" : "flex-start",
      flexEnd: isRTL ? "flex-start" : "flex-end",
      rtlClass: (ltrCls: string, rtlCls: string) => (isRTL ? rtlCls : ltrCls),
      rtlValue: <T,>(ltrVal: T, rtlVal: T): T => (isRTL ? rtlVal : ltrVal),
    }),
    [isRTL]
  );

  return <RTLContext.Provider value={value}>{children}</RTLContext.Provider>;
}

/* ── Arabic font loader ───────────────────────────────────────────────── */

let fontLoaded = false;

/**
 * Load the Arabic UI fonts (Cairo + Noto Sans Arabic) the first time RTL is
 * activated. Self-hosted via Fontsource and dynamically imported so they add
 * zero weight for English-only users and never hit an external font CDN.
 */
function loadArabicFont(): void {
  if (fontLoaded) return;
  fontLoaded = true;

  void Promise.all([
    import("@fontsource/cairo/400.css"),
    import("@fontsource/cairo/500.css"),
    import("@fontsource/cairo/600.css"),
    import("@fontsource/cairo/700.css"),
    import("@fontsource/noto-sans-arabic/400.css"),
    import("@fontsource/noto-sans-arabic/500.css"),
    import("@fontsource/noto-sans-arabic/600.css"),
    import("@fontsource/noto-sans-arabic/700.css"),
  ]).catch(() => {
    // Best-effort: if a chunk fails, the RTL font stack falls back to system
    // Arabic fonts (defined in rtl.css) — text stays readable.
  });
}

export default RTLProvider;
