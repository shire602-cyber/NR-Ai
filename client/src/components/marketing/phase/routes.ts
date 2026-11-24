export type SiteLocale = "en" | "ar";

export function siteLocale(path: string): SiteLocale | undefined {
  return /^\/ar(?:\/|$)/.test(path) ? "ar" : /^\/en(?:\/|$)/.test(path) ? "en" : undefined;
}
