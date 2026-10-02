import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCashBankAccounts } from "@/hooks/useCashBankAccounts";
import { useTranslation } from "@/lib/i18n";

interface Props {
  companyId: string;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  testId?: string;
}

/** Cash and bank accounts of the company, named in the interface language. */
export function PaymentAccountSelect({ companyId, value, onChange, placeholder, testId = "select-payment-account" }: Props) {
  const { accounts } = useCashBankAccounts(companyId);
  const { locale } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.code} - {locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
