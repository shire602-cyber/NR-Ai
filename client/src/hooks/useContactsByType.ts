import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ContactType } from "@/lib/purchasing-hr";

export interface TypedContact {
  id: string;
  name: string;
  nameAr?: string | null;
  email?: string | null;
  phone?: string | null;
  trnNumber?: string | null;
  country?: string | null;
  contactType?: ContactType | null;
}

/**
 * Contacts of one side: `customer` includes contacts that are both, `vendor` likewise.
 * The key starts with the same prefix as the contacts page, so saving a contact refreshes every picker.
 */
export function useContactsByType(companyId: string | undefined, type: "customer" | "vendor") {
  return useQuery<TypedContact[]>({
    queryKey: ["/api/companies", companyId, "customer-contacts", "by-type", type],
    enabled: Boolean(companyId),
    staleTime: 30_000,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/customer-contacts?type=${type}`),
  });
}
