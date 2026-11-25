import type { ReactNode } from "react";
import { useLightPublicTheme, useMarketingPage, usePublicChrome } from "./hooks";
import { SiteFooter } from "./phase/home/SiteFooter";
import { metaText } from "./phase/meta-text";
import { SiteHeader } from "./phase/SiteHeader";
// The homepage design system (tokens, header, buttons, bands), then the legacy page styles, then
// the layer that maps those legacy styles onto the homepage system.
import "./phase/phase.css";
import "./phase/home/home.css";
import "./marketing.css";
import "./unified.css";

/**
 * The shared public header and footer (with the skip link) around the content of a page that has
 * one URL for both languages. The content provides <main id="main-content">.
 */
export function PublicChrome({ children }: { children: ReactNode }) {
  const { locale, setLocale, tr, base, path, dir } = usePublicChrome();
  return (
    <div className="mk-root">
      <div className="phase-site mk-chrome" lang={locale} dir={dir}>
        <a className="phase-skip" href="#main-content">
          {metaText(locale, "hxNavSkip")}
        </a>
        <SiteHeader key={path} base={base} path={path} tr={tr} onSwitchLocale={setLocale} />
      </div>
      {children}
      <div className="phase-site mk-chrome" lang={locale} dir={dir}>
        <SiteFooter base={base} locale={locale} tr={tr} onSwitchLocale={setLocale} />
      </div>
    </div>
  );
}

interface MarketingLayoutProps {
  children: ReactNode;
  /** Catalog keys for the route's <title> and meta description. */
  titleKey: string;
  descriptionKey: string;
}

/**
 * Shell for the public pages outside the /en and /ar site (legal, help, sample workspace, 404):
 * the same header and footer as the homepage, around a <main> styled by the homepage system.
 */
export function MarketingLayout({ children, titleKey, descriptionKey }: MarketingLayoutProps) {
  useMarketingPage(titleKey, descriptionKey);
  useLightPublicTheme();
  return (
    <PublicChrome>
      <main id="main-content" className="mk-main" tabIndex={-1}>
        {children}
      </main>
    </PublicChrome>
  );
}
