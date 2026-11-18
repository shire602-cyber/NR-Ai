/**
 * WQ5: the hook the invoice editor calls to decide whether to show the first-invoice e-invoice
 * details prompt (TaxReadyModal). The editor (WQ1) wires it:
 *
 *   const taxReady = useTaxReadyPrompt(companyId, { enabled: isNewInvoice });
 *   ...
 *   <TaxReadyModal {...taxReady.modalProps} />
 *
 * `enabled` should be true on a new invoice only. It opens at most once per page view, and the
 * server shows it at most once per company (Later and Save both record it).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { taxReadyKey, type TaxReadyState } from "./tax-identity";

export interface TaxReadyModalProps {
  open: boolean;
  companyId: string;
  state: TaxReadyState | undefined;
  /** Called after Save or Later (the editor continues either way). */
  onDone: (outcome: "saved" | "skipped") => void;
}

/** Open only when the data is loaded, fields are missing and it was never shown. */
export function shouldOpenTaxReady(state: TaxReadyState | undefined): boolean {
  return !!state && state.show && state.missing.length > 0;
}

export function useTaxReadyPrompt(
  companyId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const query = useQuery<TaxReadyState>({
    queryKey: taxReadyKey(companyId ?? ""),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/tax-ready`),
    enabled: !!companyId && enabled,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const shouldOpen = enabled && shouldOpenTaxReady(query.data);
  useEffect(() => {
    if (!opened.current && shouldOpen) {
      opened.current = true;
      setOpen(true);
    }
  }, [shouldOpen]);
  const modalProps: TaxReadyModalProps = {
    open,
    companyId: companyId ?? "",
    state: query.data,
    onDone: () => setOpen(false),
  };
  return { open, state: query.data, modalProps };
}
