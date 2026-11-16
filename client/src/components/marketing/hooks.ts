import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";

/** localStorage key shared with client/public/theme-init.js (runs before first paint). */
export const THEME_STORAGE_KEY = "muhasib-theme";

type ThemePreference = "light" | "dark" | "system";

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/**
 * Light/dark theme for the public site. The preference follows the OS until the
 * visitor picks one with the header toggle. The `dark` class lives on <html>
 * (the app's dark tokens key off it too); when a public page unmounts we put
 * the class back the way we found it, so the signed-in app keeps its own theme.
 */
export function useMarketingTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    typeof window === "undefined" ? "system" : readPreference()
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === "undefined" ? false : systemPrefersDark()
  );
  const isDark = preference === "dark" || (preference === "system" && systemDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  useEffect(() => {
    const root = document.documentElement;
    return () => {
      // Leaving the public site: the signed-in app decides its own theme.
      if (root.dataset.appTheme !== "dark") root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  }, []);

  const toggle = useCallback(() => {
    const next: ThemePreference = isDark ? "light" : "dark";
    setPreference(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
  }, [isDark]);

  return { isDark, toggle };
}

function setMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Per-route <title>, description and social tags, restored on unmount. */
export function usePageMeta(title: string | undefined, description: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previousTitle = document.title;
    const previousDescription =
      document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    document.title = title;
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
      setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    }
    return () => {
      document.title = previousTitle;
      if (previousDescription) {
        setMeta('meta[name="description"]', "name", "description", previousDescription);
      }
    };
  }, [title, description]);
}

let arabicDisplayLoaded = false;

/** Load the Arabic display face (Noto Naskh Arabic, self-hosted) the first time Arabic is shown. */
export function useArabicDisplayFont(active: boolean) {
  useEffect(() => {
    if (!active || arabicDisplayLoaded) return;
    arabicDisplayLoaded = true;
    void Promise.all([
      import("@fontsource/noto-naskh-arabic/arabic-600.css"),
      import("@fontsource/noto-naskh-arabic/arabic-700.css"),
    ]).catch(() => {
      /* falls back to the Arabic UI stack */
    });
  }, [active]);
}

/** Route-level SEO meta plus the Arabic display face, for every public page. */
export function useMarketingPage(titleKey: string, descriptionKey: string) {
  const { t, locale } = useTranslation();
  usePageMeta(t[titleKey], t[descriptionKey]);
  useArabicDisplayFont(locale === "ar");
}
