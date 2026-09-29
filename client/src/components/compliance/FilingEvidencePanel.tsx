import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Lock, LockOpen, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { parseCalendarDay } from "@/lib/date-safe";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import {
  checkFileBeforeUpload,
  downloadAuthenticatedFile,
  fileProblemMessage,
  readFileAsBase64,
} from "@/lib/file-upload";
import { useComplianceText } from "@/lib/i18n-compliance";
import AmendButton from "./AmendButton";
import RecordFilingDialog from "./RecordFilingDialog";
import RecordPaymentDialog from "./RecordPaymentDialog";
import {
  boxLabel,
  filingBase,
  filingViewUrl,
  statusLabelKey,
  type BoxDifference,
  type FilingKind,
  type FilingView,
} from "./filing-types";

interface Props {
  kind: FilingKind;
  returnId: string;
  companyId: string;
  /** Status of the return itself; only a closed, unfiled return can be recorded as filed. */
  returnStatus: string;
  /** YYYY-MM-DD last day of the period. */
  periodEnd: string;
  /** Query keys (besides the panel's own) to refresh after any change, e.g. the returns list. */
  listKeys: unknown[][];
  /** Open another return (the amendment just created). */
  onOpenReturn?: (returnId: string) => void;
}

const ymd = (value: string) => value.slice(0, 10);
const day = (value: string) => format(parseCalendarDay(new Date(`${ymd(value)}T00:00:00Z`)), "dd MMM yyyy");
const monthLabel = (value: string) => format(parseCalendarDay(new Date(`${ymd(value)}T00:00:00Z`)), "MMM yyyy");

function DifferenceTable({ rows, locale }: { rows: BoxDifference[]; locale: string }) {
  const { c } = useComplianceText();
  return (
    <div className="overflow-x-auto rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{c.box}</TableHead>
            <TableHead className="text-end">{c.filedFigure}</TableHead>
            <TableHead className="text-end">{c.booksNow}</TableHead>
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

/**
 * Filing record of one VAT or corporate tax return: frozen-figures status, drift
 * warning, evidence files, settlement payments and the amendment action. Used
 * inside the return detail dialog of the VAT and Corporate Tax pages.
 */
export default function FilingEvidencePanel({
  kind,
  returnId,
  companyId,
  returnStatus,
  periodEnd,
  listKeys,
  onOpenReturn,
}: Props) {
  const { c, f, locale } = useComplianceText();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filingOpen, setFilingOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; filename: string } | null>(null);
  const [reason, setReason] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);

  const viewKey = [filingViewUrl(kind, returnId)];
  const invalidateKeys = [viewKey, ...listKeys];
  const { data: view, isLoading } = useQuery<FilingView>({ queryKey: viewKey });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      apiRequest("POST", `${filingBase(kind, returnId)}/evidence`, {
        fileName: file.name,
        mimeType: file.type,
        fileData: await readFileAsBase64(file),
      }),
    onSuccess: () => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: c.evidenceAdded });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: c.evidenceAddFailed, description: err?.message }),
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `${filingBase(kind, returnId)}/evidence/${removing!.id}`, { reason: reason.trim() }),
    onSuccess: () => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: c.evidenceRemoved });
      setRemoving(null);
      setReason("");
    },
    onError: (err: any) => setRemoveError(err?.message || c.downloadFailed),
  });

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFileBeforeUpload(file);
    if (problem) {
      toast({ variant: "destructive", title: c.evidenceAddFailed, description: fileProblemMessage(problem, locale) });
      return;
    }
    uploadMutation.mutate(file);
  };

  const download = async (id: string, filename: string) => {
    try {
      await downloadAuthenticatedFile(`${filingBase(kind, returnId)}/evidence/${id}/download`, filename);
    } catch (err: any) {
      toast({ variant: "destructive", title: c.downloadFailed, description: err?.message });
    }
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!view) return null;

  const monthsText = view.period ? view.period.months.map(monthLabel).join(", ") : undefined;
  // Any unfiled return of an ended period can be recorded as filed (the server enforces the period rule).
  const canRecordFiling = !view.filed && (view.isAmendment || ["draft", "pending_review", "submitted"].includes(returnStatus));
  const settlement = view.settlement;

  return (
    <Card data-testid="panel-filing-evidence">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{c.filingTitle}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {view.isAmendment && <Badge variant="outline">{c.amendmentBadge}</Badge>}
            {view.filed && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {c.filedBadge}
              </Badge>
            )}
            {view.period && view.filed && (
              <Badge
                variant={view.period.locked ? "secondary" : "outline"}
                className="gap-1"
                title={f("lockedMonths", { months: view.period.lockedMonths.map(monthLabel).join(", ") || "-" })}
                data-testid="badge-period-lock"
              >
                {view.period.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                {view.period.locked
                  ? c.periodLocked
                  : view.period.lockedMonths.length > 0
                    ? c.periodPartlyLocked
                    : c.periodUnlocked}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {view.isAmendment && view.amendsReference && (
          <p className="text-sm text-muted-foreground">{f("amendsReference", { ref: view.amendsReference })}</p>
        )}

        {view.amendedBy.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">{c.amendedBy}: </span>
            {view.amendedBy.map((a) => (
              <Button
                key={a.id}
                variant="link"
                size="sm"
                className="h-auto p-0 me-2"
                onClick={() => onOpenReturn?.(a.id)}
                data-testid={`link-amended-by-${a.id}`}
              >
                {a.referenceNumber ?? c.openAmendment}
              </Button>
            ))}
          </p>
        )}

        {/* Frozen figures / not yet filed */}
        {view.filed && view.filing ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium" data-testid="text-filing-reference">
              {f("filedWithReference", { ref: view.filing.referenceNumber, date: day(view.filing.filedAt) })}
            </p>
            <p className="text-muted-foreground">{c.filedBy}</p>
            <p className="break-all text-xs text-muted-foreground">
              {c.snapshotFingerprint}: <span className="font-mono">{view.filing.snapshotHash}</span>
            </p>
            {view.filing.notes && <p className="text-muted-foreground">{view.filing.notes}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{c.notFiledYet}</p>
            <p className="text-xs text-muted-foreground">{c.notTransmitted}</p>
            {canRecordFiling && (
              <Button size="sm" onClick={() => setFilingOpen(true)} data-testid="button-record-filing">
                {c.recordFiling}
              </Button>
            )}
          </div>
        )}

        {/* Draft amendment: what changes against the filed return */}
        {!view.filed && view.isAmendment && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{c.amendmentDifferences}</p>
            {view.amendmentDifferences.length > 0 ? (
              <DifferenceTable rows={view.amendmentDifferences} locale={locale} />
            ) : (
              <p className="text-sm text-muted-foreground">{c.noAmendmentDifferences}</p>
            )}
          </div>
        )}

        {/* Drift warning */}
        {view.filed && view.driftDetected && (
          <Alert className="border-warning/40 bg-warning-subtle text-warning-subtle-foreground" data-testid="banner-drift">
            <AlertTriangle className="h-4 w-4" />
            <div className="w-full space-y-2 text-sm">
              <p className="font-semibold">{c.driftTitle}</p>
              <p>{c.driftBody}</p>
              <DifferenceTable rows={view.driftDifferences} locale={locale} />
              <AmendButton
                kind={kind}
                returnId={returnId}
                invalidateKeys={invalidateKeys}
                onCreated={(id) => onOpenReturn?.(id)}
              />
            </div>
          </Alert>
        )}
        {view.filed && view.driftCheck === "unavailable" && view.driftMessage && (
          <p className="text-xs text-muted-foreground">{f("driftUnavailable", { message: view.driftMessage })}</p>
        )}

        {/* Evidence */}
        {view.filed && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{c.evidenceTitle}</p>
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    onPickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                  data-testid="input-evidence-file"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInput.current?.click()}
                  data-testid="button-add-evidence"
                >
                  {uploadMutation.isPending ? (
                    <Loader2 className="me-1 h-4 w-4 animate-spin" />
                  ) : (
                    <FileUp className="me-1 h-4 w-4" />
                  )}
                  {c.addEvidence}
                </Button>
              </div>
            </div>
            {view.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">{c.noEvidence}</p>
            ) : (
              <ul className="divide-y rounded-md border" data-testid="list-evidence">
                {view.evidence.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {ev.filename}
                      <span className="ms-2 text-xs text-muted-foreground">{Math.max(1, Math.round(ev.sizeBytes / 1024))} KB</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void download(ev.id, ev.filename)}
                        title={c.download}
                        data-testid={`button-download-evidence-${ev.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving({ id: ev.id, filename: ev.filename });
                        }}
                        title={c.remove}
                        data-testid={`button-remove-evidence-${ev.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Payments */}
        {view.filed && settlement && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{c.paymentsTitle}</p>
              <Badge variant={settlement.status === "paid" ? "secondary" : "outline"}>
                {c[statusLabelKey(settlement.status)]}
              </Badge>
            </div>
            {settlement.direction !== "none" && (
              <p className="text-sm">
                <span className="text-muted-foreground">
                  {settlement.direction === "receive" ? c.refundDue : c.balanceDue}:{" "}
                </span>
                <span className="font-mono font-semibold" data-testid="text-balance-due">
                  {formatCurrency(settlement.remaining, "AED", locale)}
                </span>
                <span className="ms-3 text-muted-foreground">
                  {c.alreadyPaid}: <span className="font-mono">{formatCurrency(settlement.paid, "AED", locale)}</span>
                </span>
              </p>
            )}
            {view.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{c.noPayments}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {view.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {day(p.paidAt)}
                      {p.accountName ? ` · ${p.accountName}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    <span className="font-mono">{formatCurrency(p.amount, "AED", locale)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {settlement.remaining > 0 && (
                <Button size="sm" onClick={() => setPaymentOpen(true)} data-testid="button-record-payment">
                  {settlement.direction === "receive" ? c.recordRefund : c.recordPayment}
                </Button>
              )}
              <AmendButton
                kind={kind}
                returnId={returnId}
                invalidateKeys={invalidateKeys}
                onCreated={(id) => onOpenReturn?.(id)}
              />
            </div>
          </div>
        )}
      </CardContent>

      <RecordFilingDialog
        open={filingOpen}
        onOpenChange={setFilingOpen}
        kind={kind}
        returnId={returnId}
        periodEnd={ymd(periodEnd)}
        lockedMonthsText={monthsText}
        invalidateKeys={invalidateKeys}
      />
      {settlement && settlement.direction !== "none" && settlement.remaining > 0 && (
        <RecordPaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          kind={kind}
          returnId={returnId}
          companyId={companyId}
          settlement={settlement}
          invalidateKeys={invalidateKeys}
        />
      )}

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{c.removeEvidenceTitle}</DialogTitle>
            <DialogDescription>{c.removeEvidenceBody}</DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">{removing?.filename}</p>
          <div className="space-y-1.5">
            <label htmlFor="remove-reason" className="text-sm">
              {c.removalReason}
            </label>
            <Textarea id="remove-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-removal-reason" />
          </div>
          {removeError && (
            <p className="text-sm text-destructive" role="alert">
              {removeError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={removeMutation.isPending}>
              {c.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => {
                if (reason.trim().length < 5) return setRemoveError(c.reasonTooShort);
                setRemoveError(null);
                removeMutation.mutate();
              }}
              data-testid="button-confirm-remove-evidence"
            >
              {removeMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {c.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
