import arMeta from "../../../locales/ar/marketingMeta.json";
import enMeta from "../../../locales/en/marketingMeta.json";

/**
 * Copy the server renders (page h1, title, meta description) and the site header. It lives in the
 * small `marketingMeta` catalog, which is the only source: the server and this module read the JSON
 * directly, and the client store loads the same files as the `marketingMeta` namespace.
 */
export type MetaKey = keyof typeof enMeta extends `marketing.${infer Rest}` ? Rest : never;

const catalogs = { en: enMeta, ar: arMeta } as const;

export function metaText(
  locale: "en" | "ar",
  key: MetaKey,
  vars?: Record<string, string | number>
): string {
  const value = (catalogs[locale] as Record<string, string>)[`marketing.${key}`] ?? "";
  return vars ? value.replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m)) : value;
}

/** Both languages as an `[en, ar]` pair, for code that still takes a `Bilingual` tuple. */
export function metaPair(key: MetaKey, vars?: Record<string, string | number>): [string, string] {
  return [metaText("en", key, vars), metaText("ar", key, vars)];
}
