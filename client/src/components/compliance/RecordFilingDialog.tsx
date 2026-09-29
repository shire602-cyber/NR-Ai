import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { checkFileBeforeUpload, fileProblemMessage, readFileAsBase64 } from "@/lib/file-upload";
import { useComplianceText } from "@/lib/i18n-compliance";
import { boxLabel, filingBase, type BoxDifference, type FilingKind } from "./filing-types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: FilingKind;
  returnId: string;
  /** YYYY-MM-DD, the last day of the period the return covers. */
  periodEnd: string;
  /** Human text of the months that filing will lock (VAT only). */
  lockedMonthsText?: string;
  /** Query keys to refresh after recording. */
  invalidateKeys: unknown[][];
}

type FigureChoice = "stored" | "recomputed";

/** Per box: what the draft holds against what the books produce. */
function FigureTable({ rows, storedLabel, booksLabel, locale }: { rows: BoxDifference[]; storedLabel: string; booksLabel: string; locale: string }) {
  const { c } = useComplianceText();
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{c.box}</TableHead>
            <TableHead className="text-end">{storedLabel}</TableHead>
            <TableHead className="text-end">{booksLabel}</TableHead>
            <TableHead className="text-end">{c.difference}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.box}>
              <TableCell className="text-sm">{boxLabel(r.box)}</TableCell>
              <TableCell className="text-end font-mono">{formatCurrency(r.filed, "AED", locale)}</TableCell>
              <TableCell className="text-end font-mono">{formatCurrency(r.current, "AED", locale)}</TableCell>
              <TableCell className="text-end font-mono font-medium">{formatCurrency(r.difference, "AED", locale)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Record that the return was filed on EmaraTax: FTA reference, filing date, acknowledgement. */
export default function RecordFilingDialog({
  open,
  onOpenChange,
  kind,
  returnId,
  periodEnd,
  lockedMonthsText,
  invalidateKeys,
}: Props) {
  const { c, f, locale } = useComplianceText();
  const { toast } = useToast();
  const [reference, setReference] = useState("");
  const [filedAt, setFiledAt] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // VAT: the draft has hand-entered figures and the books moved (409 VAT_RETURN_STALE): the user chooses.
  const [stale, setStale] = useState<BoxDifference[] | null>(null);
  const [choice, setChoice] = useState<FigureChoice | null>(null);
  // VAT: the draft was out of date and was filed with figures recomputed from the books.
  const [recomputed, setRecomputed] = useState<BoxDifference[] | null>(null);

  const finish = () => {
    invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    onOpenChange(false);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      let evidence: { fileName: string; mimeType: string; fileData: string } | undefined;
      if (file) {
        evidence = { fileName: file.name, mimeType: file.type, fileData: await readFileAsBase64(file) };
      }
      return apiRequest("POST", `${filingBase(kind, returnId)}/file`, {
        ftaReferenceNumber: reference.trim(),
        filedAt,
        notes: notes.trim() || undefined,
        evidence,
        acceptFigures: kind === "vat" && choice ? choice : undefined,
      });
    },
    onSuccess: (res: any) => {
      toast({ title: c.filingRecorded, description: c.filingRecordedBody });
      if (res?.recomputedAtFiling && Array.isArray(res.differences) && res.differences.length > 0) {
        // Show what changed instead of closing silently.
        invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
        setStale(null);
        setRecomputed(res.differences as BoxDifference[]);
        return;
      }
      finish();
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === "VAT_RETURN_STALE") {
        const differences = (err.details as { differences?: BoxDifference[] } | undefined)?.differences ?? [];
        setStale(differences);
        setChoice(null);
        setError(null);
        return;
      }
      if (err instanceof ApiError && err.code === "VAT_LEDGER_MISMATCH") {
        setError(`${c.ledgerMismatchTitle}. ${err.message}`);
        return;
      }
      setError(err?.message || c.filingFailed);
    },
  });

  const submit = () => {
    setError(null);
    if (stale && !choice) return setError(c.chooseFigures);
    if (!reference.trim()) return setError(c.referenceRequired);
    if (!filedAt) return setError(c.dateRequired);
    if (filedAt > localToday()) return setError(c.dateInFuture);
    if (filedAt < periodEnd) return setError(c.dateBeforePeriodEnd);
    if (file) {
      const problem = checkFileBeforeUpload(file);
      if (problem) return setError(fileProblemMessage(problem, locale));
    }
    mutation.mutate();
  };

  if (recomputed) {
    return (
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-filing-recomputed">
          <DialogHeader>
            <DialogTitle>{c.recomputedTitle}</DialogTitle>
            <DialogDescription>{c.recomputedBody}</DialogDescription>
          </DialogHeader>
          <FigureTable rows={recomputed} storedLabel={c.staleStoredColumn} booksLabel={c.staleBooksColumn} locale={locale} />
          <DialogFooter>
            <Button onClick={finish} data-testid="button-close-recomputed">
              {c.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-record-filing">
        <DialogHeader>
          <DialogTitle>{c.recordFiling}</DialogTitle>
          <DialogDescription>{c.recordFilingDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {stale && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30" role="alert" data-testid="panel-filing-stale">
              <div>
                <p className="text-sm font-medium">{c.staleTitle}</p>
                <p className="text-xs text-muted-foreground">{c.staleBody}</p>
              </div>
              <FigureTable rows={stale} storedLabel={c.staleStoredColumn} booksLabel={c.staleBooksColumn} locale={locale} />
              <fieldset className="space-y-2">
                {([
                  ["stored", c.chooseStored, c.chooseStoredHint],
                  ["recomputed", c.chooseRecomputed, c.chooseRecomputedHint],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="accept-figures"
                      className="mt-1"
                      checked={choice === value}
                      onChange={() => setChoice(value)}
                      data-testid={`radio-accept-${value}`}
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="filing-reference">{c.ftaReference}</Label>
            <Input
              id="filing-reference"
              value={reference}
              maxLength={100}
              onChange={(e) => setReference(e.target.value)}
              data-testid="input-filing-reference"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filing-date">{c.filedOn}</Label>
            <Input
              id="filing-date"
              type="date"
              value={filedAt}
              min={periodEnd}
              max={localToday()}
              onChange={(e) => setFiledAt(e.target.value)}
              data-testid="input-filing-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filing-ack">{c.acknowledgement}</Label>
            <Input
              id="filing-ack"
              type="file"
              accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-filing-ack"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filing-notes">{c.notes}</Label>
            <Textarea id="filing-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {lockedMonthsText && (
            <p className="text-xs text-muted-foreground">{f("filingLocksPeriod", { months: lockedMonthsText })}</p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-filing-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {c.cancel}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending} data-testid="button-save-filing">
            {mutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {stale ? c.fileWithChoice : c.recordFiling}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
