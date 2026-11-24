import { useCallback, useEffect } from "react";
import { loadNamespace, t, useCatalogRevision } from "@/lib/i18n";
import type enMarketing from "@/locales/en/marketing.json";
import type { SiteLocale } from "../routes";

type CatalogKey = keyof typeof enMarketing;
/** A key of the English marketing catalog without its `marketing.` prefix, e.g. `hxHeroTitle`. */
export type MarketingKey = CatalogKey extends infer K
  ? K extends `marketing.${infer Rest}`
    ? Rest
    : never
  : never;

export type MarketingText = (key: MarketingKey, vars?: Record<string, string | number>) => string;

/** Present in every build of the catalog, so its absence means the chunk is not loaded yet. */
const READY_KEY = "marketing.hxHeroTitle";
const requested = new Set<SiteLocale>();

/** Replace `{name}` placeholders; unknown names are left as written. */
export function fillPlaceholders(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/**
 * Marketing copy for the URL-forced locale (`/en` or `/ar`), read from the marketing catalog.
 * The store may hold the other locale while the visitor lands on a forced one, so this loads the
 * marketing chunk for `locale` on demand and re-renders when it arrives. Until then a missing key
 * renders as "" (never the other language, never the raw key).
 */
export function useMarketingText(locale: SiteLocale): MarketingText {
  const revision = useCatalogRevision();
  useEffect(() => {
    if (READY_KEY in t[locale] || requested.has(locale)) return;
    requested.add(locale);
    loadNamespace(locale, "marketing").catch(() => requested.delete(locale));
  }, [locale, revision]);
  return useCallback<MarketingText>(
    (key, vars) => {
      const value = t[locale][`marketing.${key}`];
      return typeof value === "string" ? fillPlaceholders(value, vars) : "";
    },
    // `revision` changes when a catalog chunk lands, so consumers re-render with the new text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, revision]
  );
}
