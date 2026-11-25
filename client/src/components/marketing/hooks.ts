import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { useI18n, useTranslation } from "@/lib/i18n";
import { applyStoredTheme } from "@/lib/theme";

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
export function usePageMeta(
  title: string | undefined,
  description: string | undefined,
  page?: { canonical: string; en: string; ar: string }
) {
  const canonical = page?.canonical;
  const en = page?.en;
  const ar = page?.ar;
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
    const headLinks = [
      ["canonical", "", canonical],
      ["alternate", "en-AE", en],
      ["alternate", "ar-AE", ar],
      ["alternate", "x-default", en],
    ] as const;
    for (const [rel, hreflang, href] of headLinks) {
      const selector = `link[rel="${rel}"]${hreflang ? `[hreflang="${hreflang}"]` : ""}`;
      const old = document.head.querySelector<HTMLLinkElement>(selector);
      if (!href) {
        old?.remove();
        continue;
      }
      const link = old ?? document.createElement("link");
      link.rel = rel;
      if (hreflang) link.hreflang = hreflang;
      link.href = href;
      if (!old) document.head.appendChild(link);
    }
    return () => {
      document.title = previousTitle;
      if (previousDescription) {
        setMeta('meta[name="description"]', "name", "description", previousDescription);
      }
    };
  }, [title, description, canonical, en, ar]);
}

/**
 * The public site has one look: the light homepage system. A visitor whose app preference is dark
 * still gets light public pages; the saved preference is untouched and is applied again as soon as
 * the public page unmounts (signing in, opening the app).
 */
export function useLightPublicTheme() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains("dark")) return;
    html.classList.remove("dark");
    return applyStoredTheme;
  }, []);
}

/**
 * Route-level SEO meta for every public page.
 */
export function useMarketingPage(titleKey: string, descriptionKey: string) {
  const { t } = useTranslation();
  usePageMeta(t[titleKey], t[descriptionKey]);
}

/** What the shared site header and footer need on a page that has one URL for both languages. */
export function usePublicChrome() {
  const locale = useI18n((state) => state.locale);
  const setLocale = useI18n((state) => state.setLocale);
  const [location] = useLocation();
  const tr = (content: readonly [string, string]) => content[locale === "ar" ? 1 : 0];
  return {
    locale,
    setLocale,
    tr,
    base: `/${locale}`,
    path: location.split(/[?#]/, 1)[0] || "/",
    dir: locale === "ar" ? ("rtl" as const) : ("ltr" as const),
  };
}
