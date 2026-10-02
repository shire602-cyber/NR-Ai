// What a UAE company's VAT setup may say (Phase 9, teardown F10/F11). Pure module.
//
// The UAE has no "Flat Rate" VAT scheme and no annual VAT filing: a registrant files monthly or quarterly (FTA assigns the
// stagger). The UI used to offer both, and a company set to them produced returns that cannot exist. The API refuses them.

/** The bank names the server accepts for a bank account (the onboarding and bank screens must offer exactly these). */
export const UAE_BANK_NAMES = ["Emirates NBD", "ADCB", "FAB", "Mashreq", "Other"] as const;

export const TAX_REGISTRATION_TYPES = ["Standard", "Non-registered", "Other"] as const;
export const VAT_FILING_FREQUENCIES = ["Monthly", "Quarterly"] as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

export type SetupProblem = { status: 422; code: string; message: string; field: string };

export function vatSetupProblem(input: { taxRegistrationType?: unknown; vatFilingFrequency?: unknown }): SetupProblem | null {
  if (input.taxRegistrationType !== undefined && input.taxRegistrationType !== null && norm(input.taxRegistrationType) === "flatrate") {
    return {
      status: 422,
      code: "FLAT_RATE_NOT_SUPPORTED",
      field: "taxRegistrationType",
      message: `The UAE has no Flat Rate VAT scheme. Choose one of: ${TAX_REGISTRATION_TYPES.join(", ")}.`,
    };
  }
  const f = norm(input.vatFilingFrequency);
  if (input.vatFilingFrequency !== undefined && input.vatFilingFrequency !== null && ["annually", "annual", "yearly", "year"].includes(f)) {
    return {
      status: 422,
      code: "ANNUAL_FILING_NOT_SUPPORTED",
      field: "vatFilingFrequency",
      message: `VAT is filed monthly or quarterly in the UAE, not annually. Choose one of: ${VAT_FILING_FREQUENCIES.join(", ")}.`,
    };
  }
  return null;
}
