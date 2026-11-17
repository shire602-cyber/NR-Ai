import { Link } from "wouter";
import { Alert } from "@/components/ui/alert";
import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

type LegalSlug = "privacy" | "terms" | "cookies";

const DOCS: { slug: LegalSlug; href: string; title: string; seo: string }[] = [
  { slug: "privacy", href: "/privacy", title: "marketing.legalPrivacyTitle", seo: "Privacy" },
  { slug: "terms", href: "/terms", title: "marketing.legalTermsTitle", seo: "Terms" },
  { slug: "cookies", href: "/cookies", title: "marketing.legalCookiesTitle", seo: "Cookies" },
];

interface LegalLayoutProps {
  slug: LegalSlug;
  /** ISO date (yyyy-mm-dd) the document took effect. */
  effectiveDate: string;
  children: ReactNode;
  /** Arabic reading copy shown in Arabic mode; the English `children` stay authoritative. */
  arabic?: ReactNode;
}

/**
 * Public legal documents on the marketing shell. The documents are written in
 * English and the English text governs. Arabic mode shows an Arabic reading copy (when the page
 * supplies one) under a notice saying the English text governs; otherwise the English body keeps
 * lang="en" under the same kind of notice.
 */
export function LegalLayout({ slug, effectiveDate, children, arabic }: LegalLayoutProps) {
  const { t, locale } = useTranslation();
  const doc = DOCS.find((d) => d.slug === slug) ?? DOCS[0];
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
  }).format(new Date(`${effectiveDate}T00:00:00Z`));

  return (
    <MarketingLayout
      titleKey={`marketing.seo${doc.seo}Title`}
      descriptionKey={`marketing.seo${doc.seo}Description`}
    >
      <header className="mk-pagehead">
        <div className="mk-container">
          <p className="mk-eyebrow">{t["marketing.footerLegal"]}</p>
          <h1 className="mk-h1">{t[doc.title]}</h1>
          <p className="mk-small" style={{ marginBlockStart: "1rem" }}>
            {t["components.legalEffectiveDate"]} <time dateTime={effectiveDate}>{date}</time>
          </p>
        </div>
      </header>
      <div className="mk-container mk-legal">
        <nav className="mk-legal__aside" aria-label={t["marketing.legalOnThisPage"]}>
          <h2>{t["marketing.legalOnThisPage"]}</h2>
          <ul>
            {DOCS.map((d) => (
              <li key={d.slug}>
                <Link href={d.href} aria-current={d.slug === slug ? "page" : undefined}>
                  {t[d.title]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          {locale === "ar" && (
            <Alert tone="info" className="mb-8">
              {arabic ? t["marketing.legalArabicNotice"] : t["marketing.legalEnglishOnly"]}
            </Alert>
          )}
          {locale === "ar" && arabic ? (
            <article
              className="mk-prose"
              lang="ar"
              dir="rtl"
              style={{ marginBlockStart: "1.5rem" }}
              data-testid="legal-arabic-copy"
            >
              {arabic}
            </article>
          ) : (
            <article
              className="mk-prose"
              lang="en"
              dir="ltr"
              style={locale === "ar" ? { marginBlockStart: "1.5rem" } : undefined}
            >
              {children}
            </article>
          )}
          <div className="mk-legal__contact">
            <strong>{t["marketing.legalQuestions"]}</strong>
            {t["marketing.legalWriteTo"]}{" "}
            <a href="mailto:hello@muhasib.ai" className="mk-link" dir="ltr">
              hello@muhasib.ai
            </a>
            <p style={{ marginBlockStart: "0.5rem" }}>{t["components.legalPoweredBy"]}</p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
