/** The seven emirates of box 1a-1g of the VAT 201, as the server stores them (same set as the company emirate). */
export const EMIRATES = ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"] as const;
export type Emirate = (typeof EMIRATES)[number];

export const EMIRATE_LABEL_KEYS = {
  abu_dhabi: "emirateAbuDhabi",
  dubai: "emirateDubai",
  sharjah: "emirateSharjah",
  ajman: "emirateAjman",
  umm_al_quwain: "emirateUmmAlQuwain",
  ras_al_khaimah: "emirateRasAlKhaimah",
  fujairah: "emirateFujairah",
} as const satisfies Record<Emirate, string>;

/** The select value that means "no emirate of its own: the company's emirate applies". */
export const COMPANY_EMIRATE = "__company__";

export function isEmirate(value: unknown): value is Emirate {
  return typeof value === "string" && (EMIRATES as readonly string[]).includes(value);
}

/** The emirate to send: a valid emirate, or null for "the company's emirate". */
export function emirateValue(selectValue: string | null | undefined): Emirate | null {
  return isEmirate(selectValue) ? selectValue : null;
}

/** The emirate a new invoice starts with: the customer's own, else none (the company's emirate applies). */
export function defaultInvoiceEmirate(contact: { emirate?: string | null } | null | undefined): Emirate | null {
  return emirateValue(contact?.emirate);
}
