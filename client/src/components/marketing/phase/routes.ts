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

/**
 * Bare (locale-less) URLs that old links, ads and the signed-in app still use. They redirect to
 * the language-prefixed marketing page; `/pricing` is the new pricing page, not the legacy one.
 */
const BARE_REDIRECTS = new Map([
  ["/pricing", "/en/pricing"],
  ["/e-invoicing", "/en/uae-e-invoicing"],
  ["/free-tools", "/en/tools"],
  ["/accounting-firms", "/en/solutions/accounting-firms"],
  ["/small-business", "/en/solutions/small-business"],
  ["/compare", "/en/compare"],
  ["/compare/wafeq", "/en/compare/wafeq"],
  ["/compare/zoho-books", "/en/compare/zoho"],
]);

/** The `/en/...` target for a bare marketing URL, or undefined when the path is not one. */
export function bareMarketingRedirect(path: string): string | undefined {
  return BARE_REDIRECTS.get(path.replace(/\/+$/, "") || "/");
}
