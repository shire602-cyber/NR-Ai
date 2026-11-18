import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { accountDisplayName } from "@/lib/account-name";
import { purchaseLineAccountGroups, type PurchaseLineAccount } from "@/lib/control-account-options";

/**
 * E3 (J1-r3): the grouped options of a bill / expense line account picker (Expenses, Fixed
 * assets, Other assets). Cash, bank, control, contra and header accounts are not offered.
 */
export function PurchaseAccountOptions({
  accounts,
  withCode = false,
}: {
  accounts: readonly (PurchaseLineAccount & { id: string; nameAr?: string | null })[];
  withCode?: boolean;
}) {
  const { t, locale } = useTranslation();
  const groups = purchaseLineAccountGroups(accounts);
  const label = (a: (typeof accounts)[number]) =>
    withCode && a.code
      ? `${a.code} · ${accountDisplayName(a, locale)}`
      : accountDisplayName(a, locale);
  const sections: Array<[string, typeof groups.expenses]> = [
    [t["forms.accountGroupExpenses"], groups.expenses],
    [t["forms.accountGroupFixedAssets"], groups.fixedAssets],
    [t["forms.accountGroupOtherAssets"], groups.otherAssets],
  ];
  return (
    <>
      {sections
        .filter(([, list]) => list.length > 0)
        .map(([heading, list]) => (
          <SelectGroup key={heading}>
            <SelectLabel>{heading}</SelectLabel>
            {list.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {label(a)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
    </>
  );
}
