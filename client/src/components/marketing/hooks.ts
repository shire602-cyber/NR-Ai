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
export function usePageMeta(title: string | undefined, description: string | undefined) {
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
    return () => {
      document.title = previousTitle;
      if (previousDescription) {
        setMeta('meta[name="description"]', "name", "description", previousDescription);
      }
    };
  }, [title, description]);
}

/**
 * Route-level SEO meta for every public page. Theme and fonts are the app's own
 * (client/src/lib/theme.ts, index.css): the public site has no second system.
 */
export function useMarketingPage(titleKey: string, descriptionKey: string) {
  const { t } = useTranslation();
  usePageMeta(t[titleKey], t[descriptionKey]);
}
