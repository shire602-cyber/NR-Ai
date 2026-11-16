/** E1: data hooks for the e-invoice components (kept apart so the component files only export components). */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { EInvoiceDocumentRow, EInvoiceStatusView } from "./einvoice-meta";

export const einvoiceStatusKey = (invoiceId: string) => ["einvoice-status", invoiceId];

export function useEInvoiceStatus(invoiceId: string | null | undefined) {
  return useQuery<EInvoiceStatusView>({
    queryKey: einvoiceStatusKey(invoiceId ?? ""),
    queryFn: () => apiRequest("GET", `/api/invoices/${invoiceId}/einvoice/status`),
    enabled: !!invoiceId,
    retry: false,
  });
}

export function useEInvoiceDocuments(companyId: string | null | undefined) {
  return useQuery<{ items: EInvoiceDocumentRow[] }>({
    queryKey: ["/api/companies", companyId, "einvoicing", "documents"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/documents`),
    enabled: !!companyId,
    retry: false,
    staleTime: 30_000,
  });
}
