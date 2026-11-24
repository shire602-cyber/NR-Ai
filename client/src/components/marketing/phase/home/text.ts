import { createElement, Fragment, useCallback, useEffect, type ReactNode } from "react";
import { loadNamespace, t, useCatalogRevision } from "@/lib/i18n";
import type enMarketing from "@/locales/en/marketing.json";
import type enMarketingHome from "@/locales/en/marketingHome.json";
import type enMarketingMeta from "@/locales/en/marketingMeta.json";
import type { SiteLocale } from "../routes";

// Copy lives in two catalogs: the original `marketing` one (also read by in-app pages) and
// `marketingHome` (the rebuilt public site, loaded only on /en and /ar). Keys share the
// `marketing.` prefix.
type CatalogKey = keyof typeof enMarketing | keyof typeof enMarketingHome | keyof typeof enMarketingMeta;
/** A key of the English marketing catalog without its `marketing.` prefix, e.g. `hxHeroTitle`. */
export type MarketingKey = CatalogKey extends infer K
  ? K extends `marketing.${infer Rest}`
    ? Rest
    : never
  : never;

type Vars = Record<string, string | number>;
export type MarketingText = (key: MarketingKey, vars?: Vars) => string;
export type MarketingRich = (key: MarketingKey, vars?: Vars) => ReactNode;

/** Present in every build of the catalog, so its absence means the chunk is not loaded yet. */
const READY_KEY = "marketing.hxDlSourcePenalty";
const requested = new Set<SiteLocale>();

/** Third-party proper noun inside a sentence: `⟦Elite⟧` renders as an English, untranslated island. */
const BRAND_MARK = /⟦([^⟧]*)⟧/g;

/** Replace `{name}` placeholders; unknown names are left as written. */
export function fillPlaceholders(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Drop the `⟦ ⟧` markers for plain-string consumers (aria labels, captions, option text). */
export function stripBrandMarks(value: string): string {
  return value.replace(BRAND_MARK, "$1");
}

/** Wrap every `⟦name⟧` in `<bdi lang="en" translate="no">` so vendor names stay Latin in Arabic. */
export function brandNodes(value: string): ReactNode {
  const parts = value.split(BRAND_MARK);
  if (parts.length === 1) return value;
  return createElement(
    Fragment,
    null,
    parts.map((part, index) =>
      index % 2 === 1
        ? createElement("bdi", { key: index, lang: "en", translate: "no" }, part)
        : part || null
    )
  );
}

function useCatalogLookup(locale: SiteLocale) {
  const revision = useCatalogRevision();
  useEffect(() => {
    if (READY_KEY in t[locale] || requested.has(locale)) return;
    requested.add(locale);
    Promise.all([
      loadNamespace(locale, "marketing"),
      loadNamespace(locale, "marketingMeta"),
      loadNamespace(locale, "marketingHome"),
    ]).catch(() => requested.delete(locale));
  }, [locale, revision]);
  return useCallback(
    (key: MarketingKey, vars?: Vars) => {
      const value = t[locale][`marketing.${key}`];
      return typeof value === "string" ? fillPlaceholders(value, vars) : "";
    },
    // `revision` changes when a catalog chunk lands, so consumers re-render with the new text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, revision]
  );
}

/**
 * Marketing copy for the URL-forced locale (`/en` or `/ar`), read from the marketing catalog.
 * The store may hold the other locale while the visitor lands on a forced one, so this loads the
 * marketing chunk for `locale` on demand and re-renders when it arrives. Until then a missing key
 * renders as "" (never the other language, never the raw key).
 */
export function useMarketingText(locale: SiteLocale): MarketingText {
  const lookup = useCatalogLookup(locale);
  return useCallback<MarketingText>((key, vars) => stripBrandMarks(lookup(key, vars)), [lookup]);
}

/** Like `useMarketingText` but returns nodes, with `⟦brand⟧` spans rendered as English islands. */
export function useMarketingRich(locale: SiteLocale): MarketingRich {
  const lookup = useCatalogLookup(locale);
  return useCallback<MarketingRich>((key, vars) => brandNodes(lookup(key, vars)), [lookup]);
}
