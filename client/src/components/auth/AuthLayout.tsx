import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Languages, Landmark, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { LocaleToggle, MarketingBrand } from "@/components/marketing/MarketingLayout";
import { useLightPublicTheme, useMarketingPage } from "@/components/marketing/hooks";
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
 * Split-screen shell for sign-in, registration, password recovery, the OAuth callback and
 * email verification: the inverse brand panel with the ledger-ruling motif (desktop only) and
 * the form straight on the page canvas, 400 px wide, no card (spec 3.2). Shares the homepage
 * tokens, brand lockup, buttons and SEO handling with the rest of the public site.
 */
export function AuthLayout({ children, variant }: AuthLayoutProps) {
  const { t } = useTranslation();
  const copy = COPY[variant];
  useMarketingPage(`marketing.seo${copy.seo}Title`, `marketing.seo${copy.seo}Description`);
  useLightPublicTheme();

  return (
    <div className="mk-root">
      <SkipLink />
      <div className="mk-auth">
        <aside className="mk-auth__panel">
          <span
            className="mk-ruling mk-ruling--fill bg-ledger-ruling on-inverse"
            aria-hidden="true"
          />
          <MarketingBrand testId="link-brand-home" />
          <div>
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
          <p className="mk-auth__panel-foot">{t["components.legalPoweredBy"]}</p>
        </aside>

        <div className="mk-auth__form">
          <header className="mk-auth__top">
            <Button asChild variant="ghost" size="sm" className="mk-auth__back">
              <Link href="/" data-testid="button-back-home">
                <ArrowLeft className="mk-flip" aria-hidden="true" />
                {t["marketing.backToHome"]}
              </Link>
            </Button>
            <MarketingBrand className="mk-auth__brand" testId="link-auth-logo" />
            <div className="mk-auth__lang">
              <LocaleToggle testId="button-language-toggle" />
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
