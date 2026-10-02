import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReportViewState } from "@/lib/reportRunApi";
import { messages as pageMessages } from "./ConsolidationCompanyPicker.i18n";
import {
  MAX_CONSOLIDATED_COMPANIES,
  hasMixedCurrencies,
  selectedCompanyIds,
  type PickableCompany,
} from "./ConsolidationCompanyPicker.logic";

interface Props {
  companies: PickableCompany[];
  currentCompanyId: string | undefined;
  state: ReportViewState;
  onChange: (next: ReportViewState) => void;
}

export function ConsolidationCompanyPicker({
  companies,
  currentCompanyId,
  state,
  onChange,
}: Props) {
  const tr = pageMessages.useT();
  const selected = selectedCompanyIds(state, currentCompanyId);
  const statement = state.filters.statement === "bs" ? "bs" : "pl";
  const mixed = hasMixedCurrencies(companies, selected);

  const setSelected = (ids: string[]) =>
    onChange({ ...state, filters: { ...state.filters, companyIds: ids.join(",") } });
  const toggle = (id: string, on: boolean) =>
    setSelected(on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id));

  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-labelledby="consolidation-title"
      data-testid="consolidation-picker"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="consolidation-title" className="text-sm font-semibold">
            {tr("title")}
          </h3>
          <p className="max-w-2xl text-xs text-muted-foreground">{tr("hint")}</p>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">{tr("statement")}</span>
          <div
            className="inline-flex rounded-md border p-0.5"
            role="group"
            aria-label={tr("statement")}
          >
            {(["pl", "bs"] as const).map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={statement === s ? "default" : "ghost"}
                aria-pressed={statement === s}
                onClick={() => onChange({ ...state, filters: { ...state.filters, statement: s } })}
                data-testid={`statement-${s}`}
              >
                {s === "pl" ? tr("profitLoss") : tr("balanceSheet")}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label={tr("title")}>
        {companies.map((c) => {
          const id = `consolidate-${c.id}`;
          return (
            <div key={c.id} className="flex items-center gap-2 rounded px-1 py-1">
              <Checkbox
                id={id}
                checked={selected.includes(c.id)}
                disabled={selected.length === 1 && selected.includes(c.id)}
                onCheckedChange={(v) => toggle(c.id, v === true)}
              />
              <Label htmlFor={id} className="flex-1 cursor-pointer font-normal" dir="auto">
                {c.name}
                {c.id === currentCompanyId ? (
                  <span className="ms-1 text-xs text-muted-foreground">{tr("currentCompany")}</span>
                ) : null}
                <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                  {c.baseCurrency || "AED"}
                </span>
              </Label>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-2" data-testid="consolidation-strict">
        <Checkbox
          id="consolidation-strict"
          checked={state.filters.strict === "1"}
          onCheckedChange={(v) =>
            onChange({ ...state, filters: { ...state.filters, strict: v === true ? "1" : "" } })
          }
        />
        <Label htmlFor="consolidation-strict" className="cursor-pointer space-y-0.5 font-normal">
          <span className="block">{tr("strictLabel")}</span>
          <span className="block text-xs text-muted-foreground">{tr("strictHint")}</span>
        </Label>
      </div>

      <p
        className={cn(
          "text-xs",
          selected.length === 0 || selected.length > MAX_CONSOLIDATED_COMPANIES
            ? "text-destructive"
            : "text-muted-foreground"
        )}
      >
        {tr("selectedCount", { count: selected.length, max: MAX_CONSOLIDATED_COMPANIES })}
      </p>
      {selected.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {tr("none")}
        </p>
      ) : null}
      {selected.length > MAX_CONSOLIDATED_COMPANIES ? (
        <p role="alert" className="text-sm text-destructive">
          {tr("tooMany", { max: MAX_CONSOLIDATED_COMPANIES })}
        </p>
      ) : null}
      {mixed ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="consolidation-mixed-currency"
        >
          {tr("mixedCurrency")}
        </p>
      ) : null}
      {companies.length < 2 ? (
        <p className="text-xs text-muted-foreground">{tr("onlyOne")}</p>
      ) : null}
    </section>
  );
}
