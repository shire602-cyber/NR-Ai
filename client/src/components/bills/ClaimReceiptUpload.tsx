import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/ui/file-drop";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import {
  openStoredFile,
  PURCHASE_FILE_ACCEPT,
  PURCHASE_FILE_MAX_BYTES,
  readFileAsDataUrl,
} from "@/lib/purchase-files";

/**
 * WQ2 (8.7): the receipt of one expense-claim item. The file is uploaded at once (the server's
 * upload guard checks its bytes) and the item keeps the signed reference it returns; saving the
 * claim stores it. A saved receipt can be opened from here.
 */
export function ClaimReceiptUpload({
  companyId,
  receiptName,
  hasReceipt,
  viewPath,
  onUploaded,
  onClear,
  index,
}: {
  companyId: string | undefined;
  receiptName: string | null | undefined;
  hasReceipt: boolean;
  /** GET path of the stored receipt (saved items only). */
  viewPath?: string | null;
  onUploaded: (ref: string, name: string) => void;
  onClear: () => void;
  index: number;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: File[]) => {
    const f = files[0];
    if (!f || !companyId) return;
    setError(null);
    if (f.size > PURCHASE_FILE_MAX_BYTES) return setError(t["purchases.capture.tooLarge"]);
    setBusy(true);
    try {
      const out = (await apiRequest("POST", `/api/companies/${companyId}/expense-claims/receipts`, {
        file: await readFileAsDataUrl(f),
        filename: f.name.slice(0, 200),
      })) as { receipt_ref: string; receipt_name: string | null };
      onUploaded(out.receipt_ref, out.receipt_name ?? f.name);
    } catch (e) {
      const code = e instanceof ApiError ? String(e.body?.code ?? "") : "";
      setError(
        code === "UNSUPPORTED_FILE"
          ? t["purchases.capture.errorType"]
          : (e as Error)?.message || t["purchases.claimReceipt.failed"]
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-3" data-testid={`claim-receipt-${index}`}>
      <span className="text-caption font-medium text-muted-foreground">
        {t["purchases.claimReceipt.label"]}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <FileDrop
          accept={PURCHASE_FILE_ACCEPT}
          onFiles={(fs) => void upload(fs)}
          value={hasReceipt ? receiptName || t["purchases.claimReceipt.attached"] : null}
          onClear={hasReceipt ? onClear : undefined}
          label={t["purchases.claimReceipt.drop"]}
          hint={t["purchases.capture.dropHint"]}
          disabled={busy}
          className="flex-1"
          testId={`claim-receipt-drop-${index}`}
          inputTestId={`claim-receipt-input-${index}`}
        />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        {hasReceipt && viewPath && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void openStoredFile(viewPath).catch(() => undefined)}
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t["purchases.claimReceipt.view"]}
          </Button>
        )}
      </div>
      {error && (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
