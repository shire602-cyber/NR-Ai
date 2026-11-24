export type SiteLocale = "en" | "ar";

export function siteLocale(path: string): SiteLocale | undefined {
  return /^\/ar(?:\/|$)/.test(path) ? "ar" : /^\/en(?:\/|$)/.test(path) ? "en" : undefined;
}

/** True when two paths differ only by their `/en` or `/ar` prefix (the language toggle). */
export function isLocaleSwitch(from: string, to: string): boolean {
  const bare = (path: string) =>
    path.replace(/^\/(?:en|ar)(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  return from !== to && siteLocale(from) !== siteLocale(to) && bare(from) === bare(to);
}
