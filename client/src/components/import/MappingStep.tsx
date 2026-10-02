import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/queryClient";
import { saveImportMapping } from "@/lib/import-api";
import {
  DATE_FORMATS,
  buildMappingBody,
  duplicateColumns,
  guessSlashDateFormat,
  isOpeningEntity,
  missingMapping,
  type DateFormat,
  type ImportJob,
  type ImportOptions,
  type UploadResult,
} from "@/lib/import-wizard";
import { messages as pageMessages } from "./Stepper.i18n";

interface Props {
  companyId: string;
  upload: UploadResult;
  onSaved: (job: ImportJob) => void;
  onBack: () => void;
}

const DATE_FIELDS = new Set(["date", "dueDate"]);
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-2 text-base md:text-sm";

export function MappingStep({ companyId, upload, onSaved, onBack }: Props) {
  const tr = pageMessages.useT();
  const { job, fields, detectedColumns, suggestedMapping, sampleRows } = upload;
  const entity = job.entity;
  const usesDates = entity === "open_invoices" || entity === "open_bills" || isOpeningEntity(entity);

  const [mapping, setMapping] = useState<Record<string, string>>(suggestedMapping);

  // A date column in dd/MM or MM/dd form tells us which one it is; otherwise keep the source default and ask.
  const dateGuess = useMemo(() => {
    const samples = Object.entries(mapping)
      .filter(([field]) => DATE_FIELDS.has(field))
      .flatMap(([, column]) => sampleRows.map((row) => row[column]));
    return guessSlashDateFormat(samples);
  }, [mapping, sampleRows]);
  const hasSlashDates = useMemo(
    () => Object.entries(mapping).some(([field, column]) => DATE_FIELDS.has(field) && sampleRows.some((r) => /\d\/\d/.test(String(r[column] ?? "")))),
    [mapping, sampleRows]
  );

  const [options, setOptions] = useState<ImportOptions>({
    dateFormat: (job.options?.dateFormat as DateFormat | undefined) ?? "yyyy-MM-dd",
    numberFormat: job.options?.numberFormat ?? "us",
    currency: job.options?.currency ?? "AED",
    defaultContactType: job.options?.defaultContactType ?? "customer",
    foldProfitAndLoss: job.options?.foldProfitAndLoss ?? true,
    goLiveDate: job.options?.goLiveDate ?? "",
  });
  const [appliedGuess, setAppliedGuess] = useState<string | null>(null);
  if (dateGuess && appliedGuess !== dateGuess) {
    setAppliedGuess(dateGuess);
    setOptions((o) => ({ ...o, dateFormat: dateGuess }));
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = missingMapping(entity, fields, mapping);
  const dupes = duplicateColumns(mapping);
  const needGoLive = isOpeningEntity(entity);
  const ready = missing.length === 0 && (!needGoLive || /^\d{4}-\d{2}-\d{2}$/.test(options.goLiveDate ?? "")) && !busy;
  const label = (key: string) => tr(`field_${key}` as "field_name");
  const firstSample = (column: string) => String(sampleRows.find((r) => r[column] != null && r[column] !== "")?.[column] ?? "");

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveImportMapping(companyId, job.id, buildMappingBody(entity, mapping, options)));
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tr("errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="mapping-heading">
      <div>
        <h2 id="mapping-heading" className="text-xl font-semibold">{tr("mappingTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr("mappingBody")}</p>
        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{tr("fileName", { name: job.filename })} · {tr.plural("rows", job.rowCount)}</p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("fieldColumn")}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("sourceColumn")}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("sample")}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key} className="border-t align-middle">
                <th scope="row" className="px-3 py-2 text-start font-normal">
                  <label htmlFor={`map-${field.key}`}>{label(field.key)}</label>
                  {field.required && <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{tr("required")}</span>}
                </th>
                <td className="px-3 py-2">
                  <select
                    id={`map-${field.key}`}
                    className={selectClass}
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                    data-testid={`select-map-${field.key}`}
                  >
                    <option value="">{tr("notUsed")}</option>
                    {detectedColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground" dir="ltr">{mapping[field.key] ? firstSample(mapping[field.key]) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dupes.length > 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{tr("columnsUsedTwice", { columns: dupes.join(", ") })}</p>}
      {missing.length > 0 && <p role="status" className="text-sm text-muted-foreground">{tr("missingRequired", { fields: missing.map(label).join(", ") })}</p>}

      <fieldset className="space-y-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">{tr("optionsTitle")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {usesDates && (
            <div className="space-y-2">
              <Label htmlFor="opt-date">{tr("dateFormat")}</Label>
              <select id="opt-date" className={selectClass} value={options.dateFormat} onChange={(e) => setOptions((o) => ({ ...o, dateFormat: e.target.value as DateFormat }))}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              {dateGuess ? (
                <p className="text-xs text-muted-foreground">{tr("dateGuess", { format: dateGuess })}</p>
              ) : hasSlashDates ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{tr("dateAmbiguous")}</p>
              ) : null}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="opt-number">{tr("numberFormat")}</Label>
            <select id="opt-number" className={selectClass} value={options.numberFormat} onChange={(e) => setOptions((o) => ({ ...o, numberFormat: e.target.value as "us" | "eu" }))}>
              <option value="us">{tr("numberUs")}</option>
              <option value="eu">{tr("numberEu")}</option>
            </select>
          </div>
          {usesDates && (
            <div className="space-y-2">
              <Label htmlFor="opt-currency">{tr("currency")}</Label>
              <Input id="opt-currency" value={options.currency} maxLength={3} dir="ltr" onChange={(e) => setOptions((o) => ({ ...o, currency: e.target.value.toUpperCase() }))} />
            </div>
          )}
          {entity === "contacts" && (
            <div className="space-y-2">
              <Label htmlFor="opt-type">{tr("contactType")}</Label>
              <select id="opt-type" className={selectClass} value={options.defaultContactType} onChange={(e) => setOptions((o) => ({ ...o, defaultContactType: e.target.value as "customer" | "vendor" | "both" }))}>
                <option value="customer">{tr("typeCustomer")}</option>
                <option value="vendor">{tr("typeVendor")}</option>
                <option value="both">{tr("typeBoth")}</option>
              </select>
            </div>
          )}
          {needGoLive && (
            <div className="space-y-2">
              <Label htmlFor="opt-golive">{tr("goLive")}</Label>
              <Input id="opt-golive" type="date" dir="ltr" value={options.goLiveDate} onChange={(e) => setOptions((o) => ({ ...o, goLiveDate: e.target.value }))} data-testid="input-golive" />
              <p className="text-xs text-muted-foreground">{tr("goLiveHint")}</p>
            </div>
          )}
        </div>
        {entity === "opening_tb" && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="opt-fold" checked={options.foldProfitAndLoss === true} onCheckedChange={(v) => setOptions((o) => ({ ...o, foldProfitAndLoss: v === true }))} />
            <label htmlFor="opt-fold">{tr("foldPl")}</label>
          </div>
        )}
      </fieldset>

      {sampleRows.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{tr("preview")}</summary>
          <div className="mt-3 overflow-x-auto" dir="ltr">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  {detectedColumns.map((c) => (
                    <th key={c} scope="col" className="px-2 py-1 text-left font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {detectedColumns.map((c) => (
                      <td key={c} className="whitespace-nowrap px-2 py-1">
                        {String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="text-mapping-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          {tr("back")}
        </Button>
        <Button onClick={save} disabled={!ready} data-testid="button-save-mapping">
          {busy ? tr("saving") : tr("saveMapping")}
        </Button>
      </div>
    </section>
  );
}
