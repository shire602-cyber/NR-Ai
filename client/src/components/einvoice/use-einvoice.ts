/** E1: data hooks for the e-invoice components (kept apart so the component files only export components). */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  EInvoiceCompliancePill,
  EInvoiceReadiness,
  EInvoiceDocumentRow,
  EInvoiceStatusView,
} from "./einvoice-meta";

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

/** X6d: invoice-list compliance pills; empty unless the e-invoicing mandate applies. */
export function useEInvoiceCompliance(companyId: string | null | undefined) {
  return useQuery<{ mandateApplies: boolean; items: EInvoiceCompliancePill[] }>({
    queryKey: ["/api/companies", companyId, "einvoicing", "compliance"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/compliance`),
    enabled: !!companyId,
    retry: false,
    staleTime: 30_000,
  });
}

/** X6d: company-level e-invoicing readiness checklist (dashboard card, onboarding). */
export function useEInvoiceReadiness(companyId: string | null | undefined) {
  return useQuery<EInvoiceReadiness>({
    queryKey: ["/api/companies", companyId, "einvoicing", "readiness"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/readiness`),
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
  });
}
