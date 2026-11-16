import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Landmark,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n";

// Each path is a catalog prefix plus its step count (marketing.migration<Id>Title / <Id>1..n).
const MIGRATION_PATHS = [
  { id: "Xero", steps: 4 },
  { id: "Mazeed", steps: 5 },
  { id: "Wafeq", steps: 5 },
  { id: "Zoho", steps: 6 },
  { id: "Excel", steps: 5 },
];

const CHECKLIST = [1, 2, 3, 4, 5];

export default function MigrationGuides() {
  const { t } = useTranslation();
  return (
    <MarketingLayout
      titleKey="marketing.seoMigrationTitle"
      descriptionKey="marketing.seoMigrationDescription"
    >
      <>
        <section className="mk-pagehead">
          <div className="mk-container">
            <p className="mk-eyebrow">
              <T k="pageLabels.migrationGuides" />
            </p>
            <h1 className="mk-h1">{t["marketing.migrationTitle"]}</h1>
            <p className="mk-lead">{t["marketing.migrationLead"]}</p>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {MIGRATION_PATHS.map((path) => (
              <Card key={path.id} className="mk-surface-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Upload className="h-5 w-5 text-accent" aria-hidden="true" />
                    {t[`marketing.migration${path.id}Title`]}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3 text-sm text-muted-foreground">
                    {Array.from({ length: path.steps }, (_, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums text-foreground">
                          {index + 1}
                        </span>
                        <span>{t[`marketing.migration${path.id}${index + 1}`]}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mk-section--sunken">
          <div className="mk-container mk-inner-section grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <h2 className="flex items-center gap-2 text-h3 font-semibold">
                <ClipboardCheck className="h-6 w-6 text-accent" aria-hidden="true" />
                <T k="pageLabels.goLiveChecklist" />
              </h2>
              <p className="mt-3 text-muted-foreground">{t["marketing.migrationChecklistBody"]}</p>
            </div>
            <div className="grid gap-3">
              {CHECKLIST.map((n) => (
                <div key={n} className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{t[`marketing.migrationCheck${n}`]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-container mk-inner-section">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="mk-surface-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="h-5 w-5 text-accent" aria-hidden="true" />
                  <T k="pageLabels.supportedImportFiles" />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                {t["marketing.migrationFilesBody"]}
              </CardContent>
            </Card>
            <Card className="mk-surface-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Landmark className="h-5 w-5 text-accent" aria-hidden="true" />
                  <T k="pageLabels.bankReconciliationAfterMigration" />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">
                {t["marketing.migrationBankBody"]}
              </CardContent>
            </Card>
          </div>
          <div className="mt-8">
            <Button asChild size="lg">
              <Link href="/register">
                <T k="pageLabels.startMigration" />
                <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </>
    </MarketingLayout>
  );
}
