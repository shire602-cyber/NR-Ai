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
import { MarketingLayout } from "@/components/marketing/MarketingLayout";

const guides = [
  {
    icon: BookOpen,
    title: "Set up your company",
    text: "Add trade license details, TRN, emirate, fiscal year, currency, and the UAE chart of accounts.",
  },
  {
    icon: Receipt,
    title: "Create VAT-ready invoices",
    text: "Create invoices, credit notes, payment records, and downloadable PDFs with clear VAT totals.",
  },
  {
    icon: FileSpreadsheet,
    title: "Import receipts and contacts",
    text: "Upload receipts, export to Excel, and import customers from .xlsx or CSV templates.",
  },
  {
    icon: Banknote,
    title: "Reconcile bank statements",
    text: "Import CSV/PDF statements, review suggested matches, and create entries for unmatched transactions.",
  },
  {
    icon: ShieldCheck,
    title: "Migrate from mazeed or Wafeq",
    text: "Use a go-live date, preserve source exports, import contacts and bank statements, and validate opening balances before live posting.",
  },
];

const slaItems = [
  "Launch onboarding support for setup, migration, VAT workflow questions, and first-month close.",
  "Migration review covers mazeed, Wafeq, Zoho Books, and Excel export packs before live use.",
  "Email support for free and starter users; priority onboarding support for professional and enterprise users.",
  "Enterprise support terms, response windows, and uptime commitments are confirmed during activation.",
  "Critical accounting workflow issues are triaged ahead of feature requests during launch.",
];

export default function HelpCenter() {
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
            <p className="mk-lead">
              Practical setup guides for invoices, VAT workflows, bank reconciliation, imports, and
              month-end routines. During launch, paid plans are activated with guided onboarding.
            </p>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            {guides.map((guide) => {
              const Icon = guide.icon;
              return (
                <Card key={guide.title} className="mk-surface-card">
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

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <LifeBuoy className="h-6 w-6 text-primary" />
                <T k="pageLabels.supportAndSLAPosture" />
              </h2>
              <p className="mt-3 text-muted-foreground">
                We keep launch promises specific. Formal SLA terms are not implied for every plan;
                they are confirmed for enterprise customers during setup.
              </p>
            </div>
            <div className="grid gap-3">
              {slaItems.map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">{item}</span>
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
                  <HelpCircle className="h-5 w-5 text-primary" />
                  <T k="pageLabels.needHelpChoosingTheRightPath" />
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  <T k="pageLabels.askForAGuidedMigrationReviewBeforeImportingLiveBooks" />
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="mailto:support@muhasib.ai?subject=Migration%20review">
                  <Button>
                    <Mail className="me-2 h-4 w-4" />
                    <T k="pageLabels.requestReview" />
                  </Button>
                </a>
                <Link href="/migration-guides">
                  <Button variant="outline">
                    <T k="pageLabels.migrationGuides" />
                    <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
