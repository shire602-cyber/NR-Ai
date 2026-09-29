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
import { Badge } from "@/components/ui/badge";
import { messages as pageMessages } from "./HelpCenter.i18n";

const getGuides = () => [
  {
    icon: BookOpen,
    title: pageMessages.t("setUpYourCompany"),
    text: pageMessages.t("addTradeLicenseDetailsTrnEmirate"),
  },
  {
    icon: Receipt,
    title: pageMessages.t("createVatReadyInvoices"),
    text: pageMessages.t("createInvoicesCreditNotesPaymentRecords"),
  },
  {
    icon: FileSpreadsheet,
    title: pageMessages.t("importReceiptsAndContacts"),
    text: pageMessages.t("uploadReceiptsExportToExcelAnd"),
  },
  {
    icon: Banknote,
    title: pageMessages.t("reconcileBankStatements"),
    text: pageMessages.t("importCsvPdfStatementsReviewSuggested"),
  },
  {
    icon: ShieldCheck,
    title: pageMessages.t("migrateFromMazeedOrWafeq"),
    text: pageMessages.t("useAGoLiveDatePreserve"),
  },
];

const getSlaItems = () => [
  pageMessages.t("launchOnboardingSupportForSetupMigration"),
  pageMessages.t("migrationReviewCoversMazeedWafeqZoho"),
  pageMessages.t("emailSupportForFreeAndStarter"),
  pageMessages.t("enterpriseSupportTermsResponseWindowsAnd"),
  pageMessages.t("criticalAccountingWorkflowIssuesAreTriaged"),
];

export default function HelpCenter() {
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
            <Link href="/trust" className="hover:text-foreground">
              {tr("trust")}
            </Link>
            <Link href="/migration-guides" className="hover:text-foreground">
              {tr("migrate")}
            </Link>
          </nav>
          <a href="mailto:support@muhasib.ai?subject=Muhasib.ai%20support">
            <Button size="sm" variant="outline">
              {tr("contactSupport")}
            </Button>
          </a>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16">
            <Badge variant="outline" className="mb-5">
              {tr("helpCenter")}
            </Badge>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
              {tr("launchSupportForUaeAccountingTeams")}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {tr("practicalSetupGuidesForInvoicesVat")}
            </p>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="grid gap-4 md:grid-cols-2">
            {getGuides().map((guide) => {
              const Icon = guide.icon;
              return (
                <Card key={guide.title}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                      <Icon className="h-5 w-5 text-primary" />
                      {guide.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-muted-foreground">
                    {guide.text}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <LifeBuoy className="h-6 w-6 text-primary" />
                {tr("supportAndSlaPosture")}
              </h2>
              <p className="mt-3 text-muted-foreground">
                {tr("weKeepLaunchPromisesSpecificFormal")}
              </p>
            </div>
            <div className="grid gap-3">
              {getSlaItems().map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container mx-auto max-w-6xl px-4 py-14">
          <div className="rounded-lg border p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold">
                  <HelpCircle className="h-5 w-5 text-primary" />
                  {tr("needHelpChoosingTheRightPath")}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tr("askForAGuidedMigrationReview")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="mailto:support@muhasib.ai?subject=Migration%20review">
                  <Button>
                    <Mail className="me-2 h-4 w-4" />
                    {tr("requestReview")}
                  </Button>
                </a>
                <Link href="/migration-guides">
                  <Button variant="outline">
                    {tr("migrationGuides")}
                    <ArrowRight className="ms-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
