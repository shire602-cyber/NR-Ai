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
    text: "Session handling uses httpOnly cookies, token revocation, CSRF protection for cookie requests, and startup secret validation.",
  },
  {
    icon: Database,
    title: "Data protection controls",
    text: "Sensitive operational settings are separated from the public app surface, with encrypted transport expected in production.",
  },
  {
    icon: FileCheck,
    title: "Auditability",
    text: "Accounting actions are designed around traceable records, period locks, retention rules, and exportable supporting schedules.",
  },
];

const roadmap = [
  "Publish formal uptime and incident-response history after launch traffic is measurable.",
  "Complete external penetration testing after the launch environment is frozen.",
  "Prepare SOC 2 / ISO 27001 readiness evidence once operational controls have live history.",
  "Expand data-processing and residency documentation for enterprise customers.",
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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Muhasib.ai
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/help" className="hover:text-foreground">
              Help
            </Link>
            <Link href="/migration-guides" className="hover:text-foreground">
              Migrate
            </Link>
          </nav>
          <Link href="/register">
            <Button size="sm">Start Free</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16 lg:py-20">
            <Badge variant="outline" className="mb-5">
              Trust and Security
            </Badge>
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
                  Built for cautious UAE finance teams, with claims kept honest.
                </h1>
                <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
                  Muhasib.ai protects accounting workflows with access controls, secure sessions,
                  auditable records, and a clear roadmap toward third-party assurance. We do not
                  claim SOC 2, ISO 27001, or FTA accreditation until those reviews are complete.
                </p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    Launch posture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span>High/critical production dependency audit gate is part of release.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span>
                      Automated test, build, type-check, and migration-secret gates run locally.
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 text-amber-600" />
                    <span>External certifications are roadmap items, not current claims.</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Launch verification evidence</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                Release evidence is kept practical: automated gates, production health checks, and
                authenticated route crawls for protected firm workflows when smoke credentials are
                available.
              </p>
            </div>
            <Badge variant="outline">Internal release gate</Badge>
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

        <section className="container mx-auto max-w-6xl px-4 py-14">
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

        <section className="border-y bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-14">
            <div>
              <h2 className="text-2xl font-semibold">Operational trust posture</h2>
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

        <section className="border-y bg-muted/30">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold">Support commitments during launch</h2>
              <p className="mt-3 text-muted-foreground">
                Paid launch customers get guided onboarding, implementation checklists, and support
                through the onboarding team. Formal enterprise support commitments are confirmed
                during setup based on the active hosting and support configuration.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck className="h-4 w-4 text-primary" />
                What customers can expect
              </div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>Guided company setup and chart-of-accounts review.</li>
                <li>Migration support from mazeed, Wafeq, Zoho Books, or Excel exports.</li>
                <li>Escalation path for accounting workflow blockers during onboarding.</li>
                <li>
                  Security and data-processing questions answered before enterprise activation.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold">Assurance roadmap</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {roadmap.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border p-4 text-sm text-muted-foreground"
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/help">
              <Button>
                Visit Help Center
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/migration-guides">
              <Button variant="outline">Migration Guides</Button>
            </Link>
            <Link href="/privacy">
              <Button variant="outline">Privacy Policy</Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
