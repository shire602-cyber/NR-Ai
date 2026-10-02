import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPANY_EMIRATE, EMIRATES, EMIRATE_LABEL_KEYS, emirateValue, isEmirate } from "@/lib/emirates";
import { messages } from "./SalesShared.i18n";

interface Props {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** The company's own emirate, named in the "same as company" choice. */
  companyEmirate?: string | null;
  disabled?: boolean;
  testId?: string;
  id?: string;
}

/** An emirate picker for contacts, invoices and credit notes: empty means the company's emirate applies. */
export function EmirateSelect({ value, onChange, companyEmirate, disabled, testId, id }: Props) {
  const tr = messages.useT();
  const current = isEmirate(value) ? value : COMPANY_EMIRATE;
  const companyName = isEmirate(companyEmirate) ? tr(EMIRATE_LABEL_KEYS[companyEmirate]) : null;
  return (
    <Select value={current} onValueChange={(v) => onChange(emirateValue(v))} disabled={disabled}>
      <SelectTrigger id={id} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={COMPANY_EMIRATE}>{companyName ? tr("emirateSameAsCompanyNamed", { emirate: companyName }) : tr("emirateSameAsCompany")}</SelectItem>
        {EMIRATES.map((e) => (
          <SelectItem key={e} value={e}>
            {tr(EMIRATE_LABEL_KEYS[e])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The emirate's name in the interface language, "" for none. */
export function useEmirateLabel(): (value: string | null | undefined) => string {
  const tr = messages.useT();
  return (value) => (isEmirate(value) ? tr(EMIRATE_LABEL_KEYS[value]) : "");
}
