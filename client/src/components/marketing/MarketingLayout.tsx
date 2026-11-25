import { MARKETING_BRAND } from "@shared/marketing-brand";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { useI18n, useTranslation } from "@/lib/i18n";
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

/** The brand lockup of the public site (same mark and wordmark as the site header). */
export function MarketingBrand({
  className = "",
  testId = "link-logo",
}: {
  className?: string;
  testId?: string;
}) {
  const locale = useI18n((state) => state.locale);
  return (
    <Link
      href={`/${locale}`}
      className={`phase-brand ${className}`}
      data-testid={testId}
      translate="no"
    >
      <BrandMark size="sm" />
      <bdi>{MARKETING_BRAND.name[locale]}</bdi>
    </Link>
  );
}

/** Language switch: shows the name of the language you would switch to, in that language. */
export function LocaleToggle({ testId }: { testId?: string }) {
  const { locale, setLocale } = useI18n();
  const { t } = useTranslation();
  const target = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      className="phase-lang"
      lang={target}
      onClick={() => setLocale(target)}
      title={t["marketing.switchLanguage"]}
      data-testid={testId}
    >
      {target === "ar" ? "العربية" : "English"}
    </button>
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
  const { locale, setLocale, tr, base, path, dir } = usePublicChrome();
  return (
    <div className="mk-root">
      <div className="phase-site mk-chrome" lang={locale} dir={dir}>
        <a className="phase-skip" href="#main-content">
          {metaText(locale, "hxNavSkip")}
        </a>
        <SiteHeader key={path} base={base} path={path} tr={tr} onSwitchLocale={setLocale} />
      </div>
      <main id="main-content" className="mk-main" tabIndex={-1}>
        {children}
      </main>
      <div className="phase-site mk-chrome" lang={locale} dir={dir}>
        <SiteFooter base={base} locale={locale} tr={tr} onSwitchLocale={setLocale} />
      </div>
    </div>
  );
}
