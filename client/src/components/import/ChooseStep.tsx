import { Button } from "@/components/ui/button";
import { IMPORT_ENTITIES, IMPORT_SOURCES, type ImportEntity, type ImportSource } from "@/lib/import-wizard";
import { messages as pageMessages } from "./Stepper.i18n";

interface Option<T extends string> {
  value: T;
  label: string;
  hint: string;
}

function Choices<T extends string>({ legend, options, value, onChange }: { legend: string; options: Option<T>[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className={`flex min-h-[44px] cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${value === o.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
            <input type="radio" name={legend} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" data-testid={`choice-${o.value}`} />
            <span aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:shadow-[inset_0_0_0_2px_hsl(var(--background))]" />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface Props {
  kind: "source" | "entity";
  source: ImportSource | null;
  entity: ImportEntity | null;
  onSource: (s: ImportSource) => void;
  onEntity: (e: ImportEntity) => void;
  onNext: () => void;
  onBack: () => void;
}

export function ChooseStep({ kind, source, entity, onSource, onEntity, onNext, onBack }: Props) {
  const tr = pageMessages.useT();
  return (
    <section className="space-y-5" aria-labelledby="choose-heading">
      <div>
        <h2 id="choose-heading" className="text-xl font-semibold">{kind === "source" ? tr("sourceTitle") : tr("entityTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{kind === "source" ? tr("sourceBody") : tr("entityBody")}</p>
      </div>
      {kind === "source" ? (
        <Choices
          legend={tr("sourceTitle")}
          value={source}
          onChange={onSource}
          options={IMPORT_SOURCES.map((s) => ({ value: s, label: tr(`source_${s}` as const), hint: tr(`sourceHint_${s}` as const) }))}
        />
      ) : (
        <>
          <Choices
            legend={tr("entityTitle")}
            value={entity}
            onChange={onEntity}
            options={IMPORT_ENTITIES.map((e) => ({ value: e, label: tr(`entity_${e}` as const), hint: tr(`entityHint_${e}` as const) }))}
          />
          <p className="text-xs text-muted-foreground">{tr("closedNote")}</p>
        </>
      )}
      <div className="flex gap-2">
        {kind === "entity" && (
          <Button variant="outline" onClick={onBack}>
            {tr("back")}
          </Button>
        )}
        <Button onClick={onNext} disabled={kind === "source" ? !source : !entity} data-testid="button-wizard-next">
          {tr("next")}
        </Button>
      </div>
    </section>
  );
}
