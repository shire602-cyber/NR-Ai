/** E1: data hooks for the e-invoice components (kept apart so the component files only export components). */
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  EInvoiceCompliancePill,
  EInvoiceReadiness,
  EInvoiceDocumentRow,
  EInvoiceListEvidence,
  EInvoiceStatusView,
} from "./einvoice-meta";

export const einvoiceStatusKey = (invoiceId: string) => ["einvoice-status", invoiceId];

export function useEInvoiceStatus(invoiceId: string | null | undefined, watch = false) {
  return useQuery<EInvoiceStatusView>({
    queryKey: einvoiceStatusKey(invoiceId ?? ""),
    queryFn: () => apiRequest("GET", `/api/invoices/${invoiceId}/einvoice/status`),
    enabled: !!invoiceId,
    retry: false,
    refetchInterval: ({ state }) => {
      if (!watch) return false;
      if (state.data?.submissionState === "queued") return 5_000;
      if (state.data?.submissionState === "sent" && state.data.transmission.providerDocumentId) {
        return 15_000;
      }
      return false;
    },
  });
}

interface InvoiceEvidenceBatch {
  items: EInvoiceCompliancePill[];
  documents: EInvoiceDocumentRow[];
}

/** One evidence query per loaded invoice page, scoped to the displayed IDs. */
export function useEInvoiceListEvidence(companyId: string | undefined, batches: string[][]) {
  return useQueries({
    queries: batches
      .filter((ids) => ids.length)
      .map((ids) => ({
        queryKey: ["/api/companies", companyId, "einvoicing", "compliance", ids],
        queryFn: (): Promise<InvoiceEvidenceBatch> =>
          apiRequest(
            "GET",
            `/api/companies/${companyId}/einvoicing/compliance?invoiceIds=${ids.join(",")}`
          ),
        enabled: !!companyId,
        retry: false,
        staleTime: 30_000,
      })),
    combine: (results) => {
      const evidence: Record<string, EInvoiceListEvidence> = {};
      for (const { data } of results) {
        for (const pill of data?.items ?? []) evidence[pill.invoiceId] = { pill };
        for (const doc of data?.documents ?? []) {
          evidence[doc.invoiceId] = { ...evidence[doc.invoiceId], doc };
        }
      }
      return evidence;
    },
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
