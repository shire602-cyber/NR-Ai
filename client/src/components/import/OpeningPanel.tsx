import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiError, queryClient } from "@/lib/queryClient";
import { commitOpening, importJobsKey, previewOpening, type OpeningJobs, type OpeningPreviewResponse } from "@/lib/import-api";
import { eligibleOpeningJobs, type ImportJob } from "@/lib/import-wizard";
import { messages as pageMessages } from "./Stepper.i18n";

const selectClass = "h-9 w-full rounded-md border border-input bg-card px-2 text-base md:text-sm";

function JobSelect({ id, label, jobs, value, onChange, optional }: { id: string; label: string; jobs: ImportJob[]; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const tr = pageMessages.useT();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`select-${id}`}>
        {optional && <option value="">{tr("pickNone")}</option>}
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.filename} ({tr.plural("rows", j.rowCount)})
          </option>
        ))}
      </select>
    </div>
  );
}

export function OpeningPanel({ companyId }: { companyId: string }) {
  const tr = pageMessages.useT();
  const { data: jobs, isLoading } = useQuery<ImportJob[]>({ queryKey: importJobsKey(companyId) });
  const eligible = eligibleOpeningJobs(jobs);

  const [tb, setTb] = useState("");
  const [inv, setInv] = useState("");
  const [bil, setBil] = useState("");
  const [preview, setPreview] = useState<OpeningPreviewResponse | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the newest clean trial balance once the list loads.
  useEffect(() => {
    if (!tb && eligible.opening_tb[0]) setTb(eligible.opening_tb[0].id);
  }, [eligible.opening_tb, tb]);

  const body = (): OpeningJobs => ({ tbJobId: tb, ...(inv ? { invoicesJobId: inv } : {}), ...(bil ? { billsJobId: bil } : {}) });
  const reset = () => {
    setPreview(null);
    setError(null);
  };

  const check = useMutation({
    mutationFn: () => previewOpening(companyId, body()),
    onSuccess: setPreview,
    onError: (err) => setError(err instanceof ApiError && err.code === "TB_UNBALANCED" ? tr("errTb") : tr("errGeneric")),
  });
  const post = useMutation({
    mutationFn: () => commitOpening(companyId, body()),
    onSuccess: () => {
      setConfirm(false);
      setPosted(true);
      queryClient.invalidateQueries({ queryKey: importJobsKey(companyId) });
    },
    onError: (err) => {
      setConfirm(false);
      setError(err instanceof ApiError && err.code === "TB_UNBALANCED" ? tr("errTb") : err instanceof ApiError && err.status === 409 ? tr("alreadyCommitted") : tr("errGeneric"));
    },
  });

  if (posted) {
    return (
      <section className="space-y-4" data-testid="opening-done">
        <h2 className="text-xl font-semibold">{tr("openingTitle")}</h2>
        <p className="text-sm text-primary" role="status">{tr("openingDone")}</p>
        <Button asChild variant="outline">
          <Link href="/journal">{tr("viewJournal")}</Link>
        </Button>
      </section>
    );
  }

  const totals = preview?.preview.totals;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section className="space-y-6" aria-labelledby="opening-heading">
      <div>
        <h2 id="opening-heading" className="text-xl font-semibold">{tr("openingTitle")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tr("openingBody")}</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
      {!isLoading && eligible.opening_tb.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-opening-none">{tr("openingNone")}</p>}
      {eligible.opening_tb.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <JobSelect id="pick-tb" label={tr("pickTb")} jobs={eligible.opening_tb} value={tb} onChange={(v) => { setTb(v); reset(); }} />
          <JobSelect id="pick-invoices" label={tr("pickInvoices")} jobs={eligible.open_invoices} value={inv} onChange={(v) => { setInv(v); reset(); }} optional />
          <JobSelect id="pick-bills" label={tr("pickBills")} jobs={eligible.open_bills} value={bil} onChange={(v) => { setBil(v); reset(); }} optional />
        </div>
      )}
      {eligible.opening_tb.length > 0 && (
        <Button onClick={() => check.mutate()} disabled={!tb || check.isPending} data-testid="button-preview-opening">
          {check.isPending ? tr("previewing") : tr("previewOpening")}
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-destructive" data-testid="text-opening-error">{error}</p>}

      {preview && (
        <div className="space-y-4" data-testid="opening-preview">
          {preview.preview.errors.length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium text-destructive">{tr("openingProblems")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-5">
                {preview.preview.errors.map((e, i) => (
                  <li key={i} dir="ltr">{e.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-primary" role="status">{tr("openingOk")}</p>
          )}
          {preview.preview.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 p-3 text-sm">
              <p className="font-medium">{tr("openingWarnings")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-5">
                {preview.preview.warnings.map((w, i) => (
                  <li key={i} dir="ltr">{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [tr("asOf"), preview.summary.asOfDate],
              [tr("summaryAccounts"), String(preview.summary.accounts)],
              [tr("summaryInvoices"), String(preview.summary.openInvoices)],
              [tr("summaryBills"), String(preview.summary.openBills)],
              [tr("summaryFolded"), money(preview.summary.foldedProfitAndLoss)],
              ...(totals
                ? [
                    [tr("totalDebit"), money(totals.debit)],
                    [tr("totalCredit"), money(totals.credit)],
                    [tr("summaryBalancing"), money(totals.balancingAmount)],
                    [tr("summaryAr"), money(totals.ar)],
                    [tr("summaryOpenInvoices"), money(totals.openInvoicesTotal)],
                    [tr("summaryAp"), money(totals.ap)],
                    [tr("summaryOpenBills"), money(totals.openBillsTotal)],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums" dir="ltr">{value}</dd>
              </div>
            ))}
          </dl>
          <Button onClick={() => setConfirm(true)} disabled={!preview.preview.ok || post.isPending} data-testid="button-post-opening">
            {post.isPending ? tr("posting") : tr("postOpening")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("confirmBody", { date: preview?.summary.asOfDate ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); post.mutate(); }} data-testid="button-confirm-post-opening">
              {tr("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
