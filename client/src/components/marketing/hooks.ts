import { useEffect } from "react";
import { useTranslation } from "@/lib/i18n";

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
 * Route-level SEO meta for every public page. Theme and fonts are the app's own
 * (client/src/lib/theme.ts, index.css): the public site has no second system.
 */
export function useMarketingPage(titleKey: string, descriptionKey: string) {
  const { t } = useTranslation();
  usePageMeta(t[titleKey], t[descriptionKey]);
}
