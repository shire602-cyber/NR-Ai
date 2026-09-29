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
import { messages as pageMessages } from "./TrustSecurity.i18n";

const getControls = () => [
  {
    icon: Lock,
    title: pageMessages.t("authenticatedAccess"),
    text: pageMessages.t("customerWorkspacesRequireSignedInAccess"),
  },
  {
    icon: KeyRound,
    title: pageMessages.t("secureSessions"),
    text: pageMessages.t("sessionHandlingUsesHttponlyCookiesToken"),
  },
  {
    icon: Database,
    title: pageMessages.t("dataProtectionControls"),
    text: pageMessages.t("sensitiveOperationalSettingsAreSeparatedFrom"),
  },
  {
    icon: FileCheck,
    title: pageMessages.t("auditability"),
    text: pageMessages.t("accountingActionsAreDesignedAroundTraceable"),
  },
];

const getRoadmap = () => [
  pageMessages.t("publishFormalUptimeAndIncidentResponse"),
  pageMessages.t("completeExternalPenetrationTestingAfterThe"),
  pageMessages.t("prepareSoc2Iso27001Readiness"),
  pageMessages.t("expandDataProcessingAndResidencyDocumentation"),
];

const getLaunchEvidence = () => [
  {
    title: pageMessages.t("releaseGates"),
    text: pageMessages.t("typeCheckUnitTestsApiContract"),
  },
  {
    title: pageMessages.t("productionSmoke"),
    text: pageMessages.t("readOnlySmokeChecksCoverLiveness"),
  },
  {
    title: pageMessages.t("protectedRouteCrawl"),
    text: pageMessages.t("authenticatedFirmRouteSmokeIsSupported"),
  },
];

const getTrustPosture = () => [
  {
    icon: Database,
    title: pageMessages.t("backupAndRestoreProof"),
    text: pageMessages.t("theApplicationBackupFlowCreatesChecksum"),
  },
  {
    icon: ShieldCheck,
    title: pageMessages.t("incidentProcess"),
    text: pageMessages.t("theResponseChecklistCoversContainmentAudit"),
  },
  {
    icon: UserCheck,
    title: pageMessages.t("privacyAndDpaPosture"),
    text: pageMessages.t("thePrivacyPolicyIsPublicEnterprise"),
  },
];

export default function TrustSecurity() {
  const tr = pageMessages.useT();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold">
            Muhasib.ai
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/pricing" className="hover:text-foreground">
              {tr("pricing")}
            </Link>
            <Link href="/help" className="hover:text-foreground">
              {tr("help")}
            </Link>
            <Link href="/migration-guides" className="hover:text-foreground">
              {tr("migrate")}
            </Link>
          </nav>
          <Link href="/register">
            <Button size="sm">{tr("startFree")}</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16 lg:py-20">
            <Badge variant="outline" className="mb-5">
              {tr("trustAndSecurity")}
            </Badge>
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
                  {tr("builtForCautiousUaeFinanceTeams")}
                </h1>
                <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
                  {tr("muhasibAiProtectsAccountingWorkflowsWith")}
                </p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-success" />
                    {tr("launchPosture")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                    <span>{tr("highCriticalProductionDependencyAuditGate")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                    <span>{tr("automatedTestBuildTypeCheckAnd")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="mt-0.5 h-4 w-4 text-warning" />
                    <span>{tr("externalCertificationsAreRoadmapItemsNot")}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">{tr("launchVerificationEvidence")}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {tr("releaseEvidenceIsKeptPracticalAutomated")}
              </p>
            </div>
            <Badge variant="outline">{tr("internalReleaseGate")}</Badge>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {getLaunchEvidence().map((item) => (
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
            {getControls().map((item) => {
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
              <h2 className="text-2xl font-semibold">{tr("operationalTrustPosture")}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {tr("thePublicPostureSeparatesWorkingProduct")}
              </p>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {getTrustPosture().map((item) => {
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
              <h2 className="text-2xl font-semibold">{tr("supportCommitmentsDuringLaunch")}</h2>
              <p className="mt-3 text-muted-foreground">
                {tr("paidLaunchCustomersGetGuidedOnboarding")}
              </p>
            </div>
            <div className="rounded-lg border bg-background p-5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck className="h-4 w-4 text-primary" />
                {tr("whatCustomersCanExpect")}
              </div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>{tr("guidedCompanySetupAndChartOf")}</li>
                <li>{tr("migrationSupportFromMazeedWafeqZoho")}</li>
                <li>{tr("escalationPathForAccountingWorkflowBlockers")}</li>
                <li>{tr("securityAndDataProcessingQuestionsAnswered")}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold">{tr("assuranceRoadmap")}</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {getRoadmap().map((item) => (
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
                {tr("visitHelpCenter")}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/migration-guides">
              <Button variant="outline">{tr("migrationGuides")}</Button>
            </Link>
            <Link href="/privacy">
              <Button variant="outline">{tr("privacyPolicy")}</Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
