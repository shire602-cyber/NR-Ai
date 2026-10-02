import type { Control, FieldValues, Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LedgerAccount } from "@/lib/banking-api-types";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import { messages } from "./DisposalProceedsField.i18n";

export const DEFAULT_PROCEEDS = "default";

/** The proceeds account of a disposal: one of the company's bank or cash accounts, or the default cash account. */
export function DisposalProceedsField<T extends FieldValues>({ control, name, accounts }: { control: Control<T>; name: Path<T>; accounts: LedgerAccount[] }) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{tr("label")}</FormLabel>
          <Select value={field.value || DEFAULT_PROCEEDS} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger data-testid="select-proceeds-account">
                <SelectValue placeholder={tr("placeholder")} />
              </SelectTrigger>
            </FormControl>
            <SelectContent className="max-h-72">
              <SelectItem value={DEFAULT_PROCEEDS}>{tr("defaultOption")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span dir="ltr" className="font-mono">
                    {a.code}
                  </span>{" "}
                  {accountName(a, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>{tr("hint")}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
