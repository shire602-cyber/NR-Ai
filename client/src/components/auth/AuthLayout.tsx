import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Languages, Landmark, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { LocaleToggle, MarketingBrand, ThemeToggle } from "@/components/marketing/MarketingLayout";
import { useMarketingPage } from "@/components/marketing/hooks";
import { SkipLink } from "@/components/SkipLink";

const TRUST_POINTS = [
  { icon: Landmark, title: "marketing.authPoint1Title", body: "marketing.authPoint1Body" },
  { icon: ShieldCheck, title: "marketing.authPoint2Title", body: "marketing.authPoint2Body" },
  { icon: Languages, title: "marketing.authPoint3Title", body: "marketing.authPoint3Body" },
];

export type AuthVariant = "login" | "register" | "forgot" | "reset";

const COPY: Record<AuthVariant, { lead: string; accent: string; sub: string; seo: string }> = {
  login: {
    lead: "marketing.authLoginLead",
    accent: "marketing.authLoginAccent",
    sub: "marketing.authLoginSub",
    seo: "Login",
  },
  register: {
    lead: "marketing.authRegisterLead",
    accent: "marketing.authRegisterAccent",
    sub: "marketing.authRegisterSub",
    seo: "Register",
  },
  forgot: {
    lead: "marketing.authRecoverLead",
    accent: "marketing.authRecoverAccent",
    sub: "marketing.authRecoverSub",
    seo: "Forgot",
  },
  reset: {
    lead: "marketing.authRecoverLead",
    accent: "marketing.authRecoverAccent",
    sub: "marketing.authResetSub",
    seo: "Reset",
  },
};

interface AuthLayoutProps {
  children: ReactNode;
  variant: AuthVariant;
}

/**
 * Split-screen shell for sign-in, registration and password recovery: the
 * midnight brand panel (desktop only) and the form on the public-site canvas.
 * Shares tokens, header controls and SEO handling with the marketing pages.
 */
export function AuthLayout({ children, variant }: AuthLayoutProps) {
  const { t } = useTranslation();
  const copy = COPY[variant];
  useMarketingPage(`marketing.seo${copy.seo}Title`, `marketing.seo${copy.seo}Description`);

  return (
    <div className="mk-root">
      <SkipLink />
      <div className="mk-auth">
        <aside className="mk-auth__panel">
          <MarketingBrand testId="link-brand-home" />
          <div>
            <p className="mk-eyebrow">{t["marketing.authEyebrow"]}</p>
            <p className="mk-auth__headline">
              {t[copy.lead]} <em>{t[copy.accent]}</em>
            </p>
            <p className="mk-auth__sub">{t[copy.sub]}</p>
            <ul className="mk-auth__points">
              {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <span className="mk-auth__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <strong>{t[title]}</strong>
                  <p>{t[body]}</p>
                </li>
              ))}
            </ul>
          </div>
          <span aria-hidden="true" />
        </aside>

        <div className="mk-auth__form">
          <header className="mk-auth__top">
            <Link
              href="/"
              className="mk-btn mk-btn--ghost mk-btn--sm mk-auth__back"
              data-testid="button-back-home"
            >
              <ArrowLeft className="mk-flip" aria-hidden="true" />
              {t["marketing.backToHome"]}
            </Link>
            <MarketingBrand className="mk-auth__brand" testId="link-auth-logo" />
            <div className="mk-header__actions" style={{ marginInlineStart: 0 }}>
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </header>
          <main id="main-content" className="mk-auth__body" tabIndex={-1}>
            <div className="mk-auth__inner">{children}</div>
          </main>
          <footer className="mk-auth__foot">{t["marketing.authFooter"]}</footer>
        </div>
      </div>
    </div>
  );
}
