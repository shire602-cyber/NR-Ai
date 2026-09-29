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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { checkFileBeforeUpload, fileProblemMessage, readFileAsBase64 } from "@/lib/file-upload";
import { useComplianceText } from "@/lib/i18n-compliance";
import { filingBase, type FilingKind } from "./filing-types";

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
      });
    },
    onSuccess: () => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: c.filingRecorded, description: c.filingRecordedBody });
      onOpenChange(false);
    },
    onError: (err: any) => setError(err?.message || c.filingFailed),
  });

  const submit = () => {
    setError(null);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-record-filing">
        <DialogHeader>
          <DialogTitle>{c.recordFiling}</DialogTitle>
          <DialogDescription>{c.recordFilingDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
            {c.recordFiling}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
