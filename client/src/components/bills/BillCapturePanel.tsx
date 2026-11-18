import { useEffect, useState } from "react";
import { FileText, Loader2, RefreshCw, ScanText, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  fetchStoredFile,
  PURCHASE_FILE_ACCEPT,
  PURCHASE_FILE_MAX_BYTES,
  readFileAsDataUrl,
} from "@/lib/purchase-files";
import type { BillCaptureField, BillCaptureResult, ConfidenceBand } from "@shared/bill-capture";

/** A file chosen in the editor; uploaded as the bill attachment when the bill is saved. */
export interface PendingBillFile {
  name: string;
  type: string;
  dataUrl: string;
}

/** Same order as BILL_CAPTURE_FIELDS (shared/bill-capture.ts, kept out of the bundle: it pulls in decimal.js). */
const BILL_CAPTURE_FIELDS: readonly BillCaptureField[] = [
  "supplier",
  "billNumber",
  "billDate",
  "currency",
  "lines",
  "vatTreatment",
  "total",
];

const BAND_VARIANT: Record<ConfidenceBand, "success" | "warning" | "danger"> = {
  high: "success",
  review: "warning",
  low: "danger",
};

/** Per-field confidence pill (also used next to the form labels). */
export function ConfidenceBadge({ band, testId }: { band: ConfidenceBand; testId?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant={BAND_VARIANT[band]} dot data-testid={testId} data-band={band}>
      {t[`purchases.capture.band.${band}`]}
    </Badge>
  );
}

const KNOWN_CHECKS = new Set([
  "AMOUNTS_DO_NOT_ADD_UP",
  "AMOUNT_MISMATCH",
  "MISSING_AMOUNT",
  "VAT_NOT_FIVE_PERCENT",
  "VAT_RATE_UNUSUAL",
  "LINES_DO_NOT_ADD_UP",
  "DATE_MISSING",
  "DATE_FUTURE",
  "DATE_ANCIENT",
  "DATE_FORMAT",
  "CURRENCY_INVALID",
  "TRN_INVALID",
]);

/**
 * WQ2 (8.2): the document side of the bill editor. Drop a PDF or a photo of the supplier invoice;
 * the receipt OCR pipeline reads it and the form is filled in (supplier matched by TRN, else
 * "Create supplier"; number; dates; currency; lines; VAT treatment) with a confidence per field.
 * Nothing is saved or posted here: the user checks the form and saves the bill, and the file is
 * then kept as the bill's attachment.
 */
export function BillCapturePanel({
  companyId,
  file,
  onFile,
  storedAttachment,
  onCaptured,
  result,
  aiAvailable = true,
}: {
  companyId: string | undefined;
  file: PendingBillFile | null;
  onFile: (file: PendingBillFile | null) => void;
  /** The bill's stored attachment (editing a saved bill). */
  storedAttachment?: { billId: string; name: string | null } | null;
  onCaptured: (result: BillCaptureResult) => void;
  result: BillCaptureResult | null;
  aiAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    type: string;
    source: string | null;
  } | null>(null);

  // Preview: the chosen file, else the stored attachment (fetched with the session). The
  // preview carries the source it was made for, so a stale one is never shown.
  const storedBillId = storedAttachment?.billId ?? null;
  const previewSource = file ? `file:${file.name}:${file.dataUrl.length}` : storedBillId;
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    const source = previewSource;
    const show = (url: string, type: string) => {
      if (cancelled) return URL.revokeObjectURL(url);
      revoke = url;
      setPreview({ url, type, source });
    };
    if (file) {
      void fetch(file.dataUrl)
        .then((r) => r.blob())
        .then((blob) => show(URL.createObjectURL(blob), file.type))
        .catch(() => undefined);
    } else if (storedBillId) {
      void fetchStoredFile(`/api/bills/${storedBillId}/attachment`)
        .then((p) => show(p.url, p.type))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [file, storedBillId, previewSource]);
  const shownPreview = preview && preview.source === previewSource ? preview : null;

  const read = async (f: PendingBillFile) => {
    if (!companyId || !aiAvailable) return;
    setReading(true);
    setError(null);
    try {
      const out = (await apiRequest("POST", `/api/companies/${companyId}/bills/capture`, {
        file: f.dataUrl,
        filename: f.name,
      })) as BillCaptureResult;
      onCaptured(out);
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body?.code ?? "") : "";
      setError({ code, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setReading(false);
    }
  };

  const choose = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > PURCHASE_FILE_MAX_BYTES) {
      setError({ code: "FILE_TOO_LARGE", message: t["purchases.capture.tooLarge"] });
      return;
    }
    const next = { name: f.name, type: f.type, dataUrl: await readFileAsDataUrl(f) };
    onFile(next);
    void read(next);
  };

  const errorText = (code: string, fallback: string) => {
    switch (code) {
      case "AI_NOT_CONFIGURED":
        return t["purchases.capture.errorOff"];
      case "SELF_TRN_DOCUMENT":
        return t["purchases.capture.errorSelfTrn"];
      case "UNSUPPORTED_FILE":
        return t["purchases.capture.errorType"];
      case "FILE_TOO_LARGE":
        return t["purchases.capture.tooLarge"];
      case "AI_QUOTA_EXCEEDED":
        return t["purchases.capture.errorQuota"];
      case "BILL_CAPTURE_FAILED":
        return t["purchases.capture.errorFailed"];
      default:
        return fallback || t["purchases.capture.errorFailed"];
    }
  };

  const fieldLabel = (f: BillCaptureField) => t[`purchases.capture.field.${f}`];
  const hasDocument = !!file || !!storedAttachment;

  return (
    <section
      aria-labelledby="bill-capture-title"
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 xl:sticky xl:top-4"
      data-testid="bill-capture-panel"
    >
      <div className="flex items-start gap-3">
        <ScanText className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 id="bill-capture-title" className="text-h3 font-semibold text-foreground">
            {t["purchases.capture.title"]}
          </h2>
          <p className="text-sm text-muted-foreground">
            {aiAvailable ? t["purchases.capture.hint"] : t["purchases.capture.hintOff"]}
          </p>
        </div>
      </div>

      {!hasDocument && (
        <FileDrop
          accept={PURCHASE_FILE_ACCEPT}
          onFiles={(fs) => void choose(fs)}
          label={t["purchases.capture.drop"]}
          hint={t["purchases.capture.dropHint"]}
          testId="bill-capture-drop"
          inputTestId="bill-capture-input"
        />
      )}

      {hasDocument && (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate" dir="auto" data-testid="bill-capture-file">
            {file?.name ?? storedAttachment?.name ?? t["purchases.capture.attachment"]}
          </span>
          {file && aiAvailable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void read(file)}
              disabled={reading}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {t["purchases.capture.readAgain"]}
            </Button>
          )}
          {file && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t["purchases.capture.remove"]}
              onClick={() => {
                onFile(null);
                setError(null);
              }}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {!file && storedAttachment && (
            <FileDrop
              accept={PURCHASE_FILE_ACCEPT}
              onFiles={(fs) => void choose(fs)}
              label={t["purchases.capture.replace"]}
              className="min-h-0 w-auto border-none p-0"
              testId="bill-capture-replace"
            />
          )}
        </div>
      )}

      {reading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t["purchases.capture.reading"]}
        </p>
      )}

      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-danger-subtle p-3 text-sm text-danger-subtle-foreground"
          role="alert"
          data-testid="bill-capture-error"
        >
          {errorText(error.code, error.message)}
        </p>
      )}

      {result && !reading && (
        <div className="space-y-3" data-testid="bill-capture-result">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t["purchases.capture.filled"]}
          </p>
          <p className="text-sm text-muted-foreground" dir="auto">
            {result.supplierMatch === "trn"
              ? formatMessage(t["purchases.capture.matchTrn"], { name: result.draft.vendor_name })
              : result.supplierMatch === "name"
                ? formatMessage(t["purchases.capture.matchName"], {
                    name: result.draft.vendor_name,
                  })
                : formatMessage(t["purchases.capture.matchNone"], {
                    name: result.draft.vendor_name || "—",
                  })}
          </p>
          <ul className="divide-y rounded-lg border text-sm">
            {BILL_CAPTURE_FIELDS.map((f) => (
              <li key={f} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-muted-foreground">{fieldLabel(f)}</span>
                <ConfidenceBadge band={result.confidence[f]} testId={`capture-confidence-${f}`} />
              </li>
            ))}
          </ul>
          {result.checks.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-sm text-warning-subtle-foreground">
              {result.checks.map((c) => (
                <li key={c}>
                  {KNOWN_CHECKS.has(c)
                    ? t[`purchases.capture.check.${c}`]
                    : t["purchases.capture.check.other"]}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t["purchases.capture.nothingSaved"]}</p>
        </div>
      )}

      {shownPreview && (
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {shownPreview.type === "application/pdf" ? (
            <iframe
              src={shownPreview.url}
              title={t["purchases.capture.previewTitle"]}
              className="h-[32rem] w-full"
            />
          ) : (
            <img
              src={shownPreview.url}
              alt={t["purchases.capture.previewTitle"]}
              className="max-h-[32rem] w-full object-contain"
            />
          )}
        </div>
      )}
    </section>
  );
}
