/** WQ5: map the identity endpoint's stable error codes to a field and localised copy. */
import { ApiError } from "@/lib/queryClient";
import type { TaxIdentityForm } from "./tax-identity";

const CODE_FIELD: Record<string, { field: keyof TaxIdentityForm; key: string }> = {
  TIN_FORMAT: { field: "einvoiceTin", key: "einvoicing.taxId.tinFormatError" },
  TIN_CT_TRN_MISMATCH: { field: "einvoiceTin", key: "einvoicing.taxId.tinCtMismatch" },
  TIN_VAT_TRN_MISMATCH: { field: "einvoiceTin", key: "einvoicing.taxId.tinVatMismatch" },
  SELLER_ID_REQUIRED: { field: "sellerIdNumber", key: "einvoicing.taxId.idRequired" },
  SELLER_ID_EID_FORMAT: { field: "sellerIdNumber", key: "einvoicing.taxId.idEidFormat" },
  SELLER_ID_PASSPORT_FORMAT: { field: "sellerIdNumber", key: "einvoicing.taxId.idPassportFormat" },
  SELLER_ID_PASSPORT_COUNTRY: {
    field: "sellerIdCountry",
    key: "einvoicing.taxId.idPassportCountry",
  },
};

export function identityErrorFor(
  err: unknown,
  t: Record<string, string>
): { field: keyof TaxIdentityForm; message: string } | null {
  const code = err instanceof ApiError ? String(err.body?.code ?? "") : "";
  const hit = CODE_FIELD[code];
  return hit ? { field: hit.field, message: t[hit.key] } : null;
}
