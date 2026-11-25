/**
 * What the two firm landing screens need on first load. One list feeds the build (which chunks the
 * document preloads for each route), the server (the document it serves and the reads it starts
 * before any script runs) and the browser (which catalogs and reads to start itself), so the three
 * cannot drift apart. Plain data: safe to import from the browser, the server and vite.config.ts.
 *
 * The catalog list was checked against every key either screen reads at first paint (the
 * namespaces it names are exactly the ones those keys live in); a key outside them would show its
 * raw name, which `tests/unit/firm-boot.test.ts` and the Arabic crawl would catch.
 */

/** Routes the signed-in firm staff land on, and the reads each one paints from first. */
export const FIRM_FIRST_SCREENS: Record<string, { api: readonly string[] }> = {
  "/firm/clients": {
    // Only the reads the heading and the list paint from. The overview and bookkeeper
    // dashboard tiles (about 20 KB) load right after, so they do not queue ahead of the code.
    api: ["/api/firm/context", "/api/firm/clients"],
  },
  "/firm/command-center": {
    api: ["/api/firm/context", "/api/firm/command-center/dashboard"],
  },
};

/** Reads every signed-in screen waits for (session and company list). */
export const SHELL_BOOT_API = ["/api/auth/me", "/api/companies"] as const;

/** Catalog namespaces the firm first screens read (see the note above). */
export const FIRM_FIRST_SCREEN_NAMESPACES = [
  "components",
  "shell",
  "pages",
  "firm",
  "firmOps",
  "clientsFirm",
] as const;

/** Functional cookie that carries the chosen language, so the document can preload its catalogs. */
export const LOCALE_COOKIE = "muhasib_locale";

export function firmFirstScreen(pathname: string): { api: readonly string[] } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return FIRM_FIRST_SCREENS[path] ?? null;
}
