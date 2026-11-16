import { T } from "@/components/layout/T";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  FileCheck,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";

// Copy lives in the marketing catalog (en + ar). Claims stay limited to what the
// product does today; certifications and audits are listed as roadmap items only.
const CONTROLS = [
  { icon: Lock, n: 1 },
  { icon: KeyRound, n: 2 },
  { icon: UserCheck, n: 3 },
  { icon: Database, n: 4 },
  { icon: FileCheck, n: 5 },
];

const OPERATIONAL = [
  { icon: Database, n: 1 },
  { icon: ShieldCheck, n: 2 },
  { icon: UserCheck, n: 3 },
];

const EVIDENCE = [1, 2, 3];
const ROADMAP = [1, 2, 3, 4];

export default function TrustSecurity() {
  const { t } = useTranslation();
  return (
    <MarketingLayout
      titleKey="marketing.seoTrustTitle"
      descriptionKey="marketing.seoTrustDescription"
    >
      <>
        <section className="mk-pagehead">
          <div className="mk-container">
            <p className="mk-eyebrow">
              <T k="pageLabels.trustAndSecurity" />
            </p>
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <h1 className="mk-h1">
                  <T k="pageLabels.builtForCautiousUaeFinanceTeams" />
                </h1>
                <p className="mk-lead">{t["marketing.trustLead"]}</p>
              </div>
              <Card className="mk-surface-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />
                    <T k="pageLabels.launchPosture" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  {[1, 2].map((n) => (
                    <div key={n} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-success"
                        aria-hidden="true"
                      />
                      <span>{t[`marketing.trustPosture${n}`]}</span>
                    </div>
                  ))}
                  <div className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>
                      <T k="pageLabels.externalCertificationsAreRoadmapItemsNot" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-h3 font-semibold">
                <T k="pageLabels.launchVerificationEvidence" />
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t["marketing.trustEvidenceBody"]}
              </p>
            </div>
            <Badge variant="outline" className="w-fit">
              <T k="pageLabels.internalReleaseGate" />
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {EVIDENCE.map((n) => (
              <div key={n} className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                  {t[`marketing.trustEvidence${n}Title`]}
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {t[`marketing.trustEvidence${n}Body`]}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            {CONTROLS.map(({ icon: Icon, n }) => (
              <Card key={n}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                    {t[`marketing.trustControl${n}Title`]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">
                  {t[`marketing.trustControl${n}Body`]}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section">
            <div>
              <h2 className="text-h3 font-semibold">
                <T k="pageLabels.operationalTrustPosture" />
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t["marketing.trustOperationalBody"]}
              </p>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {OPERATIONAL.map(({ icon: Icon, n }) => (
                <Card key={n}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                      {t[`marketing.trustOp${n}Title`]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    {t[`marketing.trustOp${n}Body`]}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-h3 font-semibold">
                <T k="pageLabels.supportCommitmentsDuringLaunch" />
              </h2>
              <p className="mt-3 text-muted-foreground">{t["marketing.trustSupportBody"]}</p>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                <T k="pageLabels.whatCustomersCanExpect" />
              </div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>
                  <T k="pageLabels.guidedCompanySetupAndChartOf" />
                </li>
                {[2, 3, 4].map((n) => (
                  <li key={n}>{t[`marketing.trustExpect${n}`]}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section">
            <h2 className="text-h3 font-semibold">
              <T k="pageLabels.assuranceRoadmap" />
            </h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {ROADMAP.map((n) => (
                <div
                  key={n}
                  className="flex gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground"
                >
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>{t[`marketing.trustRoadmap${n}`]}</span>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/help">
                  <T k="pageLabels.visitHelpCenter" />
                  <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/migration-guides">
                  <T k="pageLabels.migrationGuides" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/privacy">
                  <T k="pages.privacyPolicy" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
