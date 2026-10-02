import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/queryClient";
import { uploadImport } from "@/lib/import-api";
import { fileToBase64, validateUpload, type ImportEntity, type ImportSource, type UploadResult } from "@/lib/import-wizard";
import { messages as pageMessages } from "./Stepper.i18n";

interface Props {
  companyId: string;
  source: ImportSource;
  entity: ImportEntity;
  onUploaded: (result: UploadResult) => void;
  onBack: () => void;
}

const PROBLEM_KEY = { extension: "errExtension", empty: "errEmpty", tooLarge: "errTooLarge" } as const;

export function UploadStep({ companyId, source, entity, onUploaded, onBack }: Props) {
  const tr = pageMessages.useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file || busy) return;
    const problem = validateUpload(file.name, file.size);
    if (problem) {
      setError(tr(PROBLEM_KEY[problem]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await uploadImport(companyId, { source, entity, filename: file.name, contentBase64: await fileToBase64(file) });
      onUploaded(result);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 413 ? tr("errTooLarge") : tr("errUpload"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handle(e.dataTransfer.files?.[0]);
  }

  return (
    <section className="space-y-5" aria-labelledby="upload-heading">
      <div>
        <h2 id="upload-heading" className="text-xl font-semibold">{tr("uploadTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr("uploadBody", { source: tr(`source_${source}` as const) })}</p>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <Upload className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <input
          ref={input}
          id="import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
          data-testid="input-import-file"
        />
        <Button type="button" onClick={() => input.current?.click()} disabled={busy} data-testid="button-choose-file">
          {busy ? tr("uploading") : tr("chooseFile")}
        </Button>
        <p className="text-sm text-muted-foreground">{tr("dropHere")}</p>
        <p className="text-xs text-muted-foreground">{tr("fileTypes")}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="text-upload-error">
          {error}
        </p>
      )}
      <Button variant="outline" onClick={onBack} disabled={busy}>
        {tr("back")}
      </Button>
    </section>
  );
}
