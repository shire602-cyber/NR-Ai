import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Languages, Menu, X } from "lucide-react";
import { SkipLink } from "@/components/SkipLink";
import { BrandMark, ProductWordmark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { formatMessage, useI18n, useTranslation } from "@/lib/i18n";
import { useMarketingPage } from "./hooks";
import "./marketing.css";

export function MarketingBrand({
  className = "",
  testId = "link-logo",
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <Link href="/" className={`mk-brand ${className}`} data-testid={testId}>
      <BrandMark size="sm" />
      <ProductWordmark accentClassName="mk-brand__dot" />
    </Link>
  );
}

/** Language switch: shows the name of the language you would switch to, in that language. */
export function LocaleToggle({ testId }: { testId?: string }) {
  const { locale, setLocale } = useI18n();
  const { t } = useTranslation();
  const target = locale === "ar" ? "en" : "ar";
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => setLocale(target)}
      title={t["marketing.switchLanguage"]}
      data-testid={testId}
    >
      <Languages aria-hidden="true" />
      <span lang={target}>{target === "ar" ? "العربية" : "English"}</span>
    </Button>
  );
}

export { ThemeToggle };

type NavItem = { href: string; key: string; anchor?: boolean };

const NAV: NavItem[] = [
  { href: "/#product", key: "marketing.navProduct", anchor: true },
  { href: "/services", key: "marketing.navFirms" },
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
          <Button asChild variant="ghost" size="sm" className="mk-header__desktop-only">
            <Link href="/login" data-testid="button-login">
              {t["marketing.signIn"]}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register" data-testid="button-get-started">
              {t["marketing.startFreeTrial"]}
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mk-header__mobile-only"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? t["marketing.closeMenu"] : t["marketing.openMenu"]}
            onClick={() => setOpen((v) => !v)}
            data-testid="button-mobile-menu"
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {open && (
        <div id={menuId} className="mk-mobile-menu">
          <nav className="mk-container" aria-label={t["marketing.primaryNav"]}>
            {NAV.map((item) => (
              <NavLink key={item.key} item={item} className="mk-mobile-menu__link" />
            ))}
            <div className="mk-mobile-menu__ctas">
              <Button asChild variant="outline" size="lg">
                <Link href="/login">{t["marketing.signIn"]}</Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/register">{t["marketing.startFreeTrial"]}</Link>
              </Button>
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
