import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_RATE_PER_DAY,
  DEFAULT_RATE_PER_MINUTE,
  EXPIRY_CHOICES,
  MAX_RATE_PER_DAY,
  MAX_RATE_PER_MINUTE,
  SCOPE_PRESETS,
  SCOPE_RESOURCES,
  buildCreateKeyBody,
  matchingPreset,
  toggleScope,
  validateKeyForm,
  type KeyFormError,
  type ScopePreset,
} from "@/lib/api-scopes";
import { ApiError } from "@/lib/queryClient";
import { messages as pageMessages } from "./ApiKeysTab.i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Resolves with the created key response; throws ApiError on failure. */
  onCreate: (body: ReturnType<typeof buildCreateKeyBody>) => Promise<void>;
}

const PRESET_LABEL: Record<ScopePreset, "presetReadOnly" | "presetInvoicing" | "presetFull"> = {
  readOnly: "presetReadOnly",
  invoicing: "presetInvoicing",
  fullAccess: "presetFull",
};

export function ApiKeyCreateDialog({ open, onClose, onCreate }: Props) {
  const tr = pageMessages.useT();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...SCOPE_PRESETS.readOnly]);
  const [expiresInDays, setExpires] = useState<number>(365);
  const [perMinute, setPerMinute] = useState(String(DEFAULT_RATE_PER_MINUTE));
  const [perDay, setPerDay] = useState(String(DEFAULT_RATE_PER_DAY));
  const [errors, setErrors] = useState<KeyFormError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setScopes([...SCOPE_PRESETS.readOnly]);
      setExpires(365);
      setPerMinute(String(DEFAULT_RATE_PER_MINUTE));
      setPerDay(String(DEFAULT_RATE_PER_DAY));
      setErrors([]);
      setServerError(null);
    }
  }, [open]);

  const preset = matchingPreset(scopes);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = { name, scopes, expiresInDays, ratePerMinute: Number(perMinute), ratePerDay: Number(perDay) };
    const found = validateKeyForm(input);
    setErrors(found);
    if (found.length > 0 || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      await onCreate(buildCreateKeyBody(input));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setServerError(code === "API_KEY_LIMIT" ? tr("errLimit") : code === "KEY_HOLDER_REQUIRED" ? tr("errHolder") : tr("errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: KeyFormError) => errors.includes(k);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="dialog-create-key">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{tr("createTitle")}</DialogTitle>
            <DialogDescription>{tr("createBody")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="key-name">{tr("name")}</Label>
            <Input id="key-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={tr("namePlaceholder")} aria-invalid={err("name") || undefined} data-testid="input-key-name" />
            {err("name") && <p role="alert" className="text-xs text-destructive">{tr("errName")}</p>}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{tr("access")}</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SCOPE_PRESETS) as ScopePreset[]).map((key) => (
                <Button key={key} type="button" size="sm" variant={preset === key ? "default" : "outline"} aria-pressed={preset === key} onClick={() => setScopes([...SCOPE_PRESETS[key]])}>
                  {tr(PRESET_LABEL[key])}
                </Button>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setScopes([])}>
                {tr("clearAll")}
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{tr("access")}</th>
                    <th scope="col" className="w-20 px-3 py-2 text-center font-medium">{tr("read")}</th>
                    <th scope="col" className="w-20 px-3 py-2 text-center font-medium">{tr("write")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...SCOPE_RESOURCES, "reports" as const].map((resource) => {
                    const label = tr(`resource_${resource}` as const);
                    const readScope = `read:${resource}`;
                    const writeScope = `write:${resource}`;
                    return (
                      <tr key={resource} className="border-t">
                        <th scope="row" className="px-3 py-2 text-start font-normal">{label}</th>
                        <td className="px-3 py-2 text-center">
                          <Checkbox checked={scopes.includes(readScope)} onCheckedChange={(v) => setScopes((s) => toggleScope(s, readScope, v === true))} aria-label={`${tr("read")}: ${label}`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {resource !== "reports" && (
                            <Checkbox checked={scopes.includes(writeScope)} onCheckedChange={(v) => setScopes((s) => toggleScope(s, writeScope, v === true))} aria-label={`${tr("write")}: ${label}`} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {err("scopes") && <p role="alert" className="text-xs text-destructive">{tr("errScopes")}</p>}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="key-expiry">{tr("expiry")}</Label>
              <select id="key-expiry" value={expiresInDays} onChange={(e) => setExpires(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-card px-2 text-base md:text-sm">
                {EXPIRY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? tr("expiryNever") : tr("expiryDays", { days: d })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-per-minute">{tr("perMinute")}</Label>
              <Input id="key-per-minute" inputMode="numeric" dir="ltr" value={perMinute} onChange={(e) => setPerMinute(e.target.value.replace(/\D/g, ""))} aria-invalid={err("perMinute") || undefined} />
              {err("perMinute") && <p role="alert" className="text-xs text-destructive">{tr("errPerMinute", { max: MAX_RATE_PER_MINUTE })}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-per-day">{tr("perDay")}</Label>
              <Input id="key-per-day" inputMode="numeric" dir="ltr" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/\D/g, ""))} aria-invalid={err("perDay") || undefined} />
              {err("perDay") && <p role="alert" className="text-xs text-destructive">{tr("errPerDay", { max: MAX_RATE_PER_DAY })}</p>}
            </div>
          </div>

          {serverError && <p role="alert" className="text-sm text-destructive" data-testid="text-key-error">{serverError}</p>}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {tr("cancel")}
            </Button>
            <Button type="submit" disabled={busy} data-testid="button-key-create">
              {busy ? tr("working") : tr("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
