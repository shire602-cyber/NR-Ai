// The emirate of a supply (VAT 201 box 1a-1g). Each sales document carries its own emirate (invoices.emirate, copied from the
// customer contact; a credit note copies its invoice's). A document without one falls back to the company's own emirate.
// ONE mapping for the return, the Autopilot, the VAT Audit report and the workpaper.

export const VAT_EMIRATES = ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"] as const;
export type VatEmirate = (typeof VAT_EMIRATES)[number];

/** Box 1 row key prefix of each emirate in the VAT return (box1aAbuDhabiAmount, box1aAbuDhabiVat, box1aAbuDhabiAdj, ...). */
export const EMIRATE_BOX_PREFIX: Record<VatEmirate, string> = {
  abu_dhabi: "box1aAbuDhabi",
  dubai: "box1bDubai",
  sharjah: "box1cSharjah",
  ajman: "box1dAjman",
  umm_al_quwain: "box1eUmmAlQuwain",
  ras_al_khaimah: "box1fRasAlKhaimah",
  fujairah: "box1gFujairah",
};

/** "Abu Dhabi", "abu-dhabi", "ABU_DHABI" -> "abu_dhabi"; anything that is not one of the seven emirates -> null. */
export function normalizeVatEmirate(value: unknown): VatEmirate | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (VAT_EMIRATES as readonly string[]).includes(slug) ? (slug as VatEmirate) : null;
}

/** The emirate a document's supplies belong to: its own, else the company's, else the company value as given. */
export function supplyEmirate(documentEmirate: unknown, companyEmirate: unknown): VatEmirate {
  return normalizeVatEmirate(documentEmirate) ?? normalizeVatEmirate(companyEmirate) ?? "dubai";
}
