/**
 * WQ5: client side of the company e-invoicing identity (Settings › Company card and the
 * "get your first invoice tax-ready" prompt). One query key so both stay in step.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  CompanyTaxIdentityBody,
  SellerIdType,
  TaxReadyField,
} from "@shared/validators/einvoice-identity";

export interface TaxIdentityView {
  legalName: string | null;
  legalNameAr: string | null;
  displayName: string;
  einvoiceTin: string | null;
  effectiveTin: string | null;
  tinSuggestion: string | null;
  tinSource: "stored" | "ct_trn" | "vat_trn" | null;
  sellerIdType: SellerIdType | null;
  sellerIdNumber: string | null;
  sellerIdCountry: string | null;
  tradeLicenceAuthority: string | null;
  sellerLegalId: { type: SellerIdType; number: string } | null;
  addressStreet: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressPoBox: string | null;
  addressAr: string | null;
  emirate: string | null;
  missing: TaxReadyField[];
}

export interface TaxReadyState {
  show: boolean;
  missing: TaxReadyField[];
  promptedAt: string | null;
  identity: TaxIdentityView;
}

export const taxIdentityKey = (companyId: string) =>
  ["/api/companies", companyId, "einvoicing", "identity"] as const;
export const taxReadyKey = (companyId: string) =>
  ["/api/companies", companyId, "einvoicing", "tax-ready"] as const;

export function useTaxIdentity(companyId: string | undefined | null) {
  return useQuery<TaxIdentityView>({
    queryKey: taxIdentityKey(companyId ?? ""),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/einvoicing/identity`),
    enabled: !!companyId,
  });
}

export function useSaveTaxIdentity(companyId: string | undefined | null) {
  return useMutation<TaxIdentityView, Error, CompanyTaxIdentityBody>({
    mutationFn: (body) =>
      apiRequest("PUT", `/api/companies/${companyId}/einvoicing/identity`, body),
    onSuccess: (view) => {
      if (!companyId) return;
      queryClient.setQueryData(taxIdentityKey(companyId), view);
      void queryClient.invalidateQueries({ queryKey: taxReadyKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
    },
  });
}

/** The editable form state for the identity fields (strings; "" means empty). */
export interface TaxIdentityForm {
  legalName: string;
  legalNameAr: string;
  einvoiceTin: string;
  sellerIdType: SellerIdType | "";
  sellerIdNumber: string;
  sellerIdCountry: string;
  tradeLicenceAuthority: string;
  addressStreet: string;
  addressDistrict: string;
  addressCity: string;
  addressPoBox: string;
  addressAr: string;
  emirate: string;
}

export function formFromIdentity(v: TaxIdentityView | undefined): TaxIdentityForm {
  return {
    legalName: v?.legalName ?? "",
    legalNameAr: v?.legalNameAr ?? "",
    // Prefill the TIN from the CT TRN (else the VAT TRN) when none is stored.
    einvoiceTin: v?.einvoiceTin ?? v?.tinSuggestion ?? "",
    sellerIdType: v?.sellerIdType ?? v?.sellerLegalId?.type ?? "",
    sellerIdNumber: v?.sellerIdNumber ?? v?.sellerLegalId?.number ?? "",
    sellerIdCountry: v?.sellerIdCountry ?? "",
    tradeLicenceAuthority: v?.tradeLicenceAuthority ?? "",
    addressStreet: v?.addressStreet ?? "",
    addressDistrict: v?.addressDistrict ?? "",
    addressCity: v?.addressCity ?? "",
    addressPoBox: v?.addressPoBox ?? "",
    addressAr: v?.addressAr ?? "",
    emirate: v?.emirate ?? "",
  };
}

const blank = (s: string) => (s.trim() === "" ? null : s.trim());

/** Body for PUT …/identity: only the given keys (the prompt sends only what it asked for). */
export function bodyFromForm(
  form: TaxIdentityForm,
  keys: readonly (keyof TaxIdentityForm)[]
): CompanyTaxIdentityBody {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === "sellerIdType") out[k] = form.sellerIdType || null;
    else if (k === "emirate") out[k] = form.emirate || null;
    else out[k] = blank(form[k]);
  }
  return out as CompanyTaxIdentityBody;
}

/** Which form keys a missing prompt field needs. */
export const FIELD_KEYS: Record<TaxReadyField, (keyof TaxIdentityForm)[]> = {
  legalName: ["legalName"],
  tin: ["einvoiceTin"],
  sellerId: ["sellerIdType", "sellerIdNumber", "sellerIdCountry", "tradeLicenceAuthority"],
  addressStreet: ["addressStreet", "addressDistrict"],
  addressCity: ["addressCity"],
  emirate: ["emirate"],
};

/** Local check before the server's (same rules; the server stays the authority). */
export function tinLocalError(tin: string): "format" | null {
  const v = tin.trim();
  if (!v) return null;
  return /^1\d{9}$/.test(v) ? null : "format";
}
