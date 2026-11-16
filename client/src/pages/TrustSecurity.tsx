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

const controls = [
  {
    icon: Lock,
    title: "Authenticated access",
    text: "Customer workspaces require signed-in access, scoped company membership, and role-aware route checks.",
  },
  {
    icon: KeyRound,
    title: "Secure sessions",
    text: "Session handling uses httpOnly cookies, token revocation, CSRF protection for cookie requests, and startup secret validation. Users can review and sign out individual devices.",
  },
  {
    icon: UserCheck,
    title: "Two-factor authentication",
    text: "Optional TOTP two-factor sign-in with single-use recovery codes. Company owners can require it for owners and admins or for every member, and sensitive actions ask for a fresh code.",
  },
  {
    icon: Database,
    title: "Data protection controls",
    text: "Sensitive operational settings are separated from the public app surface, stored secrets and in-app backups are encrypted with AES-256-GCM, and encrypted transport is expected in production.",
  },
  {
    icon: FileCheck,
    title: "Auditability",
    text: "Security events, postings and chart-of-accounts changes are written to an append-only audit log whose entries are linked by SHA-256 hashes; owners can verify the chain and export it with before/after values.",
  },
];

const roadmap = [
  "Publish formal uptime and incident-response history after launch traffic is measurable.",
  "Complete an independent external penetration test after the launch environment is frozen (not yet performed).",
  "Prepare SOC 2 / ISO 27001 readiness evidence once operational controls have live history (no audit has been performed and no certification is held).",
  "Finalise the data-processing and UAE PDPL data-residency statement with counsel (a draft data map exists).",
];

const launchEvidence = [
  {
    title: "Release gates",
    text: "Type-check, unit tests, API contract checks, dependency audit, and production build run before release promotion.",
  },
  {
    title: "Production smoke",
    text: "Read-only smoke checks cover liveness, readiness, deployed version, and OAuth-provider response on the production URL.",
  },
  {
    title: "Protected-route crawl",
    text: "Authenticated firm-route smoke is supported with dedicated smoke credentials and recorded as internal release evidence.",
  },
];

const trustPosture = [
  {
    icon: Database,
    title: "Backup and restore proof",
    text: "The application backup flow creates checksum-verified snapshots, restore previews, transactional restores, and a pre-restore safety backup. Operational backup cadence is confirmed for each production environment.",
  },
  {
    icon: ShieldCheck,
    title: "Incident process",
    text: "The response checklist covers containment, audit-log review, key/API-token rotation, recovery from backup when integrity is in question, and UAE PDPL notification review.",
  },
  {
    icon: UserCheck,
    title: "Privacy and DPA posture",
    text: "The Privacy Policy is public. Enterprise DPA and security-questionnaire review is handled during onboarding while a standard downloadable DPA pack is prepared.",
  },
];

export default function TrustSecurity() {
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
                <p className="mk-lead">
                  Muhasib.ai protects accounting workflows with access controls, secure sessions,
                  auditable records, and a clear roadmap toward third-party assurance. We do not
                  claim SOC 2, ISO 27001, or FTA accreditation until those reviews are complete.
                </p>
              </div>
              <Card className="mk-surface-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-success" />
                    <T k="pageLabels.launchPosture" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                    <span>High/critical production dependency audit gate is part of release.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                    <span>
                      Automated test, build, type-check, and migration-secret gates run locally.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 text-warning" />
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
              <h2 className="text-2xl font-semibold">
                <T k="pageLabels.launchVerificationEvidence" />
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                Release evidence is kept practical: automated gates, production health checks, and
                authenticated route crawls for protected firm workflows when smoke credentials are
                available.
              </p>
            </div>
            <Badge variant="outline">
              <T k="pageLabels.internalReleaseGate" />
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {launchEvidence.map((item) => (
              <div key={item.title} className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileCheck className="h-4 w-4 text-primary" />
                  {item.title}
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            {controls.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.title}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <Icon className="h-5 w-5 text-primary" />
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    {item.text}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section">
            <div>
              <h2 className="text-2xl font-semibold">
                <T k="pageLabels.operationalTrustPosture" />
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                The public posture separates working product controls from environment-specific
                operating procedures and future certifications.
              </p>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {trustPosture.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3 text-lg">
                        <Icon className="h-5 w-5 text-primary" />
                        {item.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm leading-6 text-muted-foreground">
                      {item.text}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">
                <T k="pageLabels.supportCommitmentsDuringLaunch" />
              </h2>
              <p className="mt-3 text-muted-foreground">
                Paid launch customers get guided onboarding, implementation checklists, and support
                through the onboarding team. Formal enterprise support commitments are confirmed
                during setup based on the active hosting and support configuration.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck className="h-4 w-4 text-primary" />
                <T k="pageLabels.whatCustomersCanExpect" />
              </div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>
                  <T k="pageLabels.guidedCompanySetupAndChartOf" />
                </li>
                <li>Migration support from mazeed, Wafeq, Zoho Books, or Excel exports.</li>
                <li>Escalation path for accounting workflow blockers during onboarding.</li>
                <li>
                  Security and data-processing questions answered before enterprise activation.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <h2 className="text-2xl font-semibold">
            <T k="pageLabels.assuranceRoadmap" />
          </h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {roadmap.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border p-4 text-sm text-muted-foreground"
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/help">
              <Button>
                <T k="pageLabels.visitHelpCenter" />
                <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </Link>
            <Link href="/migration-guides">
              <Button variant="outline">
                <T k="pageLabels.migrationGuides" />
              </Button>
            </Link>
            <Link href="/privacy">
              <Button variant="outline">
                <T k="pages.privacyPolicy" />
              </Button>
            </Link>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
