import { useEffect, useSyncExternalStore } from "react";

/**
 * Colour theme preference (D2 design system).
 *
 * The preference is per browser ("light" | "dark" | "system"); light is the
 * default and dark is opt-in. `client/public/theme-init.js` applies the saved
 * value before first paint — keep the storage key and values in sync with it.
 */
export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "muhasib-theme";

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(preference) === "dark");
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage blocked: still apply for this page view */
  }
  applyTheme(preference);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current preference plus the resolved light/dark value; re-renders on change. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "light" as const);

  // Follow OS changes while the preference is "system".
  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      listeners.forEach((listener) => listener());
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return {
    preference,
    resolved: resolveTheme(preference),
    setPreference: setThemePreference,
  };
}
