import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { fieldLabel, validateFieldValue } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";
import type { CustomFieldDraft } from "./useCustomFieldDraft";

const NO_VALUE = "__none__";

/** One input per custom field defined for this kind of record. Renders nothing when the company has defined none. */
export function CustomFieldsEditor({ draft, disabled }: { draft: CustomFieldDraft; disabled?: boolean }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  if (draft.fields.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="custom-fields-editor">
      <h3 className="font-medium">{tr("customFields")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {draft.fields.map((f) => {
          const value = draft.values[f.key] ?? "";
          const problem = validateFieldValue(f, value);
          const id = `custom-field-${draft.entity}-${f.key}`;
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id}>
                {fieldLabel(f, locale)}
                {f.archived && <span className="ms-2 text-xs text-muted-foreground">{tr("fieldArchived")}</span>}
              </Label>
              {f.fieldType === "select" ? (
                <Select value={value || NO_VALUE} disabled={disabled} onValueChange={(v) => draft.setValue(f.key, v === NO_VALUE ? "" : v)}>
                  <SelectTrigger id={id} data-testid={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VALUE}>{tr("fieldNoValue")}</SelectItem>
                    {(f.options ?? []).map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"}
                  step={f.fieldType === "number" ? "any" : undefined}
                  dir={f.fieldType === "text" ? undefined : "ltr"}
                  disabled={disabled}
                  value={value}
                  onChange={(e) => draft.setValue(f.key, e.target.value)}
                  aria-invalid={problem !== "ok"}
                  data-testid={id}
                />
              )}
              {problem !== "ok" && (
                <p className="text-xs text-destructive" role="alert">
                  {problem === "number" ? tr("fieldNeedsNumber") : problem === "date" ? tr("fieldNeedsDate") : tr("fieldNeedsOption")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
