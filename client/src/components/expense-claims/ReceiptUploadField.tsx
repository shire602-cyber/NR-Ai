import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/CameraCapture";
import { downscaleImage } from "@/lib/image-downscale";
import { apiRequest } from "@/lib/queryClient";
import {
  ACCEPTED_UPLOAD_TYPES,
  checkFileBeforeUpload,
  fileProblemMessage,
  readFileAsBase64,
} from "@/lib/file-upload";

interface ReceiptUploadFieldProps {
  companyId: string;
  /** Storage key of the uploaded receipt (what the claim item stores), or "". */
  value: string | null | undefined;
  onChange: (key: string) => void;
  locale: string;
}

/** `<companyId>/expense-receipts/<uuid>-<name>` -> `<name>`; legacy values are shown as-is. */
function displayName(value: string): string {
  const name = value.split("/").pop() ?? value;
  return name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

/**
 * Receipt picker for an expense claim item. Uploads the file to private storage
 * (base64 JSON) and keeps only the returned storage key in the form.
 */
export function ReceiptUploadField({ companyId, value, onChange, locale }: ReceiptUploadFieldProps) {
  const isAr = locale === "ar";
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "reading" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    const problem = checkFileBeforeUpload(file);
    if (problem) {
      setError(fileProblemMessage(problem, locale));
      return;
    }
    try {
      setState("reading");
      const prepared = await downscaleImage(file);
      const fileData = await readFileAsBase64(prepared);
      setState("uploading");
      const result = await apiRequest("POST", `/api/companies/${companyId}/expense-claims/receipt-upload`, {
        fileName: prepared.name,
        mimeType: prepared.type || "application/octet-stream",
        fileData,
      });
      onChange(result.receiptKey);
    } catch (e: any) {
      setError(e?.message || (isAr ? "فشل رفع الإيصال" : "Receipt upload failed"));
    } finally {
      setState("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = state !== "idle";

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_UPLOAD_TYPES}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
        data-testid="input-receipt-file"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="me-2 h-4 w-4" />
          )}
          {state === "reading"
            ? isAr ? "جارٍ قراءة الملف…" : "Reading file…"
            : state === "uploading"
              ? isAr ? "جارٍ الرفع…" : "Uploading…"
              : value
                ? isAr ? "استبدال الإيصال" : "Replace receipt"
                : isAr ? "إرفاق إيصال" : "Attach receipt"}
        </Button>
        <CameraCapture compact disabled={busy} onCapture={(files) => (files[0] ? handleFile(files[0]) : undefined)} />
        {value && !busy && (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate" title={displayName(value)}>
              {displayName(value)}
            </span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 hover:bg-muted"
              onClick={() => onChange("")}
              aria-label={isAr ? "إزالة الإيصال" : "Remove receipt"}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
