/**
 * PINT AE code lists and identifiers used by the UBL generator, the rule list
 * and the settings page. Values are taken from the OpenPeppol PINT AE
 * schematron (release 2026.5, vendored under server/assets/einvoice/) — the
 * rule id that checks each list is noted next to it.
 */

/** Peppol participant identifier scheme for the UAE (TIN based). */
export const PEPPOL_SCHEME_UAE_TIN = "0235";

/** ibr-128-ae: country subdivision for AE addresses. */
export const EMIRATE_SUBENTITY: Record<string, string> = {
  abu_dhabi: "AUH",
  dubai: "DXB",
  sharjah: "SHJ",
  ajman: "AJM",
  umm_al_quwain: "UAQ",
  ras_al_khaimah: "RAK",
  fujairah: "FUJ",
};
export const EMIRATE_SUBENTITY_CODES = ["AUH", "DXB", "SHJ", "UAQ", "FUJ", "AJM", "RAK"] as const;

/** Map a stored emirate ("dubai", "Dubai", "DXB", "ras al khaimah") to its PINT AE code. */
export function emirateSubentity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if ((EMIRATE_SUBENTITY_CODES as readonly string[]).includes(v.toUpperCase())) {
    return v.toUpperCase();
  }
  const key = v
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^emirate_of_/, "");
  return EMIRATE_SUBENTITY[key] ?? null;
}

/** ibr-173/183-ae: legal registration identifier types (schemeAgencyID). */
export const LEGAL_ID_TYPES = {
  TL: { en: "Commercial / trade licence", ar: "رخصة تجارية" },
  EID: { en: "Emirates ID", ar: "الهوية الإماراتية" },
  PAS: { en: "Passport", ar: "جواز السفر" },
  CD: { en: "Cabinet decision", ar: "قرار مجلس الوزراء" },
} as const;
export type LegalIdType = keyof typeof LEGAL_ID_TYPES;

/** ibr-001/158-ae: credit note reason codes (BTAE-03, cac:DiscrepancyResponse/cbc:ResponseCode). */
export const CREDIT_NOTE_REASON_CODES = {
  "DL8.61.1.A": "VAT Decree-Law Art. 61(1)(a) adjustment",
  "DL8.61.1.B": "VAT Decree-Law Art. 61(1)(b) adjustment",
  "DL8.61.1.C": "VAT Decree-Law Art. 61(1)(c) adjustment",
  "DL8.61.1.D": "VAT Decree-Law Art. 61(1)(d) adjustment",
  "DL8.61.1.E": "VAT Decree-Law Art. 61(1)(e) adjustment",
  VD: "Volume discount",
} as const;
export type CreditNoteReasonCode = keyof typeof CREDIT_NOTE_REASON_CODES;
export const DEFAULT_CREDIT_NOTE_REASON: CreditNoteReasonCode = "DL8.61.1.C";

/** ibr-006-ae: goods/services subject to domestic reverse charge (cbc:NatureCode, BTAE-09). */
export const RCM_GOODS_TYPE_CODES = [
  "DL8.48.3.1",
  "DL8.48.3.2",
  "DL8.48.3.3",
  "DL8.48.8.1",
  "DL8.48.8.2",
] as const;

/**
 * ibr-154-ae: invoice transaction type flags (BTAE-02, cbc:ProfileExecutionID),
 * eight 0/1 characters in this order.
 */
export const TRANSACTION_FLAGS = [
  "freeTradeZone",
  "deemedSupply",
  "marginScheme",
  "summaryInvoice",
  "continuousSupply",
  "disclosedAgent",
  "ecommerce",
  "exports",
] as const;
export type TransactionFlag = (typeof TRANSACTION_FLAGS)[number];

export function transactionTypeCode(flags: Partial<Record<TransactionFlag, boolean>>): string {
  return TRANSACTION_FLAGS.map((f) => (flags[f] ? "1" : "0")).join("");
}

/**
 * UNCL1001 document types. PINT AE admits 380/480 (Invoice) and 381/81
 * (CreditNote) only (ibr-cl-01); a UAE debit note is emitted as 380 with a BillingReference.
 */
export const DOCUMENT_TYPE = {
  invoice: "380",
  outOfScope: "480",
  creditNote: "381",
  outOfScopeCreditNote: "81",
} as const;

export const PINT_AE_CREDIT_NOTE_TYPES: readonly string[] = [
  DOCUMENT_TYPE.creditNote,
  DOCUMENT_TYPE.outOfScopeCreditNote,
];

export function isPintAeCreditNoteType(value?: string | null): boolean {
  return typeof value === "string" && PINT_AE_CREDIT_NOTE_TYPES.includes(value);
}

/** Classify references returned by an ASP, including self-billed credit notes. */
export function isCreditNoteDocumentType(value?: string | null): boolean {
  return isPintAeCreditNoteType(value) || value === "261" || value === "credit-note";
}

/** UNCL4461 payment means codes offered in settings. */
export const PAYMENT_MEANS = {
  "1": "Instrument not defined",
  "10": "In cash",
  "20": "Cheque",
  "30": "Credit transfer",
  "42": "Payment to bank account",
  "48": "Bank card",
  "49": "Direct debit",
  "54": "Credit card",
  "55": "Debit card",
  "68": "Online payment service",
} as const;
export type PaymentMeansCode = keyof typeof PAYMENT_MEANS;

/** Human text for the stored payment-terms code (BT-20). */
export function paymentTermsText(terms: string | null | undefined): string | null {
  if (!terms) return null;
  const t = terms.trim().toLowerCase();
  if (t === "due_on_receipt" || t === "receipt") return "Due on receipt";
  const m = /^net\s*_?(\d{1,3})$/.exec(t);
  if (m) return `Net ${m[1]} days`;
  return terms.trim();
}

/** Exemption / category reason text (IBT-120/121) for non-standard categories. */
export const CATEGORY_REASON_TEXT: Record<string, string> = {
  Z: "Zero-rated supply (UAE VAT Decree-Law Art. 45)",
  E: "Exempt supply (UAE VAT Decree-Law Art. 46)",
  O: "Supply outside the scope of UAE VAT",
  AE: "Reverse charge: recipient accounts for VAT (UAE VAT Decree-Law Art. 48)",
};

/** Peppol participant id validation for scheme 0235 (TIN: 10 digits, starts with 1). */
export function isUaeTin(value: string | null | undefined): boolean {
  return typeof value === "string" && /^1\d{9}$/.test(value);
}

/** ibr-132-ae: UAE TRN is 15 digits, starts with 1 and ends with 03. */
export function isPintAeTrn(value: string | null | undefined): boolean {
  return typeof value === "string" && /^1\d{12}03$/.test(value);
}

/** TRN → TIN (the first 10 digits), the TRN-based fallback participant id. */
export function tinFromTrn(trn: string | null | undefined): string | null {
  return trn && isPintAeTrn(trn) ? trn.slice(0, 10) : null;
}

/** The 0235 participant must identify the same UAE taxpayer as the statutory registration. */
export function uaePeppolEndpointIssue(
  scheme: string | null | undefined,
  endpoint: string,
  taxpayerTin: string | null
): "invalid" | "mismatch" | null {
  if (scheme !== PEPPOL_SCHEME_UAE_TIN) return null;
  if (!isUaeTin(endpoint)) return "invalid";
  return taxpayerTin && endpoint !== taxpayerTin ? "mismatch" : null;
}
