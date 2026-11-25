import { MARKETING_BRAND } from "@shared/marketing-brand";
import { Link } from "wouter";
import {
  ArrowRight,
  Banknote,
  BookOpen,
  FileSpreadsheet,
  Mail,
  Receipt,
  Repeat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Checklist, SectionHeading, Tiles } from "@/components/marketing/Sections";

// R3 (CTO 8): same section system as the home page (line eyebrow, sentence case, hairline
// tiles); customer-facing hero instead of launch copy. Support mailbox as published since L1.
const SUPPORT_EMAIL = MARKETING_BRAND.supportEmail;

const GUIDES = [
  { icon: BookOpen, n: 1 },
  { icon: Receipt, n: 2 },
  { icon: FileSpreadsheet, n: 3 },
  { icon: Banknote, n: 4 },
  { icon: Repeat, n: 5 },
];

const SLA_ITEMS = [1, 2, 3, 4, 5];

export default function HelpCenter() {
  const { t } = useTranslation();
  return (
    <MarketingLayout
      titleKey="marketing.seoHelpTitle"
      descriptionKey="marketing.seoHelpDescription"
    >
      <>
        <section className="mk-pagehead">
          <div className="mk-container">
            <p className="mk-eyebrow">
              <T k="pageLabels.helpCenter" />
            </p>
            <h1 className="mk-h1" data-testid="text-help-title">
              {t["marketing.helpTitle"]}
            </h1>
            <p className="mk-lead">{t["marketing.helpLead"]}</p>
          </div>
        </section>

        <section className="mk-container mk-inner-section" aria-labelledby="help-guides-title">
          <SectionHeading
            id="help-guides-title"
            eyebrow={t["marketing.helpGuidesEyebrow"]}
            title={t["marketing.helpGuidesTitle"]}
          />
          <Tiles
            items={GUIDES.map(({ icon, n }) => ({
              key: `guide-${n}`,
              icon,
              title: t[`marketing.helpGuide${n}Title`],
              body: t[`marketing.helpGuide${n}Body`],
            }))}
          />
        </section>

        <section className="mk-section--sunken" aria-labelledby="help-support-title">
          <div className="mk-container mk-inner-section grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="mk-eyebrow">{t["marketing.helpSupportEyebrow"]}</p>
              <h2 className="mk-h2 mt-4" id="help-support-title">
                <T k="pageLabels.supportAndSLAPosture" />
              </h2>
              <p className="mk-lead mt-5">{t["marketing.helpSlaBody"]}</p>
              <p className="mk-body mt-5" data-testid="help-support-contact">
                {t["marketing.helpContactLead"]}{" "}
                <a className="mk-link" href={`mailto:${SUPPORT_EMAIL}`} dir="ltr">
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
            <Checklist items={SLA_ITEMS.map((n) => t[`marketing.helpSla${n}`])} />
          </div>
        </section>

        <section
          className="mk-section"
          style={{ paddingBlockStart: "clamp(3rem, 2rem + 3vw, 4.5rem)" }}
        >
          <div className="mk-container">
            <div className="mk-cta">
              <h2 className="mk-h2">
                <T k="pageLabels.needHelpChoosingTheRightPath" />
              </h2>
              <p className="mk-lead">
                <T k="pageLabels.askForAGuidedMigrationReviewBeforeImportingLiveBooks" />
              </p>
              <div className="mk-hero__ctas">
                <Button asChild size="lg">
                  <a
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t["marketing.helpReviewMailSubject"])}`}
                  >
                    <Mail aria-hidden />
                    <T k="pageLabels.requestReview" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/migration-guides">
                    <T k="pageLabels.migrationGuides" />
                    <ArrowRight className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
