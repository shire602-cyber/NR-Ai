import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  Calculator,
  FileCheck,
  FileText,
  FileX,
  Languages,
  Mail,
  Shield,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Checklist, SectionHeading, Tiles } from "@/components/marketing/Sections";

// R3 (CTO 9): the accounting-services page uses the home page's section system (line eyebrow,
// sentence case, hairline tiles, firms band, CTA card). Removed: the roadmap AI grid, the AI
// hype block and the VAT/CT/CSV/Help stat strip. Copy is catalog-driven
// (marketing.svc*) and only states what the firm and the product do today.

const CONSULT_HREF = "mailto:support@muhasib.ai?subject=Accounting%20services%20consultation";

const SERVICES = [
  FileText,
  Building2,
  FileX,
  FileCheck,
  Calculator,
  BookOpen,
  Sparkles,
  BarChart3,
  Shield,
];

const WHY = [
  [Sparkles, 1],
  [Shield, 2],
  [Languages, 3],
] as const;

export default function Services() {
  const { t } = useTranslation();

  return (
    <MarketingLayout
      titleKey="marketing.seoServicesTitle"
      descriptionKey="marketing.seoServicesDescription"
    >
      <section className="mk-pagehead" aria-labelledby="svc-title">
        <div className="mk-container">
          <p className="mk-eyebrow" data-testid="badge-hero">
            {t["marketing.svcEyebrow"]}
          </p>
          <h1 className="mk-h1" id="svc-title" data-testid="text-hero-headline">
            {t["marketing.svcTitle"]}
          </h1>
          <p className="mk-lead" data-testid="text-hero-subheadline">
            {t["marketing.svcLead"]}
          </p>
          <div className="mk-actions">
            <Button asChild size="lg" data-testid="button-book-consultation">
              <a href={CONSULT_HREF}>
                <Mail aria-hidden="true" />
                {t["marketing.svcBook"]}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="button-hero-get-started">
              <Link href="/register">
                {t["marketing.svcStart"]}
                <ArrowRight className="mk-flip" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <Checklist items={[1, 2, 3].map((n) => t[`marketing.svcFact${n}`])} />
        </div>
      </section>

      <section className="mk-section" aria-labelledby="svc-services-title">
        <div className="mk-container">
          <SectionHeading
            id="svc-services-title"
            eyebrow={t["marketing.svcServicesEyebrow"]}
            title={t["marketing.svcServicesTitle"]}
            body={t["marketing.svcServicesBody"]}
          />
          <Tiles
            items={SERVICES.map((icon, i) => ({
              key: `svc-${i + 1}`,
              icon,
              title: t[`marketing.svc${i + 1}Title`],
              body: t[`marketing.svc${i + 1}Body`],
              testId: `card-service-${i}`,
            }))}
          />
        </div>
      </section>

      <section className="mk-section mk-band" aria-labelledby="svc-why-title">
        <div className="mk-container mk-firms">
          <div>
            <p className="mk-eyebrow">{t["marketing.svcWhyEyebrow"]}</p>
            <h2 id="svc-why-title" className="mk-h2" style={{ marginBlockStart: "1rem" }}>
              {t["marketing.svcWhyTitle"]}
            </h2>
            <p className="mk-lead" style={{ marginBlockStart: "1.25rem" }}>
              {t["marketing.svcWhyBody"]}
            </p>
          </div>
          <ul className="mk-firms__list">
            {WHY.map(([Icon, n]) => (
              <li key={n} className="mk-firms__item" data-testid={`card-why-${n - 1}`}>
                <Icon aria-hidden="true" />
                <h3 className="mk-h3">{t[`marketing.svcWhy${n}Title`]}</h3>
                <p>{t[`marketing.svcWhy${n}Body`]}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mk-section" aria-labelledby="svc-clients-title">
        <div className="mk-container">
          <SectionHeading
            id="svc-clients-title"
            eyebrow={t["marketing.svcClientsEyebrow"]}
            title={t["marketing.svcClientsTitle"]}
          />
          <ul className="mk-chips">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <li key={n} data-testid={`card-client-${n - 1}`}>
                {t[`marketing.svcClient${n}`]}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className="mk-section"
        style={{ paddingBlockStart: 0 }}
        aria-labelledby="svc-cta-title"
      >
        <div className="mk-container">
          <div className="mk-cta">
            <h2 id="svc-cta-title" className="mk-h2" data-testid="text-cta-headline">
              {t["marketing.svcCtaTitle"]}
            </h2>
            <p className="mk-lead">{t["marketing.svcCtaBody"]}</p>
            <div className="mk-hero__ctas">
              <Button asChild size="xl" data-testid="button-cta-consultation">
                <a href={CONSULT_HREF}>
                  <Mail aria-hidden="true" />
                  {t["marketing.svcBook"]}
                </a>
              </Button>
              <Button asChild variant="outline" size="xl">
                <Link href="/register">{t["marketing.svcStart"]}</Link>
              </Button>
            </div>
            <p
              className="mk-small"
              style={{ marginBlockStart: "1.5rem" }}
              data-testid="text-footer"
            >
              {t["marketing.svcOperator"]}
            </p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
