import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { accountDisplayName } from "@/lib/account-name";

export interface IncomeAccountOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

const AUTO = "__auto__";
/**
 * Income accounts that carry a VAT treatment (zero-rated 4060, exempt 4070, out of scope 4030):
 * those lines keep their account, so they are not offered for a standard-rated line.
 */
const VAT_TREATMENT_CODES = new Set(["4030", "4060", "4070"]);

/** The income accounts a standard-rated invoice line can post to. */
export function lineIncomeAccounts<T extends IncomeAccountOption>(accounts: T[]): T[] {
  return accounts
    .filter(
      (a) =>
        a.type === "income" &&
        a.isActive !== false &&
        a.isArchived !== true &&
        !VAT_TREATMENT_CODES.has(a.code)
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * E3 (J1-r3): the income account of an invoice line. "Automatic" keeps the item rule (a service
 * item posts to Service Revenue, goods and free-text lines to Product Sales); choosing an account
 * posts the line there. Only standard-rated lines use it.
 */
export function LineIncomeAccountPicker({
  accounts,
  value,
  onChange,
  index,
  disabled,
}: {
  accounts: IncomeAccountOption[];
  value: string | undefined;
  onChange: (accountId: string | undefined) => void;
  index: number;
  disabled?: boolean;
}) {
  const { t, locale } = useTranslation();
  const options = lineIncomeAccounts(accounts);
  if (options.length === 0) return null;
  return (
    <Select
      value={value || AUTO}
      onValueChange={(id) => onChange(id === AUTO ? undefined : id)}
      disabled={disabled}
    >
      <SelectTrigger
        className="ms-7 min-w-0 flex-1 sm:ms-0 sm:w-48 sm:flex-none sm:shrink-0"
        aria-label={t["invoices.item.incomeAccountLabel"]}
        title={t["invoices.item.incomeAccountLabel"]}
        data-testid={`select-line-income-account-${index}`}
      >
        <SelectValue placeholder={t["invoices.item.incomeAccountAuto"]} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{t["invoices.item.incomeAccountAuto"]}</SelectItem>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.code} · {accountDisplayName(a, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
