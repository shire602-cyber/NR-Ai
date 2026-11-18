/**
 * WQ3 (9.4 / 9.16): the details row of one manual journal line: contact, cost centre, VAT
 * treatment, currency and corporate-tax treatment. Values live in the journal form (Journal.tsx);
 * this component only renders the controls and reports changes.
 */
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/form-layout";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { ctTreatmentFitsAccount } from "@shared/journal-line-treatments";
import type { JournalGridLine, LinePreview } from "@/lib/journal-grid";

const NONE = "__none__";

export interface ContactOption {
  id: string;
  name: string;
  nameAr?: string | null;
}

export interface CostCenterOption {
  id: string;
  code?: string | null;
  name: string;
}

export interface JournalLineDetailsProps {
  index: number;
  line: JournalGridLine;
  onChange: (patch: Partial<JournalGridLine>) => void;
  accountType?: string;
  customers: ContactOption[];
  vendors: ContactOption[];
  costCenters: CostCenterOption[];
  currencies: string[];
  baseCurrency: string;
  vatRate: number;
  preview: LinePreview;
}

export function JournalLineDetails({
  index,
  line,
  onChange,
  accountType,
  customers,
  vendors,
  costCenters,
  currencies,
  baseCurrency,
  vatRate,
  preview,
}: JournalLineDetailsProps) {
  const { t, locale } = useTranslation();
  const id = (field: string) => `line-${index}-${field}`;
  const name = (c: ContactOption) => (locale === "ar" && c.nameAr ? c.nameAr : c.name);
  const ctOptions = (["deductible", "non_deductible", "exempt_income"] as const).filter(
    (c) => !accountType || ctTreatmentFitsAccount(c, accountType)
  );
  const foreign = !!line.currency && line.currency !== baseCurrency;

  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-md bg-card p-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid={`line-details-${index}`}
    >
      <Field id={id("contact")} label={t["journal.line.contact"]}>
        <Select
          value={line.contact || NONE}
          onValueChange={(v) => onChange({ contact: v === NONE ? "" : v })}
        >
          <SelectTrigger data-testid={`select-line-contact-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t["journal.line.noContact"]}</SelectItem>
            {customers.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t["journal.line.customers"]}</SelectLabel>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={`customer:${c.id}`}>
                    {name(c)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {vendors.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t["journal.line.suppliers"]}</SelectLabel>
                {vendors.map((c) => (
                  <SelectItem key={c.id} value={`vendor:${c.id}`}>
                    {name(c)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </Field>

      {costCenters.length > 0 && (
        <Field id={id("cost-center")} label={t["journal.line.costCenter"]}>
          <Select
            value={line.costCenterId || NONE}
            onValueChange={(v) => onChange({ costCenterId: v === NONE ? "" : v })}
          >
            <SelectTrigger data-testid={`select-line-cost-center-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t["journal.line.noCostCenter"]}</SelectItem>
              {costCenters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ${c.name}` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field
        id={id("vat")}
        label={t["journal.line.vat"]}
        help={
          preview.vatFils > 0 ? (
            <span data-testid={`line-vat-leg-${index}`}>
              {formatMessage(
                preview.vatKind === "output"
                  ? t["journal.line.outputVatLeg"]
                  : t["journal.line.inputVatLeg"],
                { amount: formatCurrency(preview.vatFils / 100, baseCurrency, locale) }
              )}
            </span>
          ) : undefined
        }
      >
        <Select
          value={line.vatTreatment || NONE}
          onValueChange={(v) =>
            onChange({ vatTreatment: v === NONE ? "" : (v as JournalGridLine["vatTreatment"]) })
          }
        >
          <SelectTrigger data-testid={`select-line-vat-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t["journal.line.vatNone"]}</SelectItem>
            <SelectItem value="standard">
              {formatMessage(t["journal.line.vatStandard"], {
                rate: `${Math.round(vatRate * 100)}%`,
              })}
            </SelectItem>
            <SelectItem value="zero_rated">{t["journal.line.vatZeroRated"]}</SelectItem>
            <SelectItem value="exempt">{t["journal.line.vatExempt"]}</SelectItem>
            <SelectItem value="out_of_scope">{t["journal.line.vatOutOfScope"]}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field
        id={id("currency")}
        label={t["journal.line.currency"]}
        help={
          foreign
            ? formatMessage(t["journal.line.foreignHelp"], { currency: line.currency })
            : undefined
        }
      >
        <Select
          value={line.currency || baseCurrency}
          onValueChange={(v) => onChange({ currency: v === baseCurrency ? "" : v })}
        >
          <SelectTrigger data-testid={`select-line-currency-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id={id("ct")} label={t["journal.line.ct"]}>
        <Select
          value={line.ctTreatment || NONE}
          onValueChange={(v) =>
            onChange({
              ctTreatment: v === NONE ? "" : (v as JournalGridLine["ctTreatment"]),
              ctDisallowedPct: v === "non_deductible" ? line.ctDisallowedPct || 50 : "",
            })
          }
        >
          <SelectTrigger data-testid={`select-line-ct-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t["journal.line.ctDefault"]}</SelectItem>
            {ctOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "deductible"
                  ? t["journal.line.ctDeductible"]
                  : c === "non_deductible"
                    ? t["journal.line.ctNonDeductible"]
                    : t["journal.line.ctExemptIncome"]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {line.ctTreatment === "non_deductible" && (
        <Field id={id("ct-pct")} label={t["journal.line.ctPct"]} help={t["journal.line.ctPctHelp"]}>
          <Input
            type="number"
            min={1}
            max={100}
            step="0.01"
            inputMode="decimal"
            className="text-end tabular-nums"
            dir="ltr"
            value={line.ctDisallowedPct}
            onChange={(e) =>
              onChange({ ctDisallowedPct: e.target.value === "" ? "" : Number(e.target.value) })
            }
            data-testid={`input-line-ct-pct-${index}`}
          />
        </Field>
      )}
    </div>
  );
}
