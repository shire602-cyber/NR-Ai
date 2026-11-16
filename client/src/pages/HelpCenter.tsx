import { Link } from "wouter";
import {
  ArrowRight,
  Banknote,
  BookOpen,
  FileSpreadsheet,
  HelpCircle,
  LifeBuoy,
  Mail,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { T } from "@/components/layout/T";
import { useTranslation } from "@/lib/i18n";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

const guides = [
  { icon: BookOpen, n: 1 },
  { icon: Receipt, n: 2 },
  { icon: FileSpreadsheet, n: 3 },
  { icon: Banknote, n: 4 },
  { icon: ShieldCheck, n: 5 },
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
            <h1 className="mk-h1">
              <T k="pageLabels.launchSupportForUAEAccountingTeamsMovingFast" />
            </h1>
            <p className="mk-lead">{t["marketing.helpLead"]}</p>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            {guides.map(({ icon: Icon, n }) => {
              return (
                <Card key={n} className="mk-surface-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                      {t[`marketing.helpGuide${n}Title`]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    {t[`marketing.helpGuide${n}Body`]}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <LifeBuoy className="h-6 w-6 text-accent" aria-hidden="true" />
                <T k="pageLabels.supportAndSLAPosture" />
              </h2>
              <p className="mt-3 text-muted-foreground">{t["marketing.helpSlaBody"]}</p>
            </div>
            <div className="grid gap-3">
              {SLA_ITEMS.map((n) => (
                <div key={n} className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{t[`marketing.helpSla${n}`]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="mk-card p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <HelpCircle className="h-5 w-5 text-accent" aria-hidden="true" />
                  <T k="pageLabels.needHelpChoosingTheRightPath" />
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  <T k="pageLabels.askForAGuidedMigrationReviewBeforeImportingLiveBooks" />
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <a href="mailto:support@muhasib.ai?subject=Migration%20review">
                    <Mail aria-hidden="true" />
                    <T k="pageLabels.requestReview" />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/migration-guides">
                    <T k="pageLabels.migrationGuides" />
                    <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
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
