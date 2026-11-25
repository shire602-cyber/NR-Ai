import { MARKETING_BRAND } from "@shared/marketing-brand";
import { T } from "@/components/layout/T";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Checklist, SectionHeading, Tiles } from "@/components/marketing/Sections";
import { Link } from "wouter";
import { SHOW_DATA_RESIDENCY } from "@/components/marketing/phase/home/flags";
import {
  ArrowRight,
  Clock,
  Database,
  History,
  FileCheck,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

// R3 (CTO 8): the trust page is written for customers. It leads with the controls a customer
// uses today, then who operates the service and how to reach them, then how we operate, and
// ends with the honest "not certified yet" roadmap. Copy lives in the marketing catalog
// (en + ar); claims stay limited to what the product does today and what docs/ and the legal
// pages document (operator, support and privacy mailboxes). Release-gate / CI notes are
// internal evidence (docs/TRUST.md), not customer copy.

const SUPPORT_EMAIL = MARKETING_BRAND.supportEmail;
const PRIVACY_EMAIL = MARKETING_BRAND.privacyEmail;
const SECURITY_EMAIL = MARKETING_BRAND.securityEmail;

const ROADMAP = [1, 2, 3, 4];

function MailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} dir="ltr">
      {email}
    </a>
  );
}

export default function TrustSecurity() {
  const { t } = useTranslation();
  const controls = [
    { key: "access", icon: UserCheck, n: "trustControl1" },
    { key: "roles", icon: Users, n: "trustRoles" },
    { key: "2fa", icon: KeyRound, n: "trustControl3" },
    { key: "sessions", icon: Lock, n: "trustControl2" },
  ].map(({ key, icon, n }) => ({
    key,
    icon,
    title: t[`marketing.${n}Title`],
    body: t[`marketing.${n}Body`],
    testId: `trust-control-${key}`,
  }));
  controls.push(
    {
      key: "activity",
      icon: History,
      title: t["marketing.trustActivityTitle"],
      body: t["marketing.trustActivityBody"],
      testId: "trust-control-activity",
    },
    {
      key: "audit",
      icon: FileCheck,
      title: t["marketing.trustAuditTitle"],
      body: t["marketing.trustControl5Body"],
      testId: "trust-control-audit",
    },
    {
      key: "backups",
      icon: Database,
      title: t["marketing.trustBackupTitle"],
      body: t["marketing.trustBackupBody"],
      testId: "trust-control-backups",
    },
    {
      key: "pdpl",
      icon: ShieldCheck,
      title: t["marketing.trustPdplTitle"],
      body: t["marketing.trustPdplBody"],
      testId: "trust-control-pdpl",
    }
  );
  const operations = [1, 2, 3].map((n) => ({
    key: `op-${n}`,
    title: t[`marketing.trustOp${n}Title`],
    body: t[`marketing.trustOp${n}Body`],
  }));

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
            <h1 className="mk-h1" data-testid="text-trust-title">
              {t["marketing.trustTitle"]}
            </h1>
            <p className="mk-lead">{t["marketing.trustLead"]}</p>
          </div>
        </section>

        <section className="mk-container mk-inner-section" aria-labelledby="trust-controls-title">
          <SectionHeading
            id="trust-controls-title"
            eyebrow={t["marketing.trustControlsEyebrow"]}
            title={t["marketing.trustControlsTitle"]}
          />
          <Tiles items={controls} />
        </section>

        <section className="mk-section--sunken" aria-labelledby="trust-who-title">
          <div className="mk-container mk-inner-section">
            <SectionHeading
              id="trust-who-title"
              eyebrow={t["marketing.trustWhoEyebrow"]}
              title={t["marketing.trustWhoTitle"]}
            />
            <dl className="mk-defs" data-testid="trust-facts">
              <div>
                <dt>{t["marketing.trustOperatorLabel"]}</dt>
                <dd>
                  {t["marketing.trustOperatorBody"]}{" "}
                  <Link href="/services">{t["marketing.trustOperatorLink"]}</Link>
                </dd>
              </div>
              {/* Hosting claim stays off until the owner confirms it (flags.ts). */}
              {SHOW_DATA_RESIDENCY && (
                <div data-testid="trust-data-residency">
                  <dt>{t["marketing.trustResidencyLabel"]}</dt>
                  <dd>
                    {t["marketing.trustResidencyBody"]}{" "}
                    <Link href="/privacy">{t["marketing.trustResidencyLink"]}</Link>
                  </dd>
                </div>
              )}
              <div data-testid="trust-support-contact">
                <dt>{t["marketing.trustSupportLabel"]}</dt>
                <dd>
                  {t["marketing.trustSupportContact"]} <MailLink email={SUPPORT_EMAIL} />
                  <span className="mt-2 block">{t["marketing.trustSupportBody"]}</span>
                </dd>
              </div>
              <div>
                <dt>{t["marketing.trustPrivacyLabel"]}</dt>
                <dd>
                  {t["marketing.trustPrivacyContact"]} <MailLink email={PRIVACY_EMAIL} />
                </dd>
              </div>
              <div>
                <dt>{t["marketing.trustSecurityLabel"]}</dt>
                <dd>
                  {t["marketing.trustSecurityContact"]} <MailLink email={SECURITY_EMAIL} />
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mk-container mk-inner-section" aria-labelledby="trust-operate-title">
          <SectionHeading
            id="trust-operate-title"
            eyebrow={t["marketing.trustOperateEyebrow"]}
            title={t["marketing.trustOperateTitle"]}
          />
          <Tiles items={operations} />
          <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <h3 className="mk-h3">{t["marketing.trustExpectTitle"]}</h3>
            <Checklist
              items={[
                <T key="setup" k="pageLabels.guidedCompanySetupAndChartOf" />,
                ...[2, 3, 4].map((n) => t[`marketing.trustExpect${n}`]),
              ]}
            />
          </div>
        </section>

        <section className="mk-section--sunken" aria-labelledby="trust-roadmap-title">
          <div className="mk-container mk-inner-section">
            <div className="mk-heading">
              <p className="mk-eyebrow">{t["marketing.trustRoadmapEyebrow"]}</p>
              <h2 className="mk-h2" id="trust-roadmap-title">
                <T k="pageLabels.externalCertificationsAreRoadmapItemsNot" />
              </h2>
              <p className="mk-lead">{t["marketing.trustRoadmapLead"]}</p>
            </div>
            <h3 className="mk-h3">
              <T k="pageLabels.assuranceRoadmap" />
            </h3>
            <ul className="mk-defs mt-4" data-testid="trust-roadmap">
              {ROADMAP.map((n) => (
                <li key={n} className="flex gap-3">
                  <Clock
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="mk-body">{t[`marketing.trustRoadmap${n}`]}</span>
                </li>
              ))}
            </ul>
            <div className="mk-actions">
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
