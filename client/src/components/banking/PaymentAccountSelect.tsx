import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import type { BankAccount, LedgerAccount } from "@/lib/banking-api-types";
import { messages } from "./PaymentAccountSelect.i18n";
import { paymentAccountChoices } from "./payment-accounts";

interface Props {
  companyId: string;
  value: string;
  onChange: (id: string) => void;
  testId?: string;
}

/** The bank or cash account a payment leaves from: required, never a header account, the main bank account preselected. */
export function PaymentAccountSelect({ companyId, value, onChange, testId = "select-payment-account" }: Props) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: !!companyId });
  const { data: banks = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/companies", companyId, "bank-accounts"], enabled: !!companyId });
  const choices = useMemo(() => paymentAccountChoices(accounts, banks), [accounts, banks]);

  // preselect the main bank account whenever the field is empty (a fresh dialog), and drop a value that is not offered
  useEffect(() => {
    if (choices.options.length === 0) return;
    if (!value || !choices.options.some((o) => o.id === value)) onChange(choices.defaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, choices.defaultId, choices.options.length]);

  return (
    <div className="space-y-1">
      <Label>{tr("label")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder={tr("placeholder")} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {choices.options.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <span dir="ltr" className="font-mono">
                {a.code}
              </span>{" "}
              {accountName(a, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{choices.options.length === 0 ? tr("none") : tr("hint")}</p>
    </div>
  );
}
