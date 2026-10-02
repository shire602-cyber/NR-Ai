import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/queryClient";
import { commitImport, dryRunImport } from "@/lib/import-api";
import { canCommit, isOpeningEntity, type DryRunSummary, type ImportJob } from "@/lib/import-wizard";
import { ErrorRowsTable } from "./ErrorRowsTable";
import { messages as pageMessages } from "./Stepper.i18n";

interface Props {
  companyId: string;
  job: ImportJob;
  onCommitted: (result: { created: number; skippedDuplicates: number; errors: number }) => void;
  onOpening: () => void;
  onBack: () => void;
  onRestart: () => void;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`} dir="ltr">
        {value}
      </dd>
    </div>
  );
}

export function ReviewStep({ companyId, job, onCommitted, onOpening, onBack, onRestart }: Props) {
  const tr = pageMessages.useT();
  const [summary, setSummary] = useState<DryRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = isOpeningEntity(job.entity);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dryRunImport(companyId, job.id)
      .then((r) => !cancelled && setSummary(r.summary))
      .catch((err) => !cancelled && setError(err instanceof ApiError && err.code === "IMPORT_ALREADY_COMMITTED" ? tr("alreadyCommitted") : tr("errGeneric")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // The dry run is one request per mapping save; tr only changes with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, job.id]);

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      const out = await commitImport(companyId, job.id);
      onCommitted(out.result);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(code === "IMPORT_ALREADY_COMMITTED" ? tr("alreadyCommitted") : code === "IMPORT_IN_PROGRESS" ? tr("errInProgress") : code === "IMPORT_FAILED" ? tr("errStopped") : tr("errGeneric"));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="review-heading">
      <div>
        <h2 id="review-heading" className="text-xl font-semibold">{tr("reviewTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr("reviewBody")}</p>
      </div>
      {loading && <p className="text-sm text-muted-foreground" role="status">{tr("loading")}</p>}
      {summary && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dry-run-summary">
            <Stat label={tr("totalRows")} value={summary.rowCount} />
            <Stat label={tr("willCreate")} value={summary.toCreate} tone="good" />
            <Stat label={tr("duplicatesSkipped")} value={summary.duplicates} />
            <Stat label={tr("rowsWithErrors")} value={summary.errors} tone={summary.errors > 0 ? "bad" : undefined} />
            {summary.totalDebit !== undefined && <Stat label={tr("totalDebit")} value={summary.totalDebit.toFixed(2)} />}
            {summary.totalCredit !== undefined && <Stat label={tr("totalCredit")} value={summary.totalCredit.toFixed(2)} />}
          </dl>
          {summary.balanced === false && <p role="alert" className="text-sm text-destructive">{tr("unbalanced")}</p>}
          {summary.errors === 0 && <p className="text-sm text-primary">{tr("noErrors")}</p>}
          {summary.errors > 0 && <ErrorRowsTable companyId={companyId} jobId={job.id} total={summary.errors} />}
          {(summary.errors > 0 || summary.duplicates > 0) && canCommit(summary) && !opening && (
            <p className="text-sm text-muted-foreground">{tr("skipWarning", { errors: summary.errors, dupes: summary.duplicates })}</p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="text-review-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onBack} disabled={committing}>
          {tr("back")}
        </Button>
        {summary && summary.errors > 0 && (
          <Button variant="outline" onClick={onRestart}>
            {tr("againAction")}
          </Button>
        )}
        {summary && canCommit(summary) && !opening && (
          <Button onClick={commit} disabled={committing} data-testid="button-commit-import">
            {committing ? tr("committing") : tr.plural("commitNote", summary.toCreate)}
          </Button>
        )}
        {summary && opening && summary.errors === 0 && summary.balanced !== false && (
          <Button onClick={onOpening} data-testid="button-to-opening">
            {tr("toOpening")}
          </Button>
        )}
      </div>
    </section>
  );
}
