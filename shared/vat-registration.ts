/**
 * E3 (J2-r3 / J3-r3): one rule for "is this company VAT registered". A company that told us it
 * is not registered (onboarding "VAT: No", settings "Non-registered") charges no VAT, cannot
 * recover input VAT (supplier VAT is part of the cost) and files no VAT return. Every other
 * company keeps the registered behaviour (its TRN is checked where a return is generated).
 */
export const NON_REGISTERED_TYPE = "Non-registered";

export interface VatRegistrationFacts {
  taxRegistrationType?: string | null;
  trnVatNumber?: string | null;
}

export function isVatRegistered(company: VatRegistrationFacts | null | undefined): boolean {
  if (!company) return true;
  const type = (company.taxRegistrationType ?? "").trim().toLowerCase();
  return type !== NON_REGISTERED_TYPE.toLowerCase();
}
