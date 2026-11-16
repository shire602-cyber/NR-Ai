import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Languages, Menu, Moon, Sun, X } from "lucide-react";
import { SkipLink } from "@/components/SkipLink";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { useMarketingPage, useMarketingTheme } from "./hooks";
import "./marketing.css";

/** The Muhasib.ai mark: the letter meem (م) on the brand emerald, as vectors. */
export function MarketingMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#0F6B4A" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.12"
      />
      {/* The letter meem (م) as in the app's BrandMark, outlined from Cairo Bold so
          the mark never depends on an Arabic font being loaded. */}
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M10.83 24.5Q10.65 23.4 10.5 22.36Q10.34 21.32 10.34 20.53Q10.34 18.94 10.96 17.77Q11.38 16.98 12.08 16.41Q11.95 15.71 11.86 14.83Q11.77 13.94 11.77 12.94Q11.77 11.94 11.86 11Q11.95 10.05 12.1 9.28Q12.24 8.52 12.36 8.05Q12.89 7.85 13.93 7.67Q14.97 7.5 16.17 7.5Q17.5 7.5 18.45 7.75Q19.39 8.01 20.02 8.48Q20.64 8.95 21 9.59Q21.37 10.23 21.51 11.03Q21.66 11.82 21.66 12.72L21.66 17.73L15.34 17.73Q15.01 17.73 14.62 17.82Q14.24 17.92 13.88 18.19Q13.52 18.47 13.3 19.03Q13.07 19.59 13.07 20.53Q13.07 21.26 13.21 22.24Q13.34 23.22 13.52 24.5ZM14.66 15.41Q14.99 15.37 15.34 15.37L18.95 15.37L18.95 12.7Q18.95 11.64 18.71 11.02Q18.48 10.39 17.88 10.13Q17.27 9.86 16.13 9.86Q15.44 9.86 14.73 9.95Q14.62 10.66 14.56 11.41Q14.5 12.21 14.5 12.9Q14.5 13.66 14.56 14.41Q14.6 14.96 14.66 15.41Z"
      />
    </svg>
  );
}

export function MarketingBrand({
  className = "",
  testId = "link-logo",
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <Link href="/" className={`mk-brand ${className}`} data-testid={testId}>
      <MarketingMark />
      <span translate="no" lang="en" dir="ltr">
        {"Muhasib"}
        <span className="mk-brand__dot">{".ai"}</span>
      </span>
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
      className="mk-btn mk-btn--ghost mk-btn--sm"
      onClick={() => setLocale(target)}
      title={t["marketing.switchLanguage"]}
      data-testid={testId}
    >
      <Languages aria-hidden="true" />
      <span lang={target}>{target === "ar" ? "العربية" : "English"}</span>
    </button>
  );
}

export function ThemeToggle() {
  const { isDark, toggle } = useMarketingTheme();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="mk-btn mk-btn--ghost mk-btn--icon"
      onClick={toggle}
      aria-label={isDark ? t["marketing.themeToLight"] : t["marketing.themeToDark"]}
      data-testid="button-theme-toggle"
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}

type NavItem = { href: string; key: string; anchor?: boolean };

const NAV: NavItem[] = [
  { href: "/#product", key: "marketing.navProduct", anchor: true },
  { href: "/#firms", key: "marketing.navFirms", anchor: true },
  { href: "/pricing", key: "marketing.navPricing" },
  { href: "/demo", key: "marketing.navDemo" },
  { href: "/help", key: "marketing.navHelp" },
];

function NavLink({ item, className }: { item: NavItem; className?: string }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  if (item.anchor) {
    // In-page anchors on the landing page; full navigation from other pages.
    const href = location === "/" ? item.href.slice(1) : item.href;
    return (
      <a href={href} className={className}>
        {t[item.key]}
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className={className}
      aria-current={location === item.href ? "page" : undefined}
    >
      {t[item.key]}
    </Link>
  );
}

export function MarketingHeader() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuId = useId();

  // Close the mobile menu when the route changes (state derived during render).
  const [menuLocation, setMenuLocation] = useState(location);
  if (menuLocation !== location) {
    setMenuLocation(location);
    setOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="mk-header" data-scrolled={scrolled || open}>
      <div className="mk-container mk-header__bar">
        <MarketingBrand />
        <nav className="mk-nav" aria-label={t["marketing.primaryNav"]}>
          {NAV.map((item) => (
            <NavLink key={item.key} item={item} />
          ))}
        </nav>
        <div className="mk-header__actions">
          <span className="mk-header__desktop-only">
            <LocaleToggle testId="button-language-toggle" />
          </span>
          <ThemeToggle />
          <Link
            href="/login"
            className="mk-btn mk-btn--ghost mk-btn--sm mk-header__desktop-only"
            data-testid="button-login"
          >
            {t["marketing.signIn"]}
          </Link>
          <Link
            href="/register"
            className="mk-btn mk-btn--primary mk-btn--sm"
            data-testid="button-get-started"
          >
            {t["marketing.startFree"]}
          </Link>
          <button
            type="button"
            className="mk-btn mk-btn--ghost mk-btn--icon mk-header__mobile-only"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? t["marketing.closeMenu"] : t["marketing.openMenu"]}
            onClick={() => setOpen((v) => !v)}
            data-testid="button-mobile-menu"
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open && (
        <div id={menuId} className="mk-mobile-menu">
          <nav className="mk-container" aria-label={t["marketing.primaryNav"]}>
            {NAV.map((item) => (
              <NavLink key={item.key} item={item} className="mk-mobile-menu__link" />
            ))}
            <div className="mk-mobile-menu__ctas">
              <Link href="/login" className="mk-btn mk-btn--secondary">
                {t["marketing.signIn"]}
              </Link>
              <Link href="/register" className="mk-btn mk-btn--primary">
                {t["marketing.startFree"]}
              </Link>
            </div>
            <div style={{ marginBlockStart: "0.75rem" }}>
              <LocaleToggle />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

const FOOTER_COLUMNS: { title: string; links: NavItem[] }[] = [
  {
    title: "marketing.footerProduct",
    links: [
      { href: "/#product", key: "marketing.footerFeatures", anchor: true },
      { href: "/pricing", key: "marketing.navPricing" },
      { href: "/demo", key: "marketing.footerDemo" },
      { href: "/services", key: "marketing.navServices" },
    ],
  },
  {
    title: "marketing.footerResources",
    links: [
      { href: "/help", key: "marketing.footerHelp" },
      { href: "/migration-guides", key: "marketing.footerMigration" },
      { href: "/trust", key: "marketing.footerTrust" },
    ],
  },
  {
    title: "marketing.footerLegal",
    links: [
      { href: "/privacy", key: "marketing.footerPrivacy" },
      { href: "/terms", key: "marketing.footerTerms" },
      { href: "/cookies", key: "marketing.footerCookies" },
    ],
  },
  {
    title: "marketing.footerAccount",
    links: [
      { href: "/login", key: "marketing.signIn" },
      { href: "/register", key: "marketing.footerCreateAccount" },
    ],
  },
];

export function MarketingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="mk-footer">
      <div className="mk-container">
        <div className="mk-footer__grid">
          <div className="mk-footer__brand">
            <MarketingBrand />
            <p>{t["marketing.footerTagline"]}</p>
            <p>
              <a href="mailto:hello@muhasib.ai" className="mk-link">
                <span dir="ltr">hello@muhasib.ai</span>
              </a>
            </p>
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.title} aria-labelledby={`mk-footer-${column.title}`}>
              <h2 id={`mk-footer-${column.title}`}>{t[column.title]}</h2>
              <ul>
                {column.links.map((item) => (
                  <li key={item.key}>
                    <NavLink item={item} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mk-footer__base">
          <p>
            {formatMessage(t["marketing.footerRights"] ?? "marketing.footerRights", {
              year: new Date().getFullYear(),
            })}{" "}
            {t["components.legalPoweredBy"]}
          </p>
          <div className="mk-footer__controls">
            <LocaleToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

interface MarketingLayoutProps {
  children: ReactNode;
  /** Catalog keys for the route's <title> and meta description. */
  titleKey: string;
  descriptionKey: string;
}

/** Shell for every public page: skip link, sticky header, <main>, footer, theme and SEO meta. */
export function MarketingLayout({ children, titleKey, descriptionKey }: MarketingLayoutProps) {
  useMarketingPage(titleKey, descriptionKey);
  return (
    <div className="mk-root">
      <SkipLink />
      <MarketingHeader />
      <main id="main-content" className="mk-main" tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
