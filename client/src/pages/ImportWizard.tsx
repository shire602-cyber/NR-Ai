import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChooseStep } from "@/components/import/ChooseStep";
import { MappingStep } from "@/components/import/MappingStep";
import { OpeningPanel } from "@/components/import/OpeningPanel";
import { ReviewStep } from "@/components/import/ReviewStep";
import { Stepper } from "@/components/import/Stepper";
import { UploadStep } from "@/components/import/UploadStep";
import { messages as importMessages } from "@/components/import/Stepper.i18n";
import { useCompanyRole } from "@/hooks/useCompanyRole";
import { importJobsKey } from "@/lib/import-api";
import { queryClient } from "@/lib/queryClient";
import type { ImportEntity, ImportJob, ImportSource, UploadResult, WizardStep } from "@/lib/import-wizard";
import { messages as pageMessages } from "./ImportWizard.i18n";

interface Result {
  created: number;
  skippedDuplicates: number;
  errors: number;
}

export default function ImportWizard() {
  const tr = pageMessages.useT();
  const ti = importMessages.useT();
  const { role, companyId } = useCompanyRole();
  const [tab, setTab] = useState("file");
  const [step, setStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<ImportSource | null>(null);
  const [entity, setEntity] = useState<ImportEntity | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const allowed = role === "owner" || role === "accountant";

  function restart() {
    setStep("source");
    setUpload(null);
    setJob(null);
    setResult(null);
    setEntity(null);
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("title")}
        description={tr("description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/migration-guides">{tr("guides")}</Link>
          </Button>
        }
      />
      {!companyId ? (
        <p className="text-sm text-muted-foreground">{ti("noCompany")}</p>
      ) : role && !allowed ? (
        <p className="text-sm text-muted-foreground" data-testid="text-import-role">{ti("roleNote")}</p>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="file" data-testid="tab-import-file">{ti("tabFile")}</TabsTrigger>
            <TabsTrigger value="opening" data-testid="tab-import-opening">{ti("tabOpening")}</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="mt-6 space-y-6">
            <Stepper step={step} />
            {(step === "source" || step === "entity") && (
              <ChooseStep
                kind={step}
                source={source}
                entity={entity}
                onSource={setSource}
                onEntity={setEntity}
                onBack={() => setStep("source")}
                onNext={() => setStep(step === "source" ? "entity" : "upload")}
              />
            )}
            {step === "upload" && source && entity && (
              <UploadStep
                companyId={companyId}
                source={source}
                entity={entity}
                onBack={() => setStep("entity")}
                onUploaded={(r) => {
                  setUpload(r);
                  setJob(r.job);
                  setStep("mapping");
                  queryClient.invalidateQueries({ queryKey: importJobsKey(companyId) });
                }}
              />
            )}
            {step === "mapping" && upload && (
              <MappingStep
                companyId={companyId}
                upload={upload}
                onBack={() => setStep("upload")}
                onSaved={(j) => {
                  setJob(j);
                  setStep("review");
                }}
              />
            )}
            {step === "review" && job && (
              <ReviewStep
                companyId={companyId}
                job={job}
                onBack={() => setStep("mapping")}
                onRestart={restart}
                onOpening={() => {
                  queryClient.invalidateQueries({ queryKey: importJobsKey(companyId) });
                  setTab("opening");
                }}
                onCommitted={(r) => {
                  setResult(r);
                  setStep("done");
                }}
              />
            )}
            {step === "done" && result && (
              <section className="space-y-4" data-testid="import-done">
                <h2 className="text-xl font-semibold">{ti("doneTitle")}</h2>
                <p className="text-sm" role="status">
                  {ti("doneBody", { created: result.created, skipped: result.skippedDuplicates, errors: result.errors })}
                </p>
                <Button onClick={restart}>{ti("importAnother")}</Button>
              </section>
            )}
          </TabsContent>
          <TabsContent value="opening" className="mt-6">
            <OpeningPanel companyId={companyId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
