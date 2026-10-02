import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContactsByType, type TypedContact } from "@/hooks/useContactsByType";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { salesKeys, type PriceListResolution } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

const TYPED = "__typed__";

interface Props {
  companyId: string | undefined | null;
  contactId: string | null | undefined;
  onSelect: (contact: TypedContact | null) => void;
  /** Contact required (sales orders, advances); otherwise "type a name" is offered. */
  required?: boolean;
  disabled?: boolean;
  testId?: string;
  label?: string;
}

/** Pick the customer from the contacts list. Picking one carries its name, TRN and (for the editors) price list. */
export function ContactPicker({ companyId, contactId, onSelect, required, disabled, testId, label }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const contacts = useContactsByType(companyId ?? undefined, "customer");
  const list = contacts.data ?? [];
  return (
    <div className="space-y-1.5">
      <Label>{label ?? tr("customerFromContacts")}</Label>
      <Select
        value={contactId ?? (required ? undefined : TYPED)}
        disabled={disabled}
        onValueChange={(v) => onSelect(v === TYPED ? null : (list.find((c) => c.id === v) ?? null))}
      >
        <SelectTrigger data-testid={testId ?? "select-contact"}>
          <SelectValue placeholder={tr("selectCustomer")} />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={TYPED}>{tr("typeCustomerName")}</SelectItem>}
          {list.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {locale === "ar" && c.nameAr ? c.nameAr : c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The customer's price list for a document currency: prices by product, applied when a product is picked. */
export function usePriceListResolution(companyId: string | undefined | null, contactId: string | null | undefined, currency: string) {
  return useQuery<PriceListResolution>({
    queryKey: [...salesKeys.priceLists(companyId), "resolve", contactId ?? "none", currency],
    enabled: Boolean(companyId && contactId),
    staleTime: 30_000,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/price-lists/resolve?contactId=${contactId}&currency=${encodeURIComponent(currency)}`),
  });
}
