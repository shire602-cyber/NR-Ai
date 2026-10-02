import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, StagedPdfImport, StatementImportResult } from "@/lib/banking-api-types";
import type { CommitRow } from "@/lib/statement-review";
import { messages } from "./StatementImportDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText, sourceText } from "./banking-common";
import { PdfAiFallbackSetting } from "./PdfAiFallbackSetting";
import { StatementReviewGrid } from "./StatementReviewGrid";
import { warningText } from "./statement-warnings";
import { extractPdfPages, fileToBase64, isPdfFile } from "./pdf-extract";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".csv,.txt,.ofx,.qfx,.sta,.mt940,.xml,.pdf,application/pdf,text/csv";

const SAMPLE_CSV = `Date,Description,Debit,Credit,Balance,Reference
2026-06-13,ADCB BANK CHARGE,42.00,0,58218.00,FEE-0613
2026-06-14,ETISALAT UAE,1260.00,0,56958.00,TEL-0614
2026-06-15,AL NOOR RETAIL FZCO,0,19425.00,76383.00,INV-1042
`;

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "muhasib-sample-bank-statement.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  bankAccounts: BankAccount[];
  initialBankAccountId?: string;
  /** A staged PDF import to review again (opened from the import history). */
  resumeImportId?: string | null;
}

type Phase = { name: "select" } | { name: "working"; label: string; percent: number } | { name: "review"; staged: StagedPdfImport; fileName: string } | { name: "done"; result: StatementImportResult };

export function StatementImportDialog({ open, onOpenChange, companyId, bankAccounts, initialBankAccountId, resumeImportId }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [bankAccountId, setBankAccountId] = useState(initialBankAccountId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "select" });

  useEffect(() => {
    if (open) {
      setPhase({ name: "select" });
      setFile(null);
      setFileError(null);
      setBankAccountId((current) => current || initialBankAccountId || bankAccounts[0]?.id || "");
    }
  }, [open, initialBankAccountId, bankAccounts]);

  useEffect(() => {
    if (!open || !resumeImportId) return;
    let cancelled = false;
    setPhase({ name: "working", label: tr("progressUpload"), percent: 50 });
    apiRequest("GET", `/api/companies/${companyId}/bank-statements/imports/${resumeImportId}`)
      .then((row: any) => {
        if (cancelled) return;
        if (row.status !== "staged" || !Array.isArray(row.rows)) {
          setPhase({ name: "select" });
          return;
        }
        setBankAccountId(row.bankAccountId);
        setPhase({
          name: "review",
          fileName: row.filename ?? "",
          staged: {
            importId: row.id,
            status: "staged",
            parser: row.parser === "ai" ? "ai" : "text",
            rows: row.rows,
            statement: {
              from: row.statementFrom ?? null,
              to: row.statementTo ?? null,
              openingBalance: row.openingBalance == null ? null : Number(row.openingBalance),
              closingBalance: row.closingBalance == null ? null : Number(row.closingBalance),
              currency: row.currency ?? null,
            },
            warnings: Array.isArray(row.warnings) ? row.warnings : [],
          },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) failed(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeImportId, companyId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bank-statements"] });
  const account = bankAccounts.find((a) => a.id === bankAccountId);
  const currency = account?.currency ?? "AED";
  const isPdf = !!file && isPdfFile(file);

  const failed = (err: unknown) => {
    toast({ variant: "destructive", title: tr("toastFailed"), description: bankingErrorText(trc, err, locale) });
    setPhase({ name: "select" });
  };

  const textImport = useMutation({
    mutationFn: async (f: File) => {
      setPhase({ name: "working", label: tr("progressImport"), percent: 50 });
      const content = await f.text();
      return (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/import`, { bankAccountId, content, fileName: f.name, format: "auto" })) as StatementImportResult;
    },
    onSuccess: (result) => {
      invalidate();
      setPhase({ name: "done", result });
      toast({ title: tr("toastImported") });
    },
    onError: failed,
  });

  const pdfStage = useMutation({
    mutationFn: async (f: File) => {
      const { pages, totalPages } = await extractPdfPages(f, (p) =>
        setPhase({
          name: "working",
          label: p.ocr ? tr("progressOcr", { page: p.page, total: p.total }) : tr("progressPage", { page: p.page, total: p.total }),
          percent: Math.round((p.page / p.total) * 60),
        })
      );
      setPhase({ name: "working", label: tr("progressUpload"), percent: 80 });
      const fileData = await fileToBase64(f);
      const staged = (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/imports/pdf`, { bankAccountId, fileName: f.name, fileData, pages })) as StagedPdfImport;
      return { staged, totalPages, fileName: f.name };
    },
    onSuccess: ({ staged, fileName }) => setPhase({ name: "review", staged, fileName }),
    onError: failed,
  });

  const commit = useMutation({
    mutationFn: async (args: { importId: string; rows: CommitRow[] }) =>
      (await apiRequest("POST", `/api/companies/${companyId}/bank-statements/imports/${args.importId}/commit`, { rows: args.rows })) as StatementImportResult,
    onSuccess: (result) => {
      invalidate();
      setPhase({ name: "done", result });
      toast({ title: tr("toastImported") });
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("toastFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const discard = useMutation({
    mutationFn: async (importId: string) => apiRequest("POST", `/api/companies/${companyId}/bank-statements/imports/${importId}/discard`),
    onSuccess: () => {
      invalidate();
      toast({ title: tr("toastDiscarded") });
      onOpenChange(false);
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("toastDiscardFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  const pickFile = (f: File | undefined) => {
    setFile(f ?? null);
    setFileError(f && f.size > MAX_BYTES ? tr("tooLarge") : null);
  };

  const start = () => {
    if (!file || !bankAccountId) {
      toast({ variant: "destructive", title: tr("missingTitle"), description: tr("missingBody") });
      return;
    }
    if (file.size > MAX_BYTES) return;
    if (isPdfFile(file)) pdfStage.mutate(file);
    else textImport.mutate(file);
  };

  const wide = phase.name === "review";
  const busy = phase.name === "working";
  const money = (n: number | null) => (n === null ? "" : formatCurrency(n, currency, locale));

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className={wide ? "sm:max-w-4xl max-h-[92vh] overflow-y-auto" : "sm:max-w-lg max-h-[92vh] overflow-y-auto"} data-testid="statement-import-dialog">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>

        {(phase.name === "select" || phase.name === "working") && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("bankAccount")}</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId} disabled={busy}>
                <SelectTrigger data-testid="select-import-bank-account">
                  <SelectValue placeholder={tr("selectAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nameEn} - {a.bankName} ({a.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bankAccounts.length === 0 && <p className="text-xs text-[hsl(var(--chart-4))]">{tr("noBankAccounts")}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="statement-file">{tr("file")}</Label>
              <Input id="statement-file" type="file" accept={ACCEPT} disabled={busy} onChange={(e) => pickFile(e.target.files?.[0])} data-testid="input-bank-statement-file" />
              {file && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground" dir="auto">
                  {isPdf ? <FileText className="h-4 w-4 text-destructive" /> : <FileSpreadsheet className="h-4 w-4 text-[hsl(var(--chart-5))]" />}
                  <span className="truncate">
                    {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              )}
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
              <p className="text-xs text-muted-foreground">{tr("fileHint")}</p>
              {phase.name === "working" && (
                <div className="space-y-1" role="status">
                  <Progress value={phase.percent} className="h-2" />
                  <p className="text-xs text-muted-foreground">{phase.label}</p>
                </div>
              )}
            </div>

            {isPdf && <PdfAiFallbackSetting companyId={companyId} />}

            <div className="bg-muted/50 p-3 rounded-md text-xs space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium uppercase tracking-wide">{tr("formats")}</p>
                  {(["formatCsv", "formatOfx", "formatMt940", "formatCamt", "formatPdf"] as const).map((k) => (
                    <p key={k} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--chart-5))]" />
                      {tr(k)}
                    </p>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={downloadSample} data-testid="button-download-sample-bank-csv">
                  {tr("sampleCsv")}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {tr("cancel")}
              </Button>
              <Button onClick={start} disabled={busy || !file || !bankAccountId || !!fileError} data-testid="button-confirm-import">
                {busy && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                {tr("importBtn")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase.name === "review" && (
          <StatementReviewGrid
            staged={phase.staged}
            fileName={phase.fileName}
            currency={currency}
            busy={commit.isPending}
            discarding={discard.isPending}
            onCommit={(rows) => commit.mutate({ importId: phase.staged.importId, rows })}
            onDiscard={() => discard.mutate(phase.staged.importId)}
          />
        )}

        {phase.name === "done" && (
          <div className="space-y-3" data-testid="import-result">
            <div className="flex items-center gap-2 text-[hsl(var(--chart-5))]">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">{tr("resultTitle")}</p>
            </div>
            <ul className="text-sm space-y-1">
              <li data-testid="import-result-imported">{tr("resultImported", { count: phase.result.imported })}</li>
              {phase.result.duplicates > 0 && <li data-testid="import-result-duplicates">{tr("resultDuplicates", { count: phase.result.duplicates })}</li>}
              <li className="text-muted-foreground">{tr("resultFormat", { format: sourceText(trc, phase.result.format) })}</li>
              {phase.result.statement.from && phase.result.statement.to && (
                <li className="text-muted-foreground">{tr("resultPeriod", { from: formatDate(phase.result.statement.from, locale), to: formatDate(phase.result.statement.to, locale) })}</li>
              )}
              {phase.result.statement.openingBalance !== null && <li className="text-muted-foreground">{tr("resultOpening", { amount: money(phase.result.statement.openingBalance) })}</li>}
              {phase.result.statement.closingBalance !== null && <li className="text-muted-foreground">{tr("resultClosing", { amount: money(phase.result.statement.closingBalance) })}</li>}
            </ul>
            {phase.result.imported === 0 && <p className="text-sm text-muted-foreground">{tr("resultNoNew")}</p>}
            {phase.result.warnings.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium">{tr("resultWarnings")}</p>
                <ul className="list-disc ps-5 space-y-0.5">
                  {phase.result.warnings.map((w) => (
                    <li key={w} dir="auto">
                      {warningText(w, locale)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{tr("close")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

