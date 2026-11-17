import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowRight,
  FileDown,
  FileSpreadsheet,
  FileText,
  Info,
  Landmark,
  LineChart,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import {
  Amount,
  ProductPreview,
  StatusBadge,
  VatPreview,
} from "@/components/marketing/ProductPreview";
import { SAMPLE } from "@/components/marketing/sample";
import { Checklist, ClosingCta, FaqSection, SectionHeading } from "@/components/marketing/Sections";
import { PlanCard } from "@/components/marketing/PlanCard";
import { PLANS } from "@/components/marketing/plans";
import { StatusBadge as Status } from "@/components/ui/status-badge";

// Muhasib.ai public landing page (D1). Every capability on this page exists in
// the product today; anything that needs an outside party (FTA submission,
// e-invoice transmission) says so. Styles: components/marketing/marketing.css.

type Icon = LucideIcon;

function FeatureCard({
  icon: IconCmp,
  title,
  body,
  points,
  children,
}: {
  icon: Icon;
  title: string;
  body: string;
  points: string[];
  children: ReactNode;
}) {
  return (
    <article className="mk-card mk-feature">
      <span className="mk-feature__icon">
        <IconCmp aria-hidden="true" />
      </span>
      <h3 className="mk-h3">{title}</h3>
      <p className="mk-body">{body}</p>
      <Checklist items={points} />
      <div className="mk-feature__visual" aria-hidden="true">
        {children}
      </div>
    </article>
  );
}

function Hero() {
  const { t } = useTranslation();
  const facts = [
    "marketing.factLedger",
    "marketing.factVat",
    "marketing.factBilingual",
    "marketing.factCurrency",
    "marketing.factExports",
  ];
  return (
    <section className="mk-hero" aria-labelledby="mk-hero-title">
      <div className="mk-container">
        <div className="mk-hero__copy">
          <p className="mk-eyebrow mk-rise">{t["marketing.heroEyebrow"]}</p>
          <h1 id="mk-hero-title" className="mk-display mk-rise mk-rise--2">
            {t["marketing.heroTitleLead"]}{" "}
            <span className="mk-accent">{t["marketing.heroTitleAccent"]}</span>
          </h1>
          <p className="mk-lead mk-rise mk-rise--3">{t["marketing.heroBody"]}</p>
          <div className="mk-hero__ctas mk-rise mk-rise--3">
            <Button asChild size="xl">
              <Link href="/register" data-testid="button-hero-start">
                {t["marketing.startFreeTrial"]}
                <ArrowRight className="mk-flip" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <Link href="/demo" data-testid="button-hero-demo">
                {t["marketing.heroSecondary"]}
              </Link>
            </Button>
          </div>
          <p className="mk-hero__note mk-rise mk-rise--3">{t["marketing.heroNote"]}</p>
        </div>
        <div className="mk-hero__visual mk-rise mk-rise--4">
          <span className="mk-ruling bg-ledger-ruling" aria-hidden="true" />
          <ProductPreview />
        </div>
        <ul className="mk-facts">
          {facts.map((key) => (
            <li key={key}>{t[key]}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Product() {
  const { t } = useTranslation();
  const pl = SAMPLE.pl;
  const gross = pl.income - pl.costOfSales;
  return (
    <section id="product" className="mk-section" aria-labelledby="mk-product-title">
      <div className="mk-container">
        <SectionHeading
          id="mk-product-title"
          eyebrow={t["marketing.productEyebrow"]}
          title={t["marketing.productTitle"]}
          body={t["marketing.productBody"]}
        />

        <div className="mk-spotlight">
          <div>
            <p className="mk-eyebrow">{t["marketing.vatEyebrow"]}</p>
            <h3 className="mk-h2 mk-spotlight__title">{t["marketing.vatTitle"]}</h3>
            <p className="mk-body mk-spotlight__body">{t["marketing.vatBody"]}</p>
            <Checklist
              items={[t["marketing.vatPoint1"], t["marketing.vatPoint2"], t["marketing.vatPoint3"]]}
            />
            <p className="mk-note">
              <Info aria-hidden="true" />
              <span>{t["marketing.vatNote"]}</span>
            </p>
          </div>
          <VatPreview />
        </div>

        <div className="mk-features">
          <FeatureCard
            icon={FileText}
            title={t["marketing.invoiceTitle"]}
            body={t["marketing.invoiceBody"]}
            points={[t["marketing.invoicePoint1"], t["marketing.invoicePoint2"]]}
          >
            <div className="mk-doc">
              <div className="mk-doc__head">
                <div>
                  <div className="mk-doc__title" lang="en" dir="ltr">
                    {"Tax Invoice"}
                  </div>
                  <div className="mk-small mk-num">{"INV-1043"}</div>
                </div>
                <div className="mk-doc__end">
                  <div className="mk-doc__title-ar" lang="ar" dir="rtl">
                    {t["marketing.invoiceDocTitleAr"]}
                  </div>
                  <div className="mk-small">
                    {t["marketing.invoiceDocTrn"]}{" "}
                    <span className="mk-num">{"100000000000003"}</span>
                  </div>
                </div>
              </div>
              <div className="mk-doc__row">
                <span>{t["marketing.invoiceDocLine"]}</span>
                <Amount value={9200} />
              </div>
              <div className="mk-doc__row">
                <span>{t["marketing.invoiceDocVat"]}</span>
                <Amount value={460} />
              </div>
              <div className="mk-doc__row mk-doc__row--total">
                <span>{t["marketing.invoiceDocTotal"]}</span>
                <Amount value={9660} />
              </div>
            </div>
          </FeatureCard>

          <FeatureCard
            icon={Landmark}
            title={t["marketing.bankTitle"]}
            body={t["marketing.bankBody"]}
            points={[t["marketing.bankPoint1"], t["marketing.bankPoint2"]]}
          >
            <div className="mk-lines">
              {SAMPLE.bankLines.map((line) => (
                <div key={line.text} className="mk-line">
                  <span className="mk-line__date mk-num">{line.date}</span>
                  <span className="mk-line__desc" translate="no" dir="ltr">
                    {line.text}
                  </span>
                  <StatusBadge status={line.status} />
                  <span className="mk-line__amt" data-neg={line.amount < 0}>
                    <Amount value={line.amount} currency={false} />
                  </span>
                </div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard
            icon={Users}
            title={t["marketing.payrollTitle"]}
            body={t["marketing.payrollBody"]}
            points={[t["marketing.payrollPoint1"], t["marketing.payrollPoint2"]]}
          >
            <div className="mk-payroll__top">
              <span className="mk-panel__title">{t["marketing.payrollRun"]}</span>
              <Status tone="success" className="mk-status">
                {t["marketing.payrollApproved"]}
              </Status>
            </div>
            <div className="mk-payroll__stats">
              <div className="mk-stat">
                <div className="mk-stat__label">{t["marketing.payrollEmployees"]}</div>
                <div className="mk-stat__value mk-num">{SAMPLE.payroll.employees}</div>
              </div>
              <div className="mk-stat">
                <div className="mk-stat__label">{t["marketing.payrollNet"]}</div>
                <div className="mk-stat__value">
                  <Amount value={SAMPLE.payroll.net} />
                </div>
              </div>
            </div>
            <div className="mk-file">
              <FileSpreadsheet aria-hidden="true" />
              <span className="mk-num">{"WPS_202606.SIF"}</span>
              <Status tone="success" className="mk-status">
                {t["marketing.payrollSif"]}
              </Status>
            </div>
          </FeatureCard>

          <FeatureCard
            icon={LineChart}
            title={t["marketing.reportsTitle"]}
            body={t["marketing.reportsBody"]}
            points={[t["marketing.reportsPoint1"], t["marketing.reportsPoint2"]]}
          >
            <div className="mk-pl">
              <div className="mk-pl__row mk-pl__row--sub">
                <span>{t["marketing.reportsPl"]}</span>
                <span className="mk-small">{"Q2 2026"}</span>
              </div>
              <div className="mk-pl__row">
                <span>{t["marketing.reportsIncome"]}</span>
                <Amount value={pl.income} currency={false} />
              </div>
              <div className="mk-pl__row">
                <span>{t["marketing.reportsCostOfSales"]}</span>
                <Amount value={-pl.costOfSales} currency={false} />
              </div>
              <div className="mk-pl__row mk-pl__row--sub">
                <span>{t["marketing.reportsGrossProfit"]}</span>
                <Amount value={gross} currency={false} />
              </div>
              <div className="mk-pl__row">
                <span>{t["marketing.reportsOperating"]}</span>
                <Amount value={-pl.operating} currency={false} />
              </div>
              <div className="mk-pl__row mk-pl__row--total">
                <span>{t["marketing.reportsNetProfit"]}</span>
                <Amount value={gross - pl.operating} currency={false} />
              </div>
            </div>
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

/** Real screenshots of the product on sample data (X6d), plus the sample invoice PDF. */
const SCREENS = [
  {
    id: "dashboard",
    titleKey: "marketing.screenDashboardTitle",
    altKey: "marketing.screenDashboardAlt",
  },
  { id: "vat", titleKey: "marketing.screenVatTitle", altKey: "marketing.screenVatAlt" },
  {
    id: "invoices",
    titleKey: "marketing.screenInvoicesTitle",
    altKey: "marketing.screenInvoicesAlt",
  },
  { id: "aging", titleKey: "marketing.screenAgingTitle", altKey: "marketing.screenAgingAlt" },
] as const;

function ProductScreens() {
  const { t, locale } = useTranslation();
  const lang = locale === "ar" ? "ar" : "en";
  return (
    <section
      id="screens"
      className="mk-section mk-section--sunken"
      aria-labelledby="mk-screens-title"
    >
      <div className="mk-container">
        <SectionHeading
          id="mk-screens-title"
          eyebrow={t["marketing.screensEyebrow"]}
          title={t["marketing.screensTitle"]}
          body={t["marketing.screensBody"]}
        />
        <div className="mk-screens" data-testid="landing-screenshots">
          {SCREENS.map((screen) => (
            <figure key={screen.id} className="mk-screen">
              <img
                src={`/product/${screen.id}-${lang}.webp`}
                alt={t[screen.altKey]}
                width={1280}
                height={800}
                loading="lazy"
                decoding="async"
                data-testid={`landing-screenshot-${screen.id}`}
              />
              <figcaption>{t[screen.titleKey]}</figcaption>
            </figure>
          ))}
        </div>
        <div className="mk-sample" data-testid="landing-sample-invoice">
          <FileText aria-hidden="true" />
          <div>
            <h3 className="mk-h3">{t["marketing.sampleInvoiceTitle"]}</h3>
            <p className="mk-body">{t["marketing.sampleInvoiceBody"]}</p>
          </div>
          <Button asChild variant="outline" size="lg">
            <a
              href="/samples/muhasib-sample-invoice.pdf"
              download
              data-testid="button-sample-invoice"
            >
              <FileDown aria-hidden="true" />
              {t["marketing.sampleInvoiceCta"]}
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  const { t } = useTranslation();
  return (
    <section id="how-it-works" className="mk-section" aria-labelledby="mk-steps-title">
      <div className="mk-container">
        <SectionHeading
          id="mk-steps-title"
          eyebrow={t["marketing.stepsEyebrow"]}
          title={t["marketing.stepsTitle"]}
        />
        <ol className="mk-steps">
          {[1, 2, 3].map((n) => (
            <li key={n} className="mk-step">
              <span className="mk-step__num mk-num">{`0${n}`}</span>
              <h3 className="mk-h3">{t[`marketing.step${n}Title`]}</h3>
              <p className="mk-body">{t[`marketing.step${n}Body`]}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PricingTeaser() {
  const { t } = useTranslation();
  return (
    <section className="mk-section mk-section--sunken" aria-labelledby="mk-pricing-title">
      <div className="mk-container">
        <SectionHeading
          id="mk-pricing-title"
          eyebrow={t["marketing.pricingEyebrow"]}
          title={t["marketing.pricingTitle"]}
          body={t["marketing.pricingBody"]}
        />
        <div className="mk-prplans__row" data-testid="landing-plans">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} cycle="monthly" compact headingLevel="h3" />
          ))}
        </div>
        <div className="mk-plans__foot">
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing" data-testid="link-compare-plans">
              {t["marketing.pricingCompare"]}
              <ArrowRight className="mk-flip" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

const FAQ_LINKS: Record<number, [string, string]> = {
  6: ["/migration-guides", "marketing.faqMigrationLink"],
  7: ["/trust", "marketing.faqTrustLink"],
};

function Faq() {
  const { t } = useTranslation();
  return (
    <FaqSection
      id="mk-faq-title"
      eyebrow={t["marketing.faqEyebrow"]}
      title={t["marketing.faqTitle"]}
      items={[1, 2, 3, 4, 5, 6, 7].map((n) => ({
        q: t[`marketing.faq${n}Q`],
        a: t[`marketing.faq${n}A`],
        link: FAQ_LINKS[n] ? { href: FAQ_LINKS[n][0], label: t[FAQ_LINKS[n][1]] } : undefined,
      }))}
    />
  );
}

export default function MuhasibLanding() {
  return (
    <MarketingLayout
      titleKey="marketing.seoHomeTitle"
      descriptionKey="marketing.seoHomeDescription"
    >
      <Hero />
      <Product />
      <ProductScreens />
      <Steps />
      <PricingTeaser />
      <Faq />
      <ClosingCta />
    </MarketingLayout>
  );
}
