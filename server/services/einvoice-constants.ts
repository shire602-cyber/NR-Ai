/**
 * E-invoicing constants that are policy, not logic: identifiers that must be
 * confirmed with the chosen Accredited Service Provider (ASP) or the FTA before
 * go-live. Kept in one place so a correction touches no serializer code.
 */

/** UBL namespaces. */
export const UBL_NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
export const UBL_NS_CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
export const UBL_NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
export const UBL_NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

// PINT AE profile identifiers, confirmed against the UAE MoF PINT-AE
// specification v1.0 (published 19 Jun 2025) and the Peppol PINT-AE BIS docs.
export const EINVOICE_CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@ae-1";
export const EINVOICE_PROFILE_ID = "urn:peppol:bis:billing";

// UBL document type codes (UNCL1001): 380 = commercial invoice, 381 = credit note.
export const INVOICE_TYPE_CODE_INVOICE = "380";
export const INVOICE_TYPE_CODE_CREDIT_NOTE = "381";

/**
 * Peppol Electronic Address Scheme (EAS) code written as `schemeID` on
 * `cbc:EndpointID` for a party identified by its UAE TRN.
 *
 * "0235" is the scheme commonly cited for the UAE TIN/TRN in the Peppol EAS code
 * list. It has NOT been confirmed against the current Peppol EAS list or the PINT-AE
 * specification, and it MUST be confirmed with the chosen ASP before go-live.
 */
export const PEPPOL_EAS_UAE_TRN = "0235";

/** Emit `cbc:EndpointID` for seller and buyer. Set false if the ASP assigns routing itself. */
export const EMIT_ENDPOINT_ID = true;

/**
 * How a credit note is serialised:
 *  - "credit-note"  : a true `<CreditNote>` root (UBL CreditNote-2, CreditNoteTypeCode 381,
 *                     `cac:CreditNoteLine`, `cbc:CreditedQuantity`) - the default;
 *  - "invoice-381"  : the earlier form, an `<Invoice>` root with InvoiceTypeCode 381, kept in
 *                     case a provider requires it.
 */
export type CreditNoteSyntax = "credit-note" | "invoice-381";
export const EINVOICE_CREDIT_NOTE_SYNTAX: CreditNoteSyntax = "credit-note";

/** UN/ECE Recommendation 20 unit code used when a line has none ("C62" = one / unit; "EA" = each). */
export const EINVOICE_DEFAULT_UNIT_CODE = "C62";

/** UNCL7143-style list identifier for `cbc:ItemClassificationCode` ("HS" = Harmonized System). */
export const EINVOICE_ITEM_CLASSIFICATION_LIST_ID = "HS";

/** UNCL4461 payment means code: 30 = credit transfer. */
export const PAYMENT_MEANS_CREDIT_TRANSFER = "30";

/**
 * Emirate -> `cbc:CountrySubentity`. UNVERIFIED: the PINT-AE spec defines the code list
 * for the emirate; these three-letter abbreviations must be confirmed against it.
 */
export const EMIRATE_SUBENTITY_CODES: Record<string, string> = {
  abu_dhabi: "AUH",
  dubai: "DXB",
  sharjah: "SHJ",
  ajman: "AJM",
  umm_al_quwain: "UAQ",
  ras_al_khaimah: "RAK",
  fujairah: "FUJ",
};

/** Country used when a party has an address but no recognisable country. */
export const EINVOICE_DEFAULT_COUNTRY = "AE";
